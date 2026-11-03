import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { attemptDir as attemptDirectory } from "../../persistence/platform-paths.ts";
import { redactConfigSnapshotJson } from "../../config/effective-config.ts";
import { ReservationOutstanding } from "../../execution/call-budget.ts";
import { correctionAllowance } from "../../state/task-machine.ts";
import { assertCeiling, ceilingFor, type CallCeilings } from "../../state/tiers.ts";
import {
  assertGroupId,
  isTerminalStatus,
  latestAttemptNumber,
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
  /**
   * The driving session minting THIS attempt. Absent records NULL; it is never
   * taken from the prior attempt. See the `groupId` line below for why.
   */
  readonly groupId?: string;
  readonly now?: () => string;
  readonly sessionId?: () => string;
  readonly projectRecord?: AttemptProjector;
}

/** Retry is not a state transition: it mints attempt n+1 and carries spend. */
export async function retryCommand(options: RetryCommandOptions): Promise<{ attemptDir: string; status: AttemptStatus }> {
  const prior = await readAttempt(options.attemptDir);
  if (options.groupId !== undefined) assertGroupId(options.groupId);
  if (!isTerminalStatus(prior)) throw new Error(`attempt ${prior.attempt} is ${prior.lifecycleState}, not terminal`);
  if (prior.budget.callsReserved > 0) {
    throw new ReservationOutstanding(`retry ${prior.taskId}`, [`${prior.budget.callsReserved} unaccounted call(s)`]);
  }

  const root = taskRoot(options.stateRoot, prior.project, prior.taskId);
  const latest = await latestAttemptNumber(root) ?? prior.attempt;
  // Only the latest attempt may be retried (B9-05). Attempt n+1 carries the
  // prior attempt's spend, so minting it from an older attempt would carry a
  // smaller spend than the task has really used and let the task-lifetime
  // ceiling stop binding — repeatably, since the older attempt never changes —
  // and could leave two live attempts side by side. A live later attempt is
  // named first because it is the one the owner has to settle.
  if (latest > prior.attempt) {
    for (let later = prior.attempt + 1; later <= latest; later += 1) {
      const status = await readAttempt(join(root, String(later))).catch(() => null);
      if (status !== null && !isTerminalStatus(status)) {
        throw new Error(`cannot retry attempt ${prior.attempt}: attempt ${later} is live (${status.lifecycleState})`);
      }
    }
    throw new Error(`attempt ${prior.attempt} is not the latest attempt (${latest}); retry attempt ${latest} instead`);
  }
  const attempt = latest + 1;
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
    // B9-18: Retrying a seeded attempt clears the candidate seed and base SHA.
    // The candidate seed was validated only for its specific target attempt (attempt 1)
    // and session. Attempt n+1 prepares freshly from canonical HEAD rather than inheriting
    // the prior seed commit.
    ...(prior.seed === undefined ? {} : { seed: null }),
    recovery: null, activeOperation: null, advice: null,
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
    // The routes the owner chose for this task carry forward; the permission to
    // review without independence does NOT. A grant is attempt-scoped for the
    // same reason `ownerReentries` resets above: a new attempt is what makes
    // the owner decide again, and a degradation that survived silently would be
    // a durable mode nobody wrote down.
    reviewDegradation: null,
    // NOT inherited from the spread above. A group says "these came out of the
    // same driving session", and this attempt came out of whichever session is
    // running `awsf retry` now — which may be a different one, or none. Letting
    // it ride the spread would collapse every continuation chain into a single
    // group and leave the cross-group edge with nothing to connect.
    groupId: options.groupId ?? null,
    // CARRIED, and named here rather than left to the spread so the contrast
    // with `groupId` above is visible in one place. A plan says what this work
    // is; attempt 2 is the same work, so it is the same plan. A group says which
    // driving session minted the attempt, and this one was minted now.
    planRef: prior.planRef,
    model: null,
    lastActivityAt: now,
    lastActivity: prior.seed != null
      ? `retry minted attempt ${attempt}; cleared candidate seed from attempt ${prior.attempt}; carried ${prior.budget.callsSpent} spent call(s) from attempt ${prior.attempt}`
      : `retry minted attempt ${attempt}; carried ${prior.budget.callsSpent} spent call(s) from attempt ${prior.attempt}`,
    nextAction: "", // persistAttempt renders the new attempt, never the prior record
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
