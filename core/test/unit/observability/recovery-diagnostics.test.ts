import assert from "node:assert/strict";
import { test } from "node:test";

import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../../src/observability/attempt-evidence.ts";
import { diagnoseRecovery, formatRecoveryDiagnostic } from "../../../src/observability/recovery-diagnostics.ts";

const SHA = "a".repeat(40);
const BASE = "b".repeat(40);

function status(patch: Partial<AttemptStatus> = {}): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1",
    sessionId: "diagnostic-session",
    project: "project",
    taskId: "source-task",
    continuesTask: null,
    attempt: 1,
    repository: "/repository",
    worktree: "/worktree",
    workflow: "build-review",
    tier: 2,
    request: "build the candidate",
    configSnapshotJson: "{}",
    lifecycleState: "RUNNING",
    baseSha: BASE,
    candidateSha: null,
    phase: { name: "builder", state: "RUNNING", round: 0, maximumRounds: 1 },
    budget: {
      attempt: 1, callsSpent: 1, callsReserved: 0,
      correctionsAuto: 0, correctionsOwner: 0, ownerReentries: 0,
      allowance: { auto: 1, owner: 1, ownerReentries: 1 }, ceiling: 5,
    },
    ceilingGrants: [],
    model: null,
    lastActivityAt: "2026-09-01T00:00:00.000Z",
    lastActivity: "builder is RUNNING",
    nextAction: "watch",
    gatesPass: false,
    requiredReviewPresent: false,
    journeyApproved: false,
    protectedApprovalsValid: false,
    process: null,
    landingApproval: null,
    blocker: null,
    revision: 4,
    lastSourceSeq: 4,
    ...patch,
  };
}

function phase(state = "RUNNING"): AttemptEvidence {
  const value: PhaseEvidenceRecord = {
    phaseId: "diagnostic-session:builder", ordinal: 1, key: "builder", name: "builder",
    kind: "agent", owner: "builder", description: "build", status: state,
    correctionCount: 0, maxCorrections: 1, errorCode: null, errorMessage: null,
    startedAt: "2026-09-01T00:00:00.000Z", endedAt: null, createdAt: "2026-09-01T00:00:00.000Z",
  };
  return { type: "phase", phase: value };
}

function runningProcess(pid: number): AttemptEvidence {
  return {
    type: "process",
    phaseId: "diagnostic-session:builder",
    adapterId: "fixture",
    role: "builder",
    record: {
      identity: { pid, pgid: pid, startIdentity: `fixture:${String(pid)}`, startIdentitySource: "fixture" },
      runId: "builder-run", edge: "L4", reservationId: "r1", command: ["fixture"], cwd: "/worktree",
    },
    status: "RUNNING",
    registeredAt: "2026-09-01T00:00:00.000Z",
    releasedAt: "2026-09-01T00:00:00.000Z",
    endedAt: null,
    exitCode: null,
    exitSignal: null,
  };
}

test("a RUNNING provider phase with no recorded PID is diagnosed as a controller orphan, never as a candidate", () => {
  const report = diagnoseRecovery(status({ candidateSha: SHA }), [phase()], () => false);
  assert.equal(report.controller, "missing-pid-controller-orphan");
  assert.equal(report.pid, null);
  assert.equal(report.candidateSha, null, "an active partial worktree is not candidate evidence");
  assert.match(formatRecoveryDiagnostic(report).join("\n"), /no process PID is recorded/);
});

test("a cancelled lifecycle makes retained RUNNING phase/process rows stale when their PID is absent", () => {
  const report = diagnoseRecovery(
    status({ lifecycleState: "CANCELLED", phase: null, process: null }),
    [phase(), runningProcess(4101)],
    () => false,
  );
  assert.equal(report.controller, "cancelled-stale-records");
  assert.deepEqual(report.staleRunningPhases, ["diagnostic-session:builder"]);
  assert.deepEqual(report.staleRunningProcesses, ["builder-run"]);
  assert.equal(report.finding, null);
  assert.match(formatRecoveryDiagnostic(report).join("\n"), /stale evidence, not a live process/);
});

test("a cancelled lifecycle with a live retained PID is a survivor rather than stale-record recovery", () => {
  const report = diagnoseRecovery(
    status({ lifecycleState: "CANCELLED", phase: null, process: null }),
    [phase(), runningProcess(4102)],
    (pid) => pid === 4102,
  );
  assert.equal(report.controller, "cancelled-live-survivor");
  assert.equal(report.pid, 4102);
  assert.match(report.finding ?? "", /live process pid 4102/);
});

test("only a sealed candidate with L7 completion evidence is reported", () => {
  const sealed = status({ lifecycleState: "BLOCKED", phase: null, candidateSha: SHA });
  const none = diagnoseRecovery(sealed, [], () => false);
  assert.equal(none.candidateSha, null);

  const completed = diagnoseRecovery(sealed, [{
    type: "transition", id: "l7", seq: 1, from: "RUNNING", to: "GATING", actor: "host", edgeId: "L7",
    reasonSource: "git", reasonCode: null, reasonDetail: null, spawnSite: false, at: "2026-09-01T00:00:00.000Z",
  }], () => false);
  assert.equal(completed.candidateSha, SHA);
});
