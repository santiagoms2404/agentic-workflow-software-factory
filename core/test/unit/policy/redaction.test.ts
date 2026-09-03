import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REDACTED_VALUE,
  containsCredential,
  scrubCredentialString,
  scrubCredentials,
  scrubJsonText,
} from "../../../src/policy/redaction.ts";
import { globalCredentialPattern } from "../../../../dashboard/shared/credential-patterns.ts";

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
    nested: [{ output: `failed with ${REDACTED_VALUE}` }],
    password: REDACTED_VALUE,
  });
  assert.notEqual(scrubbed, input);
  assert.match(input.nested[0]!.output, /failed with/);
});

test("bearer, JWT, private-key, URL-auth, and vendor token shapes are recognized", () => {
  const boundary = "-".repeat(5);
  const privateKeyLabel = ["PRIVATE", "KEY"].join(" ");
  const beginMarker = [boundary, "BE", "GIN ", privateKeyLabel, boundary].join("");
  const urlCredential = `https://${"owner"}:${"passphrase"}@example.invalid/path`;
  const candidates = [
    shapedBearer(),
    `ey${"a".repeat(12)}.${"b".repeat(12)}.${"c".repeat(12)}`,
    beginMarker,
    urlCredential,
    `sk-${"x".repeat(20)}`,
  ];
  assert.ok(candidates.every(containsCredential));
  assert.ok(candidates.every((value) => scrubCredentialString(value) !== value));
  assert.equal(scrubCredentialString(urlCredential), `${REDACTED_VALUE}example.invalid/path`);
  assert.equal(scrubCredentialString(urlCredential).includes("passphrase"), false);
});

test("scrubbing masks every matched span while preserving ordinary text", () => {
  const firstCredential = shapedAccessId();
  const secondCredential = `AK${"IA"}${"B".repeat(16)}`;
  const oneCredential = `before ${firstCredential} after`;
  const twoCredentials = `before ${firstCredential} between ${secondCredential} after`;
  const safe = "ordinary prose without a credential";

  assert.equal(scrubCredentialString(oneCredential), `before ${REDACTED_VALUE} after`);
  assert.equal(
    scrubCredentialString(twoCredentials),
    `before ${REDACTED_VALUE} between ${REDACTED_VALUE} after`,
  );
  assert.notEqual(scrubCredentialString(oneCredential), oneCredential);
  assert.equal(scrubCredentialString(safe), safe);
});

test("private-key blocks are scrubbed through their matching end or input end", () => {
  const boundary = "-".repeat(5);
  const privateKeyLabel = ["PRIVATE", "KEY"].join(" ");
  const beginMarker = [boundary, "BE", "GIN ", privateKeyLabel, boundary].join("");
  const endMarker = [boundary, "E", "ND ", privateKeyLabel, boundary].join("");
  const body = "BODY_BYTES_MUST_BE_REMOVED";
  const block = [beginMarker, body, endMarker].join("\n");
  const completeOutput = scrubCredentialString(`before ${block} after`);
  const unterminatedOutput = scrubCredentialString([beginMarker, body].join("\n"));

  assert.equal(completeOutput, `before ${REDACTED_VALUE} after`);
  assert.equal(completeOutput.includes(body), false);
  assert.equal(unterminatedOutput, REDACTED_VALUE);
  assert.equal(unterminatedOutput.includes(body), false);
});

test("global pattern derivation preserves flags without duplicating the global flag", () => {
  assert.equal(globalCredentialPattern(/ordinary/i).flags, "gi");
  assert.doesNotThrow(() => globalCredentialPattern(/ordinary/g));
  assert.equal(globalCredentialPattern(/ordinary/gi).flags, "gi");
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
