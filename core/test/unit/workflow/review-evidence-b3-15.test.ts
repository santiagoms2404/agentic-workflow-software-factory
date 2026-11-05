// B3-15 — the review diff must fit the envelope in bytes, not only in characters.
//
// The diff budget counts UTF-16 code units, and the envelope cap is counted in
// UTF-8 bytes. A diff of mostly three-byte characters (em dashes, CJK) bounded
// to the full character budget serialized past the cap, so the candidate could
// not be reviewed at all. The composed diff now fits the byte allowance, and an
// ASCII diff keeps its full budget exactly as before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boundReviewDiff, type DiffFileSection } from "../../../src/gates/review-diff.ts";
import { REVIEW_CONTEXT_DIFF_MAX_CHARS } from "../../../src/contracts/review-context.ts";
import { utf8ByteLength } from "../../../src/contracts/typebox.ts";
import { boundReviewDiffForEnvelope, REVIEW_DIFF_BYTE_ALLOWANCE } from "../../../src/workflow/review-evidence.ts";

/** `count` hunks of `width` copies of `glyph` each, in one file. */
function hunks(glyph: string, count: number, width: number): DiffFileSection[] {
  const text = Array.from({ length: count }, (_, index) => `@@ -${index + 1} +${index + 1} @@\n${glyph.repeat(width)}\n`).join("");
  return [{ path: "src/wide.ts", text }];
}

test("a diff of multi-byte characters is bounded to the envelope's byte allowance (B3-15)", () => {
  const sections = hunks("—", 400, 480);
  const plain = boundReviewDiff(sections, REVIEW_CONTEXT_DIFF_MAX_CHARS);
  assert.ok(utf8ByteLength(JSON.stringify(plain.diff)) > REVIEW_DIFF_BYTE_ALLOWANCE, "the character budget alone overflows");

  const bounded = boundReviewDiffForEnvelope(sections);
  assert.ok(utf8ByteLength(JSON.stringify(bounded.diff)) <= REVIEW_DIFF_BYTE_ALLOWANCE);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.diff.length > 0, "a tighter budget still keeps whole hunks");
});

test("an ASCII diff keeps the full character budget, as before (B3-15)", () => {
  const sections = hunks("x", 400, 480);
  assert.deepEqual(boundReviewDiffForEnvelope(sections), boundReviewDiff(sections, REVIEW_CONTEXT_DIFF_MAX_CHARS));
});
