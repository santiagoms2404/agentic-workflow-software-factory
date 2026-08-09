import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { attemptDir as attemptDirectory } from "../../persistence/platform-paths.ts";
import { ReservationOutstanding } from "../../execution/call-budget.ts";
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
  const next: AttemptStatus = {
    ...prior,
    sessionId: (options.sessionId ?? randomUUID)(),
    attempt,
    lifecycleState: "DRAFT",
    worktree: null,
    baseSha: null,
    candidateSha: null,
    phase: null,
    budget: {
      ...prior.budget,
      attempt,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
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
