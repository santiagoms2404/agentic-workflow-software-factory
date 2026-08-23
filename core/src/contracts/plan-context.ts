import { Type, type Static } from "@sinclair/typebox";
import { ARCHITECTURE_REVIEW_FINDING_PROPERTIES } from "./architecture-review-output.ts";
import { DesignAcceptanceCriterionSchema, DesignInvariantSchema } from "./design-output.ts";
import { phaseEnvelope } from "./envelope-base.ts";
import { REVIEW_SEVERITIES, REVIEW_VERDICTS } from "./review-output.ts";
import { stringUnion } from "./typebox.ts";

export const PLAN_CONTEXT_SCHEMA_ID = "awsf.plan-context/v1";

// Composed by the HOST from stored design and architecture-review envelopes.
// The identifier set preserves the design's declarations, including the
// statements the planner needs in order to map steps onto them.
//
// `blockingFindingCount` is a literal zero because a plan context composed
// from a review that still reports a blocker is not merely gate-failing, it is
// unrepresentable. The gate and schema agree by construction rather than by
// coincidence. The finding schema reinforces that boundary by accepting only
// the non-blocking members of the shared ordered severity vocabulary.
const NON_BLOCKING_REVIEW_SEVERITIES = [REVIEW_SEVERITIES[0], REVIEW_SEVERITIES[1]] as const;

const NonBlockingArchitectureReviewFindingSchema = Type.Object(
  {
    ...ARCHITECTURE_REVIEW_FINDING_PROPERTIES,
    severity: stringUnion(NON_BLOCKING_REVIEW_SEVERITIES),
  },
  { additionalProperties: false },
);

export const PlanContextSchema = phaseEnvelope(
  PLAN_CONTEXT_SCHEMA_ID,
  {
    identifierSet: Type.Object(
      {
        invariants: Type.Array(DesignInvariantSchema),
        acceptanceCriteria: Type.Array(DesignAcceptanceCriterionSchema),
      },
      { additionalProperties: false },
    ),
    reviewVerdict: stringUnion(REVIEW_VERDICTS),
    nonBlockingFindings: Type.Array(NonBlockingArchitectureReviewFindingSchema),
    blockingFindingCount: Type.Literal(0),
  },
  "Host-composed design spine and clear architecture-review evidence for the planner. HOST-generated — never model-generated.",
);

export type PlanContext = Static<typeof PlanContextSchema>;
