import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRatchet } from "./_ratchet.ts";

test("the ratchet accepts an exact list, including the empty list", () => {
  assert.doesNotThrow(() => assertRatchet(["b", "a"], ["a", "b"]));
  assert.doesNotThrow(() => assertRatchet([], []));
});

test("the ratchet names a new site even when it replaces another", () => {
  assert.throws(() => assertRatchet(["b"], ["a"]), /new site: b\nstale site .*: a/u);
});

test("the ratchet names a stale site and passes when the list shrinks", () => {
  assert.throws(() => assertRatchet(["a"], ["a", "b"]), /stale site .*: b/u);
  assert.doesNotThrow(() => assertRatchet(["a"], ["a"]));
});
