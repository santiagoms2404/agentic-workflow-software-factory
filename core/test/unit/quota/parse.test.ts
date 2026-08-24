import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseQuotaReadout, type QuotaProviderReadout } from "../../../src/quota/parse.ts";

const FIXTURE_ROOT = new URL("../../fixtures/quota-axi/", import.meta.url);
const CAPTURE_NOW = "2026-08-24T20:26:39.429Z";

function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURE_ROOT), "utf8");
}

function provider(readout: { providers: readonly QuotaProviderReadout[] }, name: string): QuotaProviderReadout {
  const found = readout.providers.find((candidate) => candidate.provider === name);
  assert.ok(found, `fixture had no ${name} provider`);
  return found;
}

function mutableFixture(name = "nominal.json"): { providers: Array<Record<string, unknown>> } {
  return JSON.parse(fixture(name)) as { providers: Array<Record<string, unknown>> };
}

test("nominal quota is read from effective availability and its named binding windows", () => {
  const { readout, faults } = parseQuotaReadout(fixture("nominal.json"), CAPTURE_NOW);
  assert.deepEqual(faults, []);

  const claude = provider(readout, "claude").scopes[0];
  assert.equal(claude?.scope, "all_models");
  assert.equal(claude?.effectivePercentRemaining, 33);
  assert.equal(claude?.minutesToReset, 2314);

  const codex = provider(readout, "codex").scopes[0];
  assert.equal(codex?.effectivePercentRemaining, 66);
  assert.equal(codex?.minutesToReset, 8833);
});

test("raw windows cannot override the effective figure", () => {
  const { readout, faults } = parseQuotaReadout(fixture("derived-windows-disagree.json"), CAPTURE_NOW);
  assert.deepEqual(faults, []);
  const claude = provider(readout, "claude").scopes[0];
  assert.equal(claude?.effectivePercentRemaining, 4);
  assert.notEqual(claude?.effectivePercentRemaining, 92);
  assert.equal(claude?.minutesToReset, 2314);
});

test("now is injected: two pinned instants against one fixture produce two minute figures", () => {
  assert.equal(parseQuotaReadout.length, 2, "the parser accepts rawText and now only");
  const first = parseQuotaReadout(fixture("nominal.json"), CAPTURE_NOW);
  const second = parseQuotaReadout(fixture("nominal.json"), "2026-08-24T21:26:39.429Z");
  assert.equal(provider(first.readout, "claude").scopes[0]?.minutesToReset, 2314);
  assert.equal(provider(second.readout, "claude").scopes[0]?.minutesToReset, 2254);
});

test("state and semantic statuses structurally withhold stale and unresolved figures", () => {
  const stale = parseQuotaReadout(fixture("derived-stale.json"), CAPTURE_NOW);
  assert.deepEqual(stale.faults, []);
  for (const item of stale.readout.providers) {
    assert.equal(item.stateStatus, "stale");
    assert.equal(item.quotaSemanticsStatus, "unknown");
    assert.equal(item.scopes[0]?.effectivePercentRemaining, null);
    assert.equal(item.scopes[0]?.minutesToReset, null);
  }

  const partial = parseQuotaReadout(fixture("derived-semantics-partial.json"), CAPTURE_NOW);
  assert.deepEqual(partial.faults, []);
  const claude = provider(partial.readout, "claude");
  assert.equal(claude.stateStatus, "fresh");
  assert.equal(claude.quotaSemanticsStatus, "partial");
  assert.equal(claude.scopes[0]?.effectivePercentRemaining, null);
  assert.equal(claude.scopes[0]?.minutesToReset, null);
  assert.equal(provider(partial.readout, "codex").scopes[0]?.minutesToReset, 8833);
});

test("unknown runway has a known effective figure and null minutes", () => {
  const { readout, faults } = parseQuotaReadout(fixture("derived-runway-unknown.json"), CAPTURE_NOW);
  assert.deepEqual(faults, []);
  const claude = provider(readout, "claude").scopes[0];
  assert.equal(claude?.effectivePercentRemaining, 33);
  assert.equal(claude?.minutesToReset, null);
});

