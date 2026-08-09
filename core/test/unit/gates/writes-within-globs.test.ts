import { test } from "node:test";
import assert from "node:assert/strict";
import { writesWithinGlobs } from "../../../src/gates/git-diff.ts";

test("writes_within_globs positive records every allowed write", () => {
  const report = writesWithinGlobs(["src/a.ts", "src/nested/b.ts"], ["src/**"], true);
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 2);
});

test("writes_within_globs negative rejects paths outside the agent grant", () => {
  const report = writesWithinGlobs(["src/a.ts", "docs/a.md"], ["src/**"], true);
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((check) => check.item === "docs/a.md")?.ok, false);
  assert.equal(report.checks.length, 2);
});
