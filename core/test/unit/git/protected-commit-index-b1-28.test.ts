import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { protectedCommitIndexPath } from "../../../src/git/protected-commit.ts";
import { runGit, systemGitRunner } from "../../../src/git/changes.ts";

const CLEAN_GIT_ENV: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
delete CLEAN_GIT_ENV.GIT_INDEX_FILE;

function git(repository: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8", env: CLEAN_GIT_ENV });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function repository(): { root: string; path: string; gitDir: string; indexPath: string } {
  const root = mkdtempSync(join(tmpdir(), "awsf-protected-index-b1-28-"));
  const path = join(root, "repo");
  mkdirSync(path);
  git(path, "init", "-q", "-b", "main");
  writeFileSync(join(path, "tracked.txt"), "baseline\n");
  git(path, "add", "tracked.txt");
  const gitDir = git(path, "rev-parse", "--absolute-git-dir");
  return { root, path, gitDir, indexPath: join(gitDir, "index") };
}

test("B1-28: protected publication refuses an inherited index redirected outside the granted worktree", () => {
  const world = repository();
  const canonicalIndex = readFileSync(world.indexPath);
  const redirectedIndex = join(world.root, "hijacked.index");
  const sentinel = Buffer.from("not the worktree index\n");
  writeFileSync(redirectedIndex, sentinel, { flag: "wx", mode: 0o600 });
  const previous = process.env["GIT_INDEX_FILE"];
  try {
    process.env["GIT_INDEX_FILE"] = redirectedIndex;
    const runner = systemGitRunner(world.path);
    const observed = runGit(runner, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim();

    assert.equal(observed, redirectedIndex, "Git itself honors the inherited redirect that protected publication must reject");
    assert.throws(() => protectedCommitIndexPath(runner, world.gitDir), /redirected away from the granted worktree Git directory/);
    assert.deepEqual(readFileSync(world.indexPath), canonicalIndex);
    assert.deepEqual(readFileSync(redirectedIndex), sentinel);
  } finally {
    if (previous === undefined) delete process.env["GIT_INDEX_FILE"];
    else process.env["GIT_INDEX_FILE"] = previous;
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("protected publication selects the canonical index when Git is not redirected", () => {
  const world = repository();
  const previous = process.env["GIT_INDEX_FILE"];
  try {
    delete process.env["GIT_INDEX_FILE"];
    const runner = systemGitRunner(world.path);
    assert.equal(protectedCommitIndexPath(runner, world.gitDir), world.indexPath);
  } finally {
    if (previous === undefined) delete process.env["GIT_INDEX_FILE"];
    else process.env["GIT_INDEX_FILE"] = previous;
    rmSync(world.root, { recursive: true, force: true });
  }
});
