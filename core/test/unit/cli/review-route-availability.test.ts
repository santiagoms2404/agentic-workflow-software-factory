// Selection and availability are two different questions about a review route.
//
// `awsf rework` validates the review SELECTION before the owner confirms, so a
// T2 rework cannot spend a builder call on a review that could never have been
// bought. Availability is not part of that question: the review does not launch
// for minutes, the runner grants it a transport retry, and the worker route is
// deliberately never probed for the same reason. These tests hold the two
// apart — the selection checks still refuse, the availability probe does not.

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";

import type { Availability, HarnessAdapter, ModelInfo, ProcessSpec } from "../../../src/adapters/interface.ts";
import type { AdapterEntry, AwsfConfig } from "../../../src/config/schema.ts";
import { resolveReviewRoute, type ReviewPhaseInfrastructure } from "../../../src/cli/commands/review-phase.ts";
import { ProductionRouteUnavailable } from "../../../src/cli/commands/production-run.ts";
import { InvalidReviewInversion } from "../../../src/workflow/review-routing.ts";
import { workflowRecipe } from "../../../src/workflow/catalog.ts";
import { parseRouteFlags } from "../../../src/workflow/route-flags.ts";
import { validConfig } from "../config/fixture.ts";

const CONFIG_PATH = resolve("awsf.config.yaml");

function modelInfo(adapter: string, provider: string, model: string): ModelInfo {
  return {
    adapter,
    provider,
    requestedModel: model,
    contextWindow: null,
    supportsThinking: true,
    supportsTools: true,
    supportsImages: true,
    continuity: "none",
    usageAuthority: "provider",
    costAuthority: "unavailable",
  };
}

interface Probe {
  readonly availabilityAsks: string[];
}

/** Adapters that answer, and count, every availability question they are asked. */
function infrastructureFor(availability: Availability, probe: Probe): ReviewPhaseInfrastructure {
  const adapters: Record<string, { kind: string; provider: string }> = {
    claude: { kind: "claude-code", provider: "anthropic" },
    codex: { kind: "pi-codex", provider: "openai-codex" },
  };
  return {
    adapterFor(_entry: AdapterEntry, adapterId: string): HarnessAdapter | null {
      const shape = adapters[adapterId];
      if (shape === undefined) return null;
      return {
        id: shape.kind,
        isAvailable: (): Promise<Availability> => {
          probe.availabilityAsks.push(adapterId);
          return Promise.resolve(availability);
        },
        getModelInfo: (model: string): Promise<ModelInfo> =>
          Promise.resolve(modelInfo(shape.kind, shape.provider, model)),
        buildSpec: (): ProcessSpec => {
          throw new Error("no process is built while a route is only being resolved");
        },
        parse: (): AsyncIterable<never> => {
          throw new Error("no stream is parsed while a route is only being resolved");
        },
        execute: (): never => {
          throw new Error("no turn is executed while a route is only being resolved");
        },
      };
    },
    createBroker: () => {
      throw new Error("no broker is created while a route is only being resolved");
    },
    writeSystemPrompt: () => Promise.reject(new Error("no system prompt is materialized here")),
    now: () => "2026-09-10T00:00:00.000Z",
  };
}

function routeOptions(config: AwsfConfig, probe: Probe, availability: Availability) {
  return {
    config,
    configPath: CONFIG_PATH,
    infra: infrastructureFor(availability, probe),
    recipe: workflowRecipe("build-review")!,
    reviewPhaseId: "reviewer",
    workerProvider: "openai-codex",
  };
}

const BLOCKED: Availability = { status: "blocked", code: "E_NOT_LOGGED_IN", detail: "the reviewer CLI is not logged in" };
const AVAILABLE: Availability = { status: "available" };

test("a review about to launch is refused when its route is unavailable", async () => {
  const probe: Probe = { availabilityAsks: [] };
  await assert.rejects(
    resolveReviewRoute(routeOptions(validConfig(), probe, BLOCKED)),
    (error: Error) => error instanceof ProductionRouteUnavailable && /not logged in/.test(error.message),
  );
  assert.deepEqual(probe.availabilityAsks, ["claude"], "the reviewer route is the only one asked");
});

test("selection-only resolution never asks whether the reviewer is available", async () => {
  const probe: Probe = { availabilityAsks: [] };
  const route = await resolveReviewRoute({ ...routeOptions(validConfig(), probe, BLOCKED), requireAvailable: false });

  assert.deepEqual(probe.availabilityAsks, [], "an outage now says nothing about an outage minutes from now");
  assert.equal(route.adapterId, "claude");
  assert.equal(route.model.provider, "anthropic");
  assert.equal(route.provenance.review.mode, "invert-provider");
});

