// "Adapters describe and parse; the broker spawns."
//
// The child-process fence already stops an adapter importing
// `node:child_process`. This is the other half of the contract's sentence: an
// adapter that reaches the network directly is a provider call the host never
// registered, never reserved, and cannot cancel — the same defect as spawning,
// arriving through a different door.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const ADAPTERS = join(repoRoot(), "core", "src", "adapters");

/** Bare `fetch(` or `globalThis.fetch`, but not `something.fetch(` on an injected port. */
const FETCH = /(^|[^.\w])fetch\s*\(|globalThis\s*\.\s*fetch/;
const CHILD_PROCESS = /(['"])(node:)?child_process\1/;

test("no adapter imports node:child_process — only the broker spawns", () => {
  const offenders = walkFiles(ADAPTERS)
    .filter((file) => CHILD_PROCESS.test(readFileSync(file, "utf8")))
    .map(relRepo);
  assert.deepEqual(offenders, []);
});

test("no adapter calls global fetch — an unregistered request is an unregistered call", () => {
  const offenders = walkFiles(ADAPTERS)
    .filter((file) => FETCH.test(readFileSync(file, "utf8")))
    .map(relRepo);
  assert.deepEqual(offenders, []);
});

test("the fence is load-bearing: both patterns match the thing they forbid", () => {
  // A fence nobody has watched catch something is decoration.
  assert.ok(CHILD_PROCESS.test(`import { spawn } from "node:child_process";`));
  assert.ok(CHILD_PROCESS.test(`require('child_process')`));
  assert.ok(FETCH.test("const response = await fetch(url);"));
  assert.ok(FETCH.test("await globalThis.fetch(url)"));
  // ...and does not fire on an injected transport that merely has the name.
  assert.equal(FETCH.test("await this.#http.fetch(url)"), false);
});
