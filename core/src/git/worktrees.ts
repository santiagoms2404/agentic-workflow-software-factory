// Managed execution trees live under the machine-local Q8 root, never in state or the canonical checkout.
import { basename, isAbsolute, relative, resolve } from "node:path";
import { runGit, systemGitRunner } from "./changes.ts";

export interface WorktreeRequest {
  readonly repository: string;
  readonly root: string;
  readonly attemptId: string;
  readonly baseSha: string;
}

export interface ManagedWorktree {
  readonly attemptId: string;
  readonly path: string;
  readonly head: string;
}

function attemptPath(root: string, attemptId: string): string {
  if (!attemptId || attemptId !== basename(attemptId) || attemptId === "." || attemptId === "..") {
    throw new Error("attempt id must be one path component");
  }
  const absoluteRoot = resolve(root);
  const path = resolve(absoluteRoot, attemptId);
  if (relative(absoluteRoot, path) === "" || relative(absoluteRoot, path).startsWith("..")) {
    throw new Error("attempt worktree escapes its configured root");
  }
  return path;
}

/** Create exactly the attempt's detached execution tree. No removal operation is exposed. */
export function createWorktree(request: WorktreeRequest, runner = systemGitRunner(request.repository)): ManagedWorktree {
  if (!isAbsolute(request.root)) throw new Error("worktree root must be an absolute machine-local path");
  const path = attemptPath(request.root, request.attemptId);
  const head = runGit(runner, ["rev-parse", request.baseSha]).trim();
  runGit(runner, ["worktree", "add", "--detach", path, head]);
  return Object.freeze({ attemptId: request.attemptId, path, head });
}

/** List only the worktrees under this machine's configured root. */
export function listWorktrees(repository: string, root: string, runner = systemGitRunner(repository)): readonly ManagedWorktree[] {
  const absoluteRoot = resolve(root);
  return Object.freeze(runGit(runner, ["worktree", "list", "--porcelain"])
    .split(/\r?\n\r?\n/)
    .flatMap((record) => {
      const lines = record.split(/\r?\n/);
      const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      const head = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length);
      if (!path || !head || relative(absoluteRoot, resolve(path)).startsWith("..")) return [];
      return [{ attemptId: basename(path), path, head }];
    }));
}

export function worktreePath(root: string, attemptId: string): string {
  return attemptPath(root, attemptId);
}
