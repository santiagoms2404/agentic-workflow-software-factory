// Host-owned change-set capture. Agents never receive a Git command capability.
import { runSystemCommand } from "../execution/transport-broker.ts";

export interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export type GitRunner = (argv: readonly string[]) => GitResult;
export type ChangeSetFingerprint = Readonly<Record<string, string>>;

export function systemGitRunner(repository: string): GitRunner {
  return (argv) => runSystemCommand("git", ["-C", repository, ...argv], 30_000);
}

export class GitCommandFailed extends Error {
  constructor(argv: readonly string[], result: GitResult) {
    super(`git ${argv.join(" ")} failed: ${result.error ?? result.stderr.trim()}`);
    this.name = "GitCommandFailed";
  }
}

export function runGit(runner: GitRunner, argv: readonly string[]): string {
  const result = runner(argv);
  if (result.status !== 0) throw new GitCommandFailed(argv, result);
  return result.stdout;
}

/**
 * A snapshot is intentionally the current change-set, rather than only paths
 * written during this invocation. Comparing two snapshots catches a path that
 * vanishes because an agent restored it after it was already dirty.
 */
export function captureChangeSet(repository: string, runner = systemGitRunner(repository)): ChangeSetFingerprint {
  const fingerprint: Record<string, string> = {};
  for (const line of runGit(runner, ["diff", "HEAD", "--numstat"]).split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split("\t");
    if (fields.length >= 3) fingerprint[fields.at(-1)!] = `${fields[0]},${fields[1]}`;
  }
  for (const path of runGit(runner, ["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/)) {
    if (path) fingerprint[path] = "untracked";
  }
  return Object.freeze(fingerprint);
}

/** Paths whose state changed, including appearances, removals, and reversions. */
export function changedPaths(before: ChangeSetFingerprint, after: ChangeSetFingerprint): readonly string[] {
  return Object.freeze([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path])
    .sort());
}

export class WorktreeNotClean extends Error {
  constructor(when: "before" | "after", status: string) {
    super(`worktree is not clean ${when} gate: ${status.trim()}`);
    this.name = "WorktreeNotClean";
  }
}

export function assertClean(repository: string, when: "before" | "after", runner = systemGitRunner(repository)): void {
  const status = runGit(runner, ["status", "--porcelain"]);
  if (status.trim()) throw new WorktreeNotClean(when, status);
}

/** Gates run only in a clean tree and may not leave one dirty. */
export async function withCleanWorktree<T>(
  repository: string,
  gate: () => Promise<T> | T,
  runner = systemGitRunner(repository),
): Promise<T> {
  assertClean(repository, "before", runner);
  const result = await gate();
  assertClean(repository, "after", runner);
  return result;
}

export interface GateFreshness {
  readonly fingerprint: ChangeSetFingerprint;
  gatesCurrent: boolean;
  reviewCurrent: boolean;
}

export function recordGateFreshness(repository: string, runner = systemGitRunner(repository)): GateFreshness {
  return { fingerprint: captureChangeSet(repository, runner), gatesCurrent: true, reviewCurrent: true };
}

/** A later working-tree change makes both the gate and its review stale. */
export function invalidateStaleResults(
  freshness: GateFreshness,
  repository: string,
  runner = systemGitRunner(repository),
): readonly string[] {
  const mutations = changedPaths(freshness.fingerprint, captureChangeSet(repository, runner));
  if (mutations.length > 0) {
    freshness.gatesCurrent = false;
    freshness.reviewCurrent = false;
  }
  return mutations;
}
