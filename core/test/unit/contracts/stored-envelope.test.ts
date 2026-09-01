import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import {
  BuildOutputSchema,
  ENVELOPE_SCHEMAS,
  parseEnvelope,
  StoredEnvelopeSchema,
  wrapEnvelope,
  type BuildOutput,
  type EnvelopeIdentity,
  type ValidationViolation,
} from "../../../src/contracts/index.ts";
import { validBuildOutput } from "./fixtures.ts";

function identity(): EnvelopeIdentity {
  return {
    envelopeId: "env-0001",
    sessionId: "sess-0001",
    phaseId: "build",
    correctionRound: 0,
    agent: "builder",
    schemaId: "awsf.build-output/v1",
    createdAt: "2026-08-05T10:00:00.000Z",
    rawOutputPath: "attempt://1/phases/build/raw-0.txt",
  };
}

test("the host wraps the wire envelope; the model contributes none of the identity", () => {
  const stored = wrapEnvelope<BuildOutput>(identity(), { valid: true, payload: validBuildOutput() });
  assert.equal(stored.phaseId, "build");
  assert.equal(stored.valid, true);
  assert.deepEqual(stored.violations, []);
  assert.ok(stored.payload);
  // Nothing named phaseId ever crossed the wire.
  assert.equal("phaseId" in (stored.payload as Record<string, unknown>), false);
  assert.equal(Value.Check(StoredEnvelopeSchema(BuildOutputSchema), stored), true);
});

test("no phase envelope schema asks the model to echo a phase id", () => {
  for (const [schemaId, schema] of Object.entries(ENVELOPE_SCHEMAS)) {
    const properties = Object.keys(schema.properties as Record<string, unknown>);
    assert.equal(properties.includes("phaseId"), false, `${schemaId} echoes phaseId`);
    assert.equal(properties.includes("phase_id"), false, `${schemaId} echoes phase_id`);
  }
});

test("an invalid envelope is retained with its violations and a null payload", () => {
  const violations: ValidationViolation[] = [
    { kind: "schema-mismatch", path: "/changedFiles", message: "Expected array", received: '"README.md"' },
  ];
  const stored = wrapEnvelope<BuildOutput>(identity(), { valid: false, violations });
  assert.equal(stored.valid, false);
  assert.equal(stored.payload, null);
  assert.deepEqual(stored.violations, violations);
  // Still a well-formed stored record — retained, not discarded.
  assert.equal(Value.Check(StoredEnvelopeSchema(BuildOutputSchema), stored), true);
});

test("an invalid envelope with no violations is a programming error, not a silent hole", () => {
  assert.throws(() => wrapEnvelope<BuildOutput>(identity(), { valid: false, violations: [] }), /at least one violation/);
});

test("wrapEnvelope copies the violation list rather than aliasing the caller's array", () => {
  const violations: ValidationViolation[] = [
    { kind: "not-json", path: "", message: "not a single JSON object", received: "sorry" },
  ];
  const stored = wrapEnvelope<BuildOutput>(identity(), { valid: false, violations });
  violations.push({ kind: "size-exceeded", path: "", message: "too big", received: null });
  assert.equal(stored.violations.length, 1);
});

test("the parser salvages a corrected final object after an abandoned provider object", () => {
  const abandoned = '{"schema":"awsf.build-output/v1","producerStatus":"success","summary":"unfinished';
  const result = parseEnvelope(`${abandoned}${JSON.stringify(validBuildOutput())}`, "awsf.build-output/v1");
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.extraction, "outermost-object");
  assert.deepEqual(result.payload, validBuildOutput());
});

test("a parse failure flows straight into a retained stored envelope", () => {
  const result = parseEnvelope("I gave up.", "awsf.build-output/v1");
  assert.equal(result.valid, false);
  if (result.valid) return;
  const stored = wrapEnvelope<BuildOutput>(identity(), { valid: false, violations: result.violations });
  assert.equal(stored.valid, false);
  assert.equal(stored.violations[0]?.received, "I gave up.");
  assert.equal(Value.Check(StoredEnvelopeSchema(BuildOutputSchema), stored), true);
});

test("the stored schema rejects an unknown wrapper field", () => {
  const stored = wrapEnvelope<BuildOutput>(identity(), { valid: true, payload: validBuildOutput() });
  assert.equal(
    Value.Check(StoredEnvelopeSchema(BuildOutputSchema), { ...stored, providerSessionId: "abc" }),
    false,
  );
});

test("correctionRound is host-assigned and starts at zero", () => {
  const stored = wrapEnvelope<BuildOutput>({ ...identity(), correctionRound: 2 }, {
    valid: true,
    payload: validBuildOutput(),
  });
  assert.equal(stored.correctionRound, 2);
  assert.equal(
    Value.Check(StoredEnvelopeSchema(BuildOutputSchema), { ...stored, correctionRound: -1 }),
    false,
  );
});
