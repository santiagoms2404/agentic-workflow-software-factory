import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REDACTED_VALUE,
  containsCredential,
  scrubCredentialString,
  scrubCredentials,
  scrubJsonText,
} from "../../../src/policy/redaction.ts";

const shapedAccessId = (): string => `AK${"IA"}${"A".repeat(16)}`;
const shapedBearer = (): string => `Bear${"er"} ${"opaque".repeat(6)}`;

test("the shared scrubber catches credential shapes without mutating input", () => {
  const input = {
    safe: "visible",
    nested: [{ output: `failed with ${shapedAccessId()}` }],
    password: "format-not-yet-known",
  };
  const scrubbed = scrubCredentials(input);
  assert.deepEqual(scrubbed, {
    safe: "visible",
    nested: [{ output: REDACTED_VALUE }],
    password: REDACTED_VALUE,
  });
  assert.notEqual(scrubbed, input);
  assert.match(input.nested[0]!.output, /failed with/);
});

test("bearer, JWT, private-key, URL-auth, and vendor token shapes are recognized", () => {
  const candidates = [
    shapedBearer(),
    `ey${"a".repeat(12)}.${"b".repeat(12)}.${"c".repeat(12)}`,
    `-----BEGIN ${"PRIVATE KEY"}-----`,
    `https://${"owner"}:${"passphrase"}@example.invalid/path`,
    `sk-${"x".repeat(20)}`,
  ];
  assert.ok(candidates.every(containsCredential));
  assert.ok(candidates.every((value) => scrubCredentialString(value) === REDACTED_VALUE));
});

test("vendor-key matching requires a word boundary without weakening real key detection", () => {
  const ordinaryIdentifier = [["ta", "sk"].join(""), "owner", "rework"].join("-");
  assert.equal(containsCredential(ordinaryIdentifier), false);
  assert.equal(scrubCredentialString(ordinaryIdentifier), ordinaryIdentifier);

  const key = `${["s", "k"].join("")}-${"x".repeat(20)}`;
  const contexts = [key, ` ${key}`, `"${key}`, `context\n${key}`];
  assert.ok(contexts.every(containsCredential));
});

test("JSON text remains valid JSON and keeps safe siblings", () => {
  const scrubbed = JSON.parse(scrubJsonText(JSON.stringify({ safe: 1, auth_token: shapedAccessId() }))) as Record<string, unknown>;
  assert.deepEqual(scrubbed, { safe: 1, auth_token: REDACTED_VALUE });
});
