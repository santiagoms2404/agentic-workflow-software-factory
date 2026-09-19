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
import {
  SEALED_STATES,
  TERMINAL_STATES,
  correctionAllowance,
  type BudgetState,
  type TaskState,
} from "../../state/task-machine.ts";
import type { ModelResolutionProvenance } from "../../contracts/normalized-events.ts";
import type { ProcessIdentity } from "../../execution/launcher-barrier.ts";
import type { AttemptEvidence } from "../../observability/attempt-evidence.ts";
import type { Tier } from "../../state/tiers.ts";
import type { CandidateSeed } from "../../contracts/candidate-seed.ts";
import type { PhaseRouteOverrides } from "../../workflow/route-flags.ts";

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
  readonly recovery?: import("../../contracts/phase-recovery.ts").PhaseRecovery | null;
  readonly activeOperation?: string | null;
  readonly schema: "awsf/attempt-status/v1";
  readonly sessionId: string;
  readonly project: string;
  readonly taskId: string;
  /** Owner-declared task relationship recorded only when this task is created. */
  readonly continuesTask: string | null;
  /**
   * The driving session this attempt came out of, minted by that session and
   * passed in at `awsf new` / `awsf retry`. Never inferred from timing or
   * adjacency, and never inherited: an attempt created by a different session
   * did not come out of the first one, so `retry` records what it was given and
   * NULL when it was given nothing. That is what makes a continuation chain
   * able to cross two groups instead of collapsing into one.
   */
  readonly groupId: string | null;
  /**
   * The registered plan this task belongs to, named at creation and never
   * inferred. `sessions.plan_ref` has existed since migration 0005 with nothing
   * writing it, because the only automatic link available — a task id equal to a
   * ticket uid — matches zero real runs. So this is stated by the driver and
   * validated against the catalog, or it is NULL.
   *
   * Unlike `groupId`, a retry CARRIES this: attempt 2 is more work on the same
   * plan, while the group names the session that minted the attempt.
   */
  readonly planRef: string | null;
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
  /** Immutable target-bound provenance, absent on ordinary and historical attempts. */
  readonly seed?: CandidateSeed | null;
  readonly phase: PhaseMeter | null;
  /** `budget.ceiling` is this task's effective ceiling, grants included. */
  readonly budget: BudgetState;
  /** Every `awsf raise` this task has been given, oldest first. */
  readonly ceilingGrants: readonly CeilingGrant[];
  /**
   * The `--route` selections this attempt was created with, keyed by phase.
   *
   * Attempt state rather than configuration, so `configSnapshotJson` still
   * equals the file on disk and `awsf rework`/`awsf review` stay available to
   * an attempt whose routing was chosen at the terminal.
   */
  readonly routeOverrides: PhaseRouteOverrides;
  /**
   * The owner's grant permitting a same-provider review on this attempt, or
   * null. Never set by the host, and never inferred from a quota or transport
   * failure — see `degrade-review.ts`.
   */
  readonly reviewDegradation: ReviewDegradation | null;
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

/**
 * The owner's written permission for one attempt's review to run on the same
 * provider as its builder.
 *
 * It is a grant, not a mode: the durable `routing.review` still says what the
 * project does, and this says what the owner allowed once, with a reason on
 * the record beside it.
 */
export interface ReviewDegradation {
  /** The owner's written reason. Recorded here and in the journal; never sent to a provider. */
  readonly reason: string;
  /** The attempt the owner granted it from. */
  readonly attempt: number;
  readonly at: string;
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

/**
 * The driving-session group id, validated as a path-safe identifier.
 *
 * Deliberately the same grammar and bound the planning store applies to a group
 * id, restated rather than imported: `planning-isolation.test.ts` permits only
 * `cli/commands/group.ts` to reach into `core/src/planning/`, and an execution
 * module importing it to save six characters would be the first crack in that
 * fence. Two one-way records of the same fact, neither side importing the other.
 */
export function assertGroupId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)) {
    throw new Error(`--group ${JSON.stringify(value)} is not a path-safe identifier of 1-100 characters`);
  }
  return value;
}

/** The plan stem, in the same grammar. Whether it is REGISTERED is `plan-ref.ts`. */
export function assertPlanRef(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)) {
    throw new Error(`--plan ${JSON.stringify(value)} is not a path-safe identifier of 1-100 characters`);
  }
  return value;
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
type LegacyStatus = Omit<AttemptStatus, "ceilingGrants" | "continuesTask" | "groupId" | "planRef" | "routeOverrides" | "reviewDegradation"> & {
  ceilingGrants?: readonly CeilingGrant[];
  continuesTask?: string | null;
  groupId?: string | null;
  planRef?: string | null;
  routeOverrides?: PhaseRouteOverrides;
  reviewDegradation?: ReviewDegradation | null;
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
  if (
    budgetIsCurrent && legacy.ceilingGrants !== undefined && legacy.continuesTask !== undefined &&
    legacy.groupId !== undefined && legacy.planRef !== undefined &&
    legacy.routeOverrides !== undefined && legacy.reviewDegradation !== undefined
  ) return status;
  return {
    ...status,
    continuesTask: legacy.continuesTask ?? null,
    // A run that predates groups belongs to none, and NULL is what that says.
    // Nothing infers one from when it ran or what ran beside it.
    groupId: legacy.groupId ?? null,
    // A run that predates plan linkage named no plan. Reading one out of its
    // task id now would be the guess migration 0005 refused in the first place.
    planRef: legacy.planRef ?? null,
    // An attempt written before per-attempt routing existed chose neither, and
    // reading it as "no override, no grant" is what it meant.
    routeOverrides: legacy.routeOverrides ?? {},
    reviewDegradation: legacy.reviewDegradation ?? null,
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
        if (
          current !== null &&
          (SEALED_STATES as readonly TaskState[]).includes(current.lifecycleState)
        ) {
          throw new SealedAttempt(current.lifecycleState);
        }
        if (
          current?.lifecycleState === "LANDED" &&
          event.next.lifecycleState !== "PUBLISHED"
        ) {
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
      sealWhenTerminal: (status) =>
        (SEALED_STATES as readonly TaskState[]).includes(status.lifecycleState)
          ? status.lifecycleState
          : null,
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
    case "PUBLISHED": return "no action required; the landed candidate is published";
    case "BLOCKED": return `resolve the blocker, then run \`awsf retry ${taskId}\``;
    case "CANCELLED": return `run \`awsf retry ${taskId}\` only if the task should resume`;
  }
}
