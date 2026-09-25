// `awsf degrade-review <task> --reason "<why independence is worth giving up>"`
// — the owner act that lets ONE attempt's review run on its builder's provider.
//
// The default review is bought from the opposite provider because a review is
// the only thing standing between a candidate and the owner's branch, and a
// provider grading its own output is not that. `routing.review` names one
// deliberately alarming alternative, and `schema.ts` states the rule this
// command must not break: same-provider review "is never selected from
// availability, quota, or a transport failure."
//
// That rule is about the HOST never selecting it. A quota-exhausted owner still
// needs a way to keep working, and this is it — with the same four properties
// `awsf raise` uses to stay a decision rather than an escape hatch:
//
//   It is a COMMAND, not a configuration edit, so `configSnapshotJson` still
//   equals the file on disk and `awsf rework`/`awsf review` remain available.
//
//   It is ATTEMPT-SCOPED. One attempt's review is degraded. The project's
//   durable `routing.review` is untouched, so the next attempt is independent
//   again unless its owner says otherwise.
//
//   It is BOUNDED by being unrepeatable: an attempt carries at most one grant,
//   and there is no flag that degrades every future attempt at once.
//
//   It is the OWNER'S. An interactive terminal and a written reason, both
//   checked before anything is persisted. `degrade-review` belongs in marimba's
//   OWNER_ACTS, so a driving session is denied it by VERB — not by matching an
//   argument, which that guard's own contract says it cannot do reliably.

import {
  isTerminalStatus,
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptProjector,
  type AttemptStatus,
  type ReviewDegradation,
} from "./attempt.ts";
import { REVIEW_OUTPUT_SCHEMA_ID } from "../../contracts/review-output.ts";
import { REDACTED_VALUE, scrubCredentialString } from "../../policy/redaction.ts";
import { compiledWorkflow, workflowRecipe } from "../../workflow/catalog.ts";
import type { OwnerTerminal } from "../tty.ts";

const MAX_REASON = 2_000;

export class ReviewDegradeNotInteractive extends Error {
  constructor(taskId: string) {
    super(
      `awsf degrade-review ${taskId} requires an interactive owner terminal: giving up review independence is the owner's act, ` +
        "and a piped or redirected stdin cannot make it",
    );
    this.name = "ReviewDegradeNotInteractive";
  }
}

export class ReviewDegradeReasonRequired extends Error {
  constructor() {
    super("awsf degrade-review requires --reason naming why this attempt is worth a less independent review; it is a record, never a key");
    this.name = "ReviewDegradeReasonRequired";
  }
}

export class ReviewDegradeCredentialRejected extends Error {
  constructor(source: string) {
    super(`review degradation rejected ${source}: credential-shaped data is never persisted`);
    this.name = "ReviewDegradeCredentialRejected";
  }
}

export class ReviewDegradeAttemptNotLive extends Error {
  constructor(state: string, taskId: string) {
    super(
      `attempt is ${state}, which is terminal: a review is degraded while its attempt is LIVE, and this one has ended; ` +
        `run \`awsf retry ${taskId}\` to open the next attempt, then degrade that one if it still needs it`,
    );
    this.name = "ReviewDegradeAttemptNotLive";
  }
}

/** The workflow buys no review, so there is no independence to give up. */
export class ReviewDegradeNoReviewPhase extends Error {
  constructor(workflow: string, taskId: string) {
    super(
      `workflow ${JSON.stringify(workflow)} has no review phase, so ${taskId} has no review to degrade; ` +
        "its phases may share one provider already",
    );
    this.name = "ReviewDegradeNoReviewPhase";
  }
}

export class ReviewDegradeAlreadyGranted extends Error {
  constructor(taskId: string, at: string) {
    super(`${taskId} already carries a review degradation granted at ${at}; one attempt takes at most one grant`);
    this.name = "ReviewDegradeAlreadyGranted";
  }
}

export interface DegradeReviewCommandOptions {
  readonly attemptDir: string;
  readonly reason: string;
  readonly terminal: OwnerTerminal;
  readonly projectRecord?: AttemptProjector;
  readonly now?: () => string;
}

