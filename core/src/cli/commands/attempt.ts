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
import { TERMINAL_STATES, correctionAllowance, type BudgetState, type TaskState } from "../../state/task-machine.ts";
import type { ModelResolutionProvenance } from "../../contracts/normalized-events.ts";
import type { ProcessIdentity } from "../../execution/launcher-barrier.ts";
import type { AttemptEvidence } from "../../observability/attempt-evidence.ts";
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

/**
 * One owner act that raised this task's ceiling, recorded where the spend it
 * paid for is recorded.
 *
 * TASK-lifetime, exactly like `callsSpent`: `awsf retry` carries both forward,
 * because an attempt that inherited the spend a grant paid for and not the
 * grant would open already over its ceiling.
 */
export interface CeilingGrant {
  /** Calls this one act added. Always `>= 1` — a grant raises and never lowers. */
  readonly calls: number;
  /** The ceiling it produced, so the sequence reads as a ledger rather than a diff. */
  readonly ceiling: number;
  /** The owner's written reason. Recorded here and in the journal; never sent to a provider. */
  readonly reason: string;
  /** The attempt the owner granted it from. */
  readonly attempt: number;
  readonly at: string;
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
  /** Redacted at creation and journaled so SQLite rebuild never needs live config. */
  readonly configSnapshotJson: string;
  readonly lifecycleState: TaskState;
  readonly baseSha: string | null;
  readonly candidateSha: string | null;
  readonly phase: PhaseMeter | null;
  /** `budget.ceiling` is this task's effective ceiling, grants included. */
  readonly budget: BudgetState;
  /** Every `awsf raise` this task has been given, oldest first. */
  readonly ceilingGrants: readonly CeilingGrant[];
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
  readonly evidence?: AttemptEvidence;
}

/** The observability callback occupying the write protocol's project step. */
export type AttemptProjector = (
  record: JournalRecord<AttemptEvent>,
  status: AttemptStatus,
) => Promise<void> | void;

/** A degraded projection may halt, but may not let work complete invisibly. */
export type AttemptAdvancementGuard = (sessionId: string, to: TaskState) => void;

export function deriveAttemptStatus(records: readonly JournalRecord<AttemptEvent>[]): AttemptStatus | null {
  const next = records.length === 0 ? null : records[records.length - 1]?.event.next ?? null;
  return next === null ? null : withLegacyDefaults(next);
}

export function isTerminalStatus(status: AttemptStatus): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(status.lifecycleState);
}

function validateComponent(label: string, value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must be one path-safe identifier`);
  }
}

/** What a status written before the owner re-entry counter existed actually holds. */
type LegacyBudget = Omit<BudgetState, "ownerReentries" | "allowance"> & {
  ownerReentries?: number;
  allowance: { auto: number; owner: number; ownerReentries?: number };
};

/** And what one written before the ceiling was a dial holds. */
type LegacyStatus = Omit<AttemptStatus, "ceilingGrants"> & {
  ceilingGrants?: readonly CeilingGrant[];
};

/**
 * Reads a pre-`owner_reentries` status as zero re-entries, with the allowance
 * coupled to its configured owner tranche. That is the same answer the ledger
 * would have given: nothing had been charged, because the counter that could
 * charge it did not exist. Retained attempts stay readable and nothing on disk
 * is rewritten to make them so.
 *
 * EXPORTED because a persisted status is deserialized at more than one
 * boundary, and the first version of this shim guarded only the first of them.
 * `status.json` is read by `readAttempt`; a journal record's `event.next` is
 * read by `deriveAttemptStatus` and, one record at a time, by `awsf db
 * rebuild`. The projection path is the one that was missed, and the way it
 * failed is worth stating: `AttemptStatus.budget.ownerReentries` is typed
 * `number`, so a legacy record handed straight to the projector is a value
 * lying about its own type — `node:sqlite` then refuses to bind `undefined`
 * and the whole rebuild dies on the first pre-upgrade attempt it meets. That
 * made the documented repair for a stale projection unusable on exactly the
 * databases that needed it.
 *
 * So this is applied wherever untyped JSON becomes an `AttemptStatus`, and
 * nowhere downstream of that: `toAttemptStatusProjection` is entitled to trust
 * its parameter type, and a mapper that silently repaired its input would hide
 * which caller was feeding it a stale shape.
 *
 * It now covers a second generation of the same problem. A status written
 * before the ceiling became an owner-set number records no `budget.ceiling`
 * and no `ceilingGrants`; both are filled with what that attempt was actually
 * run under — the tier's documented default, and no grants — rather than with
 * anything invented. `budget.ceiling` is deliberately left ABSENT rather than
 * defaulted to a number here, because `ceilingFor` already reads an absent
 * ceiling as the tier default and writing one in would claim the attempt
 * recorded a ceiling it never did.
 */
export function withLegacyDefaults(status: AttemptStatus): AttemptStatus {
  const budget = status.budget as LegacyBudget;
  const legacy = status as LegacyStatus;
  const budgetIsCurrent = budget.ownerReentries !== undefined && budget.allowance.ownerReentries !== undefined;
  if (budgetIsCurrent && legacy.ceilingGrants !== undefined) return status;
  return {
    ...status,
    ...(budgetIsCurrent ? {} : {
      budget: {
        ...budget,
        ownerReentries: budget.ownerReentries ?? 0,
        allowance: correctionAllowance(budget.allowance),
      },
    }),
    ceilingGrants: legacy.ceilingGrants ?? [],
  };
}

export async function readAttempt(attemptDir: string): Promise<AttemptStatus> {
  const status = await tryReadStatus<AttemptStatus>(statusFilePath(attemptDir));
  if (status === null) throw new Error(`no attempt status exists at ${attemptDir}`);
  return withLegacyDefaults(status);
}

export async function persistAttempt(
  attemptDir: string,
  expectedRevision: number | null,
  event: AttemptEvent,
  project?: AttemptProjector,
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
      ...(project === undefined ? {} : { project }),
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
    case "PREPARED": return `run \`awsf run ${taskId}\``;
    case "RUNNING": return `run \`awsf watch ${taskId}\` or \`awsf cancel ${taskId}\``;
    case "GATING": return `inspect gate output with \`awsf watch ${taskId}\``;
    case "REVIEWING": return `wait for the mandatory review; use \`awsf watch ${taskId}\``;
    case "AWAITING_OWNER": return `run \`awsf rework ${taskId} "<concrete defect>"\`, \`awsf land ${taskId}\`, or \`awsf cancel ${taskId}\``;
    case "LANDING": return `rerun \`awsf land ${taskId}\` to recover the persisted landing`;
    case "LANDED": return "no action required; the approved candidate is canonical HEAD";
    case "BLOCKED": return `resolve the blocker, then run \`awsf retry ${taskId}\``;
    case "CANCELLED": return `run \`awsf retry ${taskId}\` only if the task should resume`;
  }
}
