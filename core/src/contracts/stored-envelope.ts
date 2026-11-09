import { Type, type Static, type TSchema } from "@sinclair/typebox";
import type { EnvelopeBase } from "./envelope-base.ts";
import { stringUnion, type UnionOf } from "./typebox.ts";

// The HOST wrapper. SSSF conflates what the model says with what the system
// records; AWSF separates them. Everything on this type is assigned by the
// host — identity, validity, provenance — and none of it is ever asked of a
// model. In particular `phaseId` lives here and only here.

export const VALIDATION_VIOLATION_KINDS = [
  "size-exceeded",
  "not-json",
  "not-an-object",
  "schema-mismatch",
  "unknown-schema-id",
] as const;
export type ValidationViolationKind = UnionOf<typeof VALIDATION_VIOLATION_KINDS>;

/** How much of an offending value is retained in a violation. Bounded: violations are stored. */
export const VIOLATION_VALUE_MAX_CHARS = 200;

/**
 * How the JSON object was recovered from the model's final message. This is
 * provenance, so the stored record keeps it (B3-18). The parser assigns it; the
 * vocabulary lives here so the persisted record can name it.
 */
export const ENVELOPE_EXTRACTIONS = ["exact", "fence-stripped", "outermost-object", "trailing-object"] as const;
export type EnvelopeExtraction = UnionOf<typeof ENVELOPE_EXTRACTIONS>;

export const ValidationViolationSchema = Type.Object(
  {
    kind: stringUnion(VALIDATION_VIOLATION_KINDS),
    // JSON-pointer-ish path into the payload; "" for whole-document violations.
    path: Type.String(),
    message: Type.String({ minLength: 1 }),
    // A bounded rendering of what was actually there, or null when the value
    // is absent or too large to be worth quoting.
    received: Type.Union([Type.String({ maxLength: VIOLATION_VALUE_MAX_CHARS }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ValidationViolation = Static<typeof ValidationViolationSchema>;

/**
 * The stored envelope.
 *
 * `payload` is `null` exactly when `valid` is `false` — an invalid envelope is
 * **retained** with its violations so the trace shows what the model actually
 * said, rather than a hole where a failure was.
 */
export interface StoredEnvelope<T extends EnvelopeBase> {
  envelopeId: string;
  sessionId: string;
  phaseId: string;
  correctionRound: number;
  agent: string;
  schemaId: string;
  valid: boolean;
  createdAt: string;
  payload: T | null;
  violations: ValidationViolation[];
  rawOutputPath: string;
  /** Present when the parser recorded how it recovered the object; `null` when nothing was recovered. */
  extraction?: EnvelopeExtraction | null;
}

/**
 * TypeBox mirror of `StoredEnvelope<T>`, for validating what was persisted.
 *
 * Validity and payload are one fact, so the mirror is a union of the two shapes
 * the type allows: a valid record carries a payload and no violations, and an
 * invalid one carries violations and a null payload (B3-17).
 */
export function StoredEnvelopeSchema<P extends TSchema>(payloadSchema: P): TSchema {
  const common = {
    envelopeId: Type.String({ minLength: 1 }),
    sessionId: Type.String({ minLength: 1 }),
    phaseId: Type.String({ minLength: 1 }),
    correctionRound: Type.Integer({ minimum: 0 }),
    agent: Type.String({ minLength: 1 }),
    schemaId: Type.String({ minLength: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    rawOutputPath: Type.String({ minLength: 1 }),
    extraction: Type.Optional(Type.Union([stringUnion(ENVELOPE_EXTRACTIONS), Type.Null()])),
  };
  return Type.Union([
    Type.Object(
      {
        ...common,
        valid: Type.Literal(true),
        payload: payloadSchema,
        violations: Type.Array(ValidationViolationSchema, { maxItems: 0 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...common,
        valid: Type.Literal(false),
        payload: Type.Null(),
        violations: Type.Array(ValidationViolationSchema, { minItems: 1 }),
      },
      { additionalProperties: false },
    ),
  ]);
}

/** Host-assigned identity for a stored envelope. The model contributes none of it. */
export interface EnvelopeIdentity {
  envelopeId: string;
  sessionId: string;
  phaseId: string;
  correctionRound: number;
  agent: string;
  schemaId: string;
  createdAt: string;
  rawOutputPath: string;
}

/**
 * Wraps a parse result into a stored envelope.
 *
 * The only constructor for a `StoredEnvelope`, so the payload/valid/violations
 * relationship cannot be assembled inconsistently somewhere else: a valid
 * envelope carries a payload and no violations; an invalid one carries
 * violations and a null payload, and is still stored.
 */
export function wrapEnvelope<T extends EnvelopeBase>(
  identity: EnvelopeIdentity,
  result:
    | { valid: true; payload: T; extraction?: EnvelopeExtraction }
    | { valid: false; violations: ValidationViolation[]; extraction?: EnvelopeExtraction | null },
): StoredEnvelope<T> {
  // The parser's extraction label is provenance the record keeps (B3-18). It is
  // written only when the caller supplies one, so a record without it is unchanged.
  const provenance = result.extraction === undefined ? {} : { extraction: result.extraction };
  if (result.valid) {
    return { ...identity, valid: true, payload: result.payload, violations: [], ...provenance };
  }
  if (result.violations.length === 0) {
    throw new Error("an invalid envelope must retain at least one violation");
  }
  return { ...identity, valid: false, payload: null, violations: [...result.violations], ...provenance };
}
