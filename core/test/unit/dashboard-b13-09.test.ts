import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(relPath: string): string {
  return readFileSync(new URL(`../../../${relPath}`, import.meta.url), "utf8");
}

// B13-09, B13-10, B13-28, B14-03 (Cluster P22): readRoute called bare
// decodeURIComponent on hash segments without a guard, so malformed escapes
// (such as #/sessions/% or #/backlog/%E0%A4%A) threw URIError inside onMounted
// before addEventListener attached the hashchange listener, disabling in-app
// navigation for the page.

test("safeDecode in App.vue is defined and used for all route hash decoding", () => {
  const appVue = source("dashboard/src/App.vue");
  // App.vue must define a non-throwing safeDecode helper
  assert.match(appVue, /function safeDecode\(value: string\): string/, "App.vue defines safeDecode");

  // App.vue must not use bare decodeURIComponent in readRoute
  const readRouteMatch = appVue.match(/function readRoute\(\): void \{([\s\S]*?)\n\}/);
  assert.ok(readRouteMatch, "readRoute function found");
  const readRouteBody = readRouteMatch[1] ?? "";
  assert.doesNotMatch(
    readRouteBody,
    /[^a-zA-Z0-9_]decodeURIComponent\(/,
    "readRoute should use safeDecode instead of bare decodeURIComponent",
  );
  // All four decoded hash segments must use safeDecode
  assert.match(readRouteBody, /backlogPlan\.value\s*=\s*backlogWithPlan\?\.\[1\]\s*\?\s*safeDecode\(backlogWithPlan\[1\]\)\s*:\s*null/);
  assert.match(readRouteBody, /selectedGroup\.value\s*=\s*groupWithId\?\.\[1\]\s*\?\s*safeDecode\(groupWithId\[1\]\)\s*:\s*null/);
  assert.match(readRouteBody, /selectedId\.value\s*=\s*safeDecode\(phase\?\.\[1\]\s*\?\?\s*session\?\.\[1\]\s*\?\?\s*""\)\s*\|\|\s*null/);
  assert.match(readRouteBody, /selectedPhaseId\.value\s*=\s*phase\?\.\[2\]\s*\?\s*safeDecode\(phase\[2\]\)\s*:\s*null/);
});

test("safeDecode behavior: handles malformed percent sequences without throwing and preserves literal plus", () => {
  const appVue = source("dashboard/src/App.vue");
  const fnMatch = appVue.match(/function safeDecode\(value: string\): string \{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, "safeDecode implementation found");
  const fnBody = fnMatch[1] ?? "";
  const safeDecode = new Function("value", fnBody) as (value: string) => string;

  // Malformed percent sequences must return raw input without throwing
  assert.equal(safeDecode("%"), "%");
  assert.equal(safeDecode("50%"), "50%");
  assert.equal(safeDecode("%E0"), "%E0");
  assert.equal(safeDecode("%E0%A4%A"), "%E0%A4%A");
  assert.equal(safeDecode("abc%zz"), "abc%zz");

  // Valid escapes must decode properly
  assert.equal(safeDecode("hello%20world"), "hello world");
  assert.equal(safeDecode("foo%2Fbar"), "foo/bar");
  assert.equal(safeDecode("session-123"), "session-123");

  // Literal plus must NOT be converted to space (B13-28 fix caution)
  assert.equal(safeDecode("run+id"), "run+id");
  assert.equal(safeDecode("a+b%20c"), "a+b c");
});
