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
  // `-z` is a safety property, not an optimization: newline, tab, quotes and
  // non-ASCII bytes in a filename must reach path policy as the path Git saw,
  // never as a display-quoted approximation. Disabling rename detection makes
  // both sides explicit (one removal plus one appearance).
  for (const record of runGit(runner, ["diff", "HEAD", "--numstat", "--no-renames", "-z"]).split("\0")) {
    if (!record) continue;
    const first = record.indexOf("\t");
    const second = first < 0 ? -1 : record.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const added = record.slice(0, first);
    const deleted = record.slice(first + 1, second);
    const path = record.slice(second + 1);
    if (path) fingerprint[path] = `${added},${deleted}`;
  }
  for (const path of runGit(runner, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")) {
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

/**
 * Every path the tree differs from the attempt's BASE by — committed candidates
 * and uncommitted work alike.
 *
 * `captureChangeSet` answers a different question: what has changed since the
 * last commit. That is the right question for one turn and the wrong one for a
 * candidate, and the difference only becomes visible once a phase can produce
 * more than one commit. After a correction commits candidate B on top of
 * candidate A, `git diff HEAD` shows nothing at all, so a writes-glob check
 * built on it would pass a candidate that had written anywhere.
 *
 * `git diff <base>` with no second revision compares the base against the
 * WORKING TREE, so one command covers both committed and uncommitted change.
 * Untracked files are added separately because `git diff` does not see them.
 * `--no-renames` keeps both halves of a rename explicit, and `-z` keeps unusual
 * bytes in a filename intact — the same two reasons `captureChangeSet` uses
 * them.
 */
export function changesSinceBase(
  repository: string,
  baseSha: string,
  runner = systemGitRunner(repository),
): readonly string[] {
  const paths = new Set<string>();
  for (const path of runGit(runner, ["diff", "--name-only", "--no-renames", "-z", baseSha, "--"]).split("\0")) {
    if (path) paths.add(path);
  }
  for (const path of runGit(runner, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")) {
    if (path) paths.add(path);
  }
  return Object.freeze([...paths].sort());
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
