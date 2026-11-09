import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_IDS, GateReport, gateKindFor } from "../../../src/gates/interface.ts";

test("every gate has its canonical evidence kind", () => {
  assert.deepEqual(GATE_IDS.map((gateId) => [gateId, gateKindFor(gateId)]), [
    ["envelope_valid", "pure"],
    ["artifacts_exist", "filesystem"],
    ["files_non_empty", "filesystem"],
    ["json_parses", "filesystem"],
    ["diff_matches_claims", "git"],
    ["head_advanced", "git"],
    ["candidate_hygiene", "git"],
    ["no_protected_paths", "filesystem"],
    ["risk_tier_sufficient", "pure"],
    ["writes_within_globs", "filesystem"],
    ["verdict_consistent", "pure"],
    ["review_evidence_present", "pure"],
    ["commands_pass", "subprocess"],
    ["journey_passes", "journey"],
    ["contract_digest", "filesystem"],
    ["spine_declared", "pure"],
    ["spine_carried", "pure"],
    ["design_evidence_present", "pure"],
    ["architecture_verdict_consistent", "pure"],
    ["architecture_review_clear", "pure"],
    ["visual_references_inspected", "pure"],
  ]);
});

test("GateReport.check appends pass and fail evidence and returns this", () => {
  const report = new GateReport("envelope_valid");
  assert.equal(report.check("first", false, "failed").check("second", true, "passed"), report);
  assert.deepEqual(report.checks.map((check) => [check.item, check.ok, check.note]), [
    ["first", false, "failed"],
    ["second", true, "passed"],
  ]);
  assert.equal(report.passed, false);
});
