// `awsf raise <task> --calls <n> --reason "<why this task is worth more>"` —
// the owner act that moves ONE task's call ceiling while its attempt is live.
//
// The ceiling is a checkpoint, not a cap. A run that reaches it stops, says
// where it is, and waits for the person paying for the calls to decide whether
// it continues. This is that decision, and four properties make it one rather
// than an escape hatch:
//
//   It is a COMMAND, not a configuration edit. An attempt records the effective
//   configuration it was created under, and `awsf rework` and `awsf review`
//   both refuse when the live config no longer matches that snapshot. Raising
//   the ceiling by editing `awsf.config.yaml` mid-attempt would therefore lock
//   the owner out of precisely the acts the raise was for. The grant lives on
//   the attempt instead, and the snapshot is never touched.
//
//   It is TASK-SCOPED. The grant is written into one task's own journal and
//   status, so it can widen that task and structurally cannot widen another —
//   there is no shared ceiling for it to move.
//
//   It is BOUNDED. One act adds at most `MAX_GRANT_CALLS`, and no sequence of
//   acts can carry a ceiling past `MAX_CALL_CEILING`. There is no unbounded
//   grant and no "unlimited" flag; an agent looping on a subscription is the
//   thing the ceiling protects against, and a bound that can be removed is not
//   one.
//
//   It is the OWNER'S. It requires an interactive terminal — a piped stdin is
//   refused before anything is written — and a reason in words, which is
//   recorded in the journal beside the grant it explains. The reason is a
//   record and not a key: it unlocks nothing, and it is never sent to a
//   provider.

import {
  isTerminalStatus,
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptProjector,
  type AttemptStatus,
  type CeilingGrant,
} from "./attempt.ts";
import { REDACTED_VALUE, scrubCredentialString } from "../../policy/redaction.ts";
import { MAX_CALL_CEILING, assertCeiling, ceilingFor } from "../../state/tiers.ts";
import type { OwnerTerminal } from "../tty.ts";

/**
 * The most one act may add.
 *
 * A T2 workflow's whole budget, which is enough to buy a correction cycle plus
 * the replacement review the pilot could not afford. A larger jump is several
 * deliberate acts, each with its own reason on the record — which is the point:
 * the cost signal is what makes the factory trustworthy in the other direction.
 */
export const MAX_GRANT_CALLS = 5;

const MAX_REASON = 2_000;

export class CeilingRaiseNotInteractive extends Error {
  constructor(taskId: string) {
    super(
      `awsf raise ${taskId} requires an interactive owner terminal: raising what an attempt may cost is the owner's act, ` +
        "and a piped or redirected stdin cannot make it",
    );
    this.name = "CeilingRaiseNotInteractive";
  }
}

export class CeilingRaiseReasonRequired extends Error {
  constructor() {
    super("awsf raise requires --reason naming why this task is worth more calls; it is a record, never a key");
    this.name = "CeilingRaiseReasonRequired";
  }
}

export class CeilingRaiseCredentialRejected extends Error {
  constructor(source: string) {
    super(`ceiling raise rejected ${source}: credential-shaped data is never persisted`);
    this.name = "CeilingRaiseCredentialRejected";
  }
}

/** A grant of nothing, of a fraction, or of more than one act may give. */
export class CeilingRaiseInvalid extends Error {
  constructor(calls: number) {
    super(
      `awsf raise adds a whole number of calls from 1 through ${MAX_GRANT_CALLS}, not ${calls}; ` +
        "a raise never lowers a ceiling, and a larger increase is several deliberate acts",
    );
    this.name = "CeilingRaiseInvalid";
  }
}

/** The bound, refused by name rather than by a bare range error. */
export class CeilingRaiseBeyondBound extends Error {
  constructor(from: number, calls: number, taskId: string) {
    super(
      `raising ${taskId} from ${from} by ${calls} would exceed the hard bound of ${MAX_CALL_CEILING} calls; ` +
        "the ceiling can be raised and cannot be removed — cancel and re-scope the task instead",
    );
    this.name = "CeilingRaiseBeyondBound";
  }
}

export class CeilingRaiseAttemptNotLive extends Error {
  constructor(state: string, taskId: string) {
    super(
      `attempt is ${state}, which is terminal: a ceiling is raised while its attempt is LIVE, and this one has ended; ` +
        `run \`awsf retry ${taskId}\` to open the next attempt, which carries both the spend and the grants, then raise it`,
    );
    this.name = "CeilingRaiseAttemptNotLive";
  }
}

/** The ceiling moved between the display and the write — another act landed. */
export class CeilingRaiseRaced extends Error {
  constructor(displayed: number, observed: number) {
    super(`the ceiling was ${displayed} when it was displayed and is ${observed} now; nothing was granted`);
    this.name = "CeilingRaiseRaced";
  }
}

export interface RaiseCommandOptions {
  readonly attemptDir: string;
  readonly calls: number;
  readonly reason: string;
  readonly terminal: OwnerTerminal;
  readonly projectRecord?: AttemptProjector;
  readonly now?: () => string;
}

