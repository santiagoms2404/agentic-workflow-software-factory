import { Type, type Static } from "@sinclair/typebox";
import { SHA_PATTERN } from "./test-output.ts";
import { stringUnion } from "./typebox.ts";

/**
 * Durable provenance for a candidate adopted from a sealed attempt.
 *
 * This is host evidence, not an agent envelope. The target journal records the
 * exact Git objects and source revision it inspected; it never copies a source
 * envelope, gate row, approval, provider session, or attempt-private file.
 */
export const CandidateAdoptionEvidenceSchema = Type.Object({
  sourceProject: Type.String({ minLength: 1 }),
  sourceTaskId: Type.String({ minLength: 1 }),
  sourceAttempt: Type.Integer({ minimum: 1 }),
  sourceSessionId: Type.String({ minLength: 1 }),
  sourceRevision: Type.Integer({ minimum: 1 }),
  sourceLifecycle: stringUnion(["BLOCKED", "CANCELLED"] as const),
  baseSha: Type.String({ pattern: SHA_PATTERN }),
  candidateSha: Type.String({ pattern: SHA_PATTERN }),
  workerProvider: Type.String({ minLength: 1 }),
  targetTaskId: Type.String({ minLength: 1 }),
  verifiedAt: Type.String({ minLength: 1 }),
  sourceEvidenceCopied: Type.Literal(false),
  sourceApprovalsCopied: Type.Literal(false),
}, { additionalProperties: false });

export type CandidateAdoptionEvidence = Static<typeof CandidateAdoptionEvidenceSchema>;
