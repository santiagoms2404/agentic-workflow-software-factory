import assert from "node:assert/strict";
import { test } from "node:test";

import { BuildOutputSchema, BUILD_OUTPUT_SCHEMA_ID } from "../../../src/contracts/build-output.ts";
import { compileWorkflowStructure, InvalidReviewBuildProducerCount, type WorkflowDefinition } from "../../../src/workflow/compiler.ts";
import type { PhaseDefinition } from "../../../src/workflow/phase.ts";
import { requireHostExecution } from "../../../src/workflow/recipe-support.ts";
import { buildReviewWorkflow } from "../../../src/workflow/recipes/build-review.ts";

function hostSeed(id: string): PhaseDefinition {
  return {
    id, kind: "code", owner: "host", description: "Commit a frozen patch as the candidate no provider built",
    schemaId: BUILD_OUTPUT_SCHEMA_ID, outputSchema: BuildOutputSchema, maxCorrections: 0, gates: [],
    execute: (context) => requireHostExecution(id, context),
  };
}

// B6-16: when two host seeds collided, the refusal was built from the empty
// agent-producer list, so it reported "found 0" and named no phase.
test("B6-16: two host seeds on prove are refused with both colliding phase ids named", () => {
  const review = buildReviewWorkflow.phases.find((phase) => phase.id === "reviewer")!;
  const workflow: WorkflowDefinition = { id: "prove", phases: [hostSeed("seed-a"), hostSeed("seed-b"), review] };
  assert.throws(() => compileWorkflowStructure(workflow), (error: unknown) => {
    assert.ok(error instanceof InvalidReviewBuildProducerCount, String(error));
    assert.equal(error.count, 2, error.message);
    assert.deepEqual([...error.phaseIds], ["seed-a", "seed-b"], error.message);
    return true;
  });
});
