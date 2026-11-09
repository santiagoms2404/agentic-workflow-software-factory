// B3-10 — canonicalJson refused undefined loudly and everything else silently.
//
// Digests (amendments, grants, recovery, ticket selections) are computed over
// canonicalJson. A Date, a Map or a class instance serialized as {}, and NaN or
// Infinity serialized as null, so two different inputs shared one digest. The
// function now refuses those values the way it already refused undefined.

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, sha256 } from "../../../src/contracts/owner-amendment.ts";

test("canonicalJson refuses a Date instead of hashing it as {} (B3-10)", () => {
  assert.throws(() => canonicalJson({ at: new Date(0) }), /not canonical JSON/u);
  assert.notEqual(sha256(canonicalJson({ at: "1970-01-01T00:00:00.000Z" })), sha256(canonicalJson({ at: "1970-01-01T00:00:01.000Z" })));
});

test("canonicalJson refuses a Map, a Set and other built-ins that hold state internally (B3-10)", () => {
  for (const value of [new Map([["a", 1]]), new Set([1]), new Number(5), new Uint8Array(2)]) {
    assert.throws(() => canonicalJson({ value }), /not canonical JSON/u);
  }
});

test("canonicalJson still digests a class instance's own data, as JSON does (B3-10)", () => {
  class Money {
    readonly cents: number;
    constructor(cents: number) {
      this.cents = cents;
    }
  }
  assert.equal(canonicalJson({ value: new Money(5) }), '{"value":{"cents":5}}');
});

test("canonicalJson accepts an environment-like object whose entries are its data (B3-10)", () => {
  const environment = Object.assign(Object.create(Object.create(null) as object) as Record<string, string>, { PATH: "/bin", SHELL: "zsh" });
  assert.equal(canonicalJson(environment), '{"PATH":"/bin","SHELL":"zsh"}');
});

test("canonicalJson refuses NaN and Infinity instead of writing null (B3-10)", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => canonicalJson({ x: value }), /not canonical JSON/u);
  }
  assert.equal(canonicalJson({ x: null }), '{"x":null}');
});

test("canonicalJson still accepts plain data, arrays and null-prototype objects (B3-10)", () => {
  const bare = Object.assign(Object.create(null) as Record<string, unknown>, { b: [2, 1], a: true });
  assert.equal(canonicalJson(bare), '{"a":true,"b":[2,1]}');
  assert.equal(canonicalJson({ z: [{ y: 1, x: "s" }], a: 0 }), '{"a":0,"z":[{"x":"s","y":1}]}');
  assert.throws(() => canonicalJson({ x: undefined }), /undefined is not canonical JSON/u);
});
