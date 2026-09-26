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

test("a shift source names its completed tickets and its tail, and a shipped source names none", () => {
  const shift = { plan: "awsf-v2-w17-shift", milestones: ["M4"], completedTickets: ["T11", "T12"], remainingTickets: ["T13"] };
  assert.equal(Value.Check(CandidateAdoptionEvidenceSchema, { ...evidence, shift }), true);
  assert.equal(Value.Check(CandidateAdoptionEvidenceSchema, { ...evidence, shift: { ...shift, remainingTickets: [] } }), true);
  assert.equal(Value.Check(CandidateAdoptionEvidenceSchema, { ...evidence, shift: { ...shift, completedTickets: [] } }), false, "a shift that completed nothing is never adopted");
  assert.equal(Value.Check(CandidateAdoptionEvidenceSchema, { ...evidence, shift: { ...shift, completedTickets: ["t11"] } }), false);
  assert.equal(Value.Check(CandidateAdoptionEvidenceSchema, { ...evidence, shift: { ...shift, extra: true } }), false);
});
