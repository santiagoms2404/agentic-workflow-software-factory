import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictConsistent } from "../../../src/gates/review.ts";
import { validReviewOutput } from "../contracts/fixtures.ts";

const SHA = "a".repeat(40);
const PATH = "core/src/contracts/parse-envelope.ts";

test("verdict_consistent positive records all review checks", () => {
  const report = verdictConsistent(validReviewOutput(), { candidateSha: SHA, candidatePaths: [PATH] });
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 4);
});

test("verdict_consistent signature negative rejects accept with a critical finding", () => {
  const output = validReviewOutput();
  output.verdict = "accept";
  output.findings[0]!.severity = "critical";
  const report = verdictConsistent(output, { candidateSha: SHA, candidatePaths: [PATH] });
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((check) => check.item.includes("high/critical"))?.ok, false);
  assert.equal(report.checks.length, 4);
});
