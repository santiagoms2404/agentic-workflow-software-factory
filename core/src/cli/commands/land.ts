import {
  completeLanding,
  inspectLanding,
  recoverLanding,
  LandingBlocked,
  type LandingInspection,
  type LandingOutcome,
} from "../../git/land.ts";
import {
  transition,
  type Actor,
  type TransitionResult,
} from "../../state/task-machine.ts";
import type { OwnerTerminal } from "../tty.ts";
import {
  writeLandingSummary,
  type LandingSummary,
} from "../../persistence/landing-summary.ts";
import {
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptAdvancementGuard,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";
import { readAttemptEvidence, recordedReviews, supersededReviewLines } from "./review-record.ts";

export interface LandCommandOptions {
  readonly attemptDir: string;
  readonly terminal: OwnerTerminal;
  readonly actor?: Actor;
  readonly now?: () => string;
  readonly projectRecord?: AttemptProjector;
  readonly assertAdvancement?: AttemptAdvancementGuard;
  /** Crash-injection boundary: L20 is durable and Git has not yet moved. */
  readonly afterLandingPersisted?: (status: AttemptStatus) => Promise<void> | void;
  /** Test seam. A record-write failure is deliberately non-blocking. */
  readonly summaryWriter?: (attemptDir: string, summary: LandingSummary) => Promise<void>;
}

export interface LandCommandResult {
  readonly status: AttemptStatus;
  readonly confirmed: boolean;
}

/**
 * THE single production authorization call for AWAITING_OWNER -> LANDING.
 * Actor and TTY checks deliberately remain inside transition(), where steps 7
 * and 8 keep their required order ahead of evidence.
 */
function authorizeLanding(
  status: AttemptStatus,
  actor: Actor,
  interactive: boolean,
  inspection: LandingInspection,
  confirmed: boolean,
): TransitionResult {
  return transition({
    from: status.lifecycleState,
    to: "LANDING",
    actor,
    tier: status.tier,
    reason: { source: "human" },
    interactive,
    budget: status.budget,
    evidence: {
      candidateSha: status.candidateSha ?? "",
      gatesPass: status.gatesPass,
      landing: {
        shaDisplayed: status.candidateSha ?? "",
        summaryDisplayed: inspection.summary,
        confirmed,
        requiredReviewPresent: status.requiredReviewPresent,
        journeyApproved: status.journeyApproved,
        protectedApprovalsValid: status.protectedApprovalsValid,
        fastForwardPreflightPasses: inspection.clean && inspection.fastForwardPossible,
      },
    },
  });
}

function summaryFor(status: AttemptStatus, inspection: LandingInspection): LandingSummary {
  const verification = [
    `- Deterministic gates: ${status.gatesPass ? "passed" : "not passed"}`,
    `- Candidate checked: ${inspection.candidateSha}`,
    `- Required review: ${status.tier === 2 ? (status.requiredReviewPresent ? "recorded" : "missing") : "not required"}`,
    `- End-user journey: ${status.tier === 2 ? (status.journeyApproved ? "approved" : "not approved") : "not required"}`,
  ].join("\n");
  const risks = [
    `- Risk tier: T${String(status.tier)}`,
    `- Canonical divergence at review: ahead ${String(inspection.ahead)}, behind ${String(inspection.behind)}`,
    `- Protected-path approvals: ${status.protectedApprovalsValid ? "valid" : "not recorded"}`,
  ].join("\n");
  return {
    problem: status.request,
    changes: inspection.summary,
    verification,
    risks,
  };
}

async function recordSummary(options: LandCommandOptions, status: AttemptStatus, inspection: LandingInspection): Promise<void> {
  try {
    await (options.summaryWriter ?? writeLandingSummary)(options.attemptDir, summaryFor(status, inspection));
  } catch {
    // This file is a review record, never landing evidence. If the human
    // approves, the candidate continues through the same persisted gate.
  }
}

function decideCompletion(status: AttemptStatus, outcome: LandingOutcome): TransitionResult {
  return transition({
    from: status.lifecycleState,
    to: "LANDED",
    actor: "host",
    tier: status.tier,
    reason: { source: "git" },
    interactive: false,
    budget: status.budget,
    evidence: {
      candidateSha: status.candidateSha ?? "",
      headSha: outcome.headSha,
      checkoutClean: outcome.checkoutClean,
    },
  });
}

function decideBlock(status: AttemptStatus, error: LandingBlocked): TransitionResult {
  return transition({
    from: status.lifecycleState,
    to: "BLOCKED",
    actor: "host",
    tier: status.tier,
    reason: { source: "git", code: error.code, detail: error.message },
    interactive: false,
    budget: status.budget,
    evidence: { candidateSha: status.candidateSha ?? "" },
  });
}

async function persistBlocked(
  attemptDir: string,
  status: AttemptStatus,
  error: LandingBlocked,
  now: string,
  project?: AttemptProjector,
): Promise<AttemptStatus> {
  const decision = decideBlock(status, error);
  const next = nextRevision(status, {
    lifecycleState: decision.to,
    lastActivityAt: now,
    lastActivity: `L24 blocked landing: ${error.message}`,
    nextAction: nextActionFor(decision.to, status.taskId),
    blocker: {
      code: error.code,
      detail: error.message,
      ahead: error.ahead,
      behind: error.behind,
    },
  });
  return persistAttempt(
    attemptDir,
    status.revision,
    { kind: "attempt.transitioned", next },
    project,
  );
}

async function finish(
  options: LandCommandOptions,
  status: AttemptStatus,
  recover: boolean,
): Promise<AttemptStatus> {
  const candidate = status.candidateSha;
  if (candidate === null) {
    return persistBlocked(
      options.attemptDir,
      status,
      new LandingBlocked("ambiguous-recovery", "LANDING record has no candidate SHA; recovery cannot guess"),
      (options.now ?? ((): string => new Date().toISOString()))(),
      options.projectRecord,
    );
  }
  options.assertAdvancement?.(status.sessionId, "LANDED");
  try {
    const outcome = recover
      ? recoverLanding(status.repository, candidate)
      : completeLanding(status.repository, candidate);
    const decision = decideCompletion(status, outcome);
    const now = (options.now ?? ((): string => new Date().toISOString()))();
    const next = nextRevision(status, {
      lifecycleState: decision.to,
      lastActivityAt: now,
      lastActivity: `L23 verified canonical HEAD ${outcome.headSha} and a clean checkout`,
      nextAction: nextActionFor(decision.to, status.taskId),
      blocker: null,
    });
    return persistAttempt(
      options.attemptDir,
      status.revision,
      { kind: "attempt.transitioned", next },
      options.projectRecord,
    );
  } catch (error) {
    const blocked = error instanceof LandingBlocked
      ? error
      : new LandingBlocked(recover ? "ambiguous-recovery" : "git-failure", error instanceof Error ? error.message : String(error));
    return persistBlocked(
      options.attemptDir,
      status,
      blocked,
      (options.now ?? ((): string => new Date().toISOString()))(),
      options.projectRecord,
    );
  }
}

export async function landCommand(options: LandCommandOptions): Promise<LandCommandResult> {
  const current = await readAttempt(options.attemptDir);
  if (current.lifecycleState === "LANDING") {
    // Approval is already durable. Re-prompting would create two human gates;
    // recovery instead proves the one approved SHA or blocks.
    return { status: await finish(options, current, true), confirmed: true };
  }
  const actor = options.actor ?? "human";
  const noInspection: LandingInspection = {
    headSha: "",
    candidateSha: current.candidateSha ?? "",
    clean: false,
    fastForwardPossible: false,
    ahead: 0,
    behind: 0,
    summary: "candidate unavailable",
  };
  if (current.lifecycleState !== "AWAITING_OWNER" || current.candidateSha === null) {
    // Pair, actor, and TTY rejections must outrank missing candidate evidence.
    authorizeLanding(current, actor, options.terminal.interactive, noInspection, false);
    throw new Error("unreachable landing authorization");
  }

  // Preserve rejection steps 7 -> 8 -> 10 before even read-only Git I/O. A
  // wrong actor or non-interactive human must hear the state complaint, not a
  // repository/preflight complaint that sits below it.
  if (actor !== "human" || !options.terminal.interactive) {
    authorizeLanding(current, actor, options.terminal.interactive, noInspection, false);
    throw new Error("unreachable landing authorization");
  }

  const inspection = inspectLanding(current.repository, current.candidateSha);
  // Write while the attempt is still AWAITING_OWNER so the polling dashboard
  // can render the same record beside the terminal confirmation.
  await recordSummary(options, current, inspection);
  options.terminal.write(`Candidate SHA: ${current.candidateSha}`);
  options.terminal.write("Summary:");
  for (const line of inspection.summary.split("\n")) options.terminal.write(`  ${line}`);
  options.terminal.write(`Fast-forward meter: canonical ahead ${inspection.ahead}, behind ${inspection.behind}`);
  // A replaced review is displayed side by side with the one it superseded.
  // `requiredReviewPresent` is one boolean, and a human gate that saw only the
  // replacement verdict would never learn that a review had been replaced or
  // why — which is precisely what L25 is obliged to make visible.
  for (const line of supersededReviewLines(recordedReviews(await readAttemptEvidence(options.attemptDir), current.sessionId))) {
    options.terminal.write(line);
  }
  const confirmed = await options.terminal.confirm(`Land exact candidate ${current.candidateSha}?`);
  if (!confirmed) return { status: current, confirmed: false };

  options.assertAdvancement?.(current.sessionId, "LANDING");
  const decision = authorizeLanding(current, actor, true, inspection, true);
  const now = (options.now ?? ((): string => new Date().toISOString()))();
  const landing = nextRevision(current, {
    lifecycleState: decision.to,
    lastActivityAt: now,
    lastActivity: `L20 human approved exact candidate ${current.candidateSha}; LANDING persisted before Git mutation`,
    nextAction: nextActionFor(decision.to, current.taskId),
    landingApproval: {
      candidateSha: current.candidateSha,
      summary: inspection.summary,
      approvedAt: now,
    },
  });
  const persisted = await persistAttempt(
    options.attemptDir,
    current.revision,
    { kind: "attempt.transitioned", next: landing },
    options.projectRecord,
  );
  await options.afterLandingPersisted?.(persisted);
  return { status: await finish(options, persisted, false), confirmed: true };
}
