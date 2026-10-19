import assert from "node:assert/strict";
import { test } from "node:test";

import type { RouteEvaluation } from "../../../src/contracts/route-selection.ts";
import { requestedPhaseRoute, retainedRolePolicy } from "../../../src/workflow/phase-routing.ts";
import { parseRouteFlags } from "../../../src/workflow/route-flags.ts";
import { validConfig } from "../config/fixture.ts";

function evaluatedConfig() {
  const config = validConfig();
  const evaluation: RouteEvaluation = {
    summary: "Opus measured on the builder suite at high effort.",
    sources: [{
      kind: "observed-run",
      title: "Builder route evidence",
      publisher: "AWSF host",
      url: "https://example.invalid/evidence/builder",
      checked_at: "2026-09-04",
    }],
  };
  config.routing.phase_routes = {
    builder: { adapter: "claude", provider: "anthropic", model: "claude:opus", effort: "high", evaluation },
  };
  return { config, evaluation };
}

test("B6-04: a changed model cannot inherit the configured route evaluation", () => {
  const { config, evaluation } = evaluatedConfig();
  const before = structuredClone(config);
  const selected = requestedPhaseRoute(config, "builder", config.agents[0]!, parseRouteFlags(["builder=claude:haiku"]));

  assert.equal(selected.requested.model, "claude:haiku");
  assert.equal(selected.requested.sources.model, "attempt-override");
  assert.equal(selected.requested.evaluation, null, "changed model must not carry the configured route's evaluation");
  assert.equal(selected.agent.model, "claude:haiku");
  assert.equal(retainedRolePolicy(selected.policy, selected.agent), true);
  assert.strictEqual(config.routing.phase_routes!.builder!.evaluation, evaluation);
  assert.deepEqual(config, before, "routing must not mutate durable configuration");
});

for (const [name, flag, field, expected] of [
  ["effort", "builder=@max", "effort", "max"],
  ["adapter", "builder=stub/anthropic/", "adapterId", "stub"],
  ["provider with the same adapter", "builder=claude/other-provider/", "provider", "other-provider"],
] as const) {
  test(`B6-04: changing ${name} invalidates evaluation without changing other route policy`, () => {
    const { config } = evaluatedConfig();
    const selected = requestedPhaseRoute(config, "builder", config.agents[0]!, parseRouteFlags([flag]));
    assert.equal(selected.requested[field], expected);
    assert.equal(selected.requested.evaluation, null);
    assert.equal(selected.requested.model, "claude:opus");
    assert.equal(retainedRolePolicy(selected.policy, selected.agent), true);
  });
}

for (const [name, flags] of [
  ["no attempt override", []],
  ["an unrelated phase override", ["reviewer=@max"]],
  ["the same model", ["builder=claude:opus"]],
  ["the same effort", ["builder=@high"]],
  ["the same adapter/provider pair", ["builder=claude/anthropic/"]],
  ["the complete identical route", ["builder=claude/anthropic/claude:opus@high"]],
] as const) {
  test(`B6-04: ${name} retains the configured evaluation`, () => {
    const { config, evaluation } = evaluatedConfig();
    const selected = requestedPhaseRoute(config, "builder", config.agents[0]!, parseRouteFlags(flags));
    assert.strictEqual(selected.requested.evaluation, evaluation);
    assert.equal(selected.requested.model, "claude:opus");
    assert.equal(selected.requested.effort, "high");
    assert.equal(selected.requested.adapterId, "claude");
    assert.equal(selected.requested.provider, "anthropic");
    assert.equal(retainedRolePolicy(selected.policy, selected.agent), true);
  });
}

test("B6-04: omitted configured values are compared against role defaults", () => {
  const { config, evaluation } = evaluatedConfig();
  config.routing.phase_routes = { builder: { model: "claude:opus", evaluation } };
  const role = config.agents[0]!;
  const unchanged = requestedPhaseRoute(config, "builder", role, parseRouteFlags(["builder=@high"]));
  assert.strictEqual(unchanged.requested.evaluation, evaluation);
  assert.equal(unchanged.requested.sources.effort, "attempt-override");
  assert.equal(unchanged.requested.provider, null, "adapter labels are not provider assertions");
  assert.equal(unchanged.requested.adapterId, role.harness.adapter);

  const changed = requestedPhaseRoute(config, "builder", role, parseRouteFlags(["builder=@low"]));
  assert.equal(changed.requested.evaluation, null);
  const explicit = requestedPhaseRoute(config, "builder", role, parseRouteFlags(["builder=codex/openai-codex/"]));
  assert.equal(explicit.requested.provider, "openai-codex");
  assert.equal(explicit.requested.evaluation, null, "a new provider assertion changes the requested identity");
});

test("B6-04: compiled phases use role routes but exact phase overrides still win", () => {
  const { config, evaluation } = evaluatedConfig();
  const role = config.agents[0]!;
  const unchanged = requestedPhaseRoute(config, "t01-build", role, parseRouteFlags(["builder=claude:opus"]));
  assert.strictEqual(unchanged.requested.evaluation, evaluation);
  assert.equal(unchanged.requested.phaseId, "t01-build");
  const changed = requestedPhaseRoute(config, "t01-build", role, parseRouteFlags(["builder=claude:haiku"]));
  assert.equal(changed.requested.evaluation, null);

  config.routing.phase_routes!["t01-build"] = { model: "claude:sonnet", evaluation };
  const exact = requestedPhaseRoute(config, "t01-build", role, {
    builder: { model: "claude:haiku" },
    "t01-build": { model: "claude:sonnet" },
  });
  assert.equal(exact.requested.model, "claude:sonnet");
  assert.strictEqual(exact.requested.evaluation, evaluation, "compare against the selected exact config route");
});

test("B6-04: routes without durable evaluation never acquire attempt evidence", () => {
  const config = validConfig();
  const role = config.agents[0]!;
  assert.equal(requestedPhaseRoute(config, "builder", role).requested.evaluation, null);
  const { evaluation } = evaluatedConfig();
  const selected = requestedPhaseRoute(config, "builder", role, { builder: { model: "claude:opus", evaluation } });
  assert.equal(selected.requested.model, "claude:opus");
  assert.equal(selected.requested.evaluation, null);
});
