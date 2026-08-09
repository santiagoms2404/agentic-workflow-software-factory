import { test } from "node:test";
import assert from "node:assert/strict";
import { filesNonEmpty } from "../../../src/gates/artifacts.ts";

const artifacts = [{ path: "plan.md", kind: "plan" as const, description: "Plan" }];

test("files_non_empty positive accepts a non-zero declared file", () => {
  const report = filesNonEmpty(artifacts, () => ({ exists: true, size: 1 }));
  assert.equal(report.passed, true);
  assert.match(report.checks[0]!.note, /size=1/);
});

test("files_non_empty negative rejects an existing empty file", () => {
  const report = filesNonEmpty(artifacts, () => ({ exists: true, size: 0 }));
  assert.equal(report.passed, false);
  assert.equal(report.checks[0]!.ok, false);
});
