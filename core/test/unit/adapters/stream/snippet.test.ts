// The snippet is what the trace shows of a value the host did not write. Its
// cut must land on a code point boundary, so the snippet stays well formed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../../../../src/adapters/stream/snippet.ts";

/** A high surrogate with no low surrogate after it: the shape a split pair leaves behind. */
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

test("B11-21: a surrogate pair straddling the snippet limit is cut before it, never split", () => {
  // The 400th code unit is the high half of an astral character.
  const snippet = summarize(`${"a".repeat(399)}😀tail`);
  assert.doesNotMatch(snippet, LONE_HIGH_SURROGATE, "no lone high surrogate survives the cut");
  assert.equal(snippet, `${"a".repeat(399)}…`);
});

test("B11-21: triangulation: a pair wholly inside the limit is kept, and a pair cut mid-text keeps the characters around it", () => {
  assert.equal(summarize(`${"a".repeat(398)}😀`), `${"a".repeat(398)}😀`, "exactly at the limit is not cut");
  assert.equal(summarize(`${"a".repeat(397)}😀bbbb`), `${"a".repeat(397)}😀b…`, "a pair inside the limit survives");
  assert.equal(summarize("b".repeat(500)), `${"b".repeat(400)}…`, "a plain cut is unchanged");
});