test("selection-only resolution still refuses a review that cannot invert the worker", async () => {
  const probe: Probe = { availabilityAsks: [] };
  const config = validConfig();
  // The reviewer is moved onto the builder's provider without the explicit
  // degraded mode. Dropping the availability probe must not drop this.
  config.routing.phase_routes = { reviewer: { adapter: "codex", provider: "openai-codex" } };

  await assert.rejects(
    resolveReviewRoute({ ...routeOptions(config, probe, AVAILABLE), requireAvailable: false }),
    (error: Error) => error instanceof InvalidReviewInversion,
  );
  assert.deepEqual(probe.availabilityAsks, []);
});

test("selection-only resolution still refuses a reviewer whose role policy is unsound", async () => {
  const probe: Probe = { availabilityAsks: [] };
  const config = validConfig();
  config.agents[1]!.harness.continuity = "same-session";

  await assert.rejects(
    resolveReviewRoute({ ...routeOptions(config, probe, AVAILABLE), requireAvailable: false }),
    /this review is cold/,
  );
  assert.deepEqual(probe.availabilityAsks, []);
});

// ---------------------------------------------------------------------------
// The attempt's own grant, and the rule it is allowed to relax.
//
// `schema.ts` states the invariant these hold: same-provider review "is never
// selected from availability, quota, or a transport failure." The grant is the
// only other way in, it can only ever be set by `awsf degrade-review`, and it
// reaches this resolution as a boolean read from attempt state.
// ---------------------------------------------------------------------------

test("without the grant, a reviewer on the builder's provider is refused", async () => {
  const probe: Probe = { availabilityAsks: [] };
  const config = validConfig();
  config.routing.phase_routes = { reviewer: { adapter: "codex", provider: "openai-codex" } };

  // The route surface has collapsed to one provider, so the refusal comes from
  // the pair itself rather than from comparing two of them.
  await assert.rejects(
    resolveReviewRoute(routeOptions(config, probe, AVAILABLE)),
    (error: Error) => error instanceof InvalidReviewInversion &&
      /exactly two distinct providers.*found 1 \(openai-codex\)/.test(error.message),
  );
});

test("the attempt's grant permits exactly that route, and marks it degraded", async () => {
  const probe: Probe = { availabilityAsks: [] };
  const config = validConfig();
  config.routing.phase_routes = { reviewer: { adapter: "codex", provider: "openai-codex" } };

  const route = await resolveReviewRoute({ ...routeOptions(config, probe, AVAILABLE), degraded: true });

  assert.equal(route.model.provider, "openai-codex", "the same provider the worker ran on");
  assert.equal(route.provenance.review.mode, "same-provider-degraded");
  assert.equal(route.provenance.review.degraded, true);
  assert.match(route.provenance.review.detail ?? "", /requested in durable config and was not selected as fallback/);
});

test("the grant relaxes the inversion and nothing else", async () => {
  const probe: Probe = { availabilityAsks: [] };
  const config = validConfig();
  // A degraded review is still a review: it may not write, and it may not be
  // resumed from a prior verdict.
  config.agents[1]!.writes = ["core/src/**"];

  await assert.rejects(
    resolveReviewRoute({ ...routeOptions(config, probe, AVAILABLE), degraded: true }),
    /a reviewer that can write is not a reviewer/,
  );
});

test("a degraded grant on an already-inverted route leaves the pair refused", async () => {
  const probe: Probe = { availabilityAsks: [] };
  // The reviewer stays on anthropic while the worker ran on openai-codex, so
  // the explicit degraded mode is the one that now disagrees with the route.
  await assert.rejects(
    resolveReviewRoute({ ...routeOptions(validConfig(), probe, AVAILABLE), degraded: true }),
    (error: Error) => error instanceof InvalidReviewInversion && /requires reviewer and worker on "openai-codex"/.test(error.message),
  );
});

test("attempt routes reach the reviewer resolution, not just the configured ones", async () => {
  const probe: Probe = { availabilityAsks: [] };
  const route = await resolveReviewRoute({
    ...routeOptions(validConfig(), probe, AVAILABLE),
    routeOverrides: parseRouteFlags(["reviewer=claude/anthropic/claude:opus@max"]),
  });

  assert.equal(route.agent.model, "claude:opus");
  assert.equal(route.provenance.effective.effort, "max");
  assert.equal(route.provenance.requested.sources.model, "attempt-override");
});
