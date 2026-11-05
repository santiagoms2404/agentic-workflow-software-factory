// B3-29 — the shared "not reported" usage object could be written in place.
//
// UNREPORTED_TOKEN_USAGE is the default usage that three command paths persist
// and return by reference. It was a plain object, so an in-place write to any
// returned usage changed the default for every later attempt in the process.
// It is frozen now, so such a write fails at the first attempt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { UNREPORTED_TOKEN_USAGE } from "../../../src/contracts/normalized-events.ts";

test("the shared unreported usage is frozen (B3-29)", () => {
  assert.equal(Object.isFrozen(UNREPORTED_TOKEN_USAGE), true);
  const writable = UNREPORTED_TOKEN_USAGE as { inputTokens: number | null };
  assert.throws(() => {
    writable.inputTokens = 5;
  }, TypeError);
  assert.equal(UNREPORTED_TOKEN_USAGE.inputTokens, null, "the default is not moved by a refused write");
});
