import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { recoveryDigest } from "../contracts/phase-recovery.ts";
import type { HostCommitIntent } from "../contracts/host-validation.ts";
import { changesSinceBase, runGit, type GitRunner } from "./changes.ts";

const MAX_CONTENT_BYTES = 64 * 1024 * 1024;

export class HostCommitContentUnavailable extends Error {}

/**
 * Exactly what a host commit against `parentSha` would contain, read from the
 * working tree without touching the index, the object store or a byte of the
 * tree itself.
 *
 * The path set is the whole difference against `parentSha`, because
 * `commitAsHost` stages `--all`; a digest over only the paths one turn wrote
 * would accept a commit that carried extra content. After the commit the tree
 * is clean, so recomputing this against the same parent yields the same digest
 * — which is what lets one function answer both "has it happened yet" and "is
 * what happened the thing that was intended".
 */
export async function hostCommitContentDigest(worktree: string, parentSha: string, git: GitRunner): Promise<string> {
  const rows: unknown[] = [];
  let bytes = 0;
  for (const path of changesSinceBase(worktree, parentSha, git)) {
    const absolute = join(worktree, path);
    let info;
    try { info = await lstat(absolute); }
    catch { rows.push({ path, removed: true }); continue; }
    if (info.isSymbolicLink()) { rows.push({ path, mode: info.mode, link: await readlink(absolute) }); continue; }
    if (!info.isFile()) throw new HostCommitContentUnavailable(`commit intent covers a special filesystem node: ${path}`);
    bytes += info.size;
    if (bytes > MAX_CONTENT_BYTES) throw new HostCommitContentUnavailable("commit intent content exceeds 64 MiB");
    rows.push({ path, mode: info.mode, digest: createHash("sha256").update(await readFile(absolute)).digest("hex") });
  }
  return recoveryDigest(rows);
}

export type HostCommitReconciliation =
  | { readonly outcome: "not-committed" }
  | { readonly outcome: "committed"; readonly commitSha: string }
  | { readonly outcome: "refused"; readonly reason: string };

const refuse = (reason: string): HostCommitReconciliation => Object.freeze({ outcome: "refused" as const, reason });

/**
 * Decide, from the recorded commit intent and Git objects alone, whether the
 * one commit this host was about to create exists.
 *
 * Every branch is an identification, never a repair. Nothing here resets,
 * cleans, stashes, stages or commits, and an outcome is returned only when the
 * evidence names ONE revision: the recorded parent still at HEAD with the
 * recorded content still uncommitted, or a single child of that parent whose
 * parent, message, author, committer, path set and content all match. A second
 * commit, a moved HEAD, a rewritten message, a dirty tree beside a finished
 * commit or altered content each refuse by name and leave the attempt exactly
 * as the crash left it.
 */
export async function reconcileHostCommit(
  intent: HostCommitIntent,
  options: { readonly worktree: string; readonly git: GitRunner },
): Promise<HostCommitReconciliation> {
  const { worktree, git } = options;
  if (git(["cat-file", "-e", `${intent.parentSha}^{commit}`]).status !== 0) {
    return refuse("the recorded pre-commit revision is not a commit object in this repository");
  }
  const head = runGit(git, ["rev-parse", "HEAD"]).trim();
  const clean = runGit(git, ["status", "--porcelain"]).trim().length === 0;

  if (head === intent.parentSha) {
    if (await hostCommitContentDigest(worktree, intent.parentSha, git) !== intent.contentDigest) {
      return refuse("HEAD is still the recorded pre-commit revision but the retained working tree no longer matches the recorded intent");
    }
    return Object.freeze({ outcome: "not-committed" as const });
  }
  if (git(["merge-base", "--is-ancestor", intent.parentSha, head]).status !== 0) {
    return refuse("current HEAD does not descend from the recorded pre-commit revision");
  }
  const produced = runGit(git, ["rev-list", `${intent.parentSha}..${head}`]).split("\n").map(line => line.trim()).filter(line => line.length > 0);
  if (produced.length !== 1) {
    return refuse(`the recorded intent identifies one commit, but ${String(produced.length)} revisions were created after it`);
  }
  const commitSha = produced[0]!;
  const parents = runGit(git, ["rev-list", "--parents", "-n", "1", commitSha]).trim().split(/\s+/).slice(1);
  if (parents.length !== 1 || parents[0] !== intent.parentSha) {
    return refuse("the created commit does not have the recorded pre-commit revision as its only parent");
  }
  if (runGit(git, ["log", "-1", "--format=%B", commitSha]).replace(/\n+$/, "") !== intent.message.replace(/\n+$/, "")) {
    return refuse("the created commit carries a different message than the recorded intent");
  }
  if (runGit(git, ["log", "-1", "--format=%an <%ae>", commitSha]).trim() !== intent.author ||
      runGit(git, ["log", "-1", "--format=%cn <%ce>", commitSha]).trim() !== intent.committer) {
    return refuse("the created commit carries a different author or committer than the recorded intent");
  }
  if (!clean) return refuse("a commit exists after the recorded intent but the worktree is not clean, so the recorded change-set cannot be proved complete");
  const paths = runGit(git, ["diff", "--name-only", "--no-renames", "-z", intent.parentSha, commitSha, "--"]).split("\0").filter(path => path.length > 0).sort();
  if (paths.length !== intent.committedPaths.length || paths.some((path, index) => path !== intent.committedPaths[index])) {
    return refuse("the created commit changes a different set of paths than the recorded intent");
  }
  if (await hostCommitContentDigest(worktree, intent.parentSha, git) !== intent.contentDigest) {
    return refuse("the created commit carries different content than the recorded intent");
  }
  return Object.freeze({ outcome: "committed" as const, commitSha });
}
