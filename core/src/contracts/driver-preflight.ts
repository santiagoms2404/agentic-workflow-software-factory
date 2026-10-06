import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { canonicalJson } from "./owner-amendment.ts";
import { SHA_PATTERN } from "./test-output.ts";
import { stringUnion } from "./typebox.ts";

// K1's two records (specs/awsf-v3-w01-driver-checks.html, K1's fields). Both
// are host-written and never parsed out of provider output, so they are
// registered as records and never as wire envelopes.
//
// `awsf.driver-preflight/v1` is what `awsf preflight` measured for one DRAFT
// attempt: the facts it bound to (base, configuration, request, the driver's
// three path and session lists) and one result per K1 field. It is appended
// whether or not every field passed, so a refusal is evidence too.
//
// `awsf.request-confirmation/v1` is the owner's attestation, written only by
// the owner-terminal act `awsf confirm`. It binds to the exact request text and
// to the `--where` and `--read` lists, so editing either after confirmation
// leaves it bound to other words.

export const DRIVER_PREFLIGHT_SCHEMA_ID = "awsf.driver-preflight/v1";
export const REQUEST_CONFIRMATION_SCHEMA_ID = "awsf.request-confirmation/v1";

/**
 * K1's field ids, in the K1 table's order, as frozen by the G01-F Amendment
 * (2026-10-05). Seven are measured by the host; `confirmation` is the only
 * attested field. Adding or dropping one is a plan amendment, not an edit here.
 */
export const K1_FIELD_IDS = [
  "suite",
  "write-boundary",
  "protected-paths",
  "git-storage",
  "duplicate",
  "request-shape",
  "prior-attempts",
  "confirmation",
] as const;
export type K1FieldId = (typeof K1_FIELD_IDS)[number];

export const K1_FIELD_KINDS = ["measured", "attested"] as const;
export type K1FieldKind = (typeof K1_FIELD_KINDS)[number];

export function k1FieldKind(id: K1FieldId): K1FieldKind {
  return id === "confirmation" ? "attested" : "measured";
}

export const SUITE_SOURCES = ["landed-attempt", "preflight-run"] as const;
export type SuiteSource = (typeof SUITE_SOURCES)[number];

const id = Type.String({ minLength: 1 });
const sha = Type.String({ pattern: SHA_PATTERN });
const digest = Type.String({ pattern: "^[0-9a-f]{64}$" });
const reason = Type.String({ minLength: 1, maxLength: 4_000 });

/** A pass carries no reason; a refusal always carries one a person can act on. */
export const K1FieldResultSchema = Type.Union([
  Type.Object(
    { id: stringUnion(K1_FIELD_IDS), kind: stringUnion(K1_FIELD_KINDS), passed: Type.Literal(true), reason: Type.Null() },
    { additionalProperties: false },
  ),
  Type.Object(
    { id: stringUnion(K1_FIELD_IDS), kind: stringUnion(K1_FIELD_KINDS), passed: Type.Literal(false), reason },
    { additionalProperties: false },
  ),
]);
export type K1FieldResult = Static<typeof K1FieldResultSchema>;

