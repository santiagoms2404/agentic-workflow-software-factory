// B7-04 — the L26 quota stop and the T2 review.
//
// L12 refuses a T2 task that would reach AWAITING_OWNER out of GATING without
// its opposite-provider review. L26 reaches the same state out of RUNNING, and
// a T2 build-review run whose next phase is the deferred review could take it
// with the review never run: the one control the tier bought, skipped by a
// quota reading. The guard is pure (inv 5), so "the review ran" is supplied
// evidence — the recorded review verdict — never something it goes and reads.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_SHA,
  budget,
  expectAccepted,
  expectRejection,
  validInput,
  type TransitionInput,
} from "./_lifecycle-harness.ts";

/** A T2 quota stop: the valid L26 fixture, at the tier that bought a review. */
function t2QuotaStop(): TransitionInput {
  return { ...validInput("L26"), tier: 2, budget: budget({ callsSpent: 2 }) };
}

/** The same stop, after the opposite-provider review recorded a verdict on the candidate. */
function t2QuotaStopAfterReview(): TransitionInput {
  const base = t2QuotaStop();
  return {
    ...base,
    evidence: {
      ...base.evidence,
      candidateSha: CANDIDATE_SHA,
      review: { verdict: "accept", reviewedSha: CANDIDATE_SHA, findings: [] },
    },
  };
}

test("L26 refuses a T2 quota stop when the opposite-provider review never ran", async () => {
  const error = await expectRejection("InsufficientEvidence", t2QuotaStop(), {
    because: "a T2 task may not reach AWAITING_OWNER with its mandatory review skipped",
  });
  assert.equal(error.edge, "L26");
  assert.deepEqual(error.violations, [
    "a T2 task may not take the quota stop before its opposite-provider review has run",
  ]);
});

test("L26 still refuses a T2 stop on an unmeasured reading, naming both defects at once", async () => {
  const base = t2QuotaStop();
  const error = await expectRejection("InsufficientEvidence", {
    ...base,
    evidence: { quotaStop: { route: "pi-codex", thresholdMinutes: 5 } },
  });
  assert.equal(error.edge, "L26");
  assert.equal((error.violations as readonly string[]).length, 2);
  assert.match(String(error.message), /minutesToReset \(absent\)/u);
  assert.match(String(error.message), /opposite-provider review has run/u);
});

test("L26 admits a T2 quota stop once the review has recorded a verdict", async () => {
  const result = await expectAccepted(t2QuotaStopAfterReview());
  assert.equal(result.edge, "L26");
  assert.equal(result.to, "AWAITING_OWNER");
});

test("L26 at T0 and T1 is unchanged: no review is demanded where none was bought", async () => {
  for (const tier of [0, 1] as const) {
    const result = await expectAccepted({ ...validInput("L26"), tier });
    assert.equal(result.edge, "L26", `T${tier}`);
    assert.equal(result.to, "AWAITING_OWNER", `T${tier}`);
  }
});

test("L26 at T2 mirrors L12: both refuse the review skip into AWAITING_OWNER", async () => {
  const l12 = await expectRejection("InsufficientEvidence", {
    ...validInput("L12"), tier: 2, budget: budget({ callsSpent: 2 }),
  });
  const l26 = await expectRejection("InsufficientEvidence", t2QuotaStop());
  assert.equal(l12.to, "AWAITING_OWNER");
  assert.equal(l26.to, "AWAITING_OWNER");
  assert.match(String(l12.message), /T2 task may not skip the opposite-provider review/u);
  assert.match(String(l26.message), /T2 task may not take the quota stop before its opposite-provider review/u);
});
