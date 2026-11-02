// Regression test for B4-06:
// The transition evidence admits only actor host, owner or human, and the SQLite CHECK
// it mirrors excludes delegate, so the delegate journaling that AGENTS.md invariant 13
// requires cannot be written, and the projector silently drops any such row without a degraded flag.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { createSession, projectAttemptStatus, type AttemptStatusProjection, type SessionInit } from "../../../src/observability/projector.ts";
import { transitionsForSession } from "../../../src/observability/queries.ts";

const SESSION: SessionInit = {
  sessionId: "s1",
  projectSlug: "proj",
  taskId: "T1",
  continuesTask: null,
  groupId: null,
  planRef: null,
  attempt: 1,
  workflowId: "shift",
  riskTier: 0,
  isProtected: false,
  requestText: "do the thing",
  callCeiling: 5,
  configSnapshotJson: "{}",
  journalPath: "/attempt/journal.jsonl",
  startedAt: "2026-08-06T00:00:00.000Z",
};

test("B4-06: delegate transition is accepted by schema and transitionsForSession returns actor 'delegate'", () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b4-06-"));
  const dbPath = join(dir, "awsf.db");
  try {
    const db = openDatabase(dbPath);
    try {
      createSession(db, SESSION);
      const projection: AttemptStatusProjection = {
        ...SESSION,
        lifecycleState: "RUNNING",
        baseSha: null,
        candidateSha: null,
        callsSpent: 0,
        callsReserved: 1,
        correctionsAuto: 0,
        correctionsOwner: 0,
        ownerReentries: 0,
        workerModelResolved: null,
        updatedAt: SESSION.startedAt,
        endedAt: null,
        stateRevision: 1,
        evidence: {
          type: "transition",
          id: "trans-1",
          seq: 1,
          from: "RUNNING",
          to: "AWAITING_OWNER",
          actor: "delegate" as any,
          edgeId: "L15",
          reasonSource: "delegate-policy",
          reasonCode: null,
          reasonDetail: "delegated pause",
          spawnSite: false,
          at: "2026-08-06T00:00:00.000Z",
        },
      };

      const result = projectAttemptStatus(db, projection, 1);
      assert.equal(result.ok, true);
      assert.equal(result.degraded, false);

      const rows = transitionsForSession(db, "s1");
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.actor, "delegate");

      // Triangulation: existing actors (host, owner, human) continue to be admitted
      for (const [idx, act] of (["host", "owner", "human"] as const).entries()) {
        const transOutcome = projectAttemptStatus(db, {
          ...projection,
          stateRevision: idx + 2,
          evidence: {
            ...(projection.evidence as Extract<typeof projection.evidence, { type: "transition" }>),
            id: `trans-${act}`,
            seq: idx + 2,
            actor: act,
          },
        }, idx + 2);
        assert.equal(transOutcome.ok, true);
        assert.equal(transOutcome.degraded, false);
      }

      const allRows = transitionsForSession(db, "s1");
      assert.equal(allRows.length, 4);
      assert.deepEqual(allRows.map((r) => r.actor), ["delegate", "host", "owner", "human"]);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
