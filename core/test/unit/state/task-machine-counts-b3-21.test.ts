// B3-21 and B3-27 — the task machine's edge count, as the code and its
// rejection text state it.
//
// IllegalTransition is persisted as rejection evidence, so the owner reads its
// wording. It used to name "twenty-five" legal transitions while the table has
// 27, and the table's own header and comment disagreed with both. The wording
// now carries no count, so it cannot drift again, and the header's counts are
// checked against the table here.

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { IllegalTransition } from "../../../src/state/errors.ts";
import { LEGAL_EDGES } from "../../../src/state/task-machine.ts";

const STATES = 11;

test("IllegalTransition names no stale edge count (B3-21)", () => {
  const error = new IllegalTransition("DRAFT", "RUNNING");
  assert.doesNotMatch(error.message, /twenty-five/u);
  assert.equal(error.message, "DRAFT -> RUNNING: not one of the legal transitions");
});

test("the task machine header states the edge count the table holds (B3-27)", () => {
  assert.equal(LEGAL_EDGES.length, 27);
  const rejected = STATES * STATES - LEGAL_EDGES.length;
  assert.equal(rejected, 94);

  const source = readFileSync(fileURLToPath(new URL("../../../src/state/task-machine.ts", import.meta.url)), "utf8");
  const header = source.split("\n").slice(0, 3).map((line) => line.replace(/^\/\/ ?/u, "")).join(" ");
  assert.match(header, /eleven states, twenty-seven legal edges, ninety-four rejected ordered pairs/u);
  assert.doesNotMatch(source, /twenty-five|twenty-six legal/u);
});
