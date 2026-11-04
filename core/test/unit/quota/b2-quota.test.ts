import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { loadConfig } from "../../../src/config/load.ts";
import { loadPlacement } from "../../../src/registry/placement.ts";
import {
  buildQuotaReadout,
  renderObservedDurationComparison,
  type ObservedDurationComparison,
} from "../../../src/quota/readout.ts";
import {
  compareNumericVersions,
  probeQuota,
  type QuotaProbeResult,
} from "../../../src/quota/probe.ts";
import {
  resolveProjectQuotaRoutes,
  type ProjectQuotaRoute,
} from "../../../src/quota/routes.ts";

const CONFIG_PATH = new URL("../../../../awsf.config.yaml", import.meta.url);

function minimalConfig(slug = "b2-quota-project") {
  const doc = parseYaml(readFileSync(CONFIG_PATH, "utf8")) as Record<string, any>;
  doc.project.slug = slug;
  doc.adapters = {
    claude: { kind: "pi-codex", executable: "pi" },
    stub: { kind: "fixture" },
  };
  doc.routing.default_worker = "claude";
  for (const agent of doc.agents as Array<Record<string, any>>) {
    agent.harness.adapter = "claude";
  }
  return loadConfig(toYaml(doc));
}

// ---------------------------------------------------------------------------
// 1. B2-30: QuotaProbeFailure construction has clean properties
// ---------------------------------------------------------------------------
test("B2-30: QuotaProbeFailure has no redundant retentionFailed when false", async () => {
  let recordedFailure: any = null;
  const result = await probeQuota({
    resolveExecutable: () => "/test/bin/quota-axi",
    runCommand: () => ({ status: 1, stdout: "garbage", stderr: "error", error: null }),
    routes: [{ provider: "claude" }],
    purpose: "interactive-preflight",
    options: { env: { PATH: "/test/bin" } },
    now: "2026-08-24T20:26:39.429Z",
    journalFailure: (failure) => {
      recordedFailure = failure;
    },
    retainFailureBytes: async () => "raw/quota-test.txt",
  });

  assert.equal(result.availability, "unavailable");
  assert.ok(recordedFailure);
  assert.equal(recordedFailure.reasonCode, "nonzero-exit");
  assert.equal(recordedFailure.retainedPath, "raw/quota-test.txt");
  // retentionFailed should be undefined / absent from keys when retention succeeds
  assert.equal("retentionFailed" in recordedFailure, false);
});

test("B2-30: QuotaProbeFailure sets retentionFailed: true when retain fails", async () => {
  let recordedFailure: any = null;
  const result = await probeQuota({
    resolveExecutable: () => "/test/bin/quota-axi",
    runCommand: () => ({ status: 1, stdout: "garbage", stderr: "error", error: null }),
    routes: [{ provider: "claude" }],
    purpose: "interactive-preflight",
    options: { env: { PATH: "/test/bin" } },
    now: "2026-08-24T20:26:39.429Z",
    journalFailure: (failure) => {
      recordedFailure = failure;
    },
    retainFailureBytes: async () => {
      throw new Error("disk full");
    },
  });

  assert.equal(result.availability, "unavailable");
  assert.ok(recordedFailure);
  assert.equal(recordedFailure.reasonCode, "nonzero-exit");
  assert.equal(recordedFailure.retainedPath, null);
  assert.equal(recordedFailure.retentionFailed, true);
});

// ---------------------------------------------------------------------------
// 2. B2-31: renderObservedDurationComparison() with null minutesToReset
// ---------------------------------------------------------------------------
test("B2-31: renderObservedDurationComparison() renders in words when minutesToReset is null", () => {
  const observation: ObservedDurationComparison = {
    status: "observed",
    durationMinutes: 15,
    count: 7,
  };
  const rendered = renderObservedDurationComparison(null, observation);
  assert.equal(
    rendered,
    "observed duration=unknown (reset unknown, median=15 minutes, count=7)",
  );
  assert.doesNotMatch(rendered, /does not fit/);
});

// ---------------------------------------------------------------------------
// 3. B2-32: thresholdFor() checks Object.hasOwn
// ---------------------------------------------------------------------------
test("B2-32: thresholdFor() does not pick up inherited Object.prototype properties", () => {
  const dummyResult: QuotaProbeResult = {
    availability: "known",
    failure: null,
    readout: { providers: [] },
    parsed: { readout: { providers: [] }, faults: [] },
    resolvedVersion: "0.1.29",
  };

  const route: ProjectQuotaRoute = {
    adapterId: "toString",
    adapterKind: "claude-code",
    disposition: "measurable",
    providers: ["claude"],
    memberKinds: [],
    reason: null,
  };

  const defaultThreshold = { minutes: 120, probe_timeout_ms: 5000 };
  const byAdapter = {};

  const readout = buildQuotaReadout({
    routes: [route],
    probeResult: dummyResult,
    defaultThreshold,
    thresholdsByAdapter: byAdapter,
  });

  assert.equal(readout.rows[0]?.configuredThresholdMinutes, 120);
});

