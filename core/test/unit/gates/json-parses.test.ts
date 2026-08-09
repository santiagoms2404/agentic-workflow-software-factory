import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonParses } from "../../../src/gates/artifacts.ts";

const artifacts = [{ path: "result.json", kind: "report" as const, description: "JSON" }];

test("json_parses positive records the top-level type", () => {
  const report = jsonParses(artifacts, () => ({ exists: true, size: 2, content: "[]" }));
  assert.equal(report.passed, true);
  assert.match(report.checks[0]!.note, /top-level type=array/);
});

test("json_parses negative records malformed JSON", () => {
  const report = jsonParses(artifacts, () => ({ exists: true, size: 1, content: "{" }));
  assert.equal(report.passed, false);
  assert.match(report.checks[0]!.note, /invalid/);
});
