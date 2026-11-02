import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiRouter } from "../../../src/api/routes.ts";
import { projectionHealth } from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { TASK_STATES } from "../../../src/state/task-machine.ts";
import type { HealthResponse } from "../../../../dashboard/shared/types.ts";
import { apiFixture } from "../api/_fixture.ts";

// Explicit expectations, independent of the production terminal-state list.
const EXPECTED_ACTIVE = {
  DRAFT: 1, PREPARED: 1, RUNNING: 1, GATING: 1, REVIEWING: 1,
  AWAITING_OWNER: 1, LANDING: 1, LANDED: 0, PUBLISHED: 0, BLOCKED: 0, CANCELLED: 0,
} as const;

for (const state of TASK_STATES) {
  test(`projectionHealth classifies ${state} by work terminality`, () => {
    const fixture = apiFixture();
    const reader = openDatabase(fixture.path, { readonly: true });
    try {
      fixture.writer.prepare("UPDATE sessions SET lifecycle_state = ?").run(state);
      assert.equal(projectionHealth(reader).activeSessions, EXPECTED_ACTIVE[state], `${state} active count`);
    } finally { reader.close(); fixture.close(); }
  });
}

test("empty health retains zero counts and schema metadata", () => {
  const db = openDatabase(":memory:");
  try {
    assert.deepEqual(projectionHealth(db), {
      schemaVersion: 8, journalMode: "memory", activeSessions: 0, projectorLag: 0, degradedSessions: 0,
    });
  } finally { db.close(); }
});

test("mixed health excludes published work but retains lag and degraded terminal sessions", () => {
  const fixture = apiFixture();
  const reader = openDatabase(fixture.path, { readonly: true });
  try {
    fixture.writer.prepare(`UPDATE sessions SET lifecycle_state = 'PUBLISHED', archived = 1,
      observability_degraded = 1, state_revision = 9, last_projected_seq = 2`).run();
    fixture.writer.prepare(`INSERT INTO sessions
      (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
       lifecycle_state, request_text, call_ceiling, started_at, updated_at, config_snapshot_json, journal_path)
      VALUES ('running','p','T2',1,'wf',0,0,'RUNNING','request',3,'t','t','{}','journal')`).run();
    assert.deepEqual(projectionHealth(reader), {
      schemaVersion: 8, journalMode: "wal", activeSessions: 1, projectorLag: 7, degradedSessions: 1,
    });
  } finally { reader.close(); fixture.close(); }
});

test("health API stops reporting active work after publication, archived or not", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config, planSources: fixture.planSources });
  const request = { method: "GET", url: "/api/v1/health", headers: { host: "127.0.0.1:4600" } };
  try {
    const running = await router.dispatch(request);
    assert.equal(running.status, 200);
    assert.equal((running.body as HealthResponse).activeSessions, 1);
    fixture.writer.prepare("UPDATE sessions SET lifecycle_state = 'PUBLISHED'").run();
    const published = await router.dispatch(request);
    assert.equal(published.status, 200);
    assert.equal((published.body as HealthResponse).activeSessions, 0);
    fixture.writer.prepare("UPDATE sessions SET archived = 1").run();
    const archived = await router.dispatch(request);
    assert.equal(archived.status, 200);
    assert.equal((archived.body as HealthResponse).activeSessions, 0);
  } finally { router.close(); fixture.close(); }
});
