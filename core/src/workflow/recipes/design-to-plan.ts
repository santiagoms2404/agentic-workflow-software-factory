import {
  ArchitectureReviewOutputSchema,
  type ArchitectureReviewOutput,
} from "../../contracts/architecture-review-output.ts";
import { DesignContextSchema } from "../../contracts/design-context.ts";
import { DesignOutputSchema, type DesignOutput } from "../../contracts/design-output.ts";
import { DesignPlanOutputSchema, type DesignPlanOutput } from "../../contracts/design-plan-output.ts";
import { DocumentOutputSchema } from "../../contracts/document-output.ts";
import { PlanContextSchema, type PlanContext } from "../../contracts/plan-context.ts";
import { PlanOutputSchema } from "../../contracts/plan-output.ts";
import { architectureVerdictConsistent } from "../../gates/architecture-review.ts";
import { GateReport } from "../../gates/interface.ts";
import { spineCarried, spineDeclared } from "../../gates/design-spine.ts";
import type { WorkflowRecipe } from "../compiler.ts";
import { loadUserPrompt, requireHostExecution } from "../recipe-support.ts";

export const designToPlanWorkflow = {
  id: "design-to-plan",
  // Architecture review is an ordinary workflow phase, not the task-level
  // mandatory review that T2 routes through L11. Three calls fit T1 exactly.
  tier: 1,
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
      id: "design-context",
      kind: "code",
      owner: "host",
      description: "Resolve every catalog repository to machine-local revision evidence before design begins",
      schemaId: "awsf.design-context/v1",
      outputSchema: DesignContextSchema,
      maxCorrections: 0,
      gates: [{
        id: "design_evidence_present",
        run: () => { throw new Error("design_evidence_present requires the production host's resolved project binding"); },
      }],
      execute: (context) => requireHostExecution("design-context", context),
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
      get prompt() { return loadUserPrompt("designer"); },
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
      get prompt() { return loadUserPrompt("architecture-reviewer"); },
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
        // The gate context carries the plan context and the review, never the stored design, so this
        // declaration cannot compare the identifier spine against the design. It used to pass the plan
        // context's own identifiers as both sides, a comparison that could never fail. Production
        // composes and checks the spine (composeProductionPlanContext), so this declaration refuses
        // rather than passes (B6-29).
        run: () => new GateReport("architecture_review_clear").check(
          "identifier spine checked against the stored design",
          false,
          "this recipe gate has no stored design to compare; production composes and checks the spine",
        ),
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
      get prompt() { return loadUserPrompt("planner"); },
    },
    {
      id: "plan-render",
      kind: "code",
      owner: "host",
      description: "Admit the validated plan, prompts, and host-derived tickets as new idle files only",
      schemaId: "awsf.document-output/v1",
      outputSchema: DocumentOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("plan-render", context),
    },
  ],
} as const satisfies WorkflowRecipe;

export default designToPlanWorkflow;
