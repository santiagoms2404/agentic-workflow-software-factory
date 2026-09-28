import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { canonicalJson } from "./owner-amendment.ts";
import { stringUnion } from "./typebox.ts";

// The owner's record of whose fault one BLOCKED attempt was (W18 D4, DD5).
// Host-written by `awsf attribute` and never parsed out of provider output, so
// it is registered as a record and never as a wire envelope. It is task-scoped
// storage for an attempt-scoped fact: the attempt it names is sealed, and the
// record sits beside it rather than inside it.
export const ATTRIBUTION_RECORD_SCHEMA_ID = "awsf.attribution/v1";

/** Whose fault a block was. The heuristic never answers `owner`; only this record can. */
export const ATTRIBUTION_CAUSES = ["model", "factory", "environment", "owner", "unknown"] as const;
export type AttributionCause = (typeof ATTRIBUTION_CAUSES)[number];

const id = Type.String({ minLength: 1 });

export const AttributionRecordSchema = Type.Object(
  {
    schema: Type.Literal(ATTRIBUTION_RECORD_SCHEMA_ID),
    project: id,
    taskId: id,
    attempt: Type.Integer({ minimum: 1 }),
    cause: stringUnion(ATTRIBUTION_CAUSES),
    /** The owner's written reason. Recorded here; never sent to a provider. */
    reason: Type.String({ minLength: 1, maxLength: 2_000 }),
    at: id,
  },
  { additionalProperties: false, $id: ATTRIBUTION_RECORD_SCHEMA_ID, title: "AttributionRecord" },
);

export type AttributionRecord = Static<typeof AttributionRecordSchema>;

export function isAttributionCause(value: string): value is AttributionCause {
  return (ATTRIBUTION_CAUSES as readonly string[]).includes(value);
}

export function assertAttributionRecord(value: unknown): asserts value is AttributionRecord {
  if (!Value.Check(AttributionRecordSchema, value)) {
    const first = [...Value.Errors(AttributionRecordSchema, value)][0];
    throw new Error(`invalid ${ATTRIBUTION_RECORD_SCHEMA_ID} record${first === undefined ? "" : ` at ${first.path}: ${first.message}`}`);
  }
}

/**
 * The record's identity: sha256 hex over its canonical JSON. Two records that
 * differ in any field, including two made in the same millisecond, never share
 * an id, and the same record projected twice always does.
 */
export function attributionRecordDigest(record: AttributionRecord): string {
  return createHash("sha256").update(canonicalJson(record), "utf8").digest("hex");
}
