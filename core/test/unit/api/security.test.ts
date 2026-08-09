import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SECURITY_HEADERS,
  SecurityError,
  assertLoopbackBind,
  decodePathSegments,
  validateAuthority,
} from "../../../src/api/security.ts";
import { jsonResponse, safely } from "../../../src/api/responses.ts";

test("only the two literal loopback bind addresses are accepted", () => {
  assert.doesNotThrow(() => assertLoopbackBind("127.0.0.1"));
  assert.doesNotThrow(() => assertLoopbackBind("::1"));
  for (const host of ["0.0.0.0", "::", "localhost", "192.168.1.2"]) {
    assert.throws(() => assertLoopbackBind(host), SecurityError);
  }
});

test("Host is mandatory and constrained to loopback authorities", () => {
  for (const host of ["127.0.0.1", "127.0.0.1:4600", "localhost:4600", "[::1]:4600"]) {
    assert.doesNotThrow(() => validateAuthority({ host }));
  }
  for (const host of [undefined, "example.com", "127.0.0.1.example.com", "127.0.0.1:70000", "[::]:4600"]) {
    assert.throws(() => validateAuthority(host === undefined ? {} : { host }), SecurityError);
  }
});

test("Origin, when present, must exactly match the loopback Host", () => {
  assert.doesNotThrow(() => validateAuthority({ host: "127.0.0.1:4600", origin: "http://127.0.0.1:4600" }));
  assert.doesNotThrow(() => validateAuthority({ host: "[::1]:4600", origin: "http://[::1]:4600" }));
  for (const origin of [
    "https://127.0.0.1:4600",
    "http://localhost:4600",
    "http://127.0.0.1:4601",
    "http://127.0.0.1:4600/path",
    "null",
  ]) {
    assert.throws(() => validateAuthority({ host: "127.0.0.1:4600", origin }), SecurityError);
  }
});

test("path segments are decoded once and rejected, never repaired", () => {
  assert.deepEqual(decodePathSegments("/api/v1/sessions/session-1"), ["api", "v1", "sessions", "session-1"]);
  assert.deepEqual(decodePathSegments("/api/v1/sessions/%73ession-1"), ["api", "v1", "sessions", "session-1"]);
  for (const target of [
    "/api/v1/sessions/../health",
    "/api/v1/sessions/%2E%2E",
    "/api/v1/sessions/a%2Fb",
    "/api/v1/sessions/a%5Cb",
    "/api/v1/sessions/%ZZ",
    "/api/v1/sessions/a b",
    "/api/v1/sessions/session-1/",
  ]) {
    assert.throws(() => decodePathSegments(target), SecurityError, target);
  }
});

test("all JSON responses carry a strict local-only CSP and no CORS header", () => {
  const response = jsonResponse({ ok: true });
  assert.equal(response.headers["content-security-policy"], SECURITY_HEADERS["content-security-policy"]);
  assert.match(response.headers["content-security-policy"] ?? "", /default-src 'none'/);
  assert.match(response.headers["content-security-policy"] ?? "", /connect-src 'self'/);
  assert.doesNotMatch(response.headers["content-security-policy"] ?? "", /https?:\/\//);
  assert.equal("access-control-allow-origin" in response.headers, false);
});

test("safely turns thrown handler failures into JSON without rejecting", async () => {
  const handler = safely(() => { throw new Error("driver detail must stay private"); });
  const response = await handler({ method: "GET", url: "/", headers: {} }, {});
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "request failed", code: "internal-error" });
});
