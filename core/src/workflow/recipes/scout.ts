import { PlanOutputSchema } from "../../contracts/plan-output.ts";
import { ScoutOutputSchema } from "../../contracts/scout-output.ts";
import type { WorkflowRecipe } from "../compiler.ts";
import { loadUserPrompt, requireHostExecution } from "../recipe-support.ts";

export const scoutWorkflow = {
  id: "scout",
  tier: 0,
  phases: [
    {
      id: "request",
      kind: "engineer",
      owner: "engineer",
      description: "Capture the owner's reconnaissance question without starting a provider",
      schemaId: "awsf.plan-output/v1",
      outputSchema: PlanOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("request", context),
    },
    {
      id: "scout",
      kind: "agent",
      owner: "scout",
      description: "Inspect the repository read-only and report concrete locations relevant to the request",
      schemaId: "awsf.scout-output/v1",
      outputSchema: ScoutOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: loadUserPrompt("scout"),
    },
  ],
} as const satisfies WorkflowRecipe;

export default scoutWorkflow;
