import { lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, posix } from "node:path";
import { runSystemCommand } from "../execution/transport-broker.ts";
import { loadCatalog } from "../registry/catalog.ts";
import { closureDelta } from "../closure/delta.ts";
import type { ClosureRegistry, ClosureTree } from "../closure/tree.ts";
import type { ClosureRecord } from "../contracts/closure-record.ts";
import { canonicalCheckoutDirt, dirtyPathSummary, runGit, type GitRunner } from "./changes.ts";
import { buildGitEnvironment } from "./environment.ts";

export function closureGitRunner(repository: string): GitRunner {
  return argv => runSystemCommand("git", ["-C", repository, "--literal-pathspecs", ...argv], {
    timeoutMs: 30_000, env: buildGitEnvironment({ noOptionalLocks: true }),
  });
}

export interface ClosureSnapshot {
  readonly tree: ClosureTree;
  readonly registry: ClosureRegistry;
  readonly modes: ReadonlyMap<string, string>;
  readonly blobs: ReadonlyMap<string, string>;
}

const SNAPSHOT_CACHE = new Map<string, ClosureSnapshot>();
const BLOB_CACHE = new Map<string, Uint8Array>();

export function clearClosureSnapshotCache(): void {
  SNAPSHOT_CACHE.clear();
  BLOB_CACHE.clear();
}

/** Registration is read independently from each committed tree, never a sealed ticket path. */
export function readClosureSnapshot(git: GitRunner, sha: string): ClosureSnapshot {
  if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error("closure requires an exact commit SHA");
  const cached = SNAPSHOT_CACHE.get(sha);
  if (cached !== undefined) return cached;
  const catalog = loadCatalog(runGit(git, ["show", `${sha}:awsf.project.yaml`]));
  const root = catalog.plans.root.replace(/\/$/u, "");
  if (root.startsWith("/") || root.split("/").some(part => part === ".." || part === ".") || root.includes("\\")) throw new Error("closure refuses a plans root outside the canonical repository");
  const modes = new Map<string, string>();
  const blobs = new Map<string, string>();
  for (const row of runGit(git, ["ls-tree", "-rz", "--full-tree", sha]).split("\0").filter(Boolean)) {
    const match = /^(\d+) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/u.exec(row);
    if (match === null) throw new Error("closure cannot read Git tree entry");
    modes.set(match[4]!, match[1]!);
    blobs.set(match[4]!, match[3]!);
  }
  const repositoryId = Object.entries(catalog.repositories).find(([, repo]) => repo.role === "plan")?.[0];
  if (repositoryId === undefined) throw new Error("closure has no registered plan repository");
  const plans = [...blobs.keys()].filter(path => posix.dirname(path) === root && path.endsWith(".html")).sort().map(planPath => {
    const label = posix.basename(planPath, ".html");
    return { project: catalog.project.slug, repositoryId, label, planPath,
      promptsPath: `${root}/${label}-build-prompts.md`, ticketsPath: `${root}/tickets/${label}`, format: catalog.plans.format };
  });
  const lightTickets = new Map([...blobs.keys()].filter(path => posix.dirname(path) === `${root}/tickets` && /^T\d\d\.md$/u.test(posix.basename(path)))
    .map(path => [posix.basename(path, ".md"), path]));
  const tree = new Map<string, Uint8Array>();
  const paths = new Set([...lightTickets.values(), ...plans.flatMap(source => [source.planPath, source.promptsPath,
    ...[...blobs.keys()].filter(path => path.startsWith(`${source.ticketsPath}/`))])]);
  for (const path of paths) {
    const blob = blobs.get(path);
    if (blob === undefined) continue;
    if (modes.get(path) !== "100644" && modes.get(path) !== "100755") throw new Error(`closure refuses non-regular registered path ${path}`);
    let bytes = BLOB_CACHE.get(blob);
    if (bytes === undefined) {
      bytes = Buffer.from(runGit(git, ["cat-file", "blob", blob]), "utf8");
      if (createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== blob) throw new Error(`closure refuses non-UTF-8 or truncated registered blob ${path}`);
      BLOB_CACHE.set(blob, bytes);
    }
    tree.set(path, bytes);
  }
  const snapshot: ClosureSnapshot = { tree, registry: { plans, lightTickets }, modes, blobs };
  SNAPSHOT_CACHE.set(sha, snapshot);
  return snapshot;
}

