// Only the host creates candidate commits; agent-facing code receives no commit capability.
import { assertClean, runGit, systemGitRunner, type GitRunner } from "./changes.ts";

export const HOST_AUTHOR = "Santiago Marin <santiagomarinsuarez@me.com>";

export interface HostCommit {
  readonly repository: string;
  readonly message: string;
}

/** Stage the complete captured change-set and create a host-attributed candidate commit. */
export function commitAsHost(commit: HostCommit, runner = systemGitRunner(commit.repository)): string {
  assertCleanBeforeCommit(runner);
  runGit(runner, ["add", "--all"]);
  runGit(runner, [
    "-c", "user.name=Santiago Marin",
    "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "--author", HOST_AUTHOR, "--no-gpg-sign", "-m", commit.message,
  ]);
  assertClean(commit.repository, "after", runner);
  return runGit(runner, ["rev-parse", "HEAD"]).trim();
}

function assertCleanBeforeCommit(runner: GitRunner): void {
  const status = runGit(runner, ["status", "--porcelain"]);
  if (!status.trim()) throw new Error("refusing to create an empty candidate commit");
}
