import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope, WorktreeRelativePath } from "./envelope-base.ts";
import { SHA_PATTERN } from "./test-output.ts";
import { stringUnion, type UnionOf } from "./typebox.ts";

export const REVIEW_OUTPUT_SCHEMA_ID = "awsf.review-output/v1";

/** Ordered least → most severe. `verdict_consistent` reads this order, so it is the contract. */
export const REVIEW_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type ReviewSeverity = UnionOf<typeof REVIEW_SEVERITIES>;

export const REVIEW_VERDICTS = ["accept", "concern"] as const;
export type ReviewVerdict = UnionOf<typeof REVIEW_VERDICTS>;

/** Severities that `accept` may not carry, and that L16 rework requires at least one of. */
export const BLOCKING_SEVERITIES = ["high", "critical"] as const;

/** Rank of a severity in `REVIEW_SEVERITIES`, for `>= medium` style guards. */
export function severityRank(severity: ReviewSeverity): number {
  return REVIEW_SEVERITIES.indexOf(severity);
}

export const ReviewLimitationSchema = Type.Object(
  {
    detail: Type.String({ minLength: 1 }),
    /** Exact affected repository paths. Empty means the limitation is not file-specific. */
    affectedFiles: Type.Array(WorktreeRelativePath, { uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type ReviewLimitation = Static<typeof ReviewLimitationSchema>;

export const ReviewFindingSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    severity: stringUnion(REVIEW_SEVERITIES),
    // The `verdict_consistent` gate checks that finding paths sit inside the
    // candidate context; this is the structural floor under that check, and
    // the same one every other envelope's paths are held to.
    file: WorktreeRelativePath,
    // null = the finding is about the file as a whole, not one line. Not
    // optional: an absent key would be indistinguishable from a forgotten one.
    line: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    title: Type.String({ minLength: 1 }),
    detail: Type.String({ minLength: 1 }),
    // The completeness gate reads this key, never the prose of `detail`. A
    // regex over English decided whether a finding was complete, and it both
    // rejected ordinary declarative outcomes ("the owner loses the attempt")
    // and admitted mechanism-only prose that happened to contain `with`. The
    // host is entitled to require a structured fact; it is not entitled to
    // adjudicate a model's sentence construction as a lifecycle condition.
    consequence: Type.String({ minLength: 1 }),
    evidence: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type ReviewFinding = Static<typeof ReviewFindingSchema>;

export const ReviewOutputSchema = phaseEnvelope(
  REVIEW_OUTPUT_SCHEMA_ID,
  {
    verdict: stringUnion(REVIEW_VERDICTS),
    // The reviewer names the SHA it actually read. `verdict_consistent`
    // requires it to equal the candidate — a review of a different tree is
    // not a review of this change.
    reviewedSha: Type.String({ pattern: SHA_PATTERN }),
    findings: Type.Array(ReviewFindingSchema),
    limitations: Type.Array(ReviewLimitationSchema),
  },
  "Output of a review phase, always run on the opposite provider from the builder.",
);

export type ReviewOutput = Static<typeof ReviewOutputSchema>;