test("reported zero remains data and is not confused with an unknown minute figure", () => {
  const { readout, faults } = parseQuotaReadout(fixture("derived-exhausted-now.json"), CAPTURE_NOW);
  assert.deepEqual(faults, []);
  const claude = provider(readout, "claude").scopes[0];
  assert.equal(claude?.effectivePercentRemaining, 0);
  assert.equal(claude?.minutesToReset, 2314);
  const codex = provider(readout, "codex").scopes[0];
  assert.equal(codex?.effectivePercentRemaining, 0);
  assert.equal(codex?.minutesToReset, 8833);
});

test("an auth-required state retains its reason and remedy without inventing a window", () => {
  const { readout, faults } = parseQuotaReadout(fixture("derived-state-unauthenticated.json"), CAPTURE_NOW);
  assert.deepEqual(faults, []);
  for (const item of readout.providers) {
    assert.equal(item.stateStatus, "auth_required");
    assert.equal(item.quotaSemanticsStatus, "unknown");
    assert.equal(item.reason, "credentials_unavailable");
    assert.equal(item.remedy, "authenticate the provider");
    assert.deepEqual(item.scopes, []);
  }
});

test("not-JSON and non-object JSON return faults and an unavailable record", () => {
  for (const raw of ["not json", "[]", "null"]) {
    const result = parseQuotaReadout(raw, CAPTURE_NOW);
    assert.ok(result.faults.length > 0, raw);
    assert.deepEqual(result.readout, { providers: [] });
  }
});

test("a missing quotaSemantics object returns a provider-level unavailable record", () => {
  const raw = mutableFixture();
  delete raw.providers[0]?.["quotaSemantics"];
  const result = parseQuotaReadout(JSON.stringify(raw), CAPTURE_NOW);
  assert.match(result.faults.join("\n"), /quotaSemantics was not an object/);
  const claude = provider(result.readout, "claude");
  assert.equal(claude.quotaSemanticsStatus, null);
  assert.deepEqual(claude.scopes, []);
});

test("a non-numeric effective percentage is faulted and never becomes zero", () => {
  const raw = mutableFixture();
  const semantics = raw.providers[0]?.["quotaSemantics"] as Record<string, unknown>;
  const availability = semantics["effectiveAvailability"] as Array<Record<string, unknown>>;
  if (availability[0] !== undefined) availability[0]["effectivePercentRemaining"] = "33";

  const result = parseQuotaReadout(JSON.stringify(raw), CAPTURE_NOW);
  assert.match(result.faults.join("\n"), /effectivePercentRemaining.*not a percentage/);
  const scope = provider(result.readout, "claude").scopes[0];
  assert.equal(scope?.effectivePercentRemaining, null);
  assert.equal(scope?.minutesToReset, null);
});

test("every malformed field encountered is reported in one pass", () => {
  const raw = mutableFixture();
  const claude = raw.providers[0];
  if (claude !== undefined) {
    claude["provider"] = 4;
    claude["windows"] = "not windows";
    const state = claude["state"] as Record<string, unknown>;
    state["status"] = 5;
    state["reason"] = false;
    const semantics = claude["quotaSemantics"] as Record<string, unknown>;
    semantics["effectiveAvailability"] = "not availability";
  }

  const result = parseQuotaReadout(JSON.stringify(raw), CAPTURE_NOW);
  assert.equal(result.faults.length, 5, result.faults.join("\n"));
  assert.equal(provider(result.readout, "codex").scopes[0]?.effectivePercentRemaining, 66);
});

test("the parser source has no clock, filesystem, process, or exit-code input", () => {
  const source = readFileSync(new URL("../../../src/quota/parse.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:fs|child_process)/);
  assert.doesNotMatch(source, /\bDate\.now\s*\(/);
  assert.doesNotMatch(source, /\b(?:spawn|exitCode)\b/);
});
