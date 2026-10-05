import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTRIBUTION_RECORD_SCHEMA_ID, ATTRIBUTION_CAUSES, type AttributionCause } from "../../src/contracts/attribution-record.ts";
import { metricsCommand, metricsFilter, metricsReadout, readMetricsPayload } from "../../src/cli/commands/metrics.ts";
import { buildMetricsPayload } from "../../src/metrics/payload.ts";
import { HEURISTIC_ATTRIBUTION_RULES } from "../../src/metrics/attribution.ts";
import { projectAttribution } from "../../src/observability/projector.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import { SyntheticAttempt, phase, session } from "./_metrics-journal.ts";

const AT = "2026-09-26T10:00:00.000Z";
const LATER = "2026-09-28T10:00:00.000Z";

// Each projected attempt is distinct, including the stop without a role-row.
function stop(id: string, code: string | null, startedAt = AT): SyntheticAttempt {
  const run = new SyntheticAttempt({ ...session(id), projectSlug: "causes", attempt: 2, startedAt, workflowId: "build-review" });
  if (code !== null) run.phase(phase("builder", "builder", {
    phaseId: `${id}:builder`, status: "FAILED", errorCode: code,
  }));
  run.transition("BLOCKED", code);
  return run;
}

function cancel(id: string, startedAt = AT): SyntheticAttempt {
  const run = new SyntheticAttempt({ ...session(id), projectSlug: "causes", startedAt, workflowId: "build-review" });
  run.transition("CANCELLED");
  return run;
}

test("projection-only cause ledger counts each heuristic outcome and each recorded cancel, with unknown missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-causes-"));
  const dbPath = join(dir, "awsf.db");
  try {
    const db = openDatabase(dbPath);
    const record = (id: string, attempt: number, cause: AttributionCause, at = AT): void => {
      projectAttribution(db, { schema: ATTRIBUTION_RECORD_SCHEMA_ID, project: "causes", taskId: `task-${id}`, attempt,
        cause, reason: "synthetic owner reason", at });
    };
    try {
      // A case for each DISTINCT heuristic answer, plus an unknown with no phase.
      for (const [id, code] of [["model", "PhaseGateFailure"], ["factory", "AdapterError"],
        ["environment", "ExecutableNotFound"], ["unknown", "phase-abort"]] as const) stop(id, code).project(db);
      stop("no-phase", null).project(db);
      stop("override", "PhaseGateFailure").project(db);
      record("override", 2, "driver");
      // Latest event_row wins over an earlier owner record, even if its timestamp is older.
      record("override", 2, "model", LATER);
      record("override", 2, "owner", "2026-09-25T00:00:00.000Z");
      for (const cause of ATTRIBUTION_CAUSES) {
        const id = `cancel-${cause}`;
        cancel(id).project(db);
        record(id, 1, cause);
      }
      cancel("legacy").project(db);
      cancel("after-window", LATER).project(db);
      stop("after-window-stop", "phase-abort", LATER).project(db);
      const landed = new SyntheticAttempt({ ...session("landed"), projectSlug: "causes", workflowId: "build-review" });
      landed.transition("LANDED").project(db);
      record("landed", 1, "owner"); // a stray record cannot make a completed run a stop
    } finally {
      db.close();
    }

    const payload = readMetricsPayload(dbPath, LATER);
    const expectedMissing = ["cancel-unknown", "legacy", "no-phase", "unknown", "after-window", "after-window-stop"];
    assert.deepEqual(payload.causes, {
      stops: { total: 7, byCause: { model: 1, factory: 1, environment: 1, owner: 1 } },
      cancels: { total: 8, byCause: { model: 1, factory: 1, environment: 1, driver: 1, owner: 1 } },
      withoutCause: expectedMissing.map((id) => ({ project: "causes", taskId: `task-${id}`,
        attempt: id.startsWith("cancel-") || id === "legacy" || id === "after-window" ? 1 : 2,
        lifecycleState: id.startsWith("cancel-") || id === "legacy" || id === "after-window" ? "CANCELLED" : "BLOCKED" })),
    });
    assert.equal(payload.runs.find((run) => run.taskId === "task-override")?.attributionSource, "owner");
    assert.equal(payload.runs.find((run) => run.taskId === "task-override")?.heuristicAttribution, "model");
    assert.equal(payload.runs.find((run) => run.taskId === "task-cancel-owner")?.attribution, "owner");
    assert.equal(payload.runs.find((run) => run.taskId === "task-cancel-owner")?.heuristicAttribution, null);
    assert.equal(payload.runs.find((run) => run.taskId === "task-landed")?.attribution, null);
    assert.equal(payload.roleRows.some((row) => row.taskId === "task-no-phase"), false);
    assert.ok(HEURISTIC_ATTRIBUTION_RULES.every((rule) => rule.attribution !== "driver"));

    const text = metricsReadout(payload, metricsFilter({ startedBefore: LATER, role: "builder" })).join("\n");
    assert.match(text, /Stops \(BLOCKED\) by cause: environment 1 · factory 1 · model 1 · owner 1 · 6 total · 2 without a cause/);
    assert.match(text, /Cancels \(CANCELLED\) by cause: driver 1 · environment 1 · factory 1 · model 1 · owner 1 · 7 total · 2 without a cause/);
    for (const id of expectedMissing.slice(0, 4)) assert.match(text, new RegExp(`causes/task-${id} attempt `));
    assert.doesNotMatch(text, /causes\/task-after-window/);
    assert.doesNotMatch(text, /causes\/task-cancel-owner attempt/);
    const [json] = metricsCommand({ dbPath, extractedAt: LATER, json: true });
    assert.deepEqual(JSON.parse(json!).causes, payload.causes, "JSON carries the unfiltered API cause ledger");
    assert.throws(() => metricsCommand({ dbPath, extractedAt: LATER, json: true, startedBefore: LATER }), /unfiltered API payload/);
    const reader = openDatabase(dbPath, { readonly: true });
    try {
      assert.deepEqual(buildMetricsPayload(reader, { extractedAt: LATER }).causes, payload.causes);
    } finally {
      reader.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
