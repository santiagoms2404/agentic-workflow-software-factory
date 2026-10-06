// K1's two records: awsf.driver-preflight/v1 and awsf.request-confirmation/v1.
//
// Under test: both are registered as host records and never as agent-output
// envelopes; the field list is exactly the one G01-F froze, in K1's order and
// with its kinds; a record that omits, reorders, invents or mis-kinds a field
// is refused; and the two digests bind what they claim to bind.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DRIVER_PREFLIGHT_SCHEMA_ID,
  DriverPreflightRecordSchema,
  K1_FIELD_IDS,
  REQUEST_CONFIRMATION_SCHEMA_ID,
  RequestConfirmationRecordSchema,
  assertDriverPreflightRecord,
  assertRequestConfirmationRecord,
  k1FieldKind,
  requestPathsDigest,
  requestTextDigest,
  type DriverPreflightRecord,
  type RequestConfirmationRecord,
} from "../../../src/contracts/driver-preflight.ts";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS, isEnvelopeSchemaId } from "../../../src/contracts/registry.ts";

const BASE = "a".repeat(40);
const DIGEST = "b".repeat(64);

function record(overrides: Partial<DriverPreflightRecord> = {}): DriverPreflightRecord {
  return {
    schema: DRIVER_PREFLIGHT_SCHEMA_ID,
    project: "demo",
    taskId: "T",
    attempt: 1,
    sessionId: "session-1",
    baseSha: BASE,
    configDigest: DIGEST,
    requestDigest: DIGEST,
    where: ["core/src/preflight/**"],
    read: [],
    consulted: [],
    fields: K1_FIELD_IDS.map((id) => ({ id, kind: k1FieldKind(id), passed: true, reason: null })),
    suite: { source: "preflight-run", rows: [{ gateId: "test", sha: BASE, gatesConfigDigest: DIGEST, passed: true, exitCode: 0 }] },
    protectedPlan: [],
    at: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

function confirmation(overrides: Partial<RequestConfirmationRecord> = {}): RequestConfirmationRecord {
  return {
    schema: REQUEST_CONFIRMATION_SCHEMA_ID,
    project: "demo",
    taskId: "T",
    attempt: 1,
    requestDigest: DIGEST,
    pathsDigest: DIGEST,
    at: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

test("both records are registered as host records and never as agent-output envelopes", () => {
  assert.equal(RECORD_SCHEMAS[DRIVER_PREFLIGHT_SCHEMA_ID], DriverPreflightRecordSchema);
  assert.equal(RECORD_SCHEMAS[REQUEST_CONFIRMATION_SCHEMA_ID], RequestConfirmationRecordSchema);
  for (const id of [DRIVER_PREFLIGHT_SCHEMA_ID, REQUEST_CONFIRMATION_SCHEMA_ID]) {
    assert.equal(isEnvelopeSchemaId(id), false);
    assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, id), false);
  }
});

test("K1's field list is exactly the one the G01-F Amendment froze: seven measured, one attested", () => {
  assert.deepEqual([...K1_FIELD_IDS], [
    "suite", "write-boundary", "protected-paths", "git-storage", "duplicate", "request-shape", "prior-attempts", "confirmation",
  ]);
  assert.deepEqual(K1_FIELD_IDS.filter((id) => k1FieldKind(id) === "attested"), ["confirmation"]);
  assert.equal(K1_FIELD_IDS.filter((id) => k1FieldKind(id) === "measured").length, 7);
});

test("a well-formed preflight record and confirmation are accepted", () => {
  assert.doesNotThrow(() => assertDriverPreflightRecord(record()));
  assert.doesNotThrow(() => assertDriverPreflightRecord(record({ suite: null })));
  assert.doesNotThrow(() => assertDriverPreflightRecord(record({
    fields: K1_FIELD_IDS.map((id) => ({ id, kind: k1FieldKind(id), passed: false, reason: `${id} refused` })),
    protectedPlan: [{ path: "docs/driving/x.md", phase: "documenter" }],
  })));
  assert.doesNotThrow(() => assertRequestConfirmationRecord(confirmation()));
});

test("a preflight record that omits, reorders, invents or mis-kinds a field is refused", () => {
  const passing = record().fields;
  assert.throws(() => assertDriverPreflightRecord(record({ fields: passing.slice(1) })), /expected suite, write-boundary/u);
  assert.throws(() => assertDriverPreflightRecord(record({ fields: [passing[1]!, passing[0]!, ...passing.slice(2)] })), /\/fields/u);
  assert.throws(() => assertDriverPreflightRecord(record({ fields: [...passing, passing[0]!] })), /\/fields/u);
  assert.throws(() => assertDriverPreflightRecord({ ...record(), fields: [...passing.slice(0, 7), { id: "grant", kind: "measured", passed: true, reason: null }] }));
  assert.throws(
    () => assertDriverPreflightRecord(record({ fields: passing.map((field) => field.id === "confirmation" ? { ...field, kind: "measured" } : field) })),
    /confirmation is attested, not measured/u,
  );
  assert.throws(
    () => assertDriverPreflightRecord(record({ fields: passing.map((field) => field.id === "suite" ? { ...field, kind: "attested" } : field) })),
    /suite is measured, not attested/u,
  );
});

test("a pass carries no reason and a refusal always carries one", () => {
  const fields = record().fields;
  assert.throws(() => assertDriverPreflightRecord({ ...record(), fields: [{ ...fields[0]!, reason: "said so" }, ...fields.slice(1)] }));
  assert.throws(() => assertDriverPreflightRecord({ ...record(), fields: [{ ...fields[0]!, passed: false }, ...fields.slice(1)] }));
  assert.throws(() => assertDriverPreflightRecord({ ...record(), fields: [{ ...fields[0]!, passed: false, reason: "" }, ...fields.slice(1)] }));
});

test("the records refuse unknown properties, short SHAs and non-sha256 digests", () => {
  assert.throws(() => assertDriverPreflightRecord({ ...record(), skipPreflight: true }), /invalid awsf\.driver-preflight\/v1 record/u);
  assert.throws(() => assertDriverPreflightRecord(record({ baseSha: "abc" })), /baseSha/u);
  assert.throws(() => assertDriverPreflightRecord(record({ requestDigest: "x" })), /requestDigest/u);
  assert.throws(() => assertDriverPreflightRecord({ ...record(), suite: { source: "driver-said", rows: [] } }), /suite/u);
  assert.throws(() => assertRequestConfirmationRecord({ ...confirmation(), confirmedBy: "driver" }), /invalid awsf\.request-confirmation\/v1 record/u);
  assert.throws(() => assertRequestConfirmationRecord(confirmation({ attempt: 0 })), /attempt/u);
  assert.throws(() => assertRequestConfirmationRecord(confirmation({ pathsDigest: "short" })), /pathsDigest/u);
});

test("the request digest binds the exact text; the paths digest binds where and read as sets", () => {
  assert.equal(requestTextDigest("Ask: x"), requestTextDigest("Ask: x"));
  assert.notEqual(requestTextDigest("Ask: x"), requestTextDigest("Ask: x "));
  const paths = requestPathsDigest(["a/b.ts", "c/**"], ["AGENTS.md"]);
  assert.match(paths, /^[0-9a-f]{64}$/u);
  assert.equal(requestPathsDigest(["c/**", "a/b.ts", "a/b.ts"], ["AGENTS.md"]), paths);
  assert.notEqual(requestPathsDigest(["a/b.ts"], ["AGENTS.md"]), paths);
  assert.notEqual(requestPathsDigest(["a/b.ts", "c/**", "AGENTS.md"], []), paths, "moving a path from read to where moves the digest");
  assert.notEqual(requestPathsDigest(["AGENTS.md"], ["a/b.ts", "c/**"]), paths);
});
