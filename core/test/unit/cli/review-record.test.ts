// What the journal says about the reviews on record — the reader `awsf review`
// derives L25's eligibility from and `awsf land` discloses.
//
// These are pure functions over evidence records, so they are unit-testable
// without a repository, and the cases that matter are the ones where getting
// the reading wrong would either refuse a legitimate replacement or admit an
// illegitimate one.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  candidateGateRows,
  recordedReviews,
  recordedRoutes,
  supersededReviewLines,
} from "../../../src/cli/commands/review-record.ts";
import type { ReviewOutput } from "../../../src/contracts/review-output.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";

const SESSION = "0f8d1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const CANDIDATE = "a".repeat(40);
const OTHER = "b".repeat(40);
const AT = "2026-08-14T00:00:00.000Z";

function review(reviewedSha: string, verdict: ReviewOutput["verdict"] = "accept"): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: "fixture review",
    artifacts: [], notesForNextPhase: "owner decides", verdict, reviewedSha,
    findings: verdict === "concern"
      ? [{ id: "f1", severity: "high", file: "core/src/generated.ts", line: 1, title: "defect", detail: "detail", evidence: "evidence" }]
      : [],
    limitations: [],
  };
}

function envelope(key: string, payload: ReviewOutput): AttemptEvidence {
  return {
    type: "envelope", phaseId: `${SESSION}:${key}`,
    envelope: {
      schemaId: "awsf.review-output/v1", envelopeId: `${SESSION}:${key}:0`, sessionId: SESSION,
      phaseId: `${SESSION}:${key}`, correctionRound: 0, agent: "reviewer", valid: true, violations: [],
      payload, rawOutputPath: `raw/${key}.txt`, createdAt: AT,
    },
  } as unknown as AttemptEvidence;
}

function gate(key: string, gateId: string, passed: boolean, candidateSha: string | null): AttemptEvidence {
  return {
    type: "gate", id: `${SESSION}:${key}:0:${gateId}`, phaseId: `${SESSION}:${key}`, round: 0,
    gateId, kind: "pure", candidateSha, passed, exitCode: null,
    checks: [{ item: gateId, ok: passed, note: "fixture" }], violations: [], outputPath: null,
    startedAt: AT, endedAt: AT,
  } as unknown as AttemptEvidence;
}

function agent(key: string, adapterId: string, provider: string, requestedModel: string): AttemptEvidence {
  return {
    type: "agent", phaseId: `${SESSION}:${key}`, agent: key, adapterId, provider, color: null,
    requestedModel, resolvedModel: requestedModel, modelProvenance: "route-attributed",
    contextWindow: null, usageAuthority: "provider",
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "unknown" },
    contextTokens: 2, costUsd: null, costAuthority: "unavailable", at: AT,
  } as unknown as AttemptEvidence;
}

test("a review with no evidence gate row at all is the legacy class the edge exists to migrate", () => {
  const reviews = recordedReviews([envelope("reviewer", review(CANDIDATE))], SESSION);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]?.phaseKey, "reviewer");
  assert.equal(reviews[0]?.evidenceDefect, "evidence-gate-absent");
});

test("a passing evidence row makes a review unreplaceable, whatever its verdict says", () => {
  for (const verdict of ["accept", "concern"] as const) {
    const reviews = recordedReviews([
      envelope("reviewer", review(CANDIDATE, verdict)),
      gate("reviewer", "review_evidence_present", true, CANDIDATE),
    ], SESSION);
    assert.equal(reviews[0]?.evidenceDefect, null, verdict);
  }
});

test("a failed evidence row is the other member of the two-member enum", () => {
  const reviews = recordedReviews([
    envelope("reviewer", review(CANDIDATE)),
    gate("reviewer", "review_evidence_present", false, CANDIDATE),
  ], SESSION);
  assert.equal(reviews[0]?.evidenceDefect, "evidence-gate-failed");
});

test("a later row supersedes an earlier one for the same review phase", () => {
  const reviews = recordedReviews([
    envelope("reviewer", review(CANDIDATE)),
    gate("reviewer", "review_evidence_present", false, CANDIDATE),
    gate("reviewer", "review_evidence_present", true, CANDIDATE),
  ], SESSION);
  assert.equal(reviews[0]?.evidenceDefect, null);
});

test("another phase's evidence row never decides this review's eligibility", () => {
  const reviews = recordedReviews([
    envelope("reviewer", review(CANDIDATE)),
    gate("reviewer-re1", "review_evidence_present", true, CANDIDATE),
  ], SESSION);
  assert.equal(reviews[0]?.evidenceDefect, "evidence-gate-absent");
});

test("an invalid or payload-less review envelope is not a review on record", () => {
  const broken = {
    type: "envelope", phaseId: `${SESSION}:reviewer`,
    envelope: {
      schemaId: "awsf.review-output/v1", envelopeId: `${SESSION}:reviewer:0`, sessionId: SESSION,
      phaseId: `${SESSION}:reviewer`, correctionRound: 0, agent: "reviewer", valid: false,
      violations: [{ path: "/verdict", message: "missing", value: null }], payload: null,
      rawOutputPath: "raw/reviewer.txt", createdAt: AT,
    },
  } as unknown as AttemptEvidence;
  assert.deepEqual(recordedReviews([broken], SESSION), []);
});

test("the review phases' own gate rows are excluded from the candidate gate evidence", () => {
  // Conflating them would let a FAILED `review_evidence_present` row read as a
  // failed candidate gate, and L25 would refuse the exact case it exists for.
  const reviewPhaseIds = new Set([`${SESSION}:reviewer`]);
  const rows = candidateGateRows([
    gate("tests", "candidate_hygiene", true, CANDIDATE),
    gate("tests", "commands_pass", true, CANDIDATE),
    gate("reviewer", "review_evidence_present", false, CANDIDATE),
    gate("reviewer", "verdict_consistent", true, CANDIDATE),
    gate("builder", "writes_within_globs", true, OTHER),
    gate("builder", "envelope_valid", true, null),
  ], CANDIDATE, reviewPhaseIds);
  assert.deepEqual(rows.map((row) => row.gateId), ["candidate_hygiene", "commands_pass"]);
  assert.ok(rows.every((row) => row.candidateSha === CANDIDATE && row.passed));
});

test("the worker and review routes are told apart by which phase wrote them, not by an optional field", () => {
  const routes = recordedRoutes([
    agent("builder", "codex", "openai-codex", "codex:gpt-5.6-sol"),
    agent("reviewer", "claude", "anthropic", "claude:opus"),
  ], new Set([`${SESSION}:reviewer`]));
  assert.equal(routes.worker?.provider, "openai-codex");
  assert.equal(routes.review?.requestedModel, "claude:opus");
});

test("one review discloses nothing; a replaced one discloses both verdicts and the defect", () => {
  const single = recordedReviews([envelope("reviewer", review(CANDIDATE))], SESSION);
  assert.deepEqual(supersededReviewLines(single), []);

  const replaced = recordedReviews([
    envelope("reviewer", review(CANDIDATE)),
    envelope("reviewer-re1", review(CANDIDATE, "concern")),
    gate("reviewer-re1", "review_evidence_present", true, CANDIDATE),
  ], SESSION);
  const lines = supersededReviewLines(replaced);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /Superseded review \(reviewer\): accept — replaceable because evidence-gate-absent/);
  assert.match(lines[1]!, /Replacement review \(reviewer-re1\): concern with 1 finding\(s\)/);
});
