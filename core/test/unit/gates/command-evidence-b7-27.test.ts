// B7-27: a clip of gate output must never cut a UTF-16 surrogate pair.
//
// The window clip used to slice by code units, so a window that started at an
// odd code unit began with a lone low surrogate, which every UTF-8 consumer
// rendered as a replacement character at the head of the evidence. The same
// cut at the head edge left a lone high surrogate at the end of a window.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boundCommandOutput, renderBoundedEvidence } from "../../../src/gates/command-evidence.ts";

const LOW_SURROGATE = /^[\uDC00-\uDFFF]/u;
const HIGH_SURROGATE_AT_END = /[\uD800-\uDBFF]$/u;

test("B7-27: a tail window never begins with a lone low surrogate", () => {
  // Ten ASCII units, then five emoji (each two code units). A tail of three units
  // under the old slice starts on the low half of the third emoji's neighbour.
  const output = "x".repeat(10) + "\u{1F600}".repeat(5);
  const evidence = boundCommandOutput(output, { budget: 5 });
  assert.equal(LOW_SURROGATE.test(evidence.tail), false, `tail begins with a lone low surrogate: ${JSON.stringify(evidence.tail)}`);
  assert.equal(HIGH_SURROGATE_AT_END.test(evidence.head), false, `head ends with a lone high surrogate: ${JSON.stringify(evidence.head)}`);
  assert.ok(evidence.tail.length <= 3, "the tail stays within its share of the budget");
});

test("B7-27: a head window never ends with a lone high surrogate", () => {
  // A budget of seven gives the head a share of three units: one emoji and the
  // high half of the next, which the old slice kept.
  const output = "\u{1F600}".repeat(5) + "x".repeat(10);
  const evidence = boundCommandOutput(output, { budget: 7 });
  assert.equal(HIGH_SURROGATE_AT_END.test(evidence.head), false, `head ends with a lone high surrogate: ${JSON.stringify(evidence.head)}`);
  assert.equal(LOW_SURROGATE.test(evidence.tail), false, `tail begins with a lone low surrogate: ${JSON.stringify(evidence.tail)}`);
});

test("B7-27: the rendered evidence stays well formed at its ceiling", () => {
  const output = "log line\n".repeat(40) + "\u{1F600}".repeat(400);
  for (const ceiling of [64, 97, 128, 201, 300]) {
    const rendered = renderBoundedEvidence(output, ceiling);
    assert.ok(rendered.length <= ceiling, `rendered ${String(rendered.length)} exceeds ceiling ${String(ceiling)}`);
    assert.equal(HIGH_SURROGATE_AT_END.test(rendered), false, `ceiling ${String(ceiling)} ends with a lone high surrogate`);
    for (const part of rendered.split("--- ")) {
      assert.equal(LOW_SURROGATE.test(part.replace(/^[^\n]*\n/u, "")), false, `ceiling ${String(ceiling)} has a lone low surrogate after a label`);
    }
  }
});
