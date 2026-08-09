import { BuildOutputSchema } from "../../contracts/build-output.ts";
import { PlanOutputSchema } from "../../contracts/plan-output.ts";
import { TestOutputSchema } from "../../contracts/test-output.ts";
import type { WorkflowRecipe } from "../compiler.ts";
import { loadUserPrompt, requireHostExecution } from "../recipe-support.ts";

export const planBuildTestWorkflow = {
  id: "plan-build-test",
  tier: 1,
  phases: [
    {
      id: "request",
      kind: "engineer",
      owner: "engineer",
      description: "Capture the owner's goal and constraints without starting a provider",
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
      description: "Derive an implementable sequence with explicit acceptance evidence for the builder",
      schemaId: "awsf.plan-output/v1",
      outputSchema: PlanOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: loadUserPrompt("planner"),
    },
    {
      id: "builder",
      kind: "agent",
      owner: "builder",
      description: "Implement the validated plan in the managed worktree and declare the exact diff",
      schemaId: "awsf.build-output/v1",
      outputSchema: BuildOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: loadUserPrompt("builder"),
    },
    {
      id: "tests",
      kind: "code",
      owner: "host",
      description: "Run the configured quality commands against the host-created candidate commit",
      schemaId: "awsf.test-output/v1",
      outputSchema: TestOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("tests", context),
    },
  ],
} as const satisfies WorkflowRecipe;

export default planBuildTestWorkflow;
