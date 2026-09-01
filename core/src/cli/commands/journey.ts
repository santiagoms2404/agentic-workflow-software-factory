// The owner's attestation that the recorded end-user journey ran, against the
// exact candidate, and passed. It exists because `journey_passes` asks three
// separate questions and nothing inside the host can answer any of them: the
// journey is a human exercising the built software, so its evidence has to
// enter the system through a human at a terminal. This command therefore does
// exactly one thing — turn what the owner observed into a gate report — and it
// deliberately cannot pass itself.

import { journeyPasses } from "../../gates/journey.ts";
import { runGit, systemGitRunner } from "../../git/changes.ts";
import { buildReviewWorkflow } from "../../workflow/recipes/build-review.ts";
import { simpleSdlcWorkflow } from "../../workflow/recipes/simple-sdlc.ts";
import type { OwnerTerminal } from "../tty.ts";
import {
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";

/**
 * The journey is a phase of the attempt in the evidence model's sense — it has
 * an ordinal, a status, and a window — and its kind is `engineer` for the same
 * reason the `request` phase is: both are content a human supplied rather than a
 * provider. It sits one past the compiled workflow, which is also how owner
 * rework numbers the phase it appends.
 */
const WORKFLOW_PHASE_COUNTS = new Map<string, number>([
  [buildReviewWorkflow.id, buildReviewWorkflow.phases.length],
  [simpleSdlcWorkflow.id, simpleSdlcWorkflow.phases.length],
]);

export class JourneyNotApplicable extends Error {
  constructor(detail: string) {
    super(`the end-user journey gate does not apply here: ${detail}`);
    this.name = "JourneyNotApplicable";
  }
}

export class JourneyEvidenceRejected extends Error {
  readonly violations: readonly string[];
  constructor(violations: readonly string[]) {
    super(`journey evidence rejected: ${violations.join("; ")}`);
    this.name = "JourneyEvidenceRejected";
    this.violations = violations;
  }
}

export interface JourneyCommandOptions {
  readonly attemptDir: string;
  readonly terminal: OwnerTerminal;
  /** Names the journey the owner ran, so the record says which one passed. */
  readonly journeyId: string;
  /** The SHA the owner states they exercised. Never defaulted to the candidate. */
  readonly observedSha: string;
  readonly now?: () => string;
  readonly projectRecord?: AttemptProjector;
}

export interface JourneyCommandResult {
  readonly status: AttemptStatus;
  readonly confirmed: boolean;
}

export async function journeyCommand(options: JourneyCommandOptions): Promise<JourneyCommandResult> {
  const status = await readAttempt(options.attemptDir);
  if (status.tier < 2) {
    throw new JourneyNotApplicable(`tier ${status.tier} never buys an end-user journey; only T2 landings require one`);
  }
  if (status.lifecycleState !== "AWAITING_OWNER") {
    throw new JourneyNotApplicable(`the journey is recorded against a gated candidate, and this attempt is ${status.lifecycleState}`);
  }
  if (status.candidateSha === null) throw new JourneyNotApplicable("this attempt has no candidate to have journeyed");
  // A piped stdin is refused for the same reason landing refuses one: an
  // attestation nobody made is not evidence, and the refusal happens before any
  // record is written.
  if (!options.terminal.interactive) {
    throw new JourneyNotApplicable("recording a journey requires an interactive owner terminal");
  }
  if (status.journeyApproved) throw new JourneyNotApplicable("this attempt already carries an approved journey");

  const trimmedId = options.journeyId.trim();
  if (trimmedId.length === 0) throw new JourneyEvidenceRejected(["the journey needs a recorded id"]);
  const observed = options.observedSha.trim();

  // Resolving through Git means a short SHA, a tag, or `HEAD` is accepted only
  // when it names the very object the host built; an unresolvable revision is
  // reported as observed-nothing rather than silently treated as a mismatch.
  const worktree = status.worktree;
  let resolved: string | null = null;
  if (worktree !== null && observed.length > 0) {
    try {
      resolved = runGit(systemGitRunner(worktree), ["rev-parse", "--verify", `${observed}^{commit}`]).trim();
    } catch {
      resolved = null;
    }
  }

  const report = journeyPasses(
    { journeyId: trimmedId, ran: true, passed: true, candidateSha: resolved },
    status.candidateSha,
  );

  options.terminal.write(`Journey:   ${trimmedId}`);
  options.terminal.write(`Candidate: ${status.candidateSha}`);
  options.terminal.write(`Observed:  ${resolved ?? `${observed} (does not resolve to a commit in the managed worktree)`}`);
  for (const check of report.checks) {
    options.terminal.write(`  ${check.ok ? "ok  " : "FAIL"} ${check.item} — ${check.note}`);
  }

  if (!report.passed) {
    throw new JourneyEvidenceRejected(report.checks.filter((check) => !check.ok).map((check) => `${check.item}: ${check.note}`));
  }

  options.terminal.write("Cost: 0 provider calls. This records your attestation without changing the candidate or invalidating gates; a later rework of the candidate invalidates the attestation.");
  options.terminal.write("Once confirmed, this evidence remains in the journal and cannot be edited or withdrawn on this attempt.");
  const confirmed = await options.terminal.confirm(
    `Do you attest that you ran ${trimmedId} against ${status.candidateSha} and it passed?`,
  );
  if (!confirmed) return { status, confirmed: false };

  const at = (options.now ?? ((): string => new Date().toISOString()))();
  const ordinal = (WORKFLOW_PHASE_COUNTS.get(status.workflow) ?? 0) + 1;
  if (ordinal === 1) throw new JourneyNotApplicable(`workflow ${JSON.stringify(status.workflow)} has no known phase count to append a journey to`);
  const phaseId = `${status.sessionId}:owner-journey`;

  // The phase row is written first because the gate references it: a gate result
  // with no phase is not storable, and a journey with no gate is not evidence.
  const withPhase = await persistAttempt(options.attemptDir, status.revision, {
    kind: "attempt.updated",
    next: nextRevision(status, {
      lastActivityAt: at,
      lastActivity: `owner journey ${trimmedId} recorded against ${status.candidateSha}`,
    }),
    evidence: {
      type: "phase",
      phase: {
        phaseId, ordinal, key: "owner-journey", name: "owner journey",
        kind: "engineer", owner: "owner",
        description: `Owner ran the recorded end-user journey ${trimmedId} against the exact candidate`,
        status: "SUCCEEDED", correctionCount: 0, maxCorrections: 0,
        errorCode: null, errorMessage: null, startedAt: at, endedAt: at, createdAt: at,
      },
    },
  }, options.projectRecord);

  return {
    status: await persistAttempt(options.attemptDir, withPhase.revision, {
      kind: "attempt.updated",
      next: nextRevision(withPhase, {
        journeyApproved: true,
        lastActivityAt: at,
        lastActivity: `owner attested journey ${trimmedId} against ${status.candidateSha}`,
        nextAction: `run \`awsf land ${status.taskId}\` at a TTY`,
      }),
      evidence: {
        type: "gate",
        id: `${status.sessionId}:journey:${trimmedId}`,
        phaseId,
        round: 0,
        gateId: "journey_passes",
        kind: "journey",
        candidateSha: status.candidateSha,
        passed: true,
        exitCode: null,
        checks: report.checks,
        violations: [],
        outputPath: null,
        startedAt: at,
        endedAt: at,
      },
    }, options.projectRecord),
    confirmed: true,
  };
}
