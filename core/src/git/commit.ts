// Only the host creates candidate commits; agent-facing code receives no commit capability.
import { runSystemCommand } from "../execution/transport-broker.ts";
import { assertClean, runGit, worktreeStatus, type GitRunner } from "./changes.ts";
import { buildGitEnvironment, HOST_AUTHOR, HOST_IDENTITY } from "./environment.ts";
export { HOST_AUTHOR, HOST_IDENTITY, hostIdentityEnv } from "./environment.ts";

/** The system Git runner for a worktree the host commits in. */
export function hostCommitGitRunner(repository: string): GitRunner {
  return (argv) => runSystemCommand("git", ["-C", repository, ...argv], {
    timeoutMs: 30_000, env: buildGitEnvironment({ asHost: true }),
  });
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
  const status = worktreeStatus(runner);
  if (!status.trim()) throw new Error("refusing to create an empty candidate commit");
}
