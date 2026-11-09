// B3-11 — the rendered violation value was cut on a code unit.
//
// A rejected envelope keeps a bounded rendering of what was there. The cut is
// at 199 UTF-16 code units, so an emoji that straddles it left a lone high
// surrogate in the retained text, and the UTF-8 round trip turned it into
// U+FFFD. The cut now backs off a code unit so the retained text ends on a
// whole character.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { VIOLATION_VALUE_MAX_CHARS } from "../../../src/contracts/stored-envelope.ts";

const schemaId = "awsf.build-output/v1";
const HIGH_SURROGATE = /[\uD800-\uDBFF]/u;

/** A final message that is not JSON at all, so the violation carries its bounded head. */
function notJson(prefixLength: number): string {
  return `${"x".repeat(prefixLength)}\u{1F600}tail`;
}

test("a retained value never ends in a lone high surrogate (B3-11)", () => {
  // The emoji starts at index 198 and its high surrogate is the 199th unit, so
  // a plain slice of VIOLATION_VALUE_MAX_CHARS - 1 would keep only that half.
  const result = parseEnvelope(notJson(198), schemaId);
  assert.equal(result.valid, false);
  if (result.valid) return;
  const received = result.violations[0]?.received;
  assert.equal(typeof received, "string");
  assert.ok(typeof received === "string" && received.length <= VIOLATION_VALUE_MAX_CHARS);
  assert.ok(typeof received === "string" && received.endsWith("…"));
  const kept = typeof received === "string" ? received.slice(0, -1) : "";
  assert.equal(HIGH_SURROGATE.test(kept.slice(-1)), false, "the retained head must not end in half a character");
  assert.equal(Buffer.from(received as string, "utf8").toString("utf8").includes("�"), false);
});

test("an untruncated retained value is kept whole (B3-11)", () => {
  const result = parseEnvelope(notJson(10), schemaId);
  assert.equal(result.valid, false);
  if (result.valid) return;
  const received = result.violations[0]?.received;
  assert.equal(received, `${"x".repeat(10)}\u{1F600}tail`);
});
