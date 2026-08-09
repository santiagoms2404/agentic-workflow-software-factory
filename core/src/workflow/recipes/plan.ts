import { PlanOutputSchema } from "../../contracts/plan-output.ts";
import type { WorkflowRecipe } from "../compiler.ts";
import { loadUserPrompt, requireHostExecution } from "../recipe-support.ts";

export const planWorkflow = {
  id: "plan",
  tier: 0,
  phases: [
    {
      id: "request",
      kind: "engineer",
      owner: "engineer",
      description: "Capture the owner's desired outcome and constraints without starting a provider",
      schemaId: "awsf.plan-output/v1",
      outputSchema: PlanOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("request", context),
    },
    {
      id: "planner",
      kind: "agent",
      owner: "planner",
      description: "Turn the accepted request into ordered implementation and verification steps",
      schemaId: "awsf.plan-output/v1",
      outputSchema: PlanOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: loadUserPrompt("planner"),
    },
  ],
} as const satisfies WorkflowRecipe;

export default planWorkflow;
