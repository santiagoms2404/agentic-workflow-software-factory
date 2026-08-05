import { Type, type Static, type TObject, type TSchema } from "@sinclair/typebox";
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
}

/** TypeBox mirror of `StoredEnvelope<T>`, for validating what was persisted. */
export function StoredEnvelopeSchema<P extends TSchema>(payloadSchema: P): TObject {
  return Type.Object(
    {
      envelopeId: Type.String({ minLength: 1 }),
      sessionId: Type.String({ minLength: 1 }),
      phaseId: Type.String({ minLength: 1 }),
      correctionRound: Type.Integer({ minimum: 0 }),
      agent: Type.String({ minLength: 1 }),
      schemaId: Type.String({ minLength: 1 }),
      valid: Type.Boolean(),
      createdAt: Type.String({ minLength: 1 }),
      payload: Type.Union([payloadSchema, Type.Null()]),
      violations: Type.Array(ValidationViolationSchema),
      rawOutputPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ) as unknown as TObject;
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
  result: { valid: true; payload: T } | { valid: false; violations: ValidationViolation[] },
): StoredEnvelope<T> {
  if (result.valid) {
    return { ...identity, valid: true, payload: result.payload, violations: [] };
  }
  if (result.violations.length === 0) {
    throw new Error("an invalid envelope must retain at least one violation");
  }
  return { ...identity, valid: false, payload: null, violations: [...result.violations] };
}