// ---------------------------------------------------------------------------
// 4. B2-33: figureFor() checks disposition === 'unmeasurable' before providers count
// ---------------------------------------------------------------------------
test("B2-33: figureFor() handles unmeasurable route with non-empty providers", () => {
  const dummyResult: QuotaProbeResult = {
    availability: "known",
    failure: null,
    readout: { providers: [] },
    parsed: { readout: { providers: [] }, faults: [] },
    resolvedVersion: "0.1.29",
  };

  // Route that has disposition unmeasurable and 2 providers (e.g. composite containing an unmeasurable member)
  const compositeUnmeasurable: ProjectQuotaRoute = {
    adapterId: "my-composite",
    adapterKind: "composite-fusion",
    disposition: "unmeasurable",
    providers: ["claude", "codex"],
    memberKinds: ["claude-code", "antigravity"],
    reason: "composite-member-unmeasurable",
  };

  const readout = buildQuotaReadout({
    routes: [compositeUnmeasurable],
    probeResult: dummyResult,
    defaultThreshold: null,
  });

  assert.equal(readout.rows[0]?.reasonCode, "composite-member-unmeasurable");
  // Before B2-33, providers.length === 2 would result in 'multiple-providers' instead of 'composite-member-unmeasurable'
  assert.notEqual(readout.rows[0]?.reasonCode, "multiple-providers");
});

// ---------------------------------------------------------------------------
// 5. B2-34: resolveProjectQuotaRoutes() handles empty planSources or missing plans.root
// ---------------------------------------------------------------------------
test("B2-34: resolveProjectQuotaRoutes() handles empty planSources gracefully without assuming planSources[0]", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b2-34-empty-sources-"));
  try {
    const catalogRoot = join(root, "catalog");
    const planRepository = join(root, "declared-plans");
    mkdirSync(catalogRoot, { recursive: true });
    mkdirSync(join(planRepository, "specs"), { recursive: true });
    writeFileSync(join(planRepository, "awsf.config.yaml"), toYaml(minimalConfig("b2-34-project")));

    const catalogPath = join(catalogRoot, "awsf.project.yaml");
    writeFileSync(catalogPath, toYaml({
      version: "awsf.project/v1",
      project: { slug: "b2-34-project" },
      repositories: { plans: { role: "plan", default_branch: "main" } },
      plans: { root: "specs", format: "awsf-plan-html/v1", default: "example" },
    }));
    const placement = loadPlacement(toYaml({
      version: "awsf.placement/v1",
      project: "b2-34-project",
      repositories: { plans: { path: planRepository } },
    }));

    const resolved = await resolveProjectQuotaRoutes({ catalogPath, placement });
    assert.equal(resolved.project, "b2-34-project");
    assert.equal(resolved.planRepositoryPath, planRepository);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-34: resolveProjectQuotaRoutes() handles missing plans root on disk gracefully", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b2-34-missing-root-"));
  try {
    const catalogRoot = join(root, "catalog");
    const planRepository = join(root, "declared-plans");
    mkdirSync(catalogRoot, { recursive: true });
    // Note: planRepository/non-existent-specs is NOT created on disk
    mkdirSync(planRepository, { recursive: true });
    writeFileSync(join(planRepository, "awsf.config.yaml"), toYaml(minimalConfig("b2-34-no-root")));

    const catalogPath = join(catalogRoot, "awsf.project.yaml");
    writeFileSync(catalogPath, toYaml({
      version: "awsf.project/v1",
      project: { slug: "b2-34-no-root" },
      repositories: { plans: { role: "plan", default_branch: "main" } },
      plans: { root: "non-existent-specs", format: "awsf-plan-html/v1", default: "example" },
    }));
    const placement = loadPlacement(toYaml({
      version: "awsf.placement/v1",
      project: "b2-34-no-root",
      repositories: { plans: { path: planRepository } },
    }));

    const resolved = await resolveProjectQuotaRoutes({ catalogPath, placement });
    assert.equal(resolved.project, "b2-34-no-root");
    assert.equal(resolved.planRepositoryPath, planRepository);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. B2-38: numericVersion() matches quota-axi version specifically
// ---------------------------------------------------------------------------
test("B2-38: compareNumericVersions() matches quota-axi version specifically over other versions in output", () => {
  // If banner has e.g. "tool-wrapper 2.0.0 (quota-axi v0.1.30)"
  // quota-axi version must be matched specifically
  const outputWithWrapper = "wrapper 2.5.0\nquota-axi v0.1.30 (build 123)";
  // If quota-axi is matched, it compares 0.1.30 against floor 0.1.29 -> 1
  assert.equal(compareNumericVersions(outputWithWrapper, "0.1.29"), 1);
  assert.equal(compareNumericVersions(outputWithWrapper, "0.1.31"), -1);

  // Fallback to plain dotted triple if quota-axi prefix is absent
  assert.equal(compareNumericVersions("v0.1.35", "0.1.29"), 1);
  assert.equal(compareNumericVersions("0.1.20", "0.1.29"), -1);
});