export interface DegradeReviewCommandResult {
  readonly status: AttemptStatus;
  readonly confirmed: boolean;
}

/** The owner's written record of why this review may be less independent. */
export function assertDegradeReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) throw new ReviewDegradeReasonRequired();
  const bounded = normalized.length <= MAX_REASON ? normalized : normalized.slice(0, MAX_REASON);
  if (scrubCredentialString(bounded) !== bounded || bounded.includes(REDACTED_VALUE)) {
    throw new ReviewDegradeCredentialRejected("owner degrade-review reason");
  }
  return bounded;
}

/** Whether this attempt's workflow buys a review at all. */
export function workflowBuysReview(workflow: string): boolean {
  const recipe = workflowRecipe(workflow);
  if (recipe === null) return compiledWorkflow(workflow)?.buysReview ?? false;
  return recipe.phases.some((phase) => phase.kind === "agent" && phase.schemaId === REVIEW_OUTPUT_SCHEMA_ID);
}

export async function degradeReviewCommand(
  options: DegradeReviewCommandOptions,
): Promise<DegradeReviewCommandResult> {
  // The medium first, exactly as `awsf raise` does it: a caller that cannot
  // type into a terminal cannot take this act, whatever it is asking for.
  const status = await readAttempt(options.attemptDir);
  if (!options.terminal.interactive) throw new ReviewDegradeNotInteractive(status.taskId);
  const reason = assertDegradeReason(options.reason);
  if (isTerminalStatus(status)) throw new ReviewDegradeAttemptNotLive(status.lifecycleState, status.taskId);
  if (!workflowBuysReview(status.workflow)) throw new ReviewDegradeNoReviewPhase(status.workflow, status.taskId);
  if (status.reviewDegradation !== null) {
    throw new ReviewDegradeAlreadyGranted(status.taskId, status.reviewDegradation.at);
  }

  options.terminal.write(`Task: ${status.project}/${status.taskId} attempt ${status.attempt}, T${status.tier}, ${status.lifecycleState}`);
  options.terminal.write(`Workflow: ${status.workflow} — its review is bought from the provider opposite the builder's.`);
  options.terminal.write(`Reason on record: ${reason}`);
  options.terminal.write("Granting lets this attempt's review run on the SAME provider as its builder. A provider checking its own output finds less than an independent one does, and the candidate this produces is weaker evidence than a cross-provider run.");
  options.terminal.write("The grant is recorded on this attempt alone. routing.review is not edited, no other task is widened, and the next attempt is independent again unless it is granted separately.");
  options.terminal.write("The review still runs, still gates, and is still recorded — it is marked degraded in the route provenance and on `awsf status`, permanently.");
  const confirmed = await options.terminal.confirm(`Allow ${status.taskId}'s review to run on the builder's provider?`);
  if (!confirmed) return { status, confirmed: false };

  // Close the display-to-write race the same way `awsf raise` does: the owner
  // decided about an attempt that was live when they read it.
  const current = await readAttempt(options.attemptDir);
  if (isTerminalStatus(current)) throw new ReviewDegradeAttemptNotLive(current.lifecycleState, current.taskId);
  if (current.reviewDegradation !== null) {
    throw new ReviewDegradeAlreadyGranted(current.taskId, current.reviewDegradation.at);
  }

  const at = (options.now ?? ((): string => new Date().toISOString()))();
  const grant: ReviewDegradation = { reason, attempt: current.attempt, at };
  const next = nextRevision(current, {
    reviewDegradation: grant,
    lastActivityAt: at,
    lastActivity: `owner allowed a same-provider review on this attempt: ${reason}`,
    // The lifecycle did not move, so neither does the recommendation.
    nextAction: nextActionFor(current.lifecycleState, current.taskId),
  });
  const persisted = await persistAttempt(options.attemptDir, current.revision, {
    kind: "attempt.updated",
    next,
    evidence: { type: "review-degradation", reason, attempt: current.attempt, at },
  }, options.projectRecord);
  return { status: persisted, confirmed: true };
}
