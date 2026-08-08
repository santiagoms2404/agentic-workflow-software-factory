import assert from "node:assert/strict";
import { test } from "node:test";
import { commitAsHost, HOST_AUTHOR } from "../../../src/git/commit.ts";
import { listWorktrees, createWorktree } from "../../../src/git/worktrees.ts";
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
