import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { attemptDir as attemptDirectory } from "../../persistence/platform-paths.ts";
import { redactConfigSnapshotJson } from "../../config/effective-config.ts";
import { ReservationOutstanding } from "../../execution/call-budget.ts";
import { correctionAllowance } from "../../state/task-machine.ts";
import { assertCeiling, ceilingFor, type CallCeilings } from "../../state/tiers.ts";
import {
  isTerminalStatus,
  latestAttemptNumber,
  nextActionFor,
  persistAttempt,
  readAttempt,
  taskRoot,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";

export interface RetryCommandOptions {
  readonly attemptDir: string;
  readonly stateRoot: string;
  /** The currently loaded effective config, never the prior attempt's snapshot. */
  readonly configSnapshotJson: string;
  /** The currently configured correction allowance for attempt n+1. */
  readonly allowance: { readonly auto: number; readonly owner: number; readonly ownerReentries?: number };
  /** The currently configured `risk.call_ceiling`, re-read like the allowance is. */
  readonly callCeilings?: CallCeilings;
  readonly now?: () => string;
  readonly sessionId?: () => string;
  readonly projectRecord?: AttemptProjector;
}

/** Retry is not a state transition: it mints attempt n+1 and carries spend. */
export async function retryCommand(options: RetryCommandOptions): Promise<{ attemptDir: string; status: AttemptStatus }> {
  const prior = await readAttempt(options.attemptDir);
  if (!isTerminalStatus(prior)) throw new Error(`attempt ${prior.attempt} is ${prior.lifecycleState}, not terminal`);
  if (prior.budget.callsReserved > 0) {
    throw new ReservationOutstanding(`retry ${prior.taskId}`, [`${prior.budget.callsReserved} unaccounted call(s)`]);
  }

  const root = taskRoot(options.stateRoot, prior.project, prior.taskId);
  const attempt = (await latestAttemptNumber(root) ?? prior.attempt) + 1;
  if (attempt <= prior.attempt) throw new Error("retry attempt number did not advance");
  const dir = attemptDirectory(options.stateRoot, prior.project, prior.taskId, String(attempt));
  const now = (options.now ?? ((): string => new Date().toISOString()))();
  // Attempt n+1 takes the CURRENT configured ceiling, exactly as it takes the
  // current allowance and the current config snapshot — and then re-applies
  // every grant this task was given. Spend carries forward, so the raises that
  // paid for it must carry forward too, or the new attempt opens over its own
  // ceiling with no act left to have caused it.
  const granted = prior.ceilingGrants.reduce((total, grant) => total + grant.calls, 0);
  const ceiling = assertCeiling(
    ceilingFor(prior.tier, options.callCeilings) + granted,
    `${prior.project}/${prior.taskId} at T${prior.tier} with ${granted} granted call(s)`,
  );
  const next: AttemptStatus = {
    ...prior,
    sessionId: (options.sessionId ?? randomUUID)(),
    attempt,
    lifecycleState: "DRAFT",
    configSnapshotJson: redactConfigSnapshotJson(options.configSnapshotJson),
    worktree: null,
    baseSha: null,
    candidateSha: null,
    ...(prior.seed === undefined ? {} : { seed: null }),
    recovery: null, activeOperation: null,
    phase: null,
    budget: {
      ...prior.budget,
      attempt,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
      // Attempt-scoped, so a new attempt is what buys the owner another
      // re-entry. Nothing else does.
      ownerReentries: 0,
      allowance: correctionAllowance(options.allowance),
      ceiling,
    },
    model: null,
    lastActivityAt: now,
    lastActivity: `retry minted attempt ${attempt}; carried ${prior.budget.callsSpent} spent call(s) from attempt ${prior.attempt}`,
    nextAction: nextActionFor("DRAFT", prior.taskId),
    gatesPass: false,
    requiredReviewPresent: false,
    journeyApproved: false,
    protectedApprovalsValid: false,
    process: null,
    landingApproval: null,
    blocker: null,
    revision: 1,
    lastSourceSeq: 1,
  };
  return {
    attemptDir: join(root, String(attempt)),
    status: await persistAttempt(dir, null, { kind: "attempt.retried", next }, options.projectRecord),
  };
}
