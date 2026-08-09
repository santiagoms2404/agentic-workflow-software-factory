import { test } from "node:test";
import assert from "node:assert/strict";
import { diffMatchesClaims } from "../../../src/gates/git-diff.ts";

test("diff_matches_claims positive accepts exact sets including a deleted path", () => {
  const report = diffMatchesClaims(["src/new.ts", "src/deleted.ts"], ["src/deleted.ts", "src/new.ts"]);
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 4);
});

test("diff_matches_claims signature negative rejects an undeclared change", () => {
  const report = diffMatchesClaims(["src/claimed.ts", "src/undeclared.ts"], ["src/claimed.ts"]);
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((check) => check.item === "changed:src/undeclared.ts")?.ok, false);
});
