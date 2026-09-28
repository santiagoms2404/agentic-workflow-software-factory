import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { createApiRouter } from "../../../src/api/routes.ts";
import { buildMetricsPayload } from "../../../src/metrics/payload.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import type { MetricsResponse } from "../../../../dashboard/shared/types.ts";
import { RATE_CARD, formatListEquivalent, listPrice, priceRow } from "../../../../dashboard/shared/rate-card.ts";
import { BENCHMARK_PRIORS, UNTESTED_ROUTES } from "../../../../dashboard/shared/benchmark-priors.ts";
import { stats } from "../../../../dashboard/shared/route-metrics.ts";
import { validConfig } from "../config/fixture.ts";
import { MetricsResponseSchema } from "../_metrics-schemas.ts";
import { AT, OPUS_HIGH, SyntheticAttempt, phase, session, usage } from "../_metrics-journal.ts";

const headers = { host: "127.0.0.1:4600" };
const CODEX = ["codex", "openai-codex", "codex:gpt-6-sol"] as const;

/** A landed run: a host brief, a codex builder observed as gpt-6-sol, and a claude reviewer that never reported a model. */
function landed(): SyntheticAttempt {
  const run = new SyntheticAttempt({ ...session("m1"), workflowId: "simple-sdlc" });
  run.phase(phase("brief", "host", { ordinal: 1, kind: "engineer", status: "SUCCEEDED", endedAt: "2026-09-26T10:01:00.000Z" }));
  run.phase(phase("builder", "builder", { ordinal: 2 }));
  run.start("phase-builder", "builder", ...CODEX);
  run.event("phase-builder", "run-1", { kind: "run.started", adapter: "pi-codex", requestedModel: "gpt-6-sol" });
  run.event("phase-builder", "run-1", {
    kind: "model.resolved", adapter: "pi-codex", provider: "openai-codex", requestedModel: "gpt-6-sol",
    resolvedModel: "gpt-6-sol", provenance: "stream-authoritative",
  });
  run.event("phase-builder", "run-1", { kind: "usage", usage: usage(100_000, 10_000, 400_000, 0, 2_000) });
  run.call("phase-builder", "builder", ...CODEX, "gpt-6-sol", usage(100_000, 10_000, 400_000, 0, 2_000));
  run.envelope("phase-builder", "builder", 0, "success");
  run.gate("phase-builder", 0, "writes_within_globs", true);
  run.phase(phase("builder", "builder", { ordinal: 2, status: "SUCCEEDED", endedAt: "2026-09-26T10:10:00.000Z" }));
  run.phase(phase("reviewer", "reviewer", { ordinal: 3 }));
  run.start("phase-reviewer", "reviewer", "claude", "anthropic", "claude:opus", { ...OPUS_HIGH, phaseId: "reviewer" });
  run.event("phase-reviewer", "run-2", { kind: "usage", usage: usage(20_000, 3_000, 50_000, 10_000, null) });
  run.envelope("phase-reviewer", "reviewer", 0, "success");
  run.review("phase-reviewer", "accept");
  run.phase(phase("reviewer", "reviewer", { ordinal: 3, status: "SUCCEEDED", endedAt: "2026-09-26T10:12:00.000Z" }));
  run.transition("AWAITING_OWNER");
  run.transition("LANDING");
  run.transition("LANDED");
  return run;
}

/** A blocked run: the builder fails its envelope and the run stops there. */
function blocked(): SyntheticAttempt {
  const run = new SyntheticAttempt(session("m2"));
  run.phase(phase("build", "builder", { ordinal: 1, maxCorrections: 0 }));
  run.start("phase-build", "builder", ...CODEX);
  run.envelope("phase-build", "builder", 0, null);
  run.gate("phase-build", 0, "envelope_valid", false);
  run.phase(phase("build", "builder", {
    ordinal: 1, maxCorrections: 0, status: "FAILED", errorCode: "EnvelopeInvalid", endedAt: "2026-09-26T10:05:00.000Z",
  }));
  run.transition("BLOCKED", "EnvelopeInvalid");
  return run;
}

