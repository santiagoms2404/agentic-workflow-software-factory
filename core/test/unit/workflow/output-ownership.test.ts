import assert from "node:assert/strict";
import { test } from "node:test";

import { WORKFLOW_RECIPES } from "../../../src/workflow/catalog.ts";
import { outputOwnershipCheck, PHASE_OUTPUT_OWNERSHIP } from "../../../src/workflow/output-ownership.ts";
import { validBuildOutput, validDocumentOutput, validReviewOutput } from "../contracts/fixtures.ts";

test("shipped work products have one central phase owner", () => {
  assert.deepEqual(PHASE_OUTPUT_OWNERSHIP.planner?.outputs, ["plan"]);
  assert.deepEqual(PHASE_OUTPUT_OWNERSHIP.builder?.outputs, ["source-and-tests"]);
  assert.deepEqual(PHASE_OUTPUT_OWNERSHIP.tests?.outputs, ["host-test-evidence"]);
  assert.deepEqual(PHASE_OUTPUT_OWNERSHIP.documenter?.outputs, ["documentation", "run-report"]);
  assert.deepEqual(PHASE_OUTPUT_OWNERSHIP.reviewer?.outputs, ["review"]);
});

test("every phase in every shipped recipe has an output owner", () => {
  for (const recipe of WORKFLOW_RECIPES) {
    for (const phase of recipe.phases) {
      assert.ok(PHASE_OUTPUT_OWNERSHIP[phase.id as keyof typeof PHASE_OUTPUT_OWNERSHIP], `${recipe.id}/${phase.id}`);
    }
  }
});

test("an agent cannot claim a nearby artifact class owned by another phase", () => {
  assert.equal(outputOwnershipCheck("builder", validBuildOutput()).ok, true);
  assert.equal(outputOwnershipCheck("documenter", validDocumentOutput()).ok, true);
  assert.equal(outputOwnershipCheck("reviewer", validReviewOutput()).ok, true);

  const documenterClaimingSource = {
    ...validDocumentOutput(),
    artifacts: [{ path: "core/src/index.ts", kind: "source" as const, description: "nearby implementation" }],
  };
  const rejected = outputOwnershipCheck("documenter", documenterClaimingSource);
  assert.equal(rejected.ok, false);
  assert.match(rejected.note, /does not own source:core\/src\/index\.ts/);
});
