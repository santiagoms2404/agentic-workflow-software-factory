import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertClean,
  captureChangeSet,
  changedPaths,
  invalidateStaleResults,
  recordGateFreshness,
  withCleanWorktree,
  WorktreeNotClean,
  systemGitRunner,
  type GitRunner,
} from "../../../src/git/changes.ts";
import { buildGitEnvironment, HOST_IDENTITY } from "../../../src/git/environment.ts";

function runner(outputs: Record<string, string[]>): GitRunner {
  return (argv) => {
    const key = argv.join(" ");
    const stdout = outputs[key]?.shift();
    if (stdout === undefined) throw new Error(`unexpected git command: ${key}`);
    return { status: 0, stdout, stderr: "", error: null };
  };
}

test("system git uses the named checkout despite ambient repository redirects", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-git-env-"));
  const previous = process.env.GIT_DIR;
  try {
    execFileSync("git", ["init", "-q", root]);
    process.env.GIT_DIR = join(root, "not-a-repository");
    const result = systemGitRunner(root)(["rev-parse", "--absolute-git-dir"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), join(root, ".git"));
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Git environment filters ambient index, object, config, and identity settings before adding host settings", () => {
  const names = ["GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_GLOBAL", "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_AUTHOR_DATE", "GIT_COMMITTER_DATE"];
  const originals = names.map(name => process.env[name]);
  try {
    for (const name of names) process.env[name] = "ambient sentinel";
    const read = buildGitEnvironment();
    for (const name of names) assert.equal(read[name], undefined, name);
    assert.equal(read.PATH, process.env.PATH);
    assert.equal(read.GIT_TERMINAL_PROMPT, "0");

    const date = "1234567890 +0000";
    const write = buildGitEnvironment({ asHost: true, date, indexFile: "/operation-owned/index", noOptionalLocks: true });
    assert.equal(write.GIT_INDEX_FILE, "/operation-owned/index");
    assert.equal(write.GIT_OPTIONAL_LOCKS, "0");
    for (const role of ["AUTHOR", "COMMITTER"]) {
      assert.equal(write[`GIT_${role}_NAME`], HOST_IDENTITY.name);
      assert.equal(write[`GIT_${role}_EMAIL`], HOST_IDENTITY.email);
      assert.equal(write[`GIT_${role}_DATE`], date);
    }
    for (const name of names) assert.equal(process.env[name], "ambient sentinel", name);
  } finally {
    names.forEach((name, index) => {
      if (originals[index] === undefined) delete process.env[name];
      else process.env[name] = originals[index];
    });
  }
});

test("fingerprint records numstat and untracked paths", () => {
  const git = runner({
    "diff HEAD --numstat --no-renames -z": ["3\t1\tsrc/a.ts\0"],
    "ls-files --others --exclude-standard -z": ["notes.txt\0"],
  });
  assert.deepEqual(captureChangeSet("/repo", git), { "src/a.ts": "3,1", "notes.txt": "untracked" });
});

test("NUL framing preserves tabs and newlines in paths for fail-closed policy", () => {
  const git = runner({
    "diff HEAD --numstat --no-renames -z": ["1\t0\todd\tname\n.ts\0"],
    "ls-files --others --exclude-standard -z": ["loose\nfile\0"],
  });
  assert.deepEqual(captureChangeSet("/repo", git), {
    "odd\tname\n.ts": "1,0",
    "loose\nfile": "untracked",
  });
});

test("a reversion is a change even when it makes a prior dirty path vanish", () => {
  assert.deepEqual(changedPaths({ "judge.ts": "4,0" }, {}), ["judge.ts"]);
});

test("appearances, rewrites, and removals are all changes", () => {
  assert.deepEqual(
    changedPaths({ gone: "1,0", rewrite: "1,0" }, { appeared: "untracked", rewrite: "2,0" }),
    ["appeared", "gone", "rewrite"],
  );
});

test("a post-gate mutation invalidates both gates and review", () => {
  const git = runner({
    "diff HEAD --numstat --no-renames -z": ["", "1\t0\tsrc/new.ts\0"],
    "ls-files --others --exclude-standard -z": ["", ""],
  });
  const freshness = recordGateFreshness("/repo", git);
  assert.deepEqual(invalidateStaleResults(freshness, "/repo", git), ["src/new.ts"]);
  assert.equal(freshness.gatesCurrent, false);
  assert.equal(freshness.reviewCurrent, false);
});

test("gates require a clean tree both before and after", async () => {
  const beforeDirty = runner({ "status --porcelain --untracked-files=all": [" M src/a.ts\n"] });
  await assert.rejects(withCleanWorktree("/repo", () => undefined, beforeDirty), WorktreeNotClean);

  const afterDirty = runner({ "status --porcelain --untracked-files=all": ["", "?? output.txt\n"] });
  await assert.rejects(withCleanWorktree("/repo", () => undefined, afterDirty), WorktreeNotClean);
});

test("cleanliness ignores ambient showUntrackedFiles=no", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b1-51-status-"));
  const repository = join(root, "repo");
  try {
    execFileSync("git", ["init", "-q", repository]);
    execFileSync("git", ["-C", repository, "config", "status.showUntrackedFiles", "no"]);
    writeFileSync(join(repository, "untracked.txt"), "untracked\n");

    assert.equal(execFileSync("git", ["-C", repository, "status", "--porcelain"], { encoding: "utf8" }), "",
      "the fixture proves the ambient setting hides untracked files from ordinary status");
    assert.match(execFileSync("git", ["-C", repository, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }), /\?\? untracked\.txt/u);
    assert.throws(() => assertClean(repository, "before", systemGitRunner(repository)), WorktreeNotClean);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
