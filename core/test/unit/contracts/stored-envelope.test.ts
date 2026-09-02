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
  // The salvage returns an INNER object, so the trace must not claim the host
  // took the outermost one. That mislabel is what made a wrong salvage
  // unreadable after the fact.
  assert.equal(result.extraction, "trailing-object");
  assert.deepEqual(result.payload, validBuildOutput());
});

test("the two brace-scan kinds are distinguishable in the retained trace", () => {
  // Prose either side: the first-brace-to-last-brace slice parses whole, and
  // the outermost object is the right answer.
  const wrapped = parseEnvelope(
    `Here is the envelope:\n${JSON.stringify(validBuildOutput())}\nThat is all.`,
    "awsf.build-output/v1",
  );
  assert.equal(wrapped.valid, true);
  assert.equal(wrapped.extraction, "outermost-object");

  // A valid envelope followed by a second object: the backward scan takes the
  // trailing one, which then fails validation. The label says which was taken.
  const trailing = parseEnvelope(
    `${JSON.stringify(validBuildOutput())}\n{"note":"an example, not the envelope"}`,
    "awsf.build-output/v1",
  );
  assert.equal(trailing.valid, false);
  assert.equal(trailing.extraction, "trailing-object");
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

// ---------------------------------------------------------------------------
// A `not-json` violation must say WHICH failure it is.
//
// A real drive returned 30 KB of prose-plus-JSON whose object was broken at
// line 98. The violation carried only a bounded head of the payload, so what
// the record showed was a conversational sentence followed by `{"schema": ...`
// — and two separate sessions read that as "the model prefixed a preamble" and
// proposed fixing the preamble. Prose around a WELL-FORMED object is recovered,
// so the preamble was never the defect and that fix would have changed nothing.
// The parser knew the difference all along; it just discarded it in a `catch`.
// ---------------------------------------------------------------------------

test("prose wrapped around a well-formed object is recovered, so a preamble is not a defect", () => {
  const result = parseEnvelope(
    `I'll ground the plan in the actual code before writing it.${JSON.stringify(validBuildOutput())}`,
    "awsf.build-output/v1",
  );
  assert.equal(result.valid, true);
  assert.equal(result.extraction, "outermost-object");
});

test("a broken object names where it broke, and is distinguishable from prose", () => {
  // The shape of the real failure: a string property, then a bracket closing an
  // array that was never opened.
  const broken = '{"schema":"awsf.build-output/v1","notesForNextPhase":"a long note"\n  ],\n  "goals": []}';
  const result = parseEnvelope(`I'll ground the plan first.${broken}`, "awsf.build-output/v1");
  assert.equal(result.valid, false);
  if (result.valid) return;
  const message = result.violations[0]?.message ?? "";
  assert.match(message, /the outermost object did not parse/u);
  assert.match(message, /position \d+/u, "the position is what separates this from a preamble");
});

test("a payload with no object at all carries no parse position to report", () => {
  const result = parseEnvelope("I gave up.", "awsf.build-output/v1");
  assert.equal(result.valid, false);
  if (result.valid) return;
  const message = result.violations[0]?.message ?? "";
  assert.match(message, /not a single JSON object/u);
  assert.doesNotMatch(message, /did not parse/u, "there was no object to fail at a position");
});
