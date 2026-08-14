import { BuildOutputSchema } from "../../contracts/build-output.ts";
import { DocumentOutputSchema } from "../../contracts/document-output.ts";
import { PlanOutputSchema } from "../../contracts/plan-output.ts";
import { ReviewContextSchema } from "../../contracts/review-context.ts";
import { ReviewOutputSchema } from "../../contracts/review-output.ts";
import { TestOutputSchema } from "../../contracts/test-output.ts";
import type { WorkflowRecipe } from "../compiler.ts";
import { loadUserPrompt, requireHostExecution } from "../recipe-support.ts";

export const simpleSdlcWorkflow = {
  id: "simple-sdlc",
  tier: 2,
  phases: [
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
    {
      id: "documenter",
      kind: "agent",
      owner: "documenter",
      description: "Update the allowed documentation so it describes the verified implementation",
      schemaId: "awsf.document-output/v1",
      outputSchema: DocumentOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: loadUserPrompt("documenter"),
    },
    {
      id: "final-tests",
      kind: "code",
      owner: "host",
      description: "Re-run every configured quality command after documentation changed the candidate",
      schemaId: "awsf.test-output/v1",
      outputSchema: TestOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("final-tests", context),
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
      description: "Audit the final candidate on the provider opposite the builder and report concrete defects",
      schemaId: "awsf.review-output/v1",
      outputSchema: ReviewOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: loadUserPrompt("reviewer"),
    },
  ],
} as const satisfies WorkflowRecipe;

export default simpleSdlcWorkflow;