function fixture(): { readonly dbPath: string; close(): void } {
  const dbPath = join(mkdtempSync(join(tmpdir(), "awsf-metrics-api-")), "awsf.db");
  const writer = openDatabase(dbPath);
  landed().project(writer);
  blocked().project(writer);
  return { dbPath, close: () => writer.close() };
}

test("GET /api/v1/metrics returns a schema-valid payload from a synthetic database", async () => {
  const db = fixture();
  const router = createApiRouter({ dbPath: db.dbPath, config: validConfig(), planSources: [] });
  try {
    const response = await router.dispatch({ method: "GET", url: "/api/v1/metrics", headers });
    assert.equal(response.status, 200);
    const body = JSON.parse(JSON.stringify(response.body)) as MetricsResponse;
    assert.equal(Value.Check(MetricsResponseSchema, body), true, JSON.stringify([...Value.Errors(MetricsResponseSchema, body)].slice(0, 5)));

    assert.equal(body.schema, "awsf.route-metrics/v1");
    assert.ok(Date.parse(body.extractedAt) >= Date.parse(AT));
    assert.deepEqual(body.rateCard, JSON.parse(JSON.stringify(RATE_CARD)));
    assert.deepEqual(body.priors, JSON.parse(JSON.stringify(BENCHMARK_PRIORS)));
    assert.deepEqual(body.untestedRoutes, JSON.parse(JSON.stringify(UNTESTED_ROUTES)));

    assert.deepEqual(body.runs.map((run) => [run.sessionId, run.stateGroup]), [["m1", "LANDED"], ["m2", "BLOCKED"]]);
    const [first] = body.runs;
    assert.deepEqual(first!.phases.map((item) => [item.key, item.kind, item.agent === null]), [
      ["brief", "engineer", true],
      ["builder", "agent", false],
      ["reviewer", "agent", false],
    ], "host phases are in the run, with no agent facts");
    assert.equal(first!.phases[1]!.minutes, 10);
    assert.equal(first!.phases[1]!.agent!.resolvedModel, "gpt-6-sol");

    // Rows the module ranks and rows it keeps out alike: nothing is filtered.
    assert.deepEqual(body.roleRows.map((row) => [row.sessionId, row.role]), [["m1", "builder"], ["m1", "reviewer"], ["m2", "builder"]]);
    const [builder, reviewer] = body.roleRows;
    const priced = priceRow(builder!);
    assert.equal(priced.priced && priced.basis, "resolved-model");
    assert.equal(priced.priced && priced.usd, (100_000 * 2 + 400_000 * 0.2 + 10_000 * 10) / 1_000_000);
    assert.equal(formatListEquivalent(listPrice(builder!)), "≈ list $0.38");
    const unpriced = priceRow(reviewer!);
    assert.equal(!unpriced.priced && unpriced.reason, "unresolved-selector", "the reviewer's selector opus is not a card id");

    // The tab and the CLI compute from the payload with the shared module.
    const summary = stats(body.roleRows, listPrice);
    assert.equal(summary.n, 3);
    assert.equal(summary.runs, 2);
    assert.equal(summary.priced, 1);
  } finally {
    router.close();
    db.close();
  }
});

test("the payload the route serves is the payload the builder returns", async () => {
  const db = fixture();
  const router = createApiRouter({ dbPath: db.dbPath, config: validConfig(), planSources: [] });
  const reader = openDatabase(db.dbPath, { readonly: true });
  try {
    const served = JSON.parse(JSON.stringify((await router.dispatch({ method: "GET", url: "/api/v1/metrics", headers })).body)) as MetricsResponse;
    const built = JSON.parse(JSON.stringify(buildMetricsPayload(reader, { extractedAt: served.extractedAt })));
    assert.deepEqual(served, built);
  } finally {
    reader.close();
    router.close();
    db.close();
  }
});

test("the metrics route takes no query and no write", async () => {
  const db = fixture();
  const router = createApiRouter({ dbPath: db.dbPath, config: validConfig(), planSources: [] });
  try {
    const query = await router.dispatch({ method: "GET", url: "/api/v1/metrics?role=builder", headers });
    assert.equal(query.status, 400);
    for (const method of ["POST", "PUT", "DELETE"]) {
      assert.equal((await router.dispatch({ method, url: "/api/v1/metrics", headers })).status, 405, method);
    }
  } finally {
    router.close();
    db.close();
  }
});
