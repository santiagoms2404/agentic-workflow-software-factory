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

/**
 * Direct network access pattern: bare `fetch(`, `globalThis.fetch`, `global.fetch`,
 * bracketed `['fetch']`, direct network module imports (`node:http`, `node:https`,
 * `node:net`, `tls`, `dgram`, `undici`), and browser/node network constructors
 * (`WebSocket`, `XMLHttpRequest`).
 */
const FETCH = new RegExp(
  [
    "(?:^|[^.\\w$])fetch\\s*\\(",
    "(?:globalThis|global)\\s*(?:\\.\\s*fetch\\b|\\[\\s*['\"`]fetch['\"`]\\s*\\])",
    "(['\"`])(?:node:)?(?:http|https|net|tls|dgram|undici)(?:\\/[A-Za-z0-9_.-]+)?\\1",
    "\\b(?:WebSocket|XMLHttpRequest)\\b",
  ].join("|"),
);
test("no adapter calls global fetch or reaches the network directly — an unregistered request is an unregistered call", () => {
  const offenders = walkFiles(ADAPTERS)
    .filter((file) => FETCH.test(readFileSync(file, "utf8")))
    .map(relRepo);
  assert.deepEqual(offenders, []);
});

test("the network fence is load-bearing: its matcher catches the thing it forbids", () => {
  assert.ok(FETCH.test("const response = await fetch(url);"));
  assert.ok(FETCH.test("await globalThis.fetch(url)"));
  assert.ok(FETCH.test("await global.fetch(url)"));
  assert.ok(FETCH.test("await globalThis['fetch'](url)"));
  assert.ok(FETCH.test("import { request } from 'node:https';"));
  assert.ok(FETCH.test("import http from 'node:http';"));
  assert.ok(FETCH.test("import { connect } from 'node:net';"));
  assert.ok(FETCH.test("import tls from 'tls';"));
  assert.ok(FETCH.test("import dgram from 'dgram';"));
  assert.ok(FETCH.test("import { request } from 'undici';"));
  assert.ok(FETCH.test("const ws = new WebSocket(url);"));
  assert.ok(FETCH.test("new XMLHttpRequest()"));
  // ...and does not fire on an injected transport that merely has the name.
  assert.equal(FETCH.test("await this.#http.fetch(url)"), false);
  assert.equal(FETCH.test('url: "https://github.com/openclaw/openclaw"'), false);
  assert.equal(FETCH.test("// safety net"), false);
});
