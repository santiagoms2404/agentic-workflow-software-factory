import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { createSession, projectAttemptStatus, type AttemptStatusProjection, type SessionInit } from "../../../src/observability/projector.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../../src/observability/attempt-evidence.ts";
import type { PhaseRecovery } from "../../../src/contracts/phase-recovery.ts";

const SESSION: SessionInit = {
  sessionId: "s1",
  projectSlug: "proj",
  taskId: "T1",
  continuesTask: null,
  groupId: null,
  planRef: null,
  attempt: 1,
  workflowId: "simple-sdlc",
  riskTier: 0,
  isProtected: false,
  requestText: "test notices started_at",
  callCeiling: 10,
  configSnapshotJson: "{}",
  journalPath: "/path/journal.jsonl",
  startedAt: "2026-08-06T00:00:00.000Z",
};

const fixturePhase: PhaseEvidenceRecord = {
  phaseId: "phase-1",
  ordinal: 1,
  key: "builder",
  name: "builder",
  kind: "agent",
  owner: "builder",
  description: "test builder",
  status: "SUCCEEDED",
  correctionCount: 0,
  maxCorrections: 1,
  errorCode: null,
  errorMessage: null,
  startedAt: "2026-08-06T00:01:00.000Z",
  endedAt: "2026-08-06T00:02:00.000Z",
  createdAt: "2026-08-06T00:00:30.000Z",
};

const fixtureCheckpoint: PhaseRecovery = {
  schema: "awsf.phase-recovery/v1",
  id: "recov-1",
  sessionId: "s1",
  kind: "quota-pause",
  workflowId: "simple-sdlc",
  bindingDigest: "d".repeat(64),
  prefix: [],
  repository: "repo",
  worktree: "wt",
  commonGitDir: "git",
  integrationBaseSha: "e".repeat(40),
  worktreeHeadSha: "f".repeat(40),
  budgetDigest: "g".repeat(64),
  quota: null,
  createdAt: "2026-08-06T00:03:00.000Z",
};

function attempt(evidence: AttemptEvidence, seq: number): AttemptStatusProjection {
  return {
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
    updatedAt: "2026-08-06T00:04:00.000Z",
    endedAt: null,
    stateRevision: seq,
    evidence,
  };
}

test("B4-12: recovery notices must include started_at so NOT NULL constraint is satisfied", () => {
  const db = openDatabase(":memory:");
  try {
    createSession(db, SESSION);

    const recoveryEvidences: AttemptEvidence[] = [
      {
        type: "quota-pause",
        checkpoint: { ...fixtureCheckpoint, kind: "quota-pause" },
      },
      {
        type: "ceiling-pause",
        checkpoint: { ...fixtureCheckpoint, kind: "ceiling-pause" },
      },
      {
        type: "ticket-block",
        checkpoint: { ...fixtureCheckpoint, kind: "ticket-block" },
        phaseKey: "builder",
        source: "gate",
        detail: "gates red",
      },
      {
        type: "phase-accepted",
        phase: fixturePhase,
        accepted: {
          phaseKey: "builder",
          ordinal: 1,
          envelopeId: "env-1",
          envelopeDigest: "h".repeat(64),
          round: 0,
          candidateSha: "1".repeat(40),
        },
      },
      {
        type: "phase-result-ready",
        phase: fixturePhase,
        checkpoint: { ...fixtureCheckpoint, kind: "result-ready" },
      },
      {
        type: "resume-activation",
        operationId: "op-1",
        checkpointId: "recov-1",
        reason: "resuming after owner grant",
        reservationId: null,
        phase: fixturePhase,
      },
    ];

    let seq = 1;
    for (const ev of recoveryEvidences) {
      const outcome = projectAttemptStatus(db, attempt(ev, seq), seq);
      assert.equal(outcome.ok, true, `projection for ${ev.type} must succeed`);

      const eventRow = db.prepare("SELECT event_id, type, name, started_at FROM events WHERE session_id = ? AND type = 'notice' AND name = ?")
        .get("s1", ev.type) as { event_id: string; type: string; name: string; started_at: string | null } | undefined;

      assert.ok(eventRow !== undefined, `notice event row for ${ev.type} must be persisted (not discarded due to NULL started_at)`);
      assert.ok(eventRow.started_at !== null && eventRow.started_at.length > 0, `started_at must be populated for ${ev.type}`);
      seq++;
    }
  } finally {
    db.close();
  }
});