export function closureHead(git: GitRunner): string { return runGit(git, ["rev-parse", "HEAD"]).trim(); }
export function closureAncestor(git: GitRunner, ancestor: string, descendant: string): boolean {
  const result = git(["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error("closure cannot verify commit ancestry");
}

/** Full Git path/mode proof supplements the text-only delta, including binary/unregistered files. */
export function verifyClosureCommit(git: GitRunner, record: ClosureRecord): void {
  if (runGit(git, ["rev-parse", `${record.commitSha}^`]).trim() !== record.parentSha) throw new Error("closure commit parent differs from intent");
  const before = readClosureSnapshot(git, record.parentSha);
  const after = readClosureSnapshot(git, record.commitSha);
  const paths = [...new Set([...before.blobs.keys(), ...after.blobs.keys()])];
  const changed = paths.filter(path => before.blobs.get(path) !== after.blobs.get(path) || before.modes.get(path) !== after.modes.get(path)).sort();
  if (JSON.stringify(changed) !== JSON.stringify(record.blobs.map(blob => blob.path).sort()) || record.blobs.some(blob => before.blobs.get(blob.path) !== blob.before || after.blobs.get(blob.path) !== blob.after)) throw new Error("closure committed path/blob set differs from intent");
  const delta = closureDelta(before.tree, after.tree, after.registry, { before: before.modes, after: after.modes });
  if (!delta.ok) throw new Error(`closure committed delta refused: ${delta.refusal.message}`);
}

function assertNoSymlinkParents(repository: string, physical: string, refusal: string): void {
  for (let parent = dirname(physical); parent !== repository; parent = dirname(parent)) {
    if (parent === dirname(parent) || lstatSync(parent).isSymbolicLink()) throw new Error(refusal);
  }
}

export function assertClosureFiles(repository: string, before: ClosureSnapshot, paths: readonly string[]): void {
  for (const path of paths) {
    const physical = join(repository, path);
    assertNoSymlinkParents(repository, physical, `closure refuses symlink parent ${path}`);
    const stat = lstatSync(physical);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !readFileSync(physical).equals(Buffer.from(before.tree.get(path)!))) throw new Error(`closure refuses changed or non-regular file ${path}`);
  }
}

/** Isolated index: the canonical index and files are not touched while the commit is built. */
export function prepareClosureCommit(repository: string, attemptDir: string, parent: string, before: ClosureSnapshot,
  after: ClosureTree, paths: readonly string[], message: string): { commit: string; blobs: ClosureRecord["blobs"] } {
  const root = join(attemptDir, "private", "closure");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(root, "stage-"));
  const indexFile = join(stage, "index");
  const git: GitRunner = argv => runSystemCommand("git", ["-C", repository, "-c", "core.fsync=all", "--literal-pathspecs", ...argv], {
    timeoutMs: 30_000, env: buildGitEnvironment({ indexFile, asHost: true }),
  });
  runGit(git, ["read-tree", parent]);
  const blobs = paths.map((path, index) => {
    const file = join(stage, `bytes-${index}`);
    writeFileSync(file, after.get(path)!, { flag: "wx", mode: 0o600 });
    const blob = runGit(git, ["hash-object", "-w", "--no-filters", "--", file]).trim();
    runGit(git, ["update-index", "--cacheinfo", before.modes.get(path)!, blob, path]);
    return { path, before: before.blobs.get(path)!, after: blob };
  });
  const tree = runGit(git, ["write-tree"]).trim();
  const commit = runGit(git, ["commit-tree", tree, "-p", parent, "-m", message]).trim();
  return { commit, blobs };
}

/** Finish only the already-published exact commit. Unknown dirty bytes are reported, never overwritten. */
export function finishClosureCheckout(repository: string, record: ClosureRecord, git = closureGitRunner(repository)): void {
  if (closureHead(git) !== record.commitSha) throw new Error("interrupted closure: HEAD does not equal the prepared commit; no automatic replay");
  verifyClosureCommit(git, record);
  const before = readClosureSnapshot(git, record.parentSha);
  const after = readClosureSnapshot(git, record.commitSha);
  const indexTree = runGit(git, ["write-tree"]).trim();
  const parentTree = runGit(git, ["rev-parse", `${record.parentSha}^{tree}`]).trim();
  const commitTree = runGit(git, ["rev-parse", `${record.commitSha}^{tree}`]).trim();
  if (indexTree !== parentTree && indexTree !== commitTree) {
    const paths = canonicalCheckoutDirt(git);
    throw new Error(`interrupted closure: index changed${paths === null ? "" : `: ${paths}`}; no automatic replay`);
  }
  const unexpected = runGit(git, ["diff", "--name-only", "--no-renames", "-z", record.parentSha, "--"]).split("\0")
    .filter(path => path && !record.blobs.some(blob => blob.path === path));
  const untracked = runGit(git, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  if (unexpected.length + untracked.length > 0) {
    throw new Error(`interrupted closure: checkout changed: ${dirtyPathSummary([...new Set([...unexpected, ...untracked])].map(path => JSON.stringify(path)))}; no automatic replay`);
  }
  for (const blob of record.blobs) {
    const physical = join(repository, blob.path);
    assertNoSymlinkParents(repository, physical, `interrupted closure: symlink parent of ${blob.path}; no automatic replay`);
    const bytes = readFileSync(physical);
    if (!bytes.equals(Buffer.from(before.tree.get(blob.path)!)) && !bytes.equals(Buffer.from(after.tree.get(blob.path)!))) throw new Error(`interrupted closure: checkout bytes changed: ${blob.path}; no automatic replay`);
    const stat = lstatSync(join(repository, blob.path));
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(`interrupted closure: non-regular file: ${blob.path}; no automatic replay`);
  }
  // No checkout filters or hooks can transform the proved after bytes.
  for (const blob of record.blobs) writeFileSync(join(repository, blob.path), after.tree.get(blob.path)!);
  // Keep cached stats for unchanged entries. The exact worktree bytes were
  // proved above and installed by the host, so merge the index only.
  runGit(git, ["read-tree", "-m", "-i", record.commitSha]);
  const dirty = canonicalCheckoutDirt(git);
  if (dirty !== null) throw new Error(`interrupted closure: canonical checkout is not clean after completion: ${dirty}`);
}
