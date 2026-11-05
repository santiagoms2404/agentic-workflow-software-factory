import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const IMPURE_MODULES = "(?:node:)?(?:fs|child_process|http|https|http2|net|dgram|dns|sqlite|tls|perf_hooks|timers|readline)";
const IMPURE_IMPORT = new RegExp(
  `(?:from\\s+|import\\s*\\(?\\s*|require\\s*\\(\\s*)(['"])${IMPURE_MODULES}(?:\\/[^'"]*)?\\1`,
);

// Invariant 5 names the clock as well as I/O. A read of the clock, a timer,
// randomness or the process needs no import at all (globals), so it is matched
// at the call site. The import fence above cannot see it.
const IMPURE_CALL = /\b(?:Date\s*\.\s*now|new\s+Date\b|performance\s*\.\s*now|setTimeout|setInterval|setImmediate|Math\s*\.\s*random|randomUUID|process\.[A-Za-z_$])/;

test("core/src/state imports nothing impure and reads no clock, timer or randomness", () => {
  const files = walkFiles(join(repoRoot(), "core", "src", "state"), [".ts"]);
  const offenders = files
    .map(relRepo)
    .filter((f) => {
      const source = readFileSync(join(repoRoot(), f), "utf8");
      return IMPURE_IMPORT.test(source) || IMPURE_CALL.test(source);
    });
  assert.deepEqual(offenders, []);
});

test("state purity fence rejects clock, timer, randomness and process reads with no import (B3-28)", () => {
  for (const call of [
    "const at = Date.now();",
    "const at = new Date();",
    "const at = performance.now();",
    "setTimeout(resume, 1);",
    "const roll = Math.random();",
    "const id = randomUUID();",
    "const pid = process.pid;",
  ]) {
    assert.equal(IMPURE_CALL.test(call), true, `${call} must be refused`);
  }
  assert.equal(IMPURE_CALL.test("const at = transition(evidence);"), false);
});

test("state purity fence rejects clocks, readline, bare and dynamic imports", () => {
  assert.equal(IMPURE_IMPORT.test('import { readFileSync } from "node:fs";'), true);
  assert.equal(IMPURE_IMPORT.test('import { performance } from "node:perf_hooks";'), true);
  assert.equal(IMPURE_IMPORT.test('import { setTimeout as sleep } from "node:timers/promises";'), true);
  assert.equal(IMPURE_IMPORT.test('import { createInterface } from "node:readline";'), true);
  assert.equal(IMPURE_IMPORT.test('import "node:fs";'), true);
  assert.equal(IMPURE_IMPORT.test('const fs = await import("node:fs");'), true);
  assert.equal(IMPURE_IMPORT.test('const cp = require("node:child_process");'), true);
  assert.equal(IMPURE_IMPORT.test('import http2 from "node:http2";'), true);
  assert.equal(IMPURE_IMPORT.test('import { transition } from "./transitions.ts";'), false);
});
