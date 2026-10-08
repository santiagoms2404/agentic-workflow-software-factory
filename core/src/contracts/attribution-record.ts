import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { canonicalJson } from "./owner-amendment.ts";
import { stringUnion } from "./typebox.ts";
import { NO_TRAP_KINDS } from "../traps/catalogue.ts";
import { REDACTED_VALUE, scrubCredentialString } from "../policy/redaction.ts";

// The owner's record of the cause of one BLOCKED or CANCELLED attempt (W18 D4, DD5).
// Host-written by `awsf attribute` and never parsed out of provider output, so
// it is registered as a record and never as a wire envelope. It is task-scoped
// storage for an attempt-scoped fact: the attempt it names is sealed, and the
// record sits beside it rather than inside it.
export const ATTRIBUTION_RECORD_V1_SCHEMA_ID = "awsf.attribution/v1";
export const ATTRIBUTION_RECORD_SCHEMA_ID = "awsf.attribution/v2";

/** Causes for a block or cancel. `driver` means a check before the first provider call
 * would have refused this run, had it existed or been run; it is not a verdict
 * on the model that drove it. The heuristic never answers `driver` or `owner`. */
export const ATTRIBUTION_CAUSES = ["model", "factory", "environment", "driver", "owner", "unknown"] as const;
export type AttributionCause = (typeof ATTRIBUTION_CAUSES)[number];

const id = Type.String({ minLength: 1 });

export const AttributionRecordV1Schema = Type.Object(
  {
    schema: Type.Literal(ATTRIBUTION_RECORD_V1_SCHEMA_ID),
    project: id,
    taskId: id,
    attempt: Type.Integer({ minimum: 1 }),
    cause: stringUnion(ATTRIBUTION_CAUSES),
    /** The owner's written reason. Recorded here; never sent to a provider. */
    reason: Type.String({ minLength: 1, maxLength: 2_000 }),
    at: id,
  },
  { additionalProperties: false, $id: ATTRIBUTION_RECORD_V1_SCHEMA_ID, title: "AttributionRecordV1" },
);

export const TrapLinkSchema = Type.Union([
  Type.Object({ kind: Type.Literal("trap"), id: Type.String({ minLength: 5, maxLength: 5, pattern: "^TR-[0-9]{2}$" }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("none"), because: stringUnion(NO_TRAP_KINDS),
    reason: Type.String({ minLength: 1, maxLength: 2_000, pattern: "\\S" }) }, { additionalProperties: false }),
]);
export type TrapLink = Static<typeof TrapLinkSchema>;

export const AttributionRecordSchema = Type.Object({
  ...AttributionRecordV1Schema.properties,
  schema: Type.Literal(ATTRIBUTION_RECORD_SCHEMA_ID),
  trap: TrapLinkSchema,
}, { additionalProperties: false, $id: ATTRIBUTION_RECORD_SCHEMA_ID, title: "AttributionRecord" });

export type AttributionRecordV2 = Static<typeof AttributionRecordSchema>;
export type AttributionRecord = Static<typeof AttributionRecordV1Schema> | AttributionRecordV2;

/** Shared by the command, durable writer and projector: no unchecked link reaches storage. */
export function assertTrapLink(value: unknown): asserts value is TrapLink {
  if (!Value.Check(TrapLinkSchema, value)) throw new Error("invalid trap link: use --trap TR-NN or --no-trap <kind> \"<why>\"");
  if (value.kind === "none" && (scrubCredentialString(value.reason) !== value.reason || value.reason.includes(REDACTED_VALUE))) {
    throw new Error("trap link rejected: credential-shaped data is never persisted");
  }
}

export function isAttributionCause(value: string): value is AttributionCause {
  return (ATTRIBUTION_CAUSES as readonly string[]).includes(value);
}

export function assertAttributionRecord(value: unknown): asserts value is AttributionRecord {
  const schema = (value as { schema?: unknown } | null)?.schema === ATTRIBUTION_RECORD_V1_SCHEMA_ID
    ? AttributionRecordV1Schema : AttributionRecordSchema;
  if (!Value.Check(schema, value)) {
    const first = [...Value.Errors(schema, value)][0];
    throw new Error(`invalid attribution record${first === undefined ? "" : ` at ${first.path}: ${first.message}`}`);
  }
  if ((value as AttributionRecord).schema === ATTRIBUTION_RECORD_SCHEMA_ID) assertTrapLink((value as AttributionRecordV2).trap);
}

/**
 * The record's identity: sha256 hex over its canonical JSON. Two records that
 * differ in any field, including two made in the same millisecond, never share
 * an id, and the same record projected twice always does.
 */
export function attributionRecordDigest(record: AttributionRecord): string {
  return createHash("sha256").update(canonicalJson(record), "utf8").digest("hex");
}
