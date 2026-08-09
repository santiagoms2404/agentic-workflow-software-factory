// Durable CLI-facing attempt record. The journal owns every revision; status is
// only its atomically replaced projection.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { AttemptLock, SealedAttempt, runWriteProtocol } from "../../persistence/attempt-lock.ts";
import { Journal, type JournalRecord } from "../../persistence/journal.ts";
import {
  journalFilePath,
  lockFilePath,
  statusFilePath,
} from "../../persistence/platform-paths.ts";
import { tryReadStatus } from "../../persistence/status-store.ts";
import { TERMINAL_STATES, type BudgetState, type TaskState } from "../../state/task-machine.ts";
import type { ModelResolutionProvenance } from "../../contracts/normalized-events.ts";
import type { ProcessIdentity } from "../../execution/launcher-barrier.ts";
import type { Tier } from "../../state/tiers.ts";

export interface PhaseMeter {
  readonly name: string;
  readonly state: string;
  readonly round: number;
  readonly maximumRounds: number;
}

export interface AttemptModel {
  readonly resolved: string;
  readonly provenance: ModelResolutionProvenance | "unknown";
}

export interface AttemptBlocker {
  readonly code: string;
  readonly detail: string;
  readonly ahead: number | null;
  readonly behind: number | null;
}

export interface LandingApproval {
  readonly candidateSha: string;
  readonly summary: string;
  readonly approvedAt: string;
}

export interface AttemptStatus {
  readonly schema: "awsf/attempt-status/v1";
  readonly sessionId: string;
  readonly project: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly repository: string;
  readonly worktree: string | null;
  readonly workflow: string;
  readonly tier: Tier;
  readonly request: string;
  readonly lifecycleState: TaskState;
  readonly baseSha: string | null;
  readonly candidateSha: string | null;
  readonly phase: PhaseMeter | null;
  readonly budget: BudgetState;
  readonly model: AttemptModel | null;
  readonly lastActivityAt: string;
  readonly lastActivity: string;
  readonly nextAction: string;
  readonly gatesPass: boolean;
  readonly requiredReviewPresent: boolean;
  readonly journeyApproved: boolean;
  readonly protectedApprovalsValid: boolean;
  readonly process: ProcessIdentity | null;
  readonly landingApproval: LandingApproval | null;
  readonly blocker: AttemptBlocker | null;
  readonly revision: number;
  readonly lastSourceSeq: number;
}

export interface AttemptEvent {
  readonly kind: "attempt.created" | "attempt.updated" | "attempt.transitioned" | "attempt.retried";
  readonly next: AttemptStatus;
}

export function deriveAttemptStatus(records: readonly JournalRecord<AttemptEvent>[]): AttemptStatus | null {
  return records.length === 0 ? null : records[records.length - 1]?.event.next ?? null;
}

export function isTerminalStatus(status: AttemptStatus): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(status.lifecycleState);
}

function validateComponent(label: string, value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must be one path-safe identifier`);
  }
}

export async function readAttempt(attemptDir: string): Promise<AttemptStatus> {
  const status = await tryReadStatus<AttemptStatus>(statusFilePath(attemptDir));
  if (status === null) throw new Error(`no attempt status exists at ${attemptDir}`);
  return status;
}

export async function persistAttempt(
  attemptDir: string,
  expectedRevision: number | null,
  event: AttemptEvent,
): Promise<AttemptStatus> {
  const journal = new Journal<AttemptEvent>(journalFilePath(attemptDir));
  const lock = new AttemptLock(lockFilePath(attemptDir));
  try {
    return await runWriteProtocol<AttemptEvent, AttemptStatus>({
      lock,
      journal,
      statusPath: statusFilePath(attemptDir),
      readCurrentStatus: () => tryReadStatus<AttemptStatus>(statusFilePath(attemptDir)),
      validate: (current) => {
        const actual = current?.revision ?? null;
        if (actual !== expectedRevision) {
          throw new Error(`attempt revision changed: expected ${String(expectedRevision)}, found ${String(actual)}`);
        }
        if (current !== null && isTerminalStatus(current)) {
          throw new SealedAttempt(current.lifecycleState);
        }
        if (event.next.revision !== (current?.revision ?? 0) + 1) {
          throw new Error("next attempt revision is not contiguous");
        }
        if (event.next.lastSourceSeq !== event.next.revision) {
          throw new Error("status source sequence must equal its journal revision");
        }
        return { event, nextStatus: event.next };
      },
      sealWhenTerminal: (status) => isTerminalStatus(status) ? status.lifecycleState : null,
    });
  } finally {
    await journal.close();
  }
}

export async function latestAttemptNumber(taskRoot: string): Promise<number | null> {
  let entries;
  try {
    entries = await readdir(taskRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const attempts = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  return attempts.length === 0 ? null : Math.max(...attempts);
}

export function taskRoot(stateRoot: string, project: string, taskId: string): string {
  validateComponent("project", project);
  validateComponent("task id", taskId);
  return join(stateRoot, "projects", project, "tasks", taskId);
}

export async function locateAttempt(
  stateRoot: string,
  project: string,
  taskId: string,
  attempt?: number,
): Promise<{ attemptDir: string; attempt: number }> {
  const root = taskRoot(stateRoot, project, taskId);
  const selected = attempt ?? await latestAttemptNumber(root);
  if (selected === null || !Number.isInteger(selected) || selected < 1) {
    throw new Error(`no attempt exists for ${project}/${taskId}; run \`awsf new ${taskId} ...\``);
  }
  return { attemptDir: join(root, String(selected)), attempt: selected };
}

export function nextRevision(status: AttemptStatus, update: Partial<AttemptStatus>): AttemptStatus {
  const revision = status.revision + 1;
  return { ...status, ...update, revision, lastSourceSeq: revision };
}

export function nextActionFor(state: TaskState, taskId: string): string {
  switch (state) {
    case "DRAFT": return `run \`awsf start ${taskId}\``;
    case "PREPARED": return `start the compiled workflow for ${taskId}`;
    case "RUNNING": return `run \`awsf watch ${taskId}\` or \`awsf cancel ${taskId}\``;
    case "GATING": return `inspect gate output with \`awsf watch ${taskId}\``;
    case "REVIEWING": return `wait for the mandatory review; use \`awsf watch ${taskId}\``;
    case "AWAITING_OWNER": return `run \`awsf land ${taskId}\`, request rework, or \`awsf cancel ${taskId}\``;
    case "LANDING": return `rerun \`awsf land ${taskId}\` to recover the persisted landing`;
    case "LANDED": return "no action required; the approved candidate is canonical HEAD";
    case "BLOCKED": return `resolve the blocker, then run \`awsf retry ${taskId}\``;
    case "CANCELLED": return `run \`awsf retry ${taskId}\` only if the task should resume`;
  }
}
