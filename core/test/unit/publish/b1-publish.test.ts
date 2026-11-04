import { test } from "node:test";
import assert from "node:assert/strict";
import { publishArgv, validatePublishArgv } from "../../../src/publish/argv.ts";
import type { AuthorizedPublishPlan } from "../../../src/publish/authorize.ts";

test("B1-45: validatePublishArgv rejects forbidden flags", () => {
  assert.throws(
    () => validatePublishArgv(["push", "--porcelain", "--mirror", "origin", "main"]),
    /forbidden push flag/,
  );
  assert.throws(
    () => validatePublishArgv(["push", "--porcelain", "--delete", "origin", "main"]),
    /forbidden push flag/,
  );
  assert.throws(
    () => validatePublishArgv(["push", "--porcelain", "--prune", "origin", "main"]),
    /forbidden push flag/,
  );
  assert.throws(
    () => validatePublishArgv(["push", "--porcelain", "--force", "origin", "main"]),
    /forbidden push flag/,
  );
  assert.throws(
    () => validatePublishArgv(["push", "-f", "origin", "main"]),
    /forbidden push flag/,
  );

  // Normal authorized plan generates valid push argv
  const plan = {
    remoteName: "origin",
    branch: "main",
    sha: "0123456789abcdef0123456789abcdef01234567",
  } as unknown as AuthorizedPublishPlan;
  const argv = publishArgv(plan);
  assert.deepEqual(argv, [
    "push",
    "--porcelain",
    "origin",
    "0123456789abcdef0123456789abcdef01234567:refs/heads/main",
  ]);
});
