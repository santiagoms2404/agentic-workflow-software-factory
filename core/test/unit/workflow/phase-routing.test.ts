import assert from "node:assert/strict";
import { test } from "node:test";

import { EXTERNAL_HARNESS_FINDINGS } from "../../../src/adapters/evaluations.ts";
import { validConfig } from "../config/fixture.ts";
import {
  InvalidPhaseRouteSelection,
  effectivePhaseRoute,
  requestedPhaseRoute,
  retainedRolePolicy,
  routeSelectionProvenance,
} from "../../../src/workflow/phase-routing.ts";

const INFO = {
  adapter: "claude-code",
  provider: "anthropic",
  requestedModel: "opus",
  contextWindow: null,
  supportsThinking: true,
  supportsTools: true,
  supportsImages: true,
  continuity: "same-session-correction" as const,
  usageAuthority: "provider" as const,
  costAuthority: "unavailable" as const,
};

test("a phase route changes only model, effort, and an explicit adapter/provider pair", () => {
  const config = validConfig();
  const role = config.agents[0]!;
  config.routing.phase_routes = {
    builder: {
      adapter: "claude",
      provider: "anthropic",
      model: "claude:opus",
      effort: "max",
      evaluation: {
        summary: "This finding is scoped to the builder phase.",
        sources: [{
          kind: "observed-run",
          title: "Builder fixture",
          publisher: "AWSF host",
          url: "https://example.invalid/evidence/builder",
          checked_at: "2026-09-04",
        }],
      },
    },
  };

  const selected = requestedPhaseRoute(config, "builder", role);
  assert.equal(selected.agent.model, "claude:opus");
  assert.equal(selected.agent.thinking, "max");
  assert.equal(selected.agent.harness.adapter, "claude");
  assert.equal(retainedRolePolicy(selected.policy, selected.agent), true);
  assert.strictEqual(selected.agent.prompt, role.prompt);
  assert.strictEqual(selected.agent.tools, role.tools);
  assert.strictEqual(selected.agent.writes, role.writes);
  assert.equal(selected.requested.sources.model, "phase-override");
  assert.equal(selected.requested.evaluation?.sources.length, 1);

  const effective = effectivePhaseRoute(selected.requested, "claude-code", INFO);
  assert.deepEqual(effective, {
    adapterId: "claude",
    adapterKind: "claude-code",
    provider: "anthropic",
    model: "opus",
    effort: "max",
  });
});

test("an adapter provider label is not enforced without an explicit phase provider override", () => {
  const config = validConfig();
  config.adapters.codex!.provider = "stale-quota-label";

  const selected = requestedPhaseRoute(config, "builder", config.agents[0]!);
  assert.equal(selected.requested.provider, null);
  assert.equal(selected.requested.sources.provider, "unspecified");
  assert.doesNotThrow(() => effectivePhaseRoute(selected.requested, "codex", {
    ...INFO,
    adapter: "codex",
    provider: "openai-codex",
    requestedModel: "gpt-5.6-sol",
  }));
});

test("the guard compares a pre-routing snapshot, so a shared nested object cannot hide a change", () => {
  const config = validConfig();
  const role = config.agents[0]!;
  const selected = requestedPhaseRoute(config, "builder", role);

  // The routed agent is a spread of the role, so it SHARES these objects. Only
  // the snapshot is independent, and only that independence lets the guard see
  // a mutation reachable from both of the objects it would otherwise compare.
  assert.strictEqual(selected.agent.tools, role.tools);
  assert.notStrictEqual(selected.policy.tools, role.tools);
  assert.equal(retainedRolePolicy(selected.policy, selected.agent), true);

  role.tools.allow = [...role.tools.allow, "undeclared-tool"];
  assert.equal(retainedRolePolicy(selected.policy, selected.agent), false);
});

test("the guard covers every non-route field, including ones an enumerated list omitted", () => {
  const config = validConfig();
  const selected = requestedPhaseRoute(config, "builder", config.agents[0]!);

  // `name` was never one of the six fields the guard used to compare; stating
  // the retained policy as the complement of the routable fields covers it,
  // and covers whatever `AgentDefinition` gains next, without a new line here.
  assert.equal(retainedRolePolicy(selected.policy, { ...selected.agent, name: "builder-shadow" }), false);
  assert.equal(retainedRolePolicy(selected.policy, { ...selected.agent, purpose: "something else" }), false);

  // The three routable fields are exactly what the guard must NOT object to.
  assert.equal(
    retainedRolePolicy(selected.policy, {
      ...selected.agent,
      model: "claude:opus",
      thinking: "low",
      harness: { ...selected.agent.harness, adapter: "stub" },
    }),
    true,
  );
});

test("explicit provider disagreement is refused during route preflight", () => {
  const config = validConfig();
  config.routing.phase_routes = {
    builder: { adapter: "claude", provider: "not-anthropic", model: "claude:opus" },
  };
  const selected = requestedPhaseRoute(config, "builder", config.agents[0]!);
  assert.throws(
    () => effectivePhaseRoute(selected.requested, "claude-code", INFO),
    (error: Error) => error instanceof InvalidPhaseRouteSelection && /explicit provider/.test(error.message),
  );
});

test("same-provider review provenance is explicit and visibly degraded", () => {
  const config = validConfig();
  const selected = requestedPhaseRoute(config, "reviewer", config.agents[1]!);
  const effective = effectivePhaseRoute(selected.requested, "claude-code", INFO);
  const route = routeSelectionProvenance({
    requested: selected.requested,
    effective,
    reviewMode: "same-provider-degraded",
  });
  assert.equal(route.review.mode, "same-provider-degraded");
  assert.equal(route.review.degraded, true);
  assert.match(route.review.detail ?? "", /explicit same-provider.*reduced independence.*not selected as fallback/);
});

test("OpenClaw and Hermes discovery findings cite official sources and admit no adapter", () => {
  assert.deepEqual(EXTERNAL_HARNESS_FINDINGS.map((row) => row.harness), ["openclaw", "hermes-agent"]);
  for (const row of EXTERNAL_HARNESS_FINDINGS) {
    assert.equal(row.disposition, "not-an-awsf-route");
    assert.ok(row.evaluation.sources.length > 0);
    assert.ok(row.evaluation.sources.every((source) => source.kind === "official-documentation"));
    assert.ok(row.evaluation.sources.every((source) => {
      const host = new URL(source.url).hostname;
      return host === "github.com" && (source.url.includes("/openclaw/") || source.url.includes("/NousResearch/"));
    }));
    assert.equal("score" in row.evaluation, false, "no global model score is invented");
  }
});
