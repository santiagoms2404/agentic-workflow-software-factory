import assert from "node:assert/strict";
import { test } from "node:test";
import { fenceHits } from "./no-destructive-paths.test.ts";

test("argv-array destructive Git commands and async deletes are fenced", () => {
  const text = [
    'runGit(runner, ["worktree", "remove", path]);',
    'runGit(runner, ["branch", "-D", name]);',
    'runGit(runner, ["update-ref", "-d", ref]);',
    'runGit(runner, ["reset", "--hard", sha]);',
    'runGit(runner, ["clean", "-fdx"]);',
    'await rm(path, { recursive: true, force: true });',
    'await fs.promises.rmdir(path, { recursive: true });',
  ].join("\n");

  assert.deepEqual(fenceHits([{ path: "core/src/fixture/destructive.ts", text }]).offenders, [
    "core/src/fixture/destructive.ts:1: runGit(runner, [\"worktree\", \"remove\", path]);",
    "core/src/fixture/destructive.ts:2: runGit(runner, [\"branch\", \"-D\", name]);",
    "core/src/fixture/destructive.ts:3: runGit(runner, [\"update-ref\", \"-d\", ref]);",
    "core/src/fixture/destructive.ts:4: runGit(runner, [\"reset\", \"--hard\", sha]);",
    "core/src/fixture/destructive.ts:5: runGit(runner, [\"clean\", \"-fdx\"]);",
    "core/src/fixture/destructive.ts:6: await rm(path, { recursive: true, force: true });",
    "core/src/fixture/destructive.ts:7: await fs.promises.rmdir(path, { recursive: true });",
  ]);
});

test("non-destructive argv-array Git commands remain allowed", () => {
  const text = [
    'runGit(runner, ["worktree", "add", "--detach", path, head]);',
    'runGit(runner, ["branch", "--list", name]);',
    'runGit(runner, ["reset", "--soft", sha]);',
    'runGit(runner, ["clean", "-n"]);',
  ].join("\n");
  assert.deepEqual(fenceHits([{ path: "core/src/fixture/safe.ts", text }]), {
    offenders: [],
    unused: [
      "core/src/execution/operation-lease.ts: if (old !== null) await unlink(pathFor(directory));",
      "core/src/execution/operation-lease.ts: await unlink(pathFor(directory));",
      "core/src/persistence/attempt-lock.ts: await unlink(lockPath);",
      "core/src/persistence/attempt-lock.ts: await unlink(this.lockPath);",
    ],
  });
});
