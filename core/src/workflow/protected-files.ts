import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { assertExactProtectedPath, type ProtectedFileBaseline, type ProtectedFilesystemIdentity, type ProtectedGrant } from "../contracts/protected-grant.ts";
import { runSystemCommand } from "../execution/transport-broker.ts";
import { runGit, type GitRunner } from "../git/changes.ts";

export function protectedReadOnlyGit(root: string): GitRunner {
  return argv => runSystemCommand("git", ["-C", root, ...(argv[0] === "diff" ? ["diff", "--no-ext-diff", "--no-textconv", ...argv.slice(1)] : argv)], { timeoutMs: 30000,
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } });
}
/** Linux grant execution reads through held directory descriptors, never through a raced parent symlink. */
export function readProtectedContent(root: string, path: string): Buffer {
  assertExactProtectedPath(path);
  if (process.platform !== "linux") throw new Error("protected content snapshots require Linux directory descriptors");
  const descriptors: number[] = [];
  try {
    let directory = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); descriptors.push(directory);
    const parts = path.split("/");
    for (const part of parts.slice(0, -1)) {
      directory = openSync(`/proc/self/fd/${directory}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      descriptors.push(directory);
    }
    const file = openSync(`/proc/self/fd/${directory}/${parts.at(-1)!}`, constants.O_RDONLY | constants.O_NOFOLLOW); descriptors.push(file);
    const before = fstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || before.size > 16 * 1024 * 1024) throw new Error("protected content must be a bounded regular single-link file");
    const bytes = Buffer.alloc(before.size + 1); let count = 0;
    while (count < bytes.length) { const read = readSync(file, bytes, count, bytes.length - count, null); if (read === 0) break; count += read; }
    const after = fstatSync(file); const named = lstatSync(join(root, path));
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
        !named.isFile() || named.nlink !== 1 || named.dev !== before.dev || named.ino !== before.ino) throw new Error("protected content changed during snapshot");
    return bytes.subarray(0, count);
  } finally { for (const descriptor of descriptors.reverse()) closeSync(descriptor); }
}
export function protectedBlobId(bytes: Buffer): string { return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"); }

export function protectedRootIdentity(path: string): ProtectedFilesystemIdentity {
  if (realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw new Error("protected root must be a physical directory");
  return identity(path, path);
}
function identity(physical: string, path: string): ProtectedFilesystemIdentity {
  const stat = lstatSync(physical);
  if (stat.isSymbolicLink()) throw new Error("protected path contains a symlink");
  return { path, device: String(stat.dev), inode: String(stat.ino), uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o7777 };
}
function sameIdentity(a: ProtectedFilesystemIdentity, b: ProtectedFilesystemIdentity): boolean {
  return a.path === b.path && a.device === b.device && a.inode === b.inode && a.uid === b.uid && a.gid === b.gid && a.mode === b.mode;
}
export function inspectProtectedPhysicalPath(root: string, path: string) {
  assertExactProtectedPath(path);
  if (realpathSync(root) !== root) throw new Error("protected worktree root is not physical");
  const parents: ProtectedFilesystemIdentity[] = [identity(root, root)];
  let directory = root;
  const parts = path.split("/");
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    const entries = readdirSync(directory);
    if (entries.some(entry => entry.normalize("NFC").toLowerCase() === part.toLowerCase() && entry !== part)) {
      throw new Error("protected path has a case or Unicode alias");
    }
    const target = join(directory, part);
    if (!entries.includes(part)) return { parents, file: null };
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error("protected path contains a symlink");
    if (index === parts.length - 1) {
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o7000) !== 0) throw new Error("protected target must be a regular single-link file");
      return { parents, file: identity(target, path) };
    }
    if (!stat.isDirectory()) throw new Error("protected parent is not a directory");
    directory = target;
    parents.push(identity(directory, directory));
  }
  throw new Error("protected path scan failed");
}
export function treeFile(git: GitRunner, revision: string, path: string): { blob: string; mode: "100644" | "100755" } | null {
  if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error("protected baseline requires an exact revision");
  const raw = runGit(git, ["ls-tree", "-z", "--full-tree", revision, "--", path]);
  if (raw === "") return null;
  const entries = raw.split("\0");
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(entries[0]!);
  if (entries.length !== 2 || entries[1] !== "" || match === null || match[3] !== path) throw new Error("protected baseline is not one regular Git file");
  return { blob: match[2]!, mode: match[1]! as "100644" | "100755" };
}
export function captureProtectedBaselines(root: string, head: string, paths: readonly string[], git = protectedReadOnlyGit(root)): ProtectedFileBaseline[] {
  return paths.map(path => {
    const physical = inspectProtectedPhysicalPath(root, path);
    const tree = treeFile(git, head, path);
    if ((tree === null) !== (physical.file === null)) throw new Error("protected baseline contains an untracked, ignored or missing file");
    if (tree !== null && protectedBlobId(readProtectedContent(root, path)) !== tree.blob) {
      throw new Error("protected baseline bytes differ from Git; filtered or changed content is unsupported");
    }
    return { path, blob: tree?.blob ?? null, mode: tree?.mode ?? null, ...physical };
  });
}
export function verifyProtectedFilesystem(grant: ProtectedGrant, contentMayChange: boolean): void {
  const root = grant.subject.worktree;
  if (grant.subject.roots.map(value => value.path).join("\0") !== [grant.subject.repository, grant.subject.commonGitDir, root, grant.subject.worktreeGitDir].join("\0")) throw new Error("protected root identities have another scope");
  for (const before of grant.subject.roots) if (!sameIdentity(before, protectedRootIdentity(before.path))) throw new Error("protected repository root identity changed");
  for (const before of grant.files) {
    const after = inspectProtectedPhysicalPath(root, before.path);
    for (const parent of before.parents) {
      const found = after.parents.find(value => value.path === parent.path);
      if (found === undefined || !sameIdentity(parent, found)) throw new Error("protected parent identity changed");
    }
    if (!contentMayChange) {
      if ((before.file === null) !== (after.file === null) || (before.file !== null && !sameIdentity(before.file, after.file!))) {
        throw new Error("protected file identity changed before activation");
      }
    } else if (before.file !== null) {
      if (after.file === null || after.file.uid !== before.file.uid || after.file.gid !== before.file.gid || after.file.mode !== before.file.mode) {
        throw new Error("protected file deleted or permissions changed");
      }
    } else if (after.file !== null && ((after.file.mode & 0o111) !== 0 || after.file.uid !== before.parents[0]!.uid)) {
      throw new Error("new protected file changed executable mode or ownership");
    }
  }
}
