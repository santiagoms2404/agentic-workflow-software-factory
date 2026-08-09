import { test } from "node:test";
import assert from "node:assert/strict";
import { headAdvanced } from "../../../src/gates/git-diff.ts";

test("head_advanced positive requires a different host commit", () => {
  const report = headAdvanced({ baseSha: "a", headSha: "b", hostCommitExists: true });
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 2);
});

test("head_advanced signature negative rejects success with no diff", () => {
  const report = headAdvanced({ baseSha: "a", headSha: "a", hostCommitExists: false });
  assert.equal(report.passed, false);
  assert.deepEqual(report.checks.map((check) => check.ok), [false, false]);
});
