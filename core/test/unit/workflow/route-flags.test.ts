// `--route <phase>=<adapter>/<provider>/<model>@<effort>` — the grammar, its
// refusals, and the courtesy warning that must never guess.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RouteFlagDuplicated,
  RouteFlagInvalid,
  formatRouteOverride,
  parseRouteFlag,
  parseRouteFlags,
  predictSameProviderReview,
} from "../../../src/workflow/route-flags.ts";
import { requestedPhaseRoute } from "../../../src/workflow/phase-routing.ts";
import { workflowRecipe } from "../../../src/workflow/catalog.ts";
import { validConfig } from "../config/fixture.ts";

test("a full route names an adapter pair, a model and an effort", () => {
  const parsed = parseRouteFlag("builder=codex/openai-codex/codex:gpt-6-astra@xhigh");
  assert.equal(parsed.phaseId, "builder");
  assert.deepEqual(parsed.selection, {
    adapter: "codex",
    provider: "openai-codex",
    model: "codex:gpt-6-astra",
    effort: "xhigh",
  });
});

test("every part except the phase is optional, so a route may sharpen one value", () => {
  assert.deepEqual(parseRouteFlag("builder=@max").selection, { effort: "max" });
  assert.deepEqual(parseRouteFlag("reviewer=claude:opus").selection, { model: "claude:opus" });
  // A trailing empty model segment keeps the phase's configured model while
  // still moving the route onto a named adapter.
  assert.deepEqual(parseRouteFlag("reviewer=claude/anthropic/").selection, { adapter: "claude", provider: "anthropic" });
});

test("a phase outside the agent-phase list is refused, and the refusal names the list", () => {
  assert.throws(
    () => parseRouteFlag("tests=claude/anthropic/opus"),
    (error: Error) => error instanceof RouteFlagInvalid && /unknown agent phase/.test(error.message) && /builder/.test(error.message),
  );
});

test("a half-explicit pair is refused, exactly as the loader refuses it in config", () => {
  assert.throws(
    () => parseRouteFlag("builder=claude//opus"),
    (error: Error) => error instanceof RouteFlagInvalid && /half-explicit/.test(error.message),
  );
  assert.throws(
    () => parseRouteFlag("builder=claude/anthropic"),
    (error: Error) => error instanceof RouteFlagInvalid && /exactly <adapter>\/<provider>\/<model>/.test(error.message),
  );
});

test("an effort outside the six config levels is refused before any attempt exists", () => {
  assert.throws(
    () => parseRouteFlag("builder=@ultra"),
    (error: Error) => error instanceof RouteFlagInvalid && /no effort level named "ultra"/.test(error.message),
  );
});

test("a route that selects nothing is refused rather than silently recorded", () => {
  assert.throws(() => parseRouteFlag("builder="), RouteFlagInvalid);
  assert.throws(() => parseRouteFlag("builder"), RouteFlagInvalid);
});

test("one phase takes one route", () => {
  assert.throws(
    () => parseRouteFlags(["builder=@max", "builder=claude/anthropic/opus"]),
    (error: Error) => error instanceof RouteFlagDuplicated && error.phaseId === "builder",
  );
  const parsed = parseRouteFlags(["builder=@max", "reviewer=claude/anthropic/opus@high"]);
  assert.deepEqual(Object.keys(parsed), ["builder", "reviewer"]);
});

test("an attempt route outranks the configured phase route, field by field", () => {
  const config = validConfig();
  config.routing.phase_routes = {
    builder: { adapter: "claude", provider: "anthropic", model: "claude:opus", effort: "low" },
  };
  const overrides = parseRouteFlags(["builder=@max"]);
  const selected = requestedPhaseRoute(config, "builder", config.agents[0]!, overrides);

  assert.equal(selected.agent.thinking, "max", "the flag moved the effort");
  assert.equal(selected.agent.model, "claude:opus", "and left the configured model alone");
  assert.equal(selected.agent.harness.adapter, "claude");
  assert.equal(selected.requested.sources.effort, "attempt-override");
  assert.equal(selected.requested.sources.model, "phase-override");
  assert.equal(selected.requested.sources.adapter, "phase-override");
});

test("a flag naming an adapter carries its provider, and neither reaches the route alone", () => {
  const config = validConfig();
  const overrides = parseRouteFlags(["builder=claude/anthropic/claude:sonnet"]);
  const selected = requestedPhaseRoute(config, "builder", config.agents[0]!, overrides);

  assert.equal(selected.agent.harness.adapter, "claude");
  assert.equal(selected.requested.provider, "anthropic");
  assert.equal(selected.requested.sources.provider, "attempt-override");
  assert.equal(selected.requested.sources.effort, "agent-default", "an unnamed effort stays the role's");
});

test("the same-provider warning fires only when BOTH providers are explicit", () => {
  const config = validConfig();
  const recipe = workflowRecipe("build-review")!;

  const collapsed = predictSameProviderReview(
    config,
    parseRouteFlags(["builder=claude/anthropic/claude:sonnet", "reviewer=claude/anthropic/claude:opus"]),
    recipe,
  );
  assert.deepEqual(collapsed, { reviewPhaseId: "reviewer", workerPhaseId: "builder", provider: "anthropic" });

  // Two providers: nothing to warn about.
  assert.equal(
    predictSameProviderReview(config, parseRouteFlags(["builder=claude/anthropic/claude:sonnet"]), recipe),
    null,
    "the reviewer named no provider, and the adapter's config label is not a launch assertion",
  );
  assert.equal(
    predictSameProviderReview(
      config,
      parseRouteFlags(["builder=claude/anthropic/claude:sonnet", "reviewer=codex/openai-codex/gpt-5.5"]),
      recipe,
    ),
    null,
  );
});

test("a workflow that buys no review has no same-provider prediction to make", () => {
  const config = validConfig();
  assert.equal(
    predictSameProviderReview(
      config,
      parseRouteFlags(["builder=claude/anthropic/claude:sonnet"]),
      workflowRecipe("build")!,
    ),
    null,
  );
});

test("a recorded route reads back as the flag that produced it", () => {
  const { phaseId, selection } = parseRouteFlag("reviewer=claude/anthropic/claude:opus@high");
  assert.equal(formatRouteOverride(phaseId, selection), "reviewer=claude/anthropic/claude:opus@high");
  assert.equal(formatRouteOverride("builder", parseRouteFlag("builder=@max").selection), "builder=configured model@max");
});
