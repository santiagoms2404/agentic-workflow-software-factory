import { ceilingFor } from "../../state/tiers.ts";
import type { AttemptStatusProjection } from "../../observability/projector.ts";
import {
  attemptDir as attemptDirectory,
  journalFilePath,
} from "../../persistence/platform-paths.ts";
import { isTerminalStatus, type AttemptEvent, type AttemptStatus } from "./attempt.ts";

/** Maps a durable CLI snapshot to its rebuildable SQLite session summary. */
export function toAttemptStatusProjection(
  stateRoot: string,
  status: AttemptStatus,
  event?: AttemptEvent,
): AttemptStatusProjection {
  const dir = attemptDirectory(
    stateRoot,
    status.project,
    status.taskId,
    String(status.attempt),
  );
  return {
    sessionId: status.sessionId,
    projectSlug: status.project,
    taskId: status.taskId,
    attempt: status.attempt,
    workflowId: status.workflow,
    riskTier: status.tier,
    isProtected: false,
    requestText: status.request,
    callCeiling: ceilingFor(status.tier),
    configSnapshotJson: status.configSnapshotJson,
    journalPath: journalFilePath(dir),
    startedAt: status.lastActivityAt,
    lifecycleState: status.lifecycleState,
    baseSha: status.baseSha,
    candidateSha: status.candidateSha,
    callsSpent: status.budget.callsSpent,
    callsReserved: status.budget.callsReserved,
    correctionsAuto: status.budget.correctionsAuto,
    correctionsOwner: status.budget.correctionsOwner,
    workerModelResolved: status.model?.resolved ?? null,
    updatedAt: status.lastActivityAt,
    endedAt: isTerminalStatus(status) ? status.lastActivityAt : null,
    stateRevision: status.revision,
    ...(event?.evidence === undefined ? {} : { evidence: event.evidence }),
  };
}
