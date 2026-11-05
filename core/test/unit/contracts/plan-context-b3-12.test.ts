// B3-12 — the non-blocking severities are the complement of the blocking ones.
//
// The plan context accepts only the non-blocking members of the review
// severity vocabulary. The set was taken by position, which matches today only
// because the first two members happen to be the non-blocking ones. It is now
// the filter of the vocabulary by the blocking set, so a reordering or an
// inserted severity cannot leave a blocking severity admitted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { NON_BLOCKING_REVIEW_SEVERITIES } from "../../../src/contracts/plan-context.ts";
import { BLOCKING_SEVERITIES, REVIEW_SEVERITIES } from "../../../src/contracts/review-output.ts";

test("the plan context admits exactly the review severities that do not block (B3-12)", () => {
  const complement = REVIEW_SEVERITIES.filter((severity) => !(BLOCKING_SEVERITIES as readonly string[]).includes(severity));
  assert.deepEqual([...NON_BLOCKING_REVIEW_SEVERITIES], complement);
  assert.deepEqual([...NON_BLOCKING_REVIEW_SEVERITIES], ["low", "medium"]);
});
