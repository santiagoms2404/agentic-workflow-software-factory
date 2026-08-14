import { BuildOutputSchema } from "../../contracts/build-output.ts";
import { PlanOutputSchema } from "../../contracts/plan-output.ts";
import { ReviewContextSchema } from "../../contracts/review-context.ts";
import { ReviewOutputSchema } from "../../contracts/review-output.ts";
import { TestOutputSchema } from "../../contracts/test-output.ts";
import type { WorkflowRecipe } from "../compiler.ts";
import { loadUserPrompt, requireHostExecution } from "../recipe-support.ts";

export const buildReviewWorkflow = {
  id: "build-review",
  tier: 2,
  phases: [
    {
      id: "request",
      kind: "engineer",
      owner: "engineer",
      description: "Capture the high-risk change and its acceptance criteria without starting a provider",
      schemaId: "awsf.plan-output/v1",
      outputSchema: PlanOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("request", context),
    },
    {
      id: "builder",
      kind: "agent",
      owner: "builder",
      description: "Implement the requested change in the managed worktree and declare the exact diff",
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
    {
      // A host phase, so it adds no agent call and no tier ceiling moves. It
      // exists because the reviewer has exactly one envelope slot and needs
      // more than one phase's output in it.
      id: "review-context",
      kind: "code",
      owner: "host",
      description: "Compose the host-observed diff, intent, and gate evidence the reviewer must judge against",
      schemaId: "awsf.review-context/v1",
      outputSchema: ReviewContextSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("review-context", context),
    },
    {
      id: "reviewer",
      kind: "agent",
      owner: "reviewer",
      description: "Audit the exact candidate on the provider opposite the builder and report concrete defects",
      schemaId: "awsf.review-output/v1",
      outputSchema: ReviewOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: loadUserPrompt("reviewer"),
    },
  ],
} as const satisfies WorkflowRecipe;

export default buildReviewWorkflow;
