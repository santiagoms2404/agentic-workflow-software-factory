import { test } from "node:test";
import assert from "node:assert/strict";
import { GateReport } from "../../../src/gates/interface.ts";

test("GateReport.check appends pass and fail evidence and returns this", () => {
  const report = new GateReport("envelope_valid");
  assert.equal(report.check("first", false, "failed").check("second", true, "passed"), report);
  assert.deepEqual(report.checks.map((check) => [check.item, check.ok, check.note]), [
    ["first", false, "failed"],
    ["second", true, "passed"],
  ]);
  assert.equal(report.passed, false);
});
