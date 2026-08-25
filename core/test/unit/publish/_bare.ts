import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitResult, GitRunner } from "../../../src/git/changes.ts";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function command(argv: readonly string[]): GitResult {
  const result = spawnSync("git", argv, { encoding: "utf8", env: GIT_ENV });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null,
  };
}

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8", env: GIT_ENV }).trim();
}

export interface BareFixture {
  readonly root: string;
  readonly bare: string;
  readonly work: string;
  readonly firstSha: string;
  readonly secondSha: string;
  readonly runner: GitRunner;
  readonly dispose: () => void;
}

/** A local-only remote with two commits and no inherited Git configuration. */
export function bareFixture(): BareFixture {
  const root = mkdtempSync(join(tmpdir(), "awsf-publish-"));
  const bare = join(root, "remote.git");
  const work = join(root, "work");
  execFileSync("git", ["init", "--bare", bare], { stdio: "ignore", env: GIT_ENV });
  execFileSync("git", ["init", "-b", "main", work], { stdio: "ignore", env: GIT_ENV });

  writeFileSync(join(work, "message.txt"), "first\n");
  git(work, "add", "message.txt");
  git(work, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: first publish candidate");
  const firstSha = git(work, "rev-parse", "HEAD");

  writeFileSync(join(work, "message.txt"), "second\n");
  git(work, "add", "message.txt");
  git(work, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: second publish candidate");
  const secondSha = git(work, "rev-parse", "HEAD");
  git(work, "remote", "add", "origin", bare);

  return {
    root,
    bare,
    work,
    firstSha,
    secondSha,
    runner: (argv) => command(["-C", work, ...argv]),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function remoteSha(fixture: BareFixture, branch: string): string | null {
  const output = command(["ls-remote", fixture.bare, `refs/heads/${branch}`]);
  if (output.status !== 0) throw new Error(output.stderr);
  const match = /^([0-9a-f]{40})\s/u.exec(output.stdout);
  return match?.[1] ?? null;
}
