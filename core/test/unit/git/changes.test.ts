import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureChangeSet,
  changedPaths,
  invalidateStaleResults,
  recordGateFreshness,
  withCleanWorktree,
  WorktreeNotClean,
  type GitRunner,
} from "../../../src/git/changes.ts";

function runner(outputs: Record<string, string[]>): GitRunner {
  return (argv) => {
    const key = argv.join(" ");
    const stdout = outputs[key]?.shift();
    if (stdout === undefined) throw new Error(`unexpected git command: ${key}`);
    return { status: 0, stdout, stderr: "", error: null };
  };
}

test("fingerprint records numstat and untracked paths", () => {
  const git = runner({
    "diff HEAD --numstat": ["3\t1\tsrc/a.ts\n"],
    "ls-files --others --exclude-standard": ["notes.txt\n"],
  });
  assert.deepEqual(captureChangeSet("/repo", git), { "src/a.ts": "3,1", "notes.txt": "untracked" });
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
    "diff HEAD --numstat": ["", "1\t0\tsrc/new.ts\n"],
    "ls-files --others --exclude-standard": ["", ""],
  });
  const freshness = recordGateFreshness("/repo", git);
  assert.deepEqual(invalidateStaleResults(freshness, "/repo", git), ["src/new.ts"]);
  assert.equal(freshness.gatesCurrent, false);
  assert.equal(freshness.reviewCurrent, false);
});

test("gates require a clean tree both before and after", async () => {
  const beforeDirty = runner({ "status --porcelain": [" M src/a.ts\n"] });
  await assert.rejects(withCleanWorktree("/repo", () => undefined, beforeDirty), WorktreeNotClean);

  const afterDirty = runner({ "status --porcelain": ["", "?? output.txt\n"] });
  await assert.rejects(withCleanWorktree("/repo", () => undefined, afterDirty), WorktreeNotClean);
});
