import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const CLOSURE_RECORD_SCHEMA_ID = "awsf.closure-record/v1";
const sha = Type.String({ pattern: "^[a-f0-9]{40}$" });
const path = Type.String({ minLength: 1, pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\\\]+$" });
const row = Type.Object({ path, ticket: Type.String({ pattern: "^[TW][0-9]{2}$" }),
  taskNumber: Type.Integer({ minimum: 1 }), rowIndex: Type.Integer({ minimum: 0 }),
  oldValue: Type.String(), newValue: Type.String() }, { additionalProperties: false });
export const ClosureRecordSchema = Type.Object({
  schema: Type.Literal(CLOSURE_RECORD_SCHEMA_ID), id: Type.String({ minLength: 1 }),
  plan: Type.Union([Type.String({ pattern: "^[a-z0-9][a-z0-9.-]*$" }), Type.Null()]),
  lightState: Type.Optional(Type.Object({ path, ticket: Type.String({ pattern: "^T[0-9]{2}$" }),
    oldValue: Type.String(), newValue: Type.Union([Type.Literal("todo"), Type.Literal("wip"), Type.Literal("done")]) }, { additionalProperties: false })),
  tickets: Type.Array(Type.String({ pattern: "^[TW][0-9]{2}$" }), { uniqueItems: true }),
  candidateSha: sha, parentSha: sha, commitSha: sha,
  rowsClosed: Type.Array(row), rowsLeftOpen: Type.Array(row),
  notClosable: Type.Array(Type.String({ pattern: "^[TW][0-9]{2}$" })),
  blobs: Type.Array(Type.Object({ path, before: sha, after: sha }, { additionalProperties: false })),
  at: Type.String({ minLength: 1 }),
}, { additionalProperties: false, $id: CLOSURE_RECORD_SCHEMA_ID });
export type ClosureRecord = Static<typeof ClosureRecordSchema>;
/** An intent precedes all Git object writes. A prepared record binds the one commit before HEAD CAS. */
export interface ClosureIntent {
  readonly id: string;
  readonly parentSha: string;
  readonly candidateSha: string;
  readonly at: string;
}
export function assertClosureRecord(value: unknown): asserts value is ClosureRecord {
  if (!Value.Check(ClosureRecordSchema, value) || (value.plan === null
    ? value.lightState === undefined || value.tickets.length !== 1 || value.tickets[0] !== value.lightState.ticket || value.rowsClosed.length !== 0 || value.rowsLeftOpen.length !== 0 || value.notClosable.length !== 0
    : value.lightState !== undefined)) throw new Error("invalid closure record");
}
