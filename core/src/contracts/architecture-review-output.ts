import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope } from "./envelope-base.ts";
import {
  BLOCKING_SEVERITIES,
  REVIEW_SEVERITIES,
  REVIEW_VERDICTS,
} from "./review-output.ts";
import { stringUnion } from "./typebox.ts";

export const ARCHITECTURE_REVIEW_OUTPUT_SCHEMA_ID = "awsf.architecture-review-output/v1";

export const ArchitectureReviewFindingSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    severity: stringUnion(REVIEW_SEVERITIES),
    // Architecture findings judge declared claims and named components. A file
    // path may describe a repository that does not exist yet and is therefore
    // the wrong subject vocabulary for this phase.
    subject: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    detail: Type.String({ minLength: 1 }),
    evidence: Type.String({ minLength: 1 }),
  },
  {
    additionalProperties: false,
    description: `Architecture finding. Blocking severities: ${BLOCKING_SEVERITIES.join(", ")}.`,
  },
);
export type ArchitectureReviewFinding = Static<typeof ArchitectureReviewFindingSchema>;

export const ArchitectureReviewOutputSchema = phaseEnvelope(
  ARCHITECTURE_REVIEW_OUTPUT_SCHEMA_ID,
  {
    reviewedDesign: Type.String({ minLength: 1 }),
    verdict: stringUnion(REVIEW_VERDICTS),
    findings: Type.Array(ArchitectureReviewFindingSchema),
    limitations: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  "Output of an independent architecture review. Its verdict is evidence, not a task-state transition.",
);

export type ArchitectureReviewOutput = Static<typeof ArchitectureReviewOutputSchema>;
