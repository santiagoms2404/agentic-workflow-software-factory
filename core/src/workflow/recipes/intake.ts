import { IntakeOutputSchema } from "../../contracts/intake-output.ts";
import { PlanOutputSchema } from "../../contracts/plan-output.ts";
import type { WorkflowRecipe } from "../compiler.ts";
import { loadUserPrompt, requireHostExecution } from "../recipe-support.ts";

export const intakeWorkflow = {
  id: "intake",
  tier: 0,
  phases: [
    {
      id: "request",
      kind: "engineer",
      owner: "engineer",
      description: "Capture the owner's vague work intent and known constraints without starting a provider",
      schemaId: "awsf.plan-output/v1",
      outputSchema: PlanOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("request", context),
    },
    {
      id: "intake",
      kind: "agent",
      owner: "intake",
      description: "Refine vague work into one dependency-aware ticket with testable acceptance criteria",
      schemaId: "awsf.intake-output/v1",
      outputSchema: IntakeOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: loadUserPrompt("intake"),
    },
  ],
} as const satisfies WorkflowRecipe;

export default intakeWorkflow;
