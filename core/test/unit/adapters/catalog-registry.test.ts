import { test } from "node:test";
import assert from "node:assert/strict";
import { AntigravityAdapter } from "../../../src/adapters/antigravity.ts";
import { resolvedIdentity, resolveSelector } from "../../../src/adapters/catalog.ts";
import { registeredAdapter } from "../../../src/adapters/registry.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";

const MODEL_EVENT: NormalizedEvent = {
  kind: "model.resolved",
  seq: 1,
  runId: "run-1",
  hostAt: "2026-08-08T00:00:00.000Z",
  providerAt: null,
  adapter: "claude-code",
  provider: "anthropic",
  requestedModel: "opus",
  resolvedModel: "claude-opus-5",
  provenance: "stream-authoritative",
};

test("catalog resolves only documented family aliases", () => {
  assert.deepEqual(resolveSelector("claude:opus"), {
    alias: "claude",
    adapterKind: "claude-code",
    provider: "anthropic",
    contextWindow: null,
    requestedModel: "opus",
  });
  assert.equal(resolveSelector("opus"), null);
  assert.equal(resolveSelector("unknown:opus"), null);
  assert.equal(resolveSelector("codex:gpt:5"), null);
});

test("resolved identity is stream evidence or honestly unknown", () => {
  assert.deepEqual(resolvedIdentity([]), { resolvedModel: "unknown", provenance: "unknown" });
  assert.deepEqual(resolvedIdentity([MODEL_EVENT]), {
    resolvedModel: "claude-opus-5",
    provenance: "stream-authoritative",
  });
});

test("registry selects reviewed adapters and respects config disablement", () => {
  const adapters = {
    claude: { kind: "claude-code", executable: "claude" },
    agy: { kind: "antigravity", executable: "agy", enabled: false },
  } as const;
  assert.equal(registeredAdapter(adapters, "claude")?.id, "claude-code");
  assert.equal(registeredAdapter(adapters, "agy"), null);
  assert.equal(registeredAdapter(adapters, "missing"), null);
});

test("Antigravity remains explicitly blocked until raw output is reviewed", async () => {
  const availability = await new AntigravityAdapter().isAvailable();
  assert.deepEqual(availability.status, "blocked");
  assert.equal(availability.code, "E_ADAPTER_UNVERIFIED");
});
