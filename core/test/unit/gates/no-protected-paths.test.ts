import { test } from "node:test";
import assert from "node:assert/strict";
import { noProtectedPaths } from "../../../src/gates/git-diff.ts";

test("no_protected_paths positive records every safe changed path", () => {
  const report = noProtectedPaths(["src/a.ts", "test/a.test.ts"], ["specs/**"], true);
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 2);
});

test("no_protected_paths signature negative rejects a protected touch", () => {
  const report = noProtectedPaths(["src/a.ts", "specs/plan.html"], ["specs/**"], true);
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((check) => check.item === "specs/plan.html")?.ok, false);
  assert.equal(report.checks.length, 2);
});
