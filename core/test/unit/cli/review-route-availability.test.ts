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
