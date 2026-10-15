// B4-02: the degraded-observability hold must also hold publication.
//
// `awsf publish` asks the projection's advancement gate about `PUBLISHED`
// before the push, which has no rollback. If a degraded session were let
// through there, the one irreversible act would happen while the dashboard
// cannot record it — exactly the "invisible completion" the hold exists to
// prevent. A healthy session must still publish.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JournalRecord } from "../../../src/persistence/journal.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import type { TaskState } from "../../../src/state/task-machine.ts";
import { closeDatabase, openDatabase } from "../../../src/observability/sqlite.ts";
import { createSession, projectEvent, type SessionInit } from "../../../src/observability/projector.ts";
import {
  DegradedObservabilityHold,
  assertAdvancementPermitted,
  observabilityDegraded,
} from "../../../src/observability/rebuild.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";

// `sessions` is UNIQUE on (project, task, attempt), so each session gets its own attempt number.
function session(sessionId: string, attempt: number): SessionInit {
  return {
    sessionId,
    projectSlug: "proj",
    taskId: "T1",
    continuesTask: null,
    groupId: null,
    planRef: null,
    attempt,
    workflowId: "wf",
    riskTier: 0,
    isProtected: false,
    requestText: "publish the landed revision",
    callCeiling: 5,
    configSnapshotJson: "{}",
    journalPath: "/attempt/journal.jsonl",
    startedAt: "2026-08-06T00:00:00.000Z",
  };
}

function runStarted(runId: string): JournalRecord<NormalizedEvent> {
  return {
    source_seq: 1,
    recorded_at: "2026-08-06T00:00:01.000Z",
    event: { seq: 1, runId, hostAt: "t0", providerAt: null, kind: "run.started", adapter: "claude-code", requestedModel: "sonnet-5" },
  };
}

/**
 * A state root whose `awsf.db` holds one healthy session and one session the
 * projector itself flagged degraded — through a real failed projection (a
 * colliding event row), not a hand-set column.
 */
function stateRootWithSessions(): { root: string; healthy: string; degraded: string } {
  const root = mkdtempSync(join(tmpdir(), "awsf-degraded-hold-"));
  const healthy = "proj:T1:1";
  const degraded = "proj:T1:2";
  const db = openDatabase(join(root, "awsf.db"));
  try {
    createSession(db, session(healthy, 1));
    createSession(db, session(degraded, 2));
    db.prepare(
      "INSERT INTO events (event_id, session_id, run_id, first_source_seq, last_source_seq, type, payload_json, started_at) " +
        "VALUES ('runD:1', ?, 'runD', 1, 1, 'x', '{}', 't0')",
    ).run(degraded);
    const outcome = projectEvent(db, { sessionId: degraded, runId: "runD", phaseId: null }, runStarted("runD"));
    assert.equal(outcome.ok, false, "the seeded projection must really fail");
    assert.equal(observabilityDegraded(db, degraded), true, "the projector flagged the session degraded");
    assert.equal(observabilityDegraded(db, healthy), false, "the other session stays healthy");
  } finally {
    closeDatabase(db);
  }
  return { root, healthy, degraded };
}

test("a degraded attempt cannot reach PUBLISHED", () => {
  assert.throws(
    () => assertAdvancementPermitted({ sessionId: "proj:T1:1", to: "PUBLISHED", degraded: true }),
    (error: unknown) =>
      error instanceof DegradedObservabilityHold && error.to === "PUBLISHED" && error.sessionId === "proj:T1:1",
  );
});

test("a healthy attempt can still reach PUBLISHED", () => {
  assert.doesNotThrow(() => assertAdvancementPermitted({ sessionId: "proj:T1:1", to: "PUBLISHED", degraded: false }));
});

test("the projection gate publish calls refuses PUBLISHED for a degraded session and permits it for a healthy one", () => {
  const { root, healthy, degraded } = stateRootWithSessions();
  const projection = createDashboardProjection(root);
  try {
    assert.throws(() => projection.assertAdvancement(degraded, "PUBLISHED"), DegradedObservabilityHold);
    assert.doesNotThrow(() => projection.assertAdvancement(healthy, "PUBLISHED"));
  } finally {
    projection.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("halting stays available to a degraded session after the change", () => {
  const halts: TaskState[] = ["BLOCKED", "CANCELLED"];
  for (const to of halts) {
    assert.doesNotThrow(
      () => assertAdvancementPermitted({ sessionId: "proj:T1:1", to, degraded: true }),
      `${to} must stay available while degraded`,
    );
  }
});
