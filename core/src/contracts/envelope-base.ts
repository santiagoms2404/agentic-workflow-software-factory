import { Type, type Static, type TProperties } from "@sinclair/typebox";
import { stringUnion, type UnionOf } from "./typebox.ts";

// The WIRE envelope — what a model emits, and nothing else. Identity
// (`envelopeId`, `sessionId`, `phaseId`), validity, and provenance are the
// host's to assign and live on `StoredEnvelope` (see stored-envelope.ts). A
// model is never asked to echo a `phase_id` it could get wrong.

export const ARTIFACT_KINDS = ["source", "test", "plan", "documentation", "report"] as const;
export type ArtifactKind = UnionOf<typeof ARTIFACT_KINDS>;

export const PRODUCER_STATUSES = ["success", "failure"] as const;
export type ProducerStatus = UnionOf<typeof PRODUCER_STATUSES>;

// Worktree-relative, normalized, no traversal — enforced structurally so the
// rule travels with the emitted JSON Schema into the agent's own prompt,
// rather than only firing at gate time. Rejects: absolute POSIX paths,
// Windows drive-letter and UNC paths, any backslash separator, any `..`
// segment, a `./` prefix, and empty or doubled separators. Containment
// against the actual worktree root is still checked at gate time — this is
// the structural floor, not the whole check.
const WORKTREE_RELATIVE_PATH_RE =
  /^(?![/\\])(?![A-Za-z]:)(?!\.\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*\/$)[^\\]+$/;
export const WORKTREE_RELATIVE_PATH_PATTERN = WORKTREE_RELATIVE_PATH_RE.source;

export const WorktreeRelativePath = Type.String({
  minLength: 1,
  pattern: WORKTREE_RELATIVE_PATH_PATTERN,
  description: "Worktree-relative POSIX path. No leading slash, no drive letter, no `..`, no backslashes.",
});

export const ArtifactClaimSchema = Type.Object(
  {
    path: WorktreeRelativePath,
    kind: stringUnion(ARTIFACT_KINDS),
    description: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type ArtifactClaim = Static<typeof ArtifactClaimSchema>;

/**
 * The five fields every wire envelope carries.
 *
 * Spread into each phase envelope rather than `$ref`-ed so the emitted JSON
 * Schema is one self-contained document per phase — an agent prompt cannot
 * follow a reference to a sibling file.
 */
export const ENVELOPE_BASE_PROPERTIES = {
  schema: Type.String({ minLength: 1, description: 'Schema id, e.g. "awsf.build-output/v1".' }),
  producerStatus: stringUnion(PRODUCER_STATUSES),
  summary: Type.String({ minLength: 1 }),
  artifacts: Type.Array(ArtifactClaimSchema),
  notesForNextPhase: Type.String(),
};

export const EnvelopeBaseSchema = Type.Object(ENVELOPE_BASE_PROPERTIES, { additionalProperties: false });
export type EnvelopeBase = Static<typeof EnvelopeBaseSchema>;

/** Field names the host owns. A wire schema declaring any of these is a wire/stored split violation. */
export const HOST_OWNED_FIELD_NAMES = [
  "envelopeId",
  "envelope_id",
  "sessionId",
  "session_id",
  "phaseId",
  "phase_id",
  "correctionRound",
  "correction_round",
  "valid",
  "violations",
  "createdAt",
  "created_at",
  "rawOutputPath",
  "raw_output_path",
] as const;

/**
 * Builds a phase envelope schema from the shared base plus its own fields.
 *
 * `additionalProperties: false` is structural here, not a default: unknown
 * fields are rejected everywhere, at every depth.
 */
export function phaseEnvelope<const S extends string, P extends TProperties>(
  schemaId: S,
  extra: P,
  description: string,
) {
  // The return type is inferred, not annotated: annotating it would have to
  // restate the property merge, and an intersection restatement collapses the
  // overridden `schema` literal to `never`. Inference keeps this function's
  // shape derived from the same object literal the validator uses.
  return Type.Object(
    { ...ENVELOPE_BASE_PROPERTIES, schema: Type.Literal(schemaId), ...extra },
    { additionalProperties: false, description },
  );
}
