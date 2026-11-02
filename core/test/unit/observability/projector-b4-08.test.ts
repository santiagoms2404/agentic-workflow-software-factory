import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { createSession, projectAttemptStatus, type AttemptStatusProjection, type SessionInit } from "../../../src/observability/projector.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { DegradedObservabilityHold } from "../../../src/observability/rebuild.ts";

test("B4-08 / B4-09: durable degraded marker is persisted when SQLITE_BUSY prevents writing degraded flag", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b4-08-"));
  const projectSlug = "test-proj";
  const taskId = "task-1";
  const attempt = 1;
  const attemptDir = join(root, "projects", projectSlug, "tasks", taskId, String(attempt));
  mkdirSync(attemptDir, { recursive: true });
  const journalPath = join(attemptDir, "journal.jsonl");
  const dbPath = join(root, "awsf.db");

  const sessionInit: SessionInit = {
    sessionId: "sess-b4-08",
    projectSlug,
    taskId,
    continuesTask: null,
    groupId: null,
    planRef: null,
    attempt,
    workflowId: "simple-sdlc",
    riskTier: 0,
    isProtected: false,
    requestText: "test b4-08",
    callCeiling: 10,
    configSnapshotJson: "{}",
    journalPath,
    startedAt: new Date().toISOString(),
  };

  const statusBase: AttemptStatusProjection = {
    ...sessionInit,
    lifecycleState: "RUNNING",
    baseSha: null,
    candidateSha: null,
    callsSpent: 0,
    callsReserved: 1,
    correctionsAuto: 0,
    correctionsOwner: 0,
    ownerReentries: 0,
    workerModelResolved: null,
    updatedAt: sessionInit.startedAt,
    endedAt: null,
    stateRevision: 1,
  };

  const db = openDatabase(dbPath);
  try {
    createSession(db, sessionInit);
    const rec1Outcome = projectAttemptStatus(db, { ...statusBase, stateRevision: 1 }, 1);
    assert.equal(rec1Outcome.ok, true, "record 1 projected cleanly");

    // Hold an exclusive lock on the database using a separate connection
    const blocker = openDatabase(dbPath);
    try {
      blocker.exec("BEGIN EXCLUSIVE");

      // Record 2 projection fails due to SQLITE_BUSY / locked database
      const rec2Outcome = projectAttemptStatus(db, { ...statusBase, stateRevision: 2 }, 2);
      assert.equal(rec2Outcome.ok, false, "record 2 projection should fail under contention");
      assert.equal(rec2Outcome.degraded, true, "record 2 outcome must be degraded");
      assert.equal(rec2Outcome.flagPersisted, false, "SQLite lock prevents writing degraded flag");
    } finally {
      blocker.exec("ROLLBACK");
      blocker.close();
    }

    // In SQLite, observability_degraded was NOT persisted and remains 0
    const row = db.prepare("SELECT observability_degraded, last_projected_seq FROM sessions WHERE session_id = ?")
      .get(sessionInit.sessionId) as { observability_degraded: number; last_projected_seq: number };
    assert.equal(row.observability_degraded, 0, "SQLite column was not written due to contention");
    assert.equal(row.last_projected_seq, 1, "projection cursor remained at 1");

    // Durable marker must be present in attemptDir
    const hasMarker = existsSync(join(attemptDir, ".degraded")) || existsSync(join(attemptDir, "observability-degraded"));
    assert.equal(hasMarker, true, "durable degraded marker must be written to attemptDir when SQLite flag fails");

    // A fresh process starting with empty in-memory state must detect degradation and hold advancement past GATING
    const freshProjection = createDashboardProjection(root);
    try {
      assert.throws(
        () => freshProjection.assertAdvancement(sessionInit.sessionId, "REVIEWING"),
        DegradedObservabilityHold,
        "subsequent process must hold advancement past GATING for degraded session",
      );
    } finally {
      freshProjection.close();
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
