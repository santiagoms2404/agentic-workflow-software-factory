import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const IMPURE_MODULES = "(?:node:)?(?:fs|child_process|http|https|http2|net|dgram|dns|sqlite|tls|perf_hooks|timers|readline)";
const IMPURE_IMPORT = new RegExp(
  `(?:from\\s+|import\\s*\\(?\\s*|require\\s*\\(\\s*)(['"])${IMPURE_MODULES}(?:\\/[^'"]*)?\\1`,
);

test("core/src/state imports nothing impure", () => {
  const files = walkFiles(join(repoRoot(), "core", "src", "state"), [".ts"]);
  const offenders = files
    .map(relRepo)
    .filter((f) => IMPURE_IMPORT.test(readFileSync(join(repoRoot(), f), "utf8")));
  assert.deepEqual(offenders, []);
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
