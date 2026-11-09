import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlanContext } from "../../../src/contracts/plan-context.ts";
import { designToPlanWorkflow } from "../../../src/workflow/recipes/design-to-plan.ts";

interface DeclaredGate {
  readonly id: string;
  run(context: { envelope: PlanContext; previousEnvelope: null; correctionRound: number }): { readonly passed: boolean };
}

// B6-29: the declared plan-context gate passed its own identifier set as both the
// stored design and the plan context, so its spine check compared a value with
// itself and could not fail. A clean accept verdict then passed the whole gate.
test("B6-29: the declared plan-context gate does not pass a spine it cannot compare against the design", () => {
  const phase = designToPlanWorkflow.phases.find((candidate) => candidate.id === "plan-context") as
    { readonly gates: readonly DeclaredGate[] } | undefined;
  assert.ok(phase, "the design-to-plan recipe has a plan-context phase");
  const gate = phase.gates.find((candidate) => candidate.id === "architecture_review_clear");
  assert.ok(gate, "the plan-context phase declares the architecture review gate");

  const planContext = {
    schema: "awsf.plan-context/v1",
    producerStatus: "success",
    summary: "The reviewed design, carried into planning.",
    artifacts: [],
    notesForNextPhase: "Plan against the carried spine.",
    reviewVerdict: "accept",
    nonBlockingFindings: [],
    identifierSet: {
      invariants: [{ id: "INV-1", statement: "The host owns the commit." }],
      acceptanceCriteria: [{ id: "AC-1", statement: "A clean candidate is accepted." }],
    },
  } as unknown as PlanContext;

  const report = gate.run({ envelope: planContext, previousEnvelope: null, correctionRound: 0 });
  assert.equal(report.passed, false, "the gate has no stored design to compare the spine against, so it must not pass");
});
