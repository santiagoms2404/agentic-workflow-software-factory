// AGENTS.md invariant 13 (W19 INV-4): only core/src/decision/jev-transport.ts
// calls the Jev endpoint. The adapter fence keeps global fetch out of the
// adapters; this one keeps it out of all of core/src except the transport, and
// keeps the endpoint's address from being spelled anywhere else, so a second
// request builder cannot appear through another door.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { repoRoot, walkFiles } from "./_walk.ts";

const CORE_SRC = join(repoRoot(), "core", "src");
const TRANSPORT = "core/src/decision/jev-transport.ts";

/** The adapter fence's pattern, reused verbatim: bare `fetch(` or `globalThis.fetch`. */
const FETCH = /(^|[^.\w])fetch\s*\(|globalThis\s*\.\s*fetch/;
/** The decisions endpoint, by path, whatever host or quoting spells it. */
const ENDPOINT = /api\/alpha\/decisions/;

/** Files under `root` (a checkout) whose core/src text matches, the transport excepted. */
function offenders(pattern: RegExp, root = repoRoot()): string[] {
  const coreSrc = root === repoRoot() ? CORE_SRC : join(root, "core", "src");
  return walkFiles(coreSrc)
    .map((file) => relative(root, file).split(sep).join("/"))
    .filter((file) => file !== TRANSPORT)
    .filter((file) => pattern.test(readFileSync(join(root, file), "utf8")));
}

test("the Jev transport exists where the invariant names it, and calls fetch itself", () => {
  const text = readFileSync(join(repoRoot(), TRANSPORT), "utf8");
  assert.ok(FETCH.test(text), `${TRANSPORT} should hold the one fetch call`);
  assert.ok(ENDPOINT.test(text), `${TRANSPORT} should name the decisions endpoint`);
});

test("no file in core/src but the Jev transport calls global fetch", () => {
  assert.deepEqual(offenders(FETCH), []);
});

test("no file in core/src but the Jev transport names the decisions endpoint", () => {
  assert.deepEqual(offenders(ENDPOINT), []);
});

test("the fence is load-bearing: both spellings are caught, an injected port is not", () => {
  assert.ok(FETCH.test("const response = await fetch(url);"));
  assert.ok(FETCH.test("const response = await fetch (url);"));
  assert.ok(FETCH.test("await globalThis.fetch(url)"));
  assert.ok(FETCH.test("const send = globalThis . fetch;"));
  assert.equal(FETCH.test("await this.#http.fetch(url)"), false);
  assert.equal(FETCH.test("await prefetch(url)"), false);
  assert.ok(ENDPOINT.test(`"https://openrouter.ai/api/alpha/decisions"`));
  assert.ok(ENDPOINT.test("`${origin}/api/alpha/decisions`"));
});

test("the fence catches a planted fetch or endpoint in another core/src file", () => {
  // The same walk, over a scratch checkout holding the transport and three plants.
  const root = mkdtempSync(join(tmpdir(), "jev-fence-"));
  try {
    const plant = (file: string, text: string) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    };
    plant(TRANSPORT, `await fetch("https://openrouter.ai/api/alpha/decisions");`);
    plant("core/src/decision/elsewhere.ts", `export const call = () => fetch("https://example.invalid");`);
    plant("core/src/workflow/sneaky.ts", `export const send = globalThis.fetch;`);
    plant("core/src/cli/url.ts", `export const url = "https://openrouter.ai/api/alpha/decisions";`);
    assert.deepEqual(offenders(FETCH, root).sort(), ["core/src/decision/elsewhere.ts", "core/src/workflow/sneaky.ts"]);
    assert.deepEqual(offenders(ENDPOINT, root), ["core/src/cli/url.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
