// `--route <phase>=<adapter>/<provider>/<model>@<effort>` — the grammar, its
// refusals, and the courtesy warning that must never guess.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RouteFlagDuplicated,
  RouteFlagInvalid,
  RouteFlagPhaseNotRouted,
  assertRoutesReachWorkflow,
  formatRouteOverride,
  parseRouteFlag,
  parseRouteFlags,
  predictSameProviderReview,
  predictSameProviderReviewFor,
  routablePhaseIds,
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

test("a shift phase has no routable id of its own, so it is routed as the role that owns it", () => {
  const config = validConfig();
  const overrides = parseRouteFlags(["builder=claude/anthropic/claude:opus@xhigh", "reviewer=claude/anthropic/claude:opus@high"]);
  const build = requestedPhaseRoute(config, "t01-build", config.agents[0]!, overrides);
  assert.equal(build.agent.harness.adapter, "claude");
  assert.equal(build.agent.model, "claude:opus");
  assert.equal(build.agent.thinking, "xhigh");
  assert.equal(build.requested.provider, "anthropic");
  assert.equal(build.requested.phaseId, "t01-build", "provenance still names the phase that ran");
  assert.equal(build.requested.sources.model, "attempt-override");
  const review = requestedPhaseRoute(config, "shift-review", config.agents[1]!, overrides);
  assert.equal(review.requested.provider, "anthropic");
  assert.equal(review.agent.thinking, "high");
});

test("the project's configured role route reaches shift phases as well", () => {
  const config = validConfig();
  config.routing.phase_routes = {
    builder: { adapter: "claude", provider: "anthropic", model: "claude:sonnet", effort: "medium" },
  };
  const build = requestedPhaseRoute(config, "t02-build", config.agents[0]!);
  assert.equal(build.agent.model, "claude:sonnet");
  assert.equal(build.requested.sources.model, "phase-override");
});

test("an entry under the exact phase id outranks its role's route", () => {
  const config = validConfig();
  const overrides = { builder: { model: "claude:opus" }, "t01-build": { model: "claude:sonnet" } };
  assert.equal(requestedPhaseRoute(config, "t01-build", config.agents[0]!, overrides).agent.model, "claude:sonnet");
  assert.equal(requestedPhaseRoute(config, "t02-build", config.agents[0]!, overrides).agent.model, "claude:opus");
});

test("a shipped phase id never borrows its role's route", () => {
  // design-to-plan's `plan` phase is owned by the planner, but `plan` is a
  // routable id of its own, so a `planner` entry does not reach it.
  const config = validConfig();
  const planner = { ...config.agents[0]!, name: "planner" };
  const selected = requestedPhaseRoute(config, "plan", planner, parseRouteFlags(["planner=@max"]));
  assert.equal(selected.agent.thinking, planner.thinking);
  assert.equal(selected.requested.sources.effort, "agent-default");
});

test("a route the workflow never reads is refused before the attempt exists", () => {
  assert.deepEqual(routablePhaseIds("shift"), ["builder", "reviewer"]);
  assert.deepEqual(routablePhaseIds("build-review"), ["builder", "reviewer"]);
  assert.equal(routablePhaseIds("no-such-workflow"), null);
  assert.throws(() => assertRoutesReachWorkflow(parseRouteFlags(["planner=@high"]), "shift"), RouteFlagPhaseNotRouted);
  assert.throws(() => assertRoutesReachWorkflow(parseRouteFlags(["reviewer=@high"]), "build"), /recorded and never applied/);
  assert.doesNotThrow(() => assertRoutesReachWorkflow(parseRouteFlags(["builder=@high", "reviewer=@high"]), "shift"));
  assert.doesNotThrow(() => assertRoutesReachWorkflow(parseRouteFlags(["builder=@high", "reviewer=@high"]), "build-review"));
});

test("the same-provider notice reaches a shift, read under the role keys it routes by", () => {
  const config = validConfig();
  const both = parseRouteFlags(["builder=claude/anthropic/claude:opus@xhigh", "reviewer=claude/anthropic/claude:opus@high"]);
  assert.deepEqual(predictSameProviderReviewFor(config, both, "shift"), {
    reviewPhaseId: "reviewer",
    workerPhaseId: "builder",
    provider: "anthropic",
  });
  assert.equal(predictSameProviderReviewFor(config, parseRouteFlags(["builder=claude/anthropic/claude:opus"]), "shift"), null);
  assert.deepEqual(predictSameProviderReviewFor(config, both, "build-review"), predictSameProviderReview(config, both, workflowRecipe("build-review")!));
  assert.equal(predictSameProviderReviewFor(config, both, "build"), null);
});
