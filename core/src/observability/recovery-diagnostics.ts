import type { AttemptStatus } from "../cli/commands/attempt.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "./attempt-evidence.ts";

export type RecoveryControllerState =
  | "inactive"
  | "live-process"
  | "missing-pid-controller-orphan"
  | "cancelled-stale-records"
  | "terminal-live-survivor";

export interface RecoveryDiagnostic {
  readonly controller: RecoveryControllerState;
  /** A sealed, completed candidate only. Partial worktree contents are never inferred. */
  readonly candidateSha: string | null;
  readonly pid: number | null;
  readonly staleRunningPhases: readonly string[];
  readonly staleRunningProcesses: readonly string[];
  readonly finding: string | null;
}

const SEALED_SOURCE_STATES = new Set(["BLOCKED", "CANCELLED", "PUBLISHED"]);
const ACTIVE_PROCESS_STATES = new Set(["REGISTERED", "RUNNING"]);
const ACTIVE_PHASE_STATES = new Set(["RUNNING", "VALIDATING", "CORRECTING"]);
const PROVIDER_CONTROLLER_STATES = new Set(["RUNNING", "REVIEWING"]);

function latestPhases(evidence: readonly AttemptEvidence[]): readonly PhaseEvidenceRecord[] {
  const phases = new Map<string, PhaseEvidenceRecord>();
  for (const record of evidence) {
    if ((record.type === "phase" || record.type === "phase-accepted" || record.type === "resume-activation") && record.phase !== null) {
      phases.set(record.phase.phaseId, record.phase);
    }
  }
  return Object.freeze([...phases.values()]);
}

function latestProcesses(evidence: readonly AttemptEvidence[]): readonly Extract<AttemptEvidence, { type: "process" }>[] {
  const processes = new Map<string, Extract<AttemptEvidence, { type: "process" }>>();
  for (const record of evidence) if (record.type === "process") processes.set(record.record.runId, record);
  return Object.freeze([...processes.values()]);
}

function completedCandidate(status: AttemptStatus, evidence: readonly AttemptEvidence[]): string | null {
  if (!SEALED_SOURCE_STATES.has(status.lifecycleState) || status.candidateSha === null) return null;
  // L7 is the durable statement that every required producer phase completed
  // and the host had a candidate commit. A worktree HEAD or dirty path without
  // that record is partial work and diagnostics must not promote it.
  const completed = evidence.some((record) => record.type === "transition" && record.edgeId === "L7");
  return completed ? status.candidateSha : null;
}

/**
 * Classify retained controller evidence without writing, signalling, or opening
 * a worktree. PID liveness is supplied by the caller so tests need no real
 * process and diagnostics never turn observation into recovery authority.
 */
export function diagnoseRecovery(
  status: AttemptStatus,
  evidence: readonly AttemptEvidence[],
  pidIsLive: (pid: number) => boolean,
): RecoveryDiagnostic {
  const phases = latestPhases(evidence);
  const processes = latestProcesses(evidence);
  const activePhases = phases.filter((phase) => ACTIVE_PHASE_STATES.has(phase.status));
  const activeProcesses = processes.filter((record) => ACTIVE_PROCESS_STATES.has(record.status));
  const liveProcess = activeProcesses.find((record) => pidIsLive(record.record.identity.pid)) ?? null;
  const liveStatusProcess = status.process !== null && pidIsLive(status.process.pid)
    ? { record: { identity: status.process, runId: "status" } }
    : null;
  const candidateSha = completedCandidate(status, evidence);

  const currentLiveProcess = liveProcess ?? liveStatusProcess;
  if (SEALED_SOURCE_STATES.has(status.lifecycleState) && currentLiveProcess !== null) {
    return Object.freeze({
      controller: "terminal-live-survivor",
      candidateSha,
      pid: currentLiveProcess.record.identity.pid,
      staleRunningPhases: Object.freeze(activePhases.map((phase) => phase.phaseId)),
      staleRunningProcesses: Object.freeze(activeProcesses.map((record) => record.record.runId)),
      finding: `${status.lifecycleState} lifecycle retains a live process pid ${String(currentLiveProcess.record.identity.pid)}`,
    });
  }

  if (status.lifecycleState === "CANCELLED" && (activePhases.length > 0 || activeProcesses.length > 0 || status.process !== null)) {
    return Object.freeze({
      controller: "cancelled-stale-records",
      candidateSha,
      pid: null,
      staleRunningPhases: Object.freeze(activePhases.map((phase) => phase.phaseId)),
      staleRunningProcesses: Object.freeze(activeProcesses.map((record) => record.record.runId)),
      finding: null,
    });
  }

  if (currentLiveProcess !== null) {
    return Object.freeze({
      controller: "live-process",
      candidateSha,
      pid: currentLiveProcess.record.identity.pid,
      staleRunningPhases: Object.freeze([]),
      staleRunningProcesses: Object.freeze([]),
      finding: null,
    });
  }

  const runningAgent = activePhases.some((phase) => phase.kind === "agent");
  if (PROVIDER_CONTROLLER_STATES.has(status.lifecycleState) && runningAgent) {
    const recordedPid = status.process?.pid ?? activeProcesses.at(-1)?.record.identity.pid ?? null;
    return Object.freeze({
      controller: "missing-pid-controller-orphan",
      candidateSha: null,
      pid: recordedPid,
      staleRunningPhases: Object.freeze(activePhases.map((phase) => phase.phaseId)),
      staleRunningProcesses: Object.freeze(activeProcesses.map((record) => record.record.runId)),
      finding: recordedPid === null
        ? "controller orphan: a provider phase is RUNNING but no process PID is recorded"
        : `controller orphan: recorded process pid ${String(recordedPid)} is absent while its provider phase is RUNNING`,
    });
  }

  return Object.freeze({
    controller: "inactive",
    candidateSha,
    pid: null,
    staleRunningPhases: Object.freeze(activePhases.map((phase) => phase.phaseId)),
    staleRunningProcesses: Object.freeze(activeProcesses.map((record) => record.record.runId)),
    finding: null,
  });
}

export function formatRecoveryDiagnostic(diagnostic: RecoveryDiagnostic): readonly string[] {
  const lines: string[] = [];
  switch (diagnostic.controller) {
    case "live-process":
      lines.push(`recovery: live process pid ${String(diagnostic.pid)}; the controller is not orphaned`);
      break;
    case "missing-pid-controller-orphan":
      lines.push(`recovery: ${diagnostic.finding}`);
      break;
    case "cancelled-stale-records":
      lines.push(
        `recovery: CANCELLED lifecycle; ${String(diagnostic.staleRunningPhases.length)} retained RUNNING phase record(s) and ` +
          `${String(diagnostic.staleRunningProcesses.length)} retained RUNNING process record(s) are stale evidence, not a live process`,
      );
      break;
    case "terminal-live-survivor":
      lines.push(`recovery: ${diagnostic.finding}; retained RUNNING records are not treated as proof of exit`);
      break;
    case "inactive":
      lines.push("recovery: no live controller or recoverable in-flight process");
      break;
  }
  lines.push(diagnostic.candidateSha === null
    ? "candidate: none — partial or uncommitted work is not candidate evidence"
    : `candidate: ${diagnostic.candidateSha} — sealed candidate completed at L7`);
  return Object.freeze(lines);
}
