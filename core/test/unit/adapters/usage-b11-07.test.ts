// B11-07: normalizeUsage bounds malformed provider value representation in faults
//
// A provider reporting a multi-megabyte string or object in usage fields could
// inflate notice details indefinitely without output budget charging. Fault
// messages must truncate oversized value representations to a bounded length.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUsage } from "../../../src/adapters/stream/usage.ts";

test("B11-07: normalizeUsage bounds oversized numeric usage field value in fault text", () => {
  const hugeString = "a".repeat(10_000);
  const { usage, faults } = normalizeUsage({ inputTokens: hugeString });

  assert.equal(usage.inputTokens, null);
  assert.equal(faults.length, 1);
  assert.ok(faults[0]!.length <= 350, `fault message must be bounded, got length ${faults[0]!.length}`);
  assert.match(faults[0]!, /^inputTokens was "a{50,}…, which is not a token count — recorded as null$/);
});

test("B11-07: normalizeUsage bounds oversized reasoningRelation value in fault text", () => {
  const hugeString = "r".repeat(10_000);
  const { usage, faults } = normalizeUsage({ reasoningRelation: hugeString });

  assert.equal(usage.reasoningRelation, "unknown");
  assert.equal(faults.length, 1);
  assert.ok(faults[0]!.length <= 350, `fault message must be bounded, got length ${faults[0]!.length}`);
  assert.match(faults[0]!, /^reasoningRelation was "r{50,}… — recorded as unknown$/);
});

test("B11-07: normalizeUsage bounds oversized unrecognized metric key in fault text", () => {
  const hugeKey = "k".repeat(10_000);
  const { faults } = normalizeUsage({ [hugeKey]: 123 });

  assert.equal(faults.length, 1);
  assert.ok(faults[0]!.length <= 350, `fault message must be bounded, got length ${faults[0]!.length}`);
  assert.match(faults[0]!, /^k{50,}… is not a metric this contract carries — dropped$/);
});

test("B11-07: normalizeUsage preserves small malformed values without truncation", () => {
  const { faults } = normalizeUsage({ inputTokens: "bad", reasoningRelation: "bogus", customField: 42 });

  assert.equal(faults.length, 3);
  assert.equal(faults[0], 'inputTokens was "bad", which is not a token count — recorded as null');
  assert.equal(faults[1], 'reasoningRelation was "bogus" — recorded as unknown');
  assert.equal(faults[2], "customField is not a metric this contract carries — dropped");
});

test("B11-07: normalizeUsage handles circular references in malformed values without throwing", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const { usage, faults } = normalizeUsage({ inputTokens: cyclic, reasoningRelation: cyclic });

  assert.equal(usage.inputTokens, null);
  assert.equal(usage.reasoningRelation, "unknown");
  assert.equal(faults.length, 2);
  assert.match(faults[0]!, /inputTokens was \[unserializable\], which is not a token count — recorded as null/);
  assert.match(faults[1]!, /reasoningRelation was \[unserializable\] — recorded as unknown/);
});

test("B11-07: normalizeUsage bounds oversized object payload in numeric field", () => {
  const hugeObject = { nested: "x".repeat(10_000) };
  const { usage, faults } = normalizeUsage({ outputTokens: hugeObject });

  assert.equal(usage.outputTokens, null);
  assert.equal(faults.length, 1);
  assert.ok(faults[0]!.length <= 350, `fault message must be bounded, got length ${faults[0]!.length}`);
  assert.match(faults[0]!, /^outputTokens was \{"nested":"x{50,}…, which is not a token count — recorded as null$/);
});

test("B11-07: normalizeUsage bounds oversized object in reasoningRelation value in fault text", () => {
  const hugeObject = { relation: "r".repeat(10_000) };
  const { usage, faults } = normalizeUsage({ reasoningRelation: hugeObject });

  assert.equal(usage.reasoningRelation, "unknown");
  assert.equal(faults.length, 1);
  assert.ok(faults[0]!.length <= 350, `fault message must be bounded, got length ${faults[0]!.length}`);
  assert.match(faults[0]!, /^reasoningRelation was \{"relation":"r{50,}… — recorded as unknown$/);
});
