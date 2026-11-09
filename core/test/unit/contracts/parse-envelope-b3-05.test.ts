import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ENVELOPE_BYTES, parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { validBuildOutput } from "./fixtures.ts";

const schemaId = "awsf.build-output/v1";

test("B3-05: a valid first-brace envelope survives trailing brace-containing prose", () => {
  const payload = validBuildOutput();
  const result = parseEnvelope(`${JSON.stringify(payload)}\nNote: the {x} placeholder is unused.`, schemaId);
  assert.equal(result.valid, true, "brace-containing trailing prose must not discard the complete envelope");
  assert.equal(result.extraction, "outermost-object");
  assert.ok(result.valid);
  assert.deepEqual(result.payload, payload);
});

for (const note of ["Note: unmatched closing }", "Note: {one} then {two}.", "Note: {{nested} prose}."]) {
  test(`B3-05: first-object salvage handles ${note}`, () => {
    const payload = validBuildOutput();
    const result = parseEnvelope(`Here is the reply:\n${JSON.stringify(payload)}\n${note}`, schemaId);
    assert.deepEqual(result, { valid: true, extraction: "outermost-object", payload });
  });
}

for (const summary of [
  "literal } and { braces",
  'escaped quote " before } and {',
  'backslash then quote \\" and }',
  "ends in a backslash \\",
]) {
  test(`B3-05: braces are structural only outside JSON strings: ${JSON.stringify(summary)}`, () => {
    const payload = { ...validBuildOutput(), summary };
    assert.deepEqual(parseEnvelope(`${JSON.stringify(payload)}\nNote: {x}.`, schemaId), {
      valid: true, extraction: "outermost-object", payload,
    });
  });
}

test("B3-05: exact, fenced and ordinary prose extractions keep their provenance", () => {
  const payload = validBuildOutput();
  const raw = JSON.stringify(payload);
  assert.deepEqual(parseEnvelope(raw, schemaId), { valid: true, extraction: "exact", payload });
  assert.deepEqual(parseEnvelope(`\`\`\`json\n${raw}\n\`\`\`\nNote: {x}.`, schemaId), {
    valid: true, extraction: "fence-stripped", payload,
  });
  assert.deepEqual(parseEnvelope(`Reply:\n${raw}\nDone.`, schemaId), {
    valid: true, extraction: "outermost-object", payload,
  });
});

test("B3-05: brace-containing preamble and abandoned-object suffix salvage are unchanged", () => {
  const payload = validBuildOutput();
  for (const prefix of ["Note: {x}.\n", '{"summary":"unfinished']) {
    assert.deepEqual(parseEnvelope(`${prefix}${JSON.stringify(payload)}`, schemaId), {
      valid: true, extraction: "trailing-object", payload,
    });
  }
});

test("B3-05: an actual trailing JSON object still takes precedence, even when schema-invalid", () => {
  const result = parseEnvelope(`${JSON.stringify(validBuildOutput())}\n{"note":"not an envelope"}`, schemaId);
  assert.equal(result.valid, false);
  assert.equal(result.extraction, "trailing-object");
  assert.ok(!result.valid);
  assert.equal(result.violations[0]?.kind, "schema-mismatch");
});

test("B3-05: a recovered first object still rejects unknown envelope fields", () => {
  const result = parseEnvelope(`${JSON.stringify({ ...validBuildOutput(), unexpected: true })}\nNote: {x}.`, schemaId);
  assert.equal(result.valid, false);
  assert.equal(result.extraction, "outermost-object");
  assert.ok(!result.valid);
  assert.ok(result.violations.some(violation => violation.kind === "schema-mismatch" && violation.path === "/unexpected"));
});

test("B3-05: balanced but malformed JSON is not repaired or accepted", () => {
  const malformed = JSON.stringify(validBuildOutput()).replace('"producerStatus":"success"', '"producerStatus":nope');
  const result = parseEnvelope(`${malformed}\nNote: {x}.`, schemaId);
  assert.equal(result.valid, false);
  assert.equal(result.extraction, null);
  assert.ok(!result.valid);
  assert.equal(result.violations[0]?.kind, "not-json");
  assert.match(result.violations[0]?.message ?? "", /outermost object did not parse/);
});

test("B3-05: a truncated envelope does not become complete because prose closes a brace", () => {
  const raw = JSON.stringify(validBuildOutput()).slice(0, -1);
  const result = parseEnvelope(`${raw}\nNote: {x}.`, schemaId);
  assert.equal(result.valid, false);
  assert.equal(result.extraction, null);
  assert.ok(!result.valid);
  assert.equal(result.violations[0]?.kind, "not-json");
});

test("B3-05: raw byte limit still rejects before salvage", () => {
  const raw = `${JSON.stringify(validBuildOutput())}\n${"x".repeat(MAX_ENVELOPE_BYTES)} {x}`;
  const result = parseEnvelope(raw, schemaId);
  assert.equal(result.valid, false);
  assert.equal(result.extraction, null);
  assert.ok(!result.valid);
  assert.equal(result.violations[0]?.kind, "size-exceeded");
});
