import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { quotaRow } from "../../../src/doctor/quota.ts";
import { buildDoctorReport } from "../../../src/doctor/report.ts";
import type { EnvironmentRows } from "../../../src/doctor/gather.ts";
import { probeQuota } from "../../../src/quota/probe.ts";
import type { ProjectQuotaRoute } from "../../../src/quota/routes.ts";

const now = "2026-08-24T20:26:39.429Z";
const routes: readonly ProjectQuotaRoute[] = [{ adapterId: "claude", adapterKind: "claude-code", disposition: "measurable", providers: ["claude"], memberKinds: null, reason: null }];
type Shape = "measured" | "unknown-runway" | "no-single-window" | "missing-reset";

async function probe(shape: Shape, condition: "remaining" | "exhausted" | "rejected" = "remaining", stale = false) {
  const data = JSON.parse(readFileSync(new URL("../../fixtures/quota-axi/nominal.json", import.meta.url), "utf8"));
  const provider = data.providers[0];
  data.providers = [provider];
  // Keep a fully measured scope beside the incomplete one: it must not mask it.
  const scope = structuredClone(provider.quotaSemantics.effectiveAvailability[0]);
  scope.scope = "other_models";
  scope.effectivePercentRemaining = condition === "exhausted" ? 0 : 33;
  if (condition === "rejected") scope.status = "rejected";
  if (shape === "unknown-runway") scope.runway = { status: "unknown" };
  if (shape === "no-single-window") scope.limitingWindowIds = ["five_hour", "seven_day"];
  if (shape === "missing-reset") {
    // A separate window keeps the neighbouring scope fully measured.
    scope.limitingWindowIds = ["no_reset"];
    provider.windows.push({ id: "no_reset", percentRemaining: 33, resetsAt: null });
  }
  provider.quotaSemantics.effectiveAvailability.push(scope);
  if (stale) provider.state.status = "stale";
  return probeQuota({
    routes: [{ provider: "claude" }], purpose: "interactive-preflight", now,
    options: { cwd: "/synthetic", env: { PATH: "/synthetic/bin" } },
    resolveExecutable: () => "/synthetic/bin/quota-axi",
    runCommand: (_executable, argv) => ({ status: 0, error: null, stderr: "", stdout: argv[0] === "--version" ? "0.1.29" : JSON.stringify(data) }),
    journalFailure: () => {},
    retainFailureBytes: async () => { assert.fail("valid synthetic payload must not require retention"); },
  });
}

function assertReportHealth(quota: EnvironmentRows["quota"], healthy: boolean) {
  const ok = { status: "ok" as const, detail: ["synthetic measured fact"] };
  const report = buildDoctorReport({ healthy: true, lines: ["healthy: synthetic state"] }, { line: "jev: not configured", finding: null }, {
    storage: ok, executables: ok, providers: ok, quota, coverage: ok,
    branches: ok, worktrees: ok, baseline: ok, markers: ok,
  });
  assert.equal(report.healthy, healthy, "warnings leave doctor's exit unchanged; findings do not");
  assert.equal(report.lines.includes("finding: quota"), !healthy);
}

for (const shape of ["unknown-runway", "no-single-window", "missing-reset"] as const) {
  test(`quota warns for a known scope with ${shape}, naming its unmeasured reset`, async () => {
    const result = await probe(shape);
    assert.equal(result.availability, "known", "exercise the reachable post-6844ae5 probe shape");
    const row = quotaRow(routes, result, undefined, 5);
    assert.equal(row.status, "warn");
    assert.ok(row.detail.some(line => /provider=claude; scope=other_models;.*reset.*not measured/.test(line)));
    assertReportHealth(row, true);
  });
}

test("quota stays ok for fully measured scopes", async () => {
  const result = await probe("measured");
  assert.equal(result.availability, "known");
  const row = quotaRow(routes, result, undefined, 5);
  assert.equal(row.status, "ok");
  assert.match(row.detail.join("\n"), /provider=claude; scope=other_models; binding window=seven_day; reset=2026-08-26/);
  assertReportHealth(row, true);
});

test("unmeasured reset cannot hide an unavailable probe", async () => {
  for (const shape of ["measured", "unknown-runway", "no-single-window", "missing-reset"] as const) {
    const result = await probe(shape, "remaining", true);
    assert.equal(result.availability, "unavailable");
    const row = quotaRow(routes, result, undefined, 5);
    assert.equal(row.status, "finding", shape);
    assertReportHealth(row, false);
  }
});

test("exhausted and rejected scopes stay warnings with or without a measured reset", async () => {
  for (const condition of ["exhausted", "rejected"] as const) {
    for (const shape of ["measured", "unknown-runway", "no-single-window", "missing-reset"] as const) {
      const result = await probe(shape, condition);
      assert.equal(result.availability, "known");
      const row = quotaRow(routes, result, undefined, 5);
      assert.equal(row.status, "warn", `${condition}: ${shape}`);
      assertReportHealth(row, true);
    }
  }
});
