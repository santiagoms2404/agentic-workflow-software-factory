import { Type, type Static } from "@sinclair/typebox";
import { SHA_PATTERN } from "./test-output.ts";
import { stringUnion } from "./typebox.ts";

const TicketId = Type.String({ pattern: "^[TW][0-9]{2}$" });

/**
 * What a sealed shift source contributes, in the manifest's run order. The
 * candidate is the last completed ticket's commit, so the continuation's owner
 * intent can name the remaining tickets instead of restating the milestone.
 */
export const ShiftAdoptionSourceSchema = Type.Object({
  plan: Type.String({ pattern: "^[a-z0-9][a-z0-9.-]*$" }),
  milestones: Type.Array(Type.String({ pattern: "^M[0-9]+$" }), { minItems: 1 }),
  completedTickets: Type.Array(TicketId, { minItems: 1 }),
  remainingTickets: Type.Array(TicketId),
}, { additionalProperties: false });

export type ShiftAdoptionSource = Static<typeof ShiftAdoptionSourceSchema>;

/**
 * The host's merge that carries the exact source candidate over a canonical
 * HEAD that advanced past the source base. Its first parent is the integration
 * base and its second the source candidate; the target is pinned to this pair.
 */
export const CandidateIntegrationSchema = Type.Object({
  /** Canonical HEAD when the owner confirmed: the merge's first parent and the target's base. */
  integrationBaseSha: Type.String({ pattern: SHA_PATTERN }),
  /** The host merge: the target's candidate. */
  integratedCandidateSha: Type.String({ pattern: SHA_PATTERN }),
  /** The merge's author and committer date, so its exact bytes can be recomputed. */
  committedAt: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export type CandidateIntegration = Static<typeof CandidateIntegrationSchema>;

/**
 * Durable provenance for a candidate adopted from a sealed attempt.
 *
 * This is host evidence, not an agent envelope. The target journal records the
 * exact Git objects and source revision it inspected; it never copies a source
 * request, envelope, gate row, approval, provider session, or attempt-private file.
 */
export const CandidateAdoptionEvidenceSchema = Type.Object({
  sourceProject: Type.String({ minLength: 1 }),
  sourceTaskId: Type.String({ minLength: 1 }),
  sourceAttempt: Type.Integer({ minimum: 1 }),
  sourceSessionId: Type.String({ minLength: 1 }),
  sourceRevision: Type.Integer({ minimum: 1 }),
  sourceLifecycle: stringUnion(["BLOCKED", "CANCELLED"] as const),
  /** The source base, always; the target's base only when `integration` is absent. */
  baseSha: Type.String({ pattern: SHA_PATTERN }),
  /** The exact source candidate, always; the target's candidate only when `integration` is absent. */
  candidateSha: Type.String({ pattern: SHA_PATTERN }),
  workerProvider: Type.String({ minLength: 1 }),
  /** Present only when the source is a shift; a shipped source has no tickets to name. */
  shift: Type.Optional(ShiftAdoptionSourceSchema),
  /** Present only when canonical HEAD had advanced past the source base. */
  integration: Type.Optional(CandidateIntegrationSchema),
  targetTaskId: Type.String({ minLength: 1 }),
  verifiedAt: Type.String({ minLength: 1 }),
  sourceEvidenceCopied: Type.Literal(false),
  sourceApprovalsCopied: Type.Literal(false),
}, { additionalProperties: false });

export type CandidateAdoptionEvidence = Static<typeof CandidateAdoptionEvidenceSchema>;