/** One configured gate's result, at the SHA it ran against, under the gate configuration it ran with. */
export const SuiteGateRowSchema = Type.Object(
  {
    gateId: id,
    sha,
    gatesConfigDigest: digest,
    passed: Type.Boolean(),
    exitCode: Type.Union([Type.Integer(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type SuiteGateRow = Static<typeof SuiteGateRowSchema>;

export const PreflightSuiteSchema = Type.Object(
  { source: stringUnion(SUITE_SOURCES), rows: Type.Array(SuiteGateRowSchema) },
  { additionalProperties: false },
);
export type PreflightSuite = Static<typeof PreflightSuiteSchema>;

/** A protected path the request writes, and the phase whose role writes it: the grant task 12 checks. */
export const ProtectedPlanEntrySchema = Type.Object({ path: id, phase: id }, { additionalProperties: false });
export type ProtectedPlanEntry = Static<typeof ProtectedPlanEntrySchema>;

export const DriverPreflightRecordSchema = Type.Object(
  {
    schema: Type.Literal(DRIVER_PREFLIGHT_SCHEMA_ID),
    project: id,
    taskId: id,
    attempt: Type.Integer({ minimum: 1 }),
    sessionId: id,
    /** The base L1 would pin, resolved exactly as `awsf start` resolves it. */
    baseSha: sha,
    configDigest: digest,
    requestDigest: digest,
    /** The driver's inputs, recorded as given and checked by the fields, never trusted by them. */
    where: Type.Array(id),
    read: Type.Array(id),
    consulted: Type.Array(id),
    fields: Type.Array(K1FieldResultSchema),
    /** Null when no gate row could be gathered at the base; `suite` then refuses. */
    suite: Type.Union([PreflightSuiteSchema, Type.Null()]),
    protectedPlan: Type.Array(ProtectedPlanEntrySchema),
    at: id,
  },
  { additionalProperties: false, $id: DRIVER_PREFLIGHT_SCHEMA_ID, title: "DriverPreflightRecord" },
);
export type DriverPreflightRecord = Static<typeof DriverPreflightRecordSchema>;

export const RequestConfirmationRecordSchema = Type.Object(
  {
    schema: Type.Literal(REQUEST_CONFIRMATION_SCHEMA_ID),
    project: id,
    taskId: id,
    attempt: Type.Integer({ minimum: 1 }),
    requestDigest: digest,
    pathsDigest: digest,
    at: id,
  },
  { additionalProperties: false, $id: REQUEST_CONFIRMATION_SCHEMA_ID, title: "RequestConfirmationRecord" },
);
export type RequestConfirmationRecord = Static<typeof RequestConfirmationRecordSchema>;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The digest both records bind the request to: the exact recorded text, byte for byte. */
export function requestTextDigest(request: string): string {
  return sha256(request);
}

/** The digest of `--where` and `--read` as sets: order and repetition do not move it, membership does. */
export function requestPathsDigest(where: readonly string[], read: readonly string[]): string {
  const set = (values: readonly string[]) => [...new Set(values)].sort();
  return sha256(canonicalJson({ read: set(read), where: set(where) }));
}

export function assertDriverPreflightRecord(value: unknown): asserts value is DriverPreflightRecord {
  if (!Value.Check(DriverPreflightRecordSchema, value)) {
    const first = [...Value.Errors(DriverPreflightRecordSchema, value)][0];
    throw new Error(`invalid ${DRIVER_PREFLIGHT_SCHEMA_ID} record${first === undefined ? "" : ` at ${first.path}: ${first.message}`}`);
  }
  // The schema admits any field list; the record admits exactly K1's, in order,
  // each with its own kind, so a record can never omit or invent a field.
  const ids = value.fields.map((field) => field.id);
  if (ids.length !== K1_FIELD_IDS.length || ids.some((field, index) => field !== K1_FIELD_IDS[index])) {
    throw new Error(`invalid ${DRIVER_PREFLIGHT_SCHEMA_ID} record at /fields: expected ${K1_FIELD_IDS.join(", ")}, got ${ids.join(", ")}`);
  }
  const wrongKind = value.fields.find((field) => field.kind !== k1FieldKind(field.id));
  if (wrongKind !== undefined) {
    throw new Error(`invalid ${DRIVER_PREFLIGHT_SCHEMA_ID} record at /fields: ${wrongKind.id} is ${k1FieldKind(wrongKind.id)}, not ${wrongKind.kind}`);
  }
}

export function assertRequestConfirmationRecord(value: unknown): asserts value is RequestConfirmationRecord {
  if (!Value.Check(RequestConfirmationRecordSchema, value)) {
    const first = [...Value.Errors(RequestConfirmationRecordSchema, value)][0];
    throw new Error(`invalid ${REQUEST_CONFIRMATION_SCHEMA_ID} record${first === undefined ? "" : ` at ${first.path}: ${first.message}`}`);
  }
}
