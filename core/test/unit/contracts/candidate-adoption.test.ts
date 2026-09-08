import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";

import { CandidateAdoptionEvidenceSchema } from "../../../src/contracts/candidate-adoption.ts";

const evidence = {
  sourceProject: "project",
  sourceTaskId: "blocked-source",
  sourceAttempt: 2,
  sourceSessionId: "source-session",
  sourceRevision: 14,
  sourceLifecycle: "BLOCKED",
  baseSha: "a".repeat(40),
  candidateSha: "b".repeat(40),
  workerProvider: "provider-a",
  targetTaskId: "continuation",
  verifiedAt: "2026-09-08T00:00:00.000Z",
  sourceEvidenceCopied: false,
  sourceApprovalsCopied: false,
} as const;

test("candidate-adoption evidence pins one sealed source and makes non-transfer explicit", () => {
  assert.equal(Value.Check(CandidateAdoptionEvidenceSchema, evidence), true);
  assert.equal(Value.Check(CandidateAdoptionEvidenceSchema, { ...evidence, sourceApprovalsCopied: true }), false);
  assert.equal(Value.Check(CandidateAdoptionEvidenceSchema, { ...evidence, candidateSha: "HEAD" }), false);
  assert.equal(Value.Check(CandidateAdoptionEvidenceSchema, { ...evidence, extra: "not admitted" }), false);
});
