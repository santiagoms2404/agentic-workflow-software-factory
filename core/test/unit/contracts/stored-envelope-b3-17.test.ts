// B3-17 and B3-18 — the stored envelope record.
//
// B3-17: StoredEnvelope documents that `payload` is null exactly when `valid`
// is false, and that an invalid envelope carries a violation. The TypeBox
// mirror that validates persisted records checked the fields independently, so
// a record whose validity and payload contradicted each other still passed.
//
// B3-18: parseEnvelope records how the JSON object was recovered (the
// extraction label), and that label is provenance. wrapEnvelope dropped it, so
// the persisted record could not show that the host had taken a trailing
// object.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import {
  BuildOutputSchema,
  parseEnvelope,
  StoredEnvelopeSchema,
  wrapEnvelope,
  type BuildOutput,
  type EnvelopeIdentity,
  type ValidationViolation,
} from "../../../src/contracts/index.ts";
import { validBuildOutput } from "./fixtures.ts";

const STORED = StoredEnvelopeSchema(BuildOutputSchema);
const schemaId = "awsf.build-output/v1";

function identity(): EnvelopeIdentity {
  return {
    envelopeId: "env-0002",
    sessionId: "sess-0002",
    phaseId: "build",
    correctionRound: 0,
    agent: "builder",
    schemaId,
    createdAt: "2026-08-05T10:00:00.000Z",
    rawOutputPath: "attempt://1/phases/build/raw-0.txt",
  };
}

const violation: ValidationViolation = { kind: "schema-mismatch", path: "/summary", message: "Expected string", received: null };

test("a persisted record's validity and payload agree (B3-17)", () => {
  const valid = wrapEnvelope<BuildOutput>(identity(), { valid: true, payload: validBuildOutput() });
  const invalid = wrapEnvelope<BuildOutput>(identity(), { valid: false, violations: [violation] });
  assert.equal(Value.Check(STORED, valid), true);
  assert.equal(Value.Check(STORED, invalid), true);

  const contradictions: Record<string, unknown>[] = [
    { ...valid, payload: null },
    { ...valid, violations: [violation] },
    { ...invalid, payload: validBuildOutput() },
    { ...invalid, violations: [] },
  ];
  for (const record of contradictions) {
    assert.equal(Value.Check(STORED, record), false, `${JSON.stringify(record.valid)} with contradictory fields must be refused`);
  }
});

test("the wrapper keeps the extraction label the parser recorded (B3-18)", () => {
  const trailing = parseEnvelope(
    `${JSON.stringify(validBuildOutput())}\n{"note":"an example, not the envelope"}`,
    schemaId,
  );
  assert.equal(trailing.valid, false);
  const storedTrailing = wrapEnvelope<BuildOutput>(identity(), trailing);
  assert.equal(storedTrailing.extraction, "trailing-object");
  assert.equal(Value.Check(STORED, storedTrailing), true);

  const exact = parseEnvelope(JSON.stringify(validBuildOutput()), schemaId);
  assert.equal(exact.valid, true);
  const storedExact = wrapEnvelope<BuildOutput>(identity(), exact);
  assert.equal(storedExact.extraction, "exact");
  assert.equal(Value.Check(STORED, storedExact), true);
});

test("a record written without an extraction label is still a valid record", () => {
  const stored = wrapEnvelope<BuildOutput>(identity(), { valid: true, payload: validBuildOutput() });
  assert.equal("extraction" in stored, false);
  assert.equal(Value.Check(STORED, stored), true);
});
