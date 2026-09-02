import assert from "node:assert/strict";
import { test } from "node:test";
import { commitAsHost, HOST_AUTHOR } from "../../../src/git/commit.ts";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttemptWorktreeExists, listWorktrees, createWorktree } from "../../../src/git/worktrees.ts";
import type { GitRunner } from "../../../src/git/changes.ts";

function scripted(replies: Record<string, string | string[]>): { runner: GitRunner; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runner: (argv) => {
      const key = argv.join(" ");
      calls.push(key);
      const reply = replies[key];
      const stdout = Array.isArray(reply) ? reply.shift() ?? "" : reply ?? "";
      return { status: 0, stdout, stderr: "", error: null };
    },
  };
}

test("create pins one detached worktree to its attempt under the configured root", () => {
  const git = scripted({ "rev-parse abc": "012345\n" });
  const tree = createWorktree({ repository: "/repo", root: "/worktrees", attemptId: "task-16-1", baseSha: "abc" }, git.runner);
  assert.deepEqual(tree, { attemptId: "task-16-1", path: "/worktrees/task-16-1", head: "012345" });
  assert.deepEqual(git.calls, ["rev-parse abc", "worktree add --detach /worktrees/task-16-1 012345"]);
  assert.throws(() => createWorktree({ repository: "/repo", root: "/worktrees", attemptId: "../other", baseSha: "abc" }, git.runner));
});

test("listing limits the host view to the configured worktree root", () => {
  const git = scripted({
    "worktree list --porcelain": "worktree /repo\nHEAD aaa\n\nworktree /worktrees/T16\nHEAD bbb\n\n",
  });
  assert.deepEqual(listWorktrees("/repo", "/worktrees", git.runner), [{ attemptId: "T16", path: "/worktrees/T16", head: "bbb" }]);
});

test("host commits set both author and committer identity deterministically", () => {
  const git = scripted({
    "status --porcelain": [" M src/a.ts\n", ""],
    "rev-parse HEAD": "candidate\n",
  });
  assert.equal(commitAsHost({ repository: "/repo", message: "feat: candidate" }, git.runner), "candidate");
  assert.deepEqual(git.calls, [
    "status --porcelain",
    "add --all",
    "-c user.name=Santiago Marin -c user.email=santiagomarinsuarez@me.com commit --author Santiago Marin <santiagomarinsuarez@me.com> --no-gpg-sign -m feat: candidate",
    "status --porcelain",
    "rev-parse HEAD",
  ]);
  assert.equal(HOST_AUTHOR, "Santiago Marin <santiagomarinsuarez@me.com>");
});

function caught(run: () => unknown): AttemptWorktreeExists {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof AttemptWorktreeExists, `expected AttemptWorktreeExists, got ${String(error)}`);
    return error;
  }
  throw new Error("expected createWorktree to refuse an existing tree");
}

test("an interrupted start's leftover tree is diagnosed, not repeated back as a git error", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-orphan-worktree-"));
  try {
    const attemptId = "orphaned-attempt";
    const path = join(root, attemptId);
    mkdirSync(path, { recursive: true });

    // Git tracks it: the exact state an interrupted `awsf start` leaves, where
    // the tree is registered while the attempt record still reads DRAFT.
    const tracked = scripted({
      "rev-parse abc": "012345\n",
      "worktree list --porcelain": `worktree /repo\nHEAD aaa\n\nworktree ${path}\nHEAD 012345\n\n`,
    });
    const registered = caught(() => createWorktree({ repository: "/repo", root, attemptId, baseSha: "abc" }, tracked.runner));
    assert.equal(registered.registered, true);
    assert.equal(registered.path, path);
    assert.match(registered.message, /already exists at .*orphaned-attempt.* and Git still tracks it/u);
    assert.match(registered.message, /no phase ran and no provider call was spent/u);
    assert.match(registered.message, /gotchas\.md carries the exact recovery/u);
    // It must never reach `worktree add`, whose own message names a path and
    // nothing else.
    assert.equal(tracked.calls.includes(`worktree add --detach ${path} 012345`), false);

    // A bare directory Git knows nothing about is the other half, and the
    // recovery differs, so the error says which it is.
    const untracked = scripted({
      "rev-parse abc": "012345\n",
      "worktree list --porcelain": "worktree /repo\nHEAD aaa\n\n",
    });
    const bare = caught(() => createWorktree({ repository: "/repo", root, attemptId, baseSha: "abc" }, untracked.runner));
    assert.equal(bare.registered, false);
    assert.match(bare.message, /as an untracked directory/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
