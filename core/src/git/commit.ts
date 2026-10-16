// Only the host creates candidate commits; agent-facing code receives no commit capability.
import { runSystemCommand } from "../execution/transport-broker.ts";
import { assertClean, runGit, type GitRunner } from "./changes.ts";

/**
 * The one identity every AWSF-made commit carries as author and committer
 * (AGENTS.md invariant 11). Every other identity in core/src derives from this
 * constant; nothing reads `git config user.*` to decide who a commit is by.
 */
export const HOST_AUTHOR = "Santiago Marin <santiagomarinsuarez@me.com>";

function splitHostAuthor(): { readonly name: string; readonly email: string } {
  const match = /^(.+) <([^<>]+)>$/u.exec(HOST_AUTHOR);
  if (match === null) throw new Error(`host author ${JSON.stringify(HOST_AUTHOR)} is not "name <email>"`);
  return Object.freeze({ name: match[1]!, email: match[2]! });
}

export const HOST_IDENTITY = splitHostAuthor();

/**
 * All four identity variables, pinned. Git ranks GIT_AUTHOR_* and
 * GIT_COMMITTER_* from the environment above `-c user.*`, so a commit-making
 * git child that merely inherits the launching environment would let an
 * exported committer (a session's own identity) win (H9: B1-12 B7-08 B8-04
 * B8-05 B9-09). Setting all four explicitly leaves nothing ambient to win.
 */
export function hostIdentityEnv(): Readonly<Record<string, string>> {
  return Object.freeze({
    GIT_AUTHOR_NAME: HOST_IDENTITY.name, GIT_AUTHOR_EMAIL: HOST_IDENTITY.email,
    GIT_COMMITTER_NAME: HOST_IDENTITY.name, GIT_COMMITTER_EMAIL: HOST_IDENTITY.email,
  });
}

/**
 * The system git runner for a worktree the host commits in: the inherited
 * environment, a no-prompt git, and the host identity pinned over anything
 * ambient. Same broker port as `systemGitRunner`; no new spawn path.
 */
export function hostCommitGitRunner(repository: string): GitRunner {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, { GIT_TERMINAL_PROMPT: "0" }, hostIdentityEnv());
  return (argv) => runSystemCommand("git", ["-C", repository, ...argv], { timeoutMs: 30_000, env });
}

export interface HostCommit {
  readonly repository: string;
  readonly message: string;
}

/**
 * Stage the complete captured change-set and create a host-attributed candidate commit.
 * A caller-supplied runner must be `hostCommitGitRunner` (or a test double): the
 * `-c`/`--author` pins below cannot outrank an exported GIT_COMMITTER_*.
 */
export function commitAsHost(commit: HostCommit, runner = hostCommitGitRunner(commit.repository)): string {
  assertCleanBeforeCommit(runner);
  runGit(runner, ["add", "--all"]);
  try {
    runGit(runner, [
      "-c", `user.name=${HOST_IDENTITY.name}`,
      "-c", `user.email=${HOST_IDENTITY.email}`,
      "commit", "--author", HOST_AUTHOR, "--no-gpg-sign", "-m", commit.message,
    ]);
  } catch (error) {
    // B1-19: the staging above is this function's own setup, so a refused
    // commit (a hook, a full disk) undoes it. Left staged, new files stop
    // reading as untracked, the change-set fingerprint every later gate
    // compares shifts, and nothing in core/src would ever unstage them.
    // A mixed reset touches the index only — the working tree, and so the
    // uncommitted work, is exactly as the agent left it. Agents hold no Git
    // capability, so before `add --all` the index was HEAD's; on an unborn
    // branch the reset empties it, which is what it was. If even that fails,
    // the commit's own failure is what the caller sees.
    try { runGit(runner, ["reset", "-q"]); } catch { throw error; }
    throw error;
  }
  assertClean(commit.repository, "after", runner);
  return runGit(runner, ["rev-parse", "HEAD"]).trim();
}

function assertCleanBeforeCommit(runner: GitRunner): void {
  const status = runGit(runner, ["status", "--porcelain"]);
  if (!status.trim()) throw new Error("refusing to create an empty candidate commit");
}
