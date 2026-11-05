// B3-19 — the readout's instant fields accepted a date followed by anything.
//
// `cut`, `terminalAt` and `landedAt` are timestamps. The pattern anchored the
// date at the start and then stopped, so "2026-10-13T" and
// "2026-10-13Tgarbage" validated, and assertTrapsReadout trusted them. Every
// producer writes a full ISO instant, and that is the only form accepted now.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import { TrapsReadoutSchema } from "../../../src/contracts/traps-readout.ts";

const instant = TrapsReadoutSchema.properties.cut;

test("the readout accepts full ISO instants, as every producer writes them (B3-19)", () => {
  for (const value of [
    "2026-10-13T10:00:00.000Z",
    "2026-10-13T10:00:00Z",
    "2026-10-13T10:00:00.123456+02:00",
  ]) {
    assert.equal(Value.Check(instant, value), true, `${value} is an instant`);
  }
});

test("the readout refuses a date with no time, or with trailing text (B3-19)", () => {
  for (const value of [
    "2026-10-13T",
    "2026-10-13Tgarbage",
    "2026-10-13T not a time",
    "2026-10-13T10:00:00Zjunk",
    "not a time",
  ]) {
    assert.equal(Value.Check(instant, value), false, `${JSON.stringify(value)} is not an instant`);
  }
});
