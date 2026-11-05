// B3-23 — L17 and the recorded review failure.
//
// L17 settles a review process that exited without a verdict. The one code that
// is a transport fact (review-unavailable) earns a fixed-route retry, and every
// other admitted code must match `reviewFailure` exactly. The first branch used
// to skip the match entirely, so a blocker could be journaled as transport
// unavailability while the failure on record was a different one.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  expectAccepted,
  expectRejection,
  validInput,
  type TransitionInput,
} from "./_lifecycle-harness.ts";

/** A review-unavailable settlement after its one retry, optionally naming a recorded failure. */
function unavailable(reviewFailure?: string): TransitionInput {
  const base = validInput("L17");
  return {
    ...base,
    evidence: {
      reviewTransportRetries: 1,
      ...(reviewFailure === undefined ? {} : { reviewFailure }),
    },
  };
}

test("L17 refuses review-unavailable when the recorded failure is a different code (B3-23)", async () => {
  const error = await expectRejection("InsufficientEvidence", unavailable("permission-breach"), {
    because: "a permission breach recorded under the transport trap must not be settled as unavailability",
  });
  assert.equal(error.edge, "L17");
  assert.deepEqual(error.violations, [
    'reviewFailure "permission-breach" does not match reason.code "review-unavailable"',
  ]);
});

test("L17 accepts review-unavailable with no recorded failure, or the matching one", async () => {
  for (const reviewFailure of [undefined, "review-unavailable"]) {
    const result = await expectAccepted(unavailable(reviewFailure));
    assert.equal(result.edge, "L17");
    assert.equal(result.to, "BLOCKED");
  }
});

test("L17 keeps its retry requirement for review-unavailable", async () => {
  const base = validInput("L17");
  const error = await expectRejection("InsufficientEvidence", { ...base, evidence: { reviewTransportRetries: 0 } });
  assert.equal(error.edge, "L17");
});