export interface RaiseCommandResult {
  readonly status: AttemptStatus;
  readonly confirmed: boolean;
  /** The effective ceiling after the act — unchanged when the owner declined. */
  readonly ceiling: number;
}

/** Whole calls only, and never zero or negative: a raise raises. */
export function assertGrantCalls(calls: number): number {
  if (!Number.isInteger(calls) || calls < 1 || calls > MAX_GRANT_CALLS) throw new CeilingRaiseInvalid(calls);
  return calls;
}

/**
 * The owner's written record of why the ceiling moved.
 *
 * Bounded and credential-checked like every other persisted owner text. It
 * reaches the journal and the status and stops there — no prompt, no provider,
 * no gate reads it.
 */
export function assertGrantReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) throw new CeilingRaiseReasonRequired();
  const bounded = normalized.length <= MAX_REASON ? normalized : normalized.slice(0, MAX_REASON);
  if (scrubCredentialString(bounded) !== bounded || bounded.includes(REDACTED_VALUE)) {
    throw new CeilingRaiseCredentialRejected("owner raise reason");
  }
  return bounded;
}

/** This task's effective ceiling: what it records, or its tier's documented default. */
export function effectiveCeiling(status: AttemptStatus): number {
  return ceilingFor(status.tier, status.budget.ceiling);
}

export async function raiseCommand(options: RaiseCommandOptions): Promise<RaiseCommandResult> {
  // The medium first, before a reason is even parsed: a caller that cannot type
  // into a terminal cannot take this act, whatever it is asking for.
  const status = await readAttempt(options.attemptDir);
  if (!options.terminal.interactive) throw new CeilingRaiseNotInteractive(status.taskId);
  const calls = assertGrantCalls(options.calls);
  const reason = assertGrantReason(options.reason);
  if (isTerminalStatus(status)) throw new CeilingRaiseAttemptNotLive(status.lifecycleState, status.taskId);

  const from = effectiveCeiling(status);
  if (from + calls > MAX_CALL_CEILING) throw new CeilingRaiseBeyondBound(from, calls, status.taskId);
  const to = assertCeiling(from + calls, `${status.project}/${status.taskId}`);
  const committed = status.budget.callsSpent + status.budget.callsReserved;

  options.terminal.write(`Task: ${status.project}/${status.taskId} attempt ${status.attempt}, T${status.tier}, ${status.lifecycleState}`);
  options.terminal.write(`Calls: ${status.budget.callsSpent} spent and ${status.budget.callsReserved} reserved against a ceiling of ${from} — ${Math.max(0, from - committed)} remain`);
  options.terminal.write(`Raise: ${from} -> ${to} (+${calls}); ${Math.max(0, to - committed)} would remain`);
  options.terminal.write(`Reason on record: ${reason}`);
  options.terminal.write(`This grant is recorded on ${status.taskId} alone and widens no other task; awsf.config.yaml is not edited, so the attempt's configuration snapshot still matches and \`awsf rework\`/\`awsf review\` remain available.`);
  options.terminal.write(`The ceiling stays a bound: no grant may carry it past ${MAX_CALL_CEILING} calls.`);
  options.terminal.write("Confirming records an irreversible grant and reason. It spends no call now, does not invalidate gates, and cannot later lower this task's ceiling; cancellation remains available while the attempt is live.");
  const confirmed = await options.terminal.confirm(`Raise ${status.taskId}'s ceiling to ${to} call(s)?`);
  if (!confirmed) return { status, confirmed: false, ceiling: from };

  // Close the display-to-write race: the owner decided against a ceiling that
  // was true when they read it, and a grant that landed meanwhile would make
  // this one add to a number nobody was shown.
  const current = await readAttempt(options.attemptDir);
  if (isTerminalStatus(current)) throw new CeilingRaiseAttemptNotLive(current.lifecycleState, current.taskId);
  if (effectiveCeiling(current) !== from) throw new CeilingRaiseRaced(from, effectiveCeiling(current));

  const at = (options.now ?? ((): string => new Date().toISOString()))();
  const grant: CeilingGrant = { calls, ceiling: to, reason, attempt: current.attempt, at };
  const next = nextRevision(current, {
    budget: { ...current.budget, ceiling: to },
    ceilingGrants: [...current.ceilingGrants, grant],
    lastActivityAt: at,
    lastActivity: `owner raised the call ceiling ${from} -> ${to}: ${reason}`,
    // The lifecycle did not move, so neither does the recommendation.
    nextAction: nextActionFor(current.lifecycleState, current.taskId),
  });
  const persisted = await persistAttempt(options.attemptDir, current.revision, {
    kind: "attempt.updated",
    next,
    evidence: { type: "ceiling-grant", calls, from, to, reason, attempt: current.attempt, at },
  }, options.projectRecord);
  return { status: persisted, confirmed: true, ceiling: to };
}
