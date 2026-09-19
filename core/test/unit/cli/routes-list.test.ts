// `awsf routes list` — the vocabulary a driving session composes a `--route`
// from, and the two things it must never do: spend, or invent a model name.

import assert from "node:assert/strict";
import { test } from "node:test";

import { routesListCommand } from "../../../src/cli/commands/routes.ts";
import { AGENT_PHASE_IDS } from "../../../src/config/workflow-ids.ts";
import { ROUTE_EFFORT_LEVELS } from "../../../src/config/schema.ts";
import { validConfig } from "../config/fixture.ts";

async function lines(): Promise<readonly string[]> {
  return routesListCommand({
    config: validConfig(),
    providerFor: (adapterId) => Promise.resolve(
      adapterId === "claude" ? "anthropic" : adapterId === "codex" ? "openai-codex" : null,
    ),
  });
}

test("every declared adapter is listed with the provider it reports", async () => {
  const text = (await lines()).join("\n");
  assert.match(text, /claude\s+claude-code\s+anthropic\s+enabled/);
  assert.match(text, /codex\s+pi-codex\s+openai-codex\s+enabled/);
  assert.match(text, /stub\s+fixture/);
});

test("every agent phase id a route may name is listed, with where it runs", async () => {
  const text = (await lines()).join("\n");
  for (const phaseId of AGENT_PHASE_IDS) {
    assert.ok(text.includes(phaseId), `${phaseId} is missing from the listing`);
  }
  assert.match(text, /builder .*build-review/);
  assert.match(text, /reviewer .*simple-sdlc/);
});

test("every effort level is listed with each adapter's own spelling", async () => {
  const text = (await lines()).join("\n");
  for (const level of ROUTE_EFFORT_LEVELS) {
    assert.ok(text.includes(level), `${level} is missing from the listing`);
  }
  // The one that differs, and the reason the table exists at all: pi has a real
  // off switch and the Claude CLI has none.
  assert.match(text, /none\s+low\s+off/);
});

test("the listing states that this CLI keeps no model catalogue, and names the source", async () => {
  const text = (await lines()).join("\n");
  assert.match(text, /keeps no catalogue/);
  assert.match(text, /pi --list-models/);
  assert.match(text, /no enumeration command/, "the adapter that cannot enumerate says so rather than guessing");
});

test("the listing names the review rule and the act that relaxes it", async () => {
  const text = (await lines()).join("\n");
  assert.match(text, /different PROVIDER than the builder/);
  assert.match(text, /two models from/);
  assert.match(text, /awsf degrade-review <task> --reason/);
});

test("a disabled adapter is listed as disabled and offered no enumeration command", async () => {
  const config = validConfig();
  config.adapters.antigravity = { kind: "antigravity", executable: "agy", enabled: false };
  const text = (await routesListCommand({ config, providerFor: () => Promise.resolve(null) })).join("\n");

  assert.match(text, /antigravity.*disabled/);
  const models = text.slice(text.indexOf("Models —"));
  assert.ok(!models.includes("antigravity"), "a disabled adapter has no models to enumerate");
});
