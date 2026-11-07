import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { createSession, projectAttemptStatus, type AttemptStatusProjection, type SessionInit } from "../../../src/observability/projector.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";

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
  requestText: "test evidence exhaustiveness",
  callCeiling: 10,
  configSnapshotJson: "{}",
  journalPath: "/path/journal.jsonl",
  startedAt: "2026-08-06T00:00:00.000Z",
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
    updatedAt: "2026-08-06T00:00:00.000Z",
    endedAt: null,
    stateRevision: seq,
    evidence,
  };
}

test("B4-11: applyAttemptEvidence records review-degradation in events table", () => {
  const db = openDatabase(":memory:");
  try {
    createSession(db, SESSION);

    const reviewDegradation: AttemptEvidence = {
      type: "review-degradation",
      reason: "builder matches reviewer provider for speed",
      attempt: 1,
      at: "2026-08-06T00:01:00.000Z",
    };

    const outcome = projectAttemptStatus(db, attempt(reviewDegradation, 1), 1);
    assert.equal(outcome.ok, true, "projection succeeded");

    const row = db.prepare("SELECT type, name, payload_json, started_at FROM events WHERE session_id = ? AND type = 'review_degradation'")
      .get("s1") as { type: string; name: string; payload_json: string; started_at: string } | undefined;

    assert.ok(row !== undefined, "review_degradation event row must be written");
    assert.equal(row.type, "review_degradation");
    const payload = JSON.parse(row.payload_json);
    assert.equal(payload.reason, "builder matches reviewer provider for speed");
    assert.equal(payload.attempt, 1);
    assert.equal(row.started_at, "2026-08-06T00:01:00.000Z");
  } finally {
    db.close();
  }
});

test("B4-11: all remaining unhandled variants are handled cleanly without throwing", () => {
  const db = openDatabase(":memory:");
  try {
    createSession(db, SESSION);

    const unhandledEvidences: AttemptEvidence[] = [
      {
        type: "command-occurrence-opened",
        opening: {
          occurrenceId: "occ-1",
          phaseId: "phase-1",
          planStep: "step-1",
          commandSchema: "cmd/v1",
          at: "2026-08-06T00:02:00.000Z",
        } as unknown as import("../../../src/contracts/command-ledger.ts").CommandOccurrenceOpened,
      },
      {
        type: "command-dispatch-intent",
        intent: {
          occurrenceId: "occ-1",
          dispatchId: "disp-1",
          command: "npm test",
          at: "2026-08-06T00:02:01.000Z",
        } as unknown as import("../../../src/contracts/command-ledger.ts").CommandDispatchIntent,
      },
      {
        type: "command-dispatch-result",
        result: {
          occurrenceId: "occ-1",
          dispatchId: "disp-1",
          exitCode: 0,
          at: "2026-08-06T00:02:02.000Z",
        } as unknown as import("../../../src/contracts/command-ledger.ts").CommandDispatchResult,
      },
      {
        type: "command-occurrence-closed",
        closure: {
          occurrenceId: "occ-1",
          phaseId: "phase-1",
          status: "closed",
          at: "2026-08-06T00:02:03.000Z",
        } as unknown as import("../../../src/contracts/command-ledger.ts").CommandOccurrenceClosed,
      },
      {
        type: "protected-commit-intent",
        intent: {
          commitSha: "a".repeat(40),
          at: "2026-08-06T00:02:04.000Z",
        } as unknown as import("../../../src/git/protected-commit.ts").ProtectedCommitIntent,
      },
      {
        type: "protected-lock-witness",
        witness: {
          lockPath: "/path/to/lock",
          witnessedAt: "2026-08-06T00:02:05.000Z",
        } as unknown as import("../../../src/git/protected-lock.ts").ProtectedLockWitness,
      },
      {
        type: "protected-grant",
        grant: {
          grantId: "grant-1",
          at: "2026-08-06T00:02:06.000Z",
        } as unknown as import("../../../src/contracts/protected-grant.ts").ProtectedGrant,
      },
      {
        type: "protected-candidate",
        binding: {
          candidateSha: "b".repeat(40),
          at: "2026-08-06T00:02:07.000Z",
        } as unknown as import("../../../src/contracts/protected-grant.ts").ProtectedCandidateBinding,
      },
      {
        type: "protected-landing",
        protectedApproval: {
          authorizedSha: "c".repeat(40),
          at: "2026-08-06T00:02:08.000Z",
        } as unknown as import("../../../src/contracts/protected-grant.ts").ProtectedCandidateAuthorization,
      },
      {
        type: "quota-snapshot",
        attribution: "none",
        scope: "account-window",
        completedPhaseKey: "phase-1",
        nextPhaseKey: "phase-2",
        effectivePercentRemaining: 80,
        minutesToReset: 30,
        reasonCode: null,
        resolvedVersion: "1.0",
      },
    ];

    let seq = 1;
    for (const ev of unhandledEvidences) {
      const outcome = projectAttemptStatus(db, attempt(ev, seq), seq);
      assert.equal(outcome.ok, true, `projection for ${ev.type} must succeed`);
      seq++;
    }
  } finally {
    db.close();
  }
});
