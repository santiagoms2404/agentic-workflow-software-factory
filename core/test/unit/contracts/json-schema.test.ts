import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import {
  emitAllEnvelopeJsonSchemas,
  emitEnvelopeJsonSchema,
  ENVELOPE_SCHEMAS,
  ENVELOPE_SCHEMA_IDS,
  injectOutputSchema,
  MissingSchemaPlaceholderError,
  OUTPUT_SCHEMA_PLACEHOLDER,
  PREVIOUS_ENVELOPE_PLACEHOLDER,
  renderSchemaBlock,
  UnknownEnvelopeSchemaError,
} from "../../../src/contracts/index.ts";
import { VALID_ENVELOPES } from "./fixtures.ts";

// The T3 stopping criterion, asserted directly: for each envelope, the runtime
// validator, the static TypeScript type, and the emitted JSON Schema all derive
// from one TypeBox definition. The static type is checked at compile time by
// the typed fixtures in fixtures.ts; the other two are checked here, against
// each other, so they cannot drift.

for (const schemaId of ENVELOPE_SCHEMA_IDS) {
  test(`${schemaId}: the emitted JSON Schema has exactly the validator's properties`, () => {
    const emitted = emitEnvelopeJsonSchema(schemaId);
    const emittedProperties = Object.keys(emitted["properties"] as Record<string, unknown>).sort();
    const sourceProperties = Object.keys(ENVELOPE_SCHEMAS[schemaId].properties as Record<string, unknown>).sort();
    assert.deepEqual(emittedProperties, sourceProperties);
  });

  test(`${schemaId}: the emitted JSON Schema rejects unknown fields, like the validator`, () => {
    const emitted = emitEnvelopeJsonSchema(schemaId);
    assert.equal(emitted["additionalProperties"], false);
    assert.equal(emitted["type"], "object");
  });

  test(`${schemaId}: the emission is plain JSON — no TypeBox symbols survive`, () => {
    const emitted = emitEnvelopeJsonSchema(schemaId);
    assert.equal(Object.getOwnPropertySymbols(emitted).length, 0);
    assert.doesNotThrow(() => JSON.stringify(emitted));
    // Round-trips losslessly: what the prompt shows is what is transmitted.
    assert.deepEqual(JSON.parse(JSON.stringify(emitted)), emitted);
  });

  test(`${schemaId}: the emitted schema is self-contained — no $ref to chase`, () => {
    const text = JSON.stringify(emitEnvelopeJsonSchema(schemaId));
    assert.equal(text.includes('"$ref"'), false);
  });

  test(`${schemaId}: the fixture that the validator accepts also matches the emitted document`, () => {
    // Re-checking the fixture against the emission's own `required`/`properties`
    // proves the two emissions agree on more than key names.
    const emitted = emitEnvelopeJsonSchema(schemaId);
    const fixture = VALID_ENVELOPES[schemaId as keyof typeof VALID_ENVELOPES]() as Record<string, unknown>;
    assert.equal(Value.Check(ENVELOPE_SCHEMAS[schemaId], fixture), true);
    for (const key of (emitted["required"] as string[]) ?? []) {
      assert.ok(key in fixture, `${schemaId} fixture is missing required field ${key}`);
    }
    assert.deepEqual(Object.keys(fixture).sort(), Object.keys(emitted["properties"] as object).sort());
  });
}

test("emitAllEnvelopeJsonSchemas covers every registered envelope", () => {
  assert.deepEqual(Object.keys(emitAllEnvelopeJsonSchemas()).sort(), [...ENVELOPE_SCHEMA_IDS].sort());
});

test("the emission carries a draft declaration, an $id, and a title", () => {
  const emitted = emitEnvelopeJsonSchema("awsf.review-output/v1");
  assert.equal(emitted["$schema"], "https://json-schema.org/draft/2020-12/schema");
  assert.equal(emitted["$id"], "https://awsf.local/schemas/awsf.review-output/v1");
  assert.equal(emitted["title"], "awsf.review-output/v1");
});

test("emission fails closed on an unregistered schema id", () => {
  assert.throws(() => emitEnvelopeJsonSchema("awsf.fix-output/v1"), UnknownEnvelopeSchemaError);
});

test("the prompt block states the one-JSON-object rule and carries the schema", () => {
  const block = renderSchemaBlock("awsf.plan-output/v1");
  assert.match(block, /exactly one JSON object/);
  assert.match(block, /unknown fields are rejected/i);
  assert.match(block, /"awsf\.plan-output\/v1"/);
  assert.match(block, /implementationSteps/);
});

test("injection replaces the placeholder with the generated schema", () => {
  const template = `You are the planner.\n\n${OUTPUT_SCHEMA_PLACEHOLDER}\n`;
  const compiled = injectOutputSchema(template, "awsf.plan-output/v1");
  assert.equal(compiled.includes(OUTPUT_SCHEMA_PLACEHOLDER), false);
  assert.match(compiled, /You are the planner\./);
  assert.match(compiled, /"nonGoals"/);
});

test("injection replaces every occurrence of the placeholder", () => {
  const template = `${OUTPUT_SCHEMA_PLACEHOLDER} middle ${OUTPUT_SCHEMA_PLACEHOLDER}`;
  const compiled = injectOutputSchema(template, "awsf.scout-output/v1");
  assert.equal(compiled.includes(OUTPUT_SCHEMA_PLACEHOLDER), false);
  assert.equal(compiled.split('"$id"').length - 1, 2);
});

test("a template with no placeholder is a compile-time error, not a silently schema-less prompt", () => {
  assert.throws(() => injectOutputSchema("You are the planner.", "awsf.plan-output/v1"), MissingSchemaPlaceholderError);
});

test("the previous-envelope placeholder is host-rendered, and is a distinct token", () => {
  assert.equal(PREVIOUS_ENVELOPE_PLACEHOLDER, "{previous_envelope}");
  assert.notEqual(PREVIOUS_ENVELOPE_PLACEHOLDER, OUTPUT_SCHEMA_PLACEHOLDER);
});
