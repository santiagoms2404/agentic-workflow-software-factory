import { Type, type Static } from "@sinclair/typebox";

// Visual references: owner-authorized design images a phase must open through
// its own image tool before any visual decision.
//
// Three documents, three trust levels, and the split is the point:
//
//   · The BINDING is launch context the owner writes on their own machine and
//     hands to `awsf start --visual-references`. It carries an absolute root,
//     so it is private: the host keeps it at `private/visual-references.json`
//     and never projects it.
//   · The INDEX and DIGESTS live under that root and are read, not trusted.
//     The index must be the root's committed Git blob, the digests must name
//     that blob's bytes, and every selected image must hash to its digest.
//   · The BOUND record is what the host verified, with no path in it. It is
//     the public journal evidence and the shape every later phase is checked
//     against.

export const VISUAL_REFERENCE_BINDING_SCHEMA_ID = "awsf.visual-reference-binding/v1";
export const VISUAL_REFERENCES_BOUND_SCHEMA_ID = "awsf.visual-references-bound/v1";

/** Bounds that keep delivered bytes under both CLIs' resize thresholds, so a digest match is exact. */
export const VISUAL_REFERENCE_LIMITS = Object.freeze({
  maxFrames: 32,
  maxImageBytes: 4 * 1024 * 1024,
  maxImageEdge: 2000,
  maxIndexBytes: 4 * 1024 * 1024,
  maxDigestsBytes: 1024 * 1024,
});

export const VISUAL_MEDIA_TYPES = ["image/png", "image/jpeg"] as const;

const FrameIdSchema = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" });
const IdentifierSchema = Type.String({ minLength: 1, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$" });
const Sha256Schema = Type.String({ pattern: "^[a-f0-9]{64}$" });
const RelativePathSchema = Type.String({ minLength: 1, maxLength: 1024 });

export const VisualSelectionSchema = Type.Union([
  Type.Object({ frames: Type.Array(FrameIdSchema, { minItems: 1, maxItems: VISUAL_REFERENCE_LIMITS.maxFrames }) },
    { additionalProperties: false }),
  // A ticket id alone is ambiguous across plans, so it is always scoped by the
  // plan the attempt was created under (`awsf new --plan`).
  Type.Object({ plan: IdentifierSchema, ticket: Type.String({ pattern: "^T[0-9]{2,}$" }) },
    { additionalProperties: false }),
]);

export const VisualReferenceBindingSchema = Type.Object({
  schema: Type.Literal(VISUAL_REFERENCE_BINDING_SCHEMA_ID),
  /** Absolute machine-local root. Never committed; held privately by the host. */
  root: Type.String({ minLength: 1, maxLength: 4096 }),
  /** Root-relative path of the committed frame index. */
  index: RelativePathSchema,
  /** Root-relative path of the index and image digests. */
  digests: RelativePathSchema,
  selection: VisualSelectionSchema,
  /** Agent phases whose visual decisions or verdicts require these frames. */
  phases: Type.Array(IdentifierSchema, { minItems: 1 }),
}, { additionalProperties: false });
export type VisualReferenceBinding = Static<typeof VisualReferenceBindingSchema>;

/** The subset of the frame index AWSF reads. Other fields are ignored, never trusted. */
export const VisualReferenceIndexSchema = Type.Object({
  version: Type.Literal(1),
  frames: Type.Array(Type.Object({ id: FrameIdSchema, image: RelativePathSchema }), { minItems: 1 }),
  ticketFrames: Type.Optional(Type.Record(Type.String(), Type.Array(FrameIdSchema))),
});
export type VisualReferenceIndex = Static<typeof VisualReferenceIndexSchema>;

export const VisualReferenceDigestsSchema = Type.Object({
  indexSha256: Sha256Schema,
  images: Type.Record(FrameIdSchema, Sha256Schema),
});

const BoundFrameSchema = Type.Object({
  id: FrameIdSchema,
  sha256: Sha256Schema,
  mediaType: Type.Union(VISUAL_MEDIA_TYPES.map((type) => Type.Literal(type))),
  bytes: Type.Integer({ minimum: 1, maximum: VISUAL_REFERENCE_LIMITS.maxImageBytes }),
  width: Type.Integer({ minimum: 1, maximum: VISUAL_REFERENCE_LIMITS.maxImageEdge }),
  height: Type.Integer({ minimum: 1, maximum: VISUAL_REFERENCE_LIMITS.maxImageEdge }),
}, { additionalProperties: false });
export type BoundVisualFrame = Static<typeof BoundFrameSchema>;

/** Public evidence: what was verified, by digest, with no path and no pixels. */
export const VisualReferencesBoundSchema = Type.Object({
  schema: Type.Literal(VISUAL_REFERENCES_BOUND_SCHEMA_ID),
  bindingDigest: Sha256Schema,
  indexSha256: Sha256Schema,
  indexCommit: Type.String({ pattern: "^[a-f0-9]{40}$" }),
  selection: VisualSelectionSchema,
  phases: Type.Array(IdentifierSchema, { minItems: 1 }),
  frames: Type.Array(BoundFrameSchema, { minItems: 1, maxItems: VISUAL_REFERENCE_LIMITS.maxFrames }),
}, { additionalProperties: false });
export type VisualReferencesBound = Static<typeof VisualReferencesBoundSchema>;

/** One image a phase's tool returned, matched against the bound frames. */
export const VisualObservationSchema = Type.Object({
  toolCallId: Type.String({ pattern: "^t[1-9][0-9]*$" }),
  toolName: Type.String({ minLength: 1 }),
  outcome: Type.Union([Type.Literal("ok"), Type.Literal("error")]),
  mediaType: Type.String({ minLength: 1 }),
  bytes: Type.Integer({ minimum: 0 }),
  sha256: Sha256Schema,
  /** The bound frame whose digest this image carried, or null for an unrequested image. */
  frameId: Type.Union([FrameIdSchema, Type.Null()]),
}, { additionalProperties: false });
export type VisualObservation = Static<typeof VisualObservationSchema>;

/**
 * The frame ids a selection names, in order. Pure: the ticket form resolves
 * through the index's own `ticketFrames` and only for the attempt's own plan.
 */
export function selectedFrameIds(selection: VisualReferenceBinding["selection"], index: VisualReferenceIndex,
  planRef: string | null): readonly string[] {
  if ("frames" in selection) return selection.frames;
  if (planRef === null || planRef !== selection.plan) {
    throw new Error(`ticket selection ${selection.plan}#${selection.ticket} does not belong to this attempt's plan ` +
      `${planRef === null ? "(none; create the attempt with --plan)" : JSON.stringify(planRef)}`);
  }
  const frames = index.ticketFrames?.[selection.ticket];
  if (frames === undefined || frames.length === 0) {
    throw new Error(`the index maps no frames for ${selection.plan}#${selection.ticket}`);
  }
  return frames;
}
