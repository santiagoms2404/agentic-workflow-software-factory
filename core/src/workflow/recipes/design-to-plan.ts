import {
  ArchitectureReviewOutputSchema,
  type ArchitectureReviewOutput,
} from "../../contracts/architecture-review-output.ts";
import { DesignOutputSchema, type DesignOutput } from "../../contracts/design-output.ts";
import { DesignPlanOutputSchema, type DesignPlanOutput } from "../../contracts/design-plan-output.ts";
import { DocumentOutputSchema } from "../../contracts/document-output.ts";
import { PlanContextSchema, type PlanContext } from "../../contracts/plan-context.ts";
import { PlanOutputSchema } from "../../contracts/plan-output.ts";
import { architectureReviewClear, architectureVerdictConsistent } from "../../gates/architecture-review.ts";
import { spineCarried, spineDeclared } from "../../gates/design-spine.ts";
import type { WorkflowRecipe } from "../compiler.ts";
import { loadUserPrompt, requireHostExecution } from "../recipe-support.ts";

export const designToPlanWorkflow = {
  id: "design-to-plan",
  tier: 2,
  phases: [
    {
      id: "request",
      kind: "engineer",
      owner: "engineer",
      description: "Capture the owner's planning request before any provider call is reserved",
      schemaId: "awsf.plan-output/v1",
      outputSchema: PlanOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("request", context),
    },
    {
      id: "design",
      kind: "agent",
      owner: "designer",
      description: "Declare the architecture, invariants, and acceptance boundaries that the plan must preserve",
      schemaId: "awsf.design-output/v1",
      outputSchema: DesignOutputSchema,
      maxCorrections: 1,
      gates: [{
        id: "spine_declared",
        run: (context) => spineDeclared(context.envelope as DesignOutput, {
          ownerRecordedRequest: context.previousEnvelope?.summary ?? "",
        }),
      }],
      prompt: loadUserPrompt("designer"),
    },
    {
      id: "architecture-review",
      kind: "agent",
      owner: "architecture-reviewer",
      description: "Independently challenge the declared design and record bounded findings for the owner",
      schemaId: "awsf.architecture-review-output/v1",
      outputSchema: ArchitectureReviewOutputSchema,
      maxCorrections: 1,
      gates: [{
        id: "architecture_verdict_consistent",
        run: (context) => architectureVerdictConsistent(
          context.envelope as ArchitectureReviewOutput,
          context.previousEnvelope as DesignOutput,
        ),
      }],
      prompt: loadUserPrompt("architecture-reviewer"),
    },
    {
      id: "plan-context",
      kind: "code",
      owner: "host",
      description: "Compose the reviewed identifier spine that makes planning impossible while blockers remain",
      schemaId: "awsf.plan-context/v1",
      outputSchema: PlanContextSchema,
      maxCorrections: 0,
      gates: [{
        id: "architecture_review_clear",
        run: (context) => {
          const planContext = context.envelope as PlanContext;
          return architectureReviewClear(
            {
              schema: "awsf.architecture-review-output/v1",
              producerStatus: planContext.producerStatus,
              summary: planContext.summary,
              artifacts: planContext.artifacts,
              notesForNextPhase: planContext.notesForNextPhase,
              reviewedDesign: planContext.summary,
              verdict: planContext.reviewVerdict,
              findings: planContext.nonBlockingFindings,
              limitations: ["The original review limitations are bound by the host executor."],
            },
            {
              design: planContext.identifierSet,
              planContext: planContext.identifierSet,
            },
          );
        },
      }],
      execute: (context) => requireHostExecution("plan-context", context),
    },
    {
      id: "plan",
      kind: "agent",
      owner: "planner",
      description: "Map the carried design commitments into ordered, independently verifiable implementation work",
      schemaId: "awsf.design-plan-output/v1",
      outputSchema: DesignPlanOutputSchema,
      maxCorrections: 1,
      gates: [{
        id: "spine_carried",
        run: (context) => spineCarried(
          context.envelope as DesignPlanOutput,
          {
            identifierSet: (context.previousEnvelope as PlanContext).identifierSet,
            planLabel: "design-to-plan",
          },
          ["design-to-plan"],
        ),
      }],
      prompt: loadUserPrompt("planner"),
    },
    {
      id: "plan-render",
      kind: "code",
      owner: "host",
      description: "Render the validated plan envelope into the committed plan, prompts, and tickets",
      schemaId: "awsf.document-output/v1",
      outputSchema: DocumentOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("plan-render", context),
    },
  ],
} as const satisfies WorkflowRecipe;

export default designToPlanWorkflow;
