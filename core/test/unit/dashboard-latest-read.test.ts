import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readSequence } from "../../../dashboard/src/latest-read.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

// B13-25: a poll and a hashchange can both be loading the same view, and the
// older response may land last. Only the read started last may publish.

test("only the read started last is the newest", () => {
  const sequence = readSequence();
  const first = sequence.begin();
  const second = sequence.begin();
  assert.equal(sequence.isNewest(first), false);
  assert.equal(sequence.isNewest(second), true);
  const third = sequence.begin();
  assert.equal(sequence.isNewest(second), false);
  assert.equal(sequence.isNewest(third), true);
});

test("a slow older read that finishes last does not publish over the newer one", async () => {
  const sequence = readSequence();
  let published = "none";
  const load = async (label: string, delayMs: number): Promise<void> => {
    const read = sequence.begin();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (sequence.isNewest(read)) published = label;
  };
  await Promise.all([load("older", 30), load("newer", 5)]);
  assert.equal(published, "newer");
});

test("App.vue's load publishes only after the newest-read check", () => {
  const app = source("dashboard/src/App.vue");
  assert.match(app, /import \{ readSequence \} from "\.\/latest-read\.ts";/);
  assert.match(app, /const reads = readSequence\(\);/);
  assert.match(app, /async function load\(\): Promise<void> \{[\s\S]*?const read = reads\.begin\(\);/);
  assert.match(app, /if \(kind !== readKind\(\)\) return;\s*if \(!reads\.isNewest\(read\)\) return;/);
});
