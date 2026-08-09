import { test } from "node:test";
import assert from "node:assert/strict";
import { journeyPasses } from "../../../src/gates/journey.ts";

const SHA = "a".repeat(40);

test("journey_passes positive pins a passing run to the exact candidate", () => {
  const report = journeyPasses({ journeyId: "T2", ran: true, passed: true, candidateSha: SHA }, SHA);
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 3);
});

test("journey_passes negative records run, failure, and stale SHA checks", () => {
  const report = journeyPasses({ journeyId: "T2", ran: true, passed: false, candidateSha: "b".repeat(40) }, SHA);
  assert.equal(report.passed, false);
  assert.equal(report.checks.length, 3);
  assert.deepEqual(report.checks.map((check) => check.ok), [true, false, false]);
});
