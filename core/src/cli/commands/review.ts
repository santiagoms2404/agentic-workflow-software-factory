// `awsf review <task> --reason "<why the recorded review is not evidence>"` —
// the caller L25 was written for.
//
// One owner-authorized replacement review of an UNCHANGED candidate. The green
// it stands on is preserved and revalidated rather than invalidated, which is
// the whole reason the edge exists: L16 and L19 must invalidate the stale gates
// because they change the tree, and this does not.
//
// Three properties carry the command:
//
//   Eligibility is HOST-determined. `reviewEvidenceDefect` is read off the
//   recorded review phase's own gate rows and has exactly two members. A review
//   carrying a PASSING `review_evidence_present` row is not replaceable at all,
//   whatever its verdict says, and the owner's `--reason` is a record rather
//   than a key. Without that, disliking a verdict would buy a cold second
//   opinion and the mandatory opposite-provider review would be a lottery.
//
//   The candidate is revalidated three times — before authorizing L25, again
//   immediately before GO once the sandbox grant is built, and again after the
//   review answers and before L15. A clean checkout of a DIFFERENT commit is
//   invisible to both `captureChangeSet` and `assertClean`, so every one of
//   those reads is a SHA comparison and never a cleanliness one.
//
//   Persistence identities are generation-qualified — `reviewer-re<N>`, where
//   N is the owner re-entry counter this command is about to charge. Six
//   identities would otherwise collide and the replacement would silently
//   overwrite the evidence it is superseding.
//
// Named regression risk, displayed to the owner before the call is spent: the
// task leaves AWAITING_OWNER (where it could land) for REVIEWING (where it
// cannot), the owner tranche is spent by the authorization itself so L16 and
// L19 are gone, and a failed replacement blocks the attempt — which costs the
// candidate on `awsf retry`. That is accepted, not hidden.
//
// What a review of one exact candidate MEANS — the inverted route, the composed
// evidence, the turn, its single permitted retry, its gates and its artefacts —
// lives in `./review-phase.ts` and is shared with `awsf rework`'s tier-2 branch.
// This file owns only what is L25's: eligibility, the owner's reason, the
// display, the edge, and the halt.

import { registeredAdapter } from "../../adapters/registry.ts";
import { writeSystemPromptFile } from "../../adapters/system-prompt-file.ts";
import type { AwsfConfig } from "../../config/schema.ts";
import { toConfigSnapshotJson } from "../../config/effective-config.ts";
import { CallBudget } from "../../execution/call-budget.ts";
import type { BarrierRecord, TerminationReport } from "../../execution/launcher-barrier.ts";
import { ProcessTransportBroker } from "../../execution/transport-broker.ts";
import { assertClean, runGit, systemGitRunner } from "../../git/changes.ts";
import { HOST_AUTHOR } from "../../git/commit.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../observability/attempt-evidence.ts";
import { REDACTED_VALUE, scrubCredentialString, scrubCredentials } from "../../policy/redaction.ts";
import { transition, type EdgeId, type TaskState, type TransitionEvidence } from "../../state/task-machine.ts";
import { ceilingFor } from "../../state/tiers.ts";
import type { WorkflowRecipe } from "../../workflow/compiler.ts";
import { buildReviewWorkflow } from "../../workflow/recipes/build-review.ts";
import { simpleSdlcWorkflow } from "../../workflow/recipes/simple-sdlc.ts";
import type { OwnerTerminal } from "../tty.ts";
import {
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptAdvancementGuard,
  type AttemptEvent,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";
import {
  ProductionConfigSnapshotMismatch,
  ProductionRouteUnavailable,
  ProductionWorkflowUnsupported,
  requestOutput,
} from "./production-run.ts";
import {
  candidateGateRows,
  readAttemptEvidence,
  recordedReviews,
  recordedRoutes,
  type RecordedReview,
} from "./review-record.ts";
import {
  CONTRACT_RETRY_HEADING,
  REVIEW_HEADROOM_CALLS,
  ReviewCredentialRejected,
  ReviewRecordMissing,
  ReviewRouteMismatch,
  ReplacementReviewEvidenceInvalid,
  ReplacementReviewInconsistent,
  ReplacementReviewMalformed,
  contractRetryPrompt,
  createReviewRunState,
  lastTestOutputFrom,
  planIntentFrom,
  prepareReview,
  resolveReviewRoute,
  reviewFailureBlocker,
  reviewPhasesOf,
  type ObservedProcessOutcome,
  type PreparedReview,
  type ReviewPhaseInfrastructure,
  type ReviewRoute,
} from "./review-phase.ts";

/** Only a tier-2 recipe declares a review, and only a review can be replaced. */
const SUPPORTED = new Map<string, WorkflowRecipe>([
  [buildReviewWorkflow.id, buildReviewWorkflow],
  [simpleSdlcWorkflow.id, simpleSdlcWorkflow],
]);

/**
 * The host gate set a candidate is measured by, and therefore the set L25's
 * `gateEvidence.configured` demands a passing row for.
 *
 * These two are what `measureCandidate` produces against an exact SHA and what
 * `gatesPass` summarises: hygiene, and the aggregate of every configured
 * command. The individual `config.gates` entries are deliberately not listed —
 * they are aggregated into one `commands_pass` row by construction, so
 * demanding a row per entry would demand rows the host never writes.
 */
const CANDIDATE_GATE_IDS = Object.freeze(["candidate_hygiene", "commands_pass"]);

/** The sentence D5 requires the owner to read before the call is spent. */
export const CANDIDATE_LOSS_WARNING = "if this review fails, the candidate is lost";

const MAX_REASON = 2_000;

// The review half moved to `./review-phase.ts`; these names are re-exported so
// the command remains one import for its callers and its journeys.
export {
  CONTRACT_RETRY_HEADING,
  ReviewCredentialRejected,
  ReviewRecordMissing,
  ReviewRouteMismatch,
  ReplacementReviewEvidenceInvalid,
  ReplacementReviewInconsistent,
  ReplacementReviewMalformed,
  contractRetryPrompt,
};

// ---------------------------------------------------------------------------
// Refusals. Every one of these costs nothing and leaves AWAITING_OWNER intact.
// ---------------------------------------------------------------------------

export class ReviewReasonRequired extends Error {
  constructor() {
    super("awsf review requires --reason naming why the recorded review is not evidence; it is a record, never a key");
    this.name = "ReviewReasonRequired";
  }
}

/**
 * The eligibility narrowing, refused at zero cost.
 *
 * A review carrying a passing `review_evidence_present` row saw the diff, the
 * request and the gate results, so its verdict stands whatever it says. L25 is
 * a migration path out of a structural defect, not a verdict appeal.
 */
export class ReviewNotReplaceable extends Error {
  readonly verdict: string;
  constructor(verdict: string, phaseKey: string, taskId: string) {
    super(
      `the recorded review ${JSON.stringify(phaseKey)} carries a passing review_evidence_present row, so its ${verdict} verdict is not replaceable; ` +
        `accept a finding with \`awsf rework ${taskId} "<concrete defect>"\`, land it, or cancel — a replacement review is not a verdict appeal`,
    );
    this.name = "ReviewNotReplaceable";
    this.verdict = verdict;
  }
}

/**
 * Two calls of headroom, one for the review and one for its single permitted
 * retry. With one call left the review spends the last one and a transport
 * fault then raises `CallCeilingExceeded` from inside the retry closure —
 * which is not a transport failure, so it is never wrapped, and the attempt is
 * stranded in REVIEWING having taken no L17 either. Refusing costs nothing.
 */
export class ReviewHeadroomInsufficient extends Error {
  constructor(remaining: number, tier: number, taskId: string) {
    super(
      `a replacement review needs two calls of headroom — one for the review and one for its single permitted retry — and this T${tier} attempt has ${remaining}; ` +
        `insufficient headroom, so nothing was spent and \`awsf raise ${taskId} --calls ${Math.max(1, 2 - remaining)} --reason "<why>"\`, ` +
        `\`awsf land ${taskId}\` or \`awsf cancel ${taskId}\` remain`,
    );
    this.name = "ReviewHeadroomInsufficient";
  }
}

export class ReviewCandidateMoved extends Error {
  readonly when: string;
  /**
   * True only for §5.3.2's THIRD read — after the review answered.
   *
   * That one is host-deterministic evidence that the tree the reviewer read is
   * not the tree the guard approved, and §5.5 names it as `review-evidence-invalid`.
   * The earlier two reads happen before anything was bought, so they are
   * ordinary pre-GO refusals: the reservation goes back, the tranche charge is
   * rewound, and no blocker vocabulary is invoked for a review that never ran.
   */
  readonly afterReview: boolean;
  constructor(when: string, detail: string, afterReview = false) {
    super(`the candidate under review moved ${when}: ${detail}`);
    this.name = "ReviewCandidateMoved";
    this.when = when;
    this.afterReview = afterReview;
  }
}

// ---------------------------------------------------------------------------
// Options.
// ---------------------------------------------------------------------------

export type ReviewInfrastructure = ReviewPhaseInfrastructure;

export interface ReviewCommandOptions {
  readonly attemptDir: string;
  /** Masked inside the sandbox namespace; see `policy/sandbox-broker.ts`. */
  readonly stateRoot: string;
  readonly reason: string;
  readonly terminal: OwnerTerminal;
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly projectRecord?: AttemptProjector;
  readonly assertAdvancement?: AttemptAdvancementGuard;
  readonly assertLaunchProjection?: (sessionId: string) => void;
  readonly infrastructure?: Partial<ReviewInfrastructure>;
}

export interface ReviewCommandResult {
  readonly status: AttemptStatus;
  readonly confirmed: boolean;
}

interface CandidateInspection {
  readonly base: string;
  readonly candidate: string;
  readonly summary: string;
}

const DEFAULT_INFRASTRUCTURE: ReviewInfrastructure = {
  adapterFor: (_entry, adapterId, config) => registeredAdapter(config.adapters, adapterId, config.runtime),
  createBroker: (options) => new ProcessTransportBroker(options),
  writeSystemPrompt: writeSystemPromptFile,
  now: () => new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Small shared helpers, deliberately the same shapes `awsf rework` uses.
// ---------------------------------------------------------------------------

function bounded(value: string, maximum = MAX_REASON): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function credentialSafeText(value: string, source: string, rejectPriorRedaction = false): string {
  const scrubbed = scrubCredentialString(value);
  if (scrubbed !== value || (rejectPriorRedaction && value.includes(REDACTED_VALUE))) {
    throw new ReviewCredentialRejected(source);
  }
  return scrubbed;
}

function credentialSafeValue<T>(value: T, source: string): T {
  const scrubbed = scrubCredentials(value);
  if (JSON.stringify(scrubbed) !== JSON.stringify(value)) {
    throw new ReviewCredentialRejected(source);
  }
  return scrubbed;
}

function safeFailure(error: unknown): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  return scrubCredentialString(`${failure.name}: ${failure.message}`) === `${failure.name}: ${failure.message}`
    ? failure
    : new ReviewCredentialRejected("failure detail");
}

/**
 * The owner's record of why the recorded review is not evidence.
 *
 * Unlike `awsf rework`'s defect this is never sent to a provider: telling the
 * replacement reviewer that the owner rejected its predecessor would brief it
 * on a conclusion, and a briefed reviewer is an argued-with one. It is a
 * record, and it reaches the journal and nothing else.
 */
export function assertReviewReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) throw new ReviewReasonRequired();
  return credentialSafeText(bounded(normalized), "owner review reason");
}

// ---------------------------------------------------------------------------
// Preflight: the physical checks a pure guard can never make for itself.
// ---------------------------------------------------------------------------

/**
 * §5.3.2 step 1 — the full candidate revalidation, before L25 is authorized.
 *
 * Every field of the reuse key that Git can answer: both HEADs, both trees
 * clean, both objects present, ancestry, and host authorship of the candidate.
 */
function inspectCandidate(status: AttemptStatus): CandidateInspection {
  if (status.worktree === null || status.baseSha === null || status.candidateSha === null) {
    throw new ReviewCandidateMoved("at preflight", "the attempt records no managed worktree, base, and candidate");
  }
  const canonical = systemGitRunner(status.repository);
  const worktree = systemGitRunner(status.worktree);
  assertClean(status.repository, "before", canonical);
  assertClean(status.worktree, "before", worktree);
  const canonicalHead = runGit(canonical, ["rev-parse", "HEAD"]).trim();
  const observedBase = runGit(worktree, ["rev-parse", `${status.baseSha}^{commit}`]).trim();
  const observedCandidate = runGit(worktree, ["rev-parse", `${status.candidateSha}^{commit}`]).trim();
  const worktreeHead = runGit(worktree, ["rev-parse", "HEAD"]).trim();
  if (canonicalHead !== status.baseSha || observedBase !== status.baseSha) {
    throw new ReviewCandidateMoved("at preflight", `canonical HEAD and base must both equal ${status.baseSha}; observed ${canonicalHead}, ${observedBase}`);
  }
  if (observedCandidate !== status.candidateSha || worktreeHead !== status.candidateSha) {
    throw new ReviewCandidateMoved("at preflight", `recorded candidate and worktree HEAD must both equal ${status.candidateSha}; observed ${observedCandidate}, ${worktreeHead}`);
  }
  if (worktree(["merge-base", "--is-ancestor", status.baseSha, status.candidateSha]).status !== 0) {
    throw new ReviewCandidateMoved("at preflight", "the recorded candidate is not descended from the canonical base");
  }
  const identities = runGit(worktree, ["show", "-s", "--format=%an <%ae>|%cn <%ce>", status.candidateSha]).trim();
  if (identities !== `${HOST_AUTHOR}|${HOST_AUTHOR}`) {
    throw new ReviewCandidateMoved("at preflight", `the candidate is not host-created under the owner identity: ${identities}`);
  }
  if (worktree(["diff", "--check", `${status.baseSha}..${status.candidateSha}`, "--"]).status !== 0) {
    throw new ReviewCandidateMoved("at preflight", "the candidate fails `git diff --check`");
  }
  return {
    base: status.baseSha,
    candidate: status.candidateSha,
    summary: bounded(credentialSafeText(
      runGit(worktree, ["show", "--stat", "--oneline", "--format=%s", status.candidateSha]).trim(),
      "candidate summary",
      true,
    )),
  };
}

/**
 * §5.3.2 steps 2 and 3 — the same read, narrowed to identity.
 *
 * A SHA comparison, never a cleanliness one: a clean checkout of a DIFFERENT
 * commit produces an identical change-set fingerprint before and after, so the
 * permission layer cannot see it and only `rev-parse` can.
 */
function assertCandidateUnmoved(status: AttemptStatus, inspection: CandidateInspection, when: string, afterReview = false): void {
  const moved = (detail: string): never => { throw new ReviewCandidateMoved(when, detail, afterReview); };
  const canonical = systemGitRunner(status.repository);
  const worktree = systemGitRunner(status.worktree!);
  const worktreeHead = runGit(worktree, ["rev-parse", "HEAD"]).trim();
  const canonicalHead = runGit(canonical, ["rev-parse", "HEAD"]).trim();
  if (worktreeHead !== inspection.candidate) moved(`worktree HEAD is ${worktreeHead}, not the candidate ${inspection.candidate}`);
  if (canonicalHead !== inspection.base) moved(`canonical HEAD is ${canonicalHead}, not the recorded base ${inspection.base}`);
  const dirty = runGit(worktree, ["status", "--porcelain"]).trim();
  if (dirty.length > 0) moved(`the managed worktree is not clean: ${bounded(dirty, 400)}`);
  const canonicalDirty = runGit(canonical, ["status", "--porcelain"]).trim();
  if (canonicalDirty.length > 0) moved(`the canonical checkout is not clean: ${bounded(canonicalDirty, 400)}`);
}

function validateAttempt(status: AttemptStatus, config: AwsfConfig): WorkflowRecipe {
  const recipe = SUPPORTED.get(status.workflow);
  if (recipe === undefined) {
    throw new ProductionWorkflowUnsupported(status.workflow, "a replacement review needs a recipe that declares a review phase");
  }
  if (!config.workflows.enabled.includes(status.workflow)) {
    throw new ProductionWorkflowUnsupported(status.workflow, "not enabled by the effective config");
  }
  if (recipe.tier !== status.tier) {
    throw new ProductionWorkflowUnsupported(status.workflow, `recipe is tier ${recipe.tier} but the attempt is tier ${status.tier}`);
  }
  if (config.project.slug !== status.project) throw new Error("attempt and config project do not match");
  if (toConfigSnapshotJson(config) !== status.configSnapshotJson) throw new ProductionConfigSnapshotMismatch();
  return recipe;
}

/**
 * Every exited review failure gets a name and an L17 settlement.
 *
 * `ReviewCandidateMoved` is this command's own — the shared module knows
 * nothing about the three revalidations — so it is answered here and everything
 * else is deferred to the one classifier both commands read.
 */
function classify(error: unknown): { code: string; detail: string; edge: "L17" } {
  const failure = safeFailure(error);
  const detail = `${failure.name}: ${failure.message}`;
  if (failure instanceof ReviewCandidateMoved) {
    return { code: "review-evidence-invalid", detail, edge: "L17" };
  }
  return reviewFailureBlocker(failure, detail) ?? { code: "phase-abort", detail, edge: "L17" };
}

// ---------------------------------------------------------------------------
// The command.
// ---------------------------------------------------------------------------

async function runReviewCommand(options: ReviewCommandOptions): Promise<ReviewCommandResult> {
  const reason = assertReviewReason(options.reason);
  credentialSafeValue(options.config, "configured replacement review data");
  const infra: ReviewInfrastructure = { ...DEFAULT_INFRASTRUCTURE, ...options.infrastructure };
  let status = await readAttempt(options.attemptDir);
  credentialSafeText(status.request, "persisted original request", true);

  // A prior process died holding this command's reservation. Reconcile before
  // deciding anything: `awsf retry` refuses while a reservation is held, and an
  // owner re-entry charged for a launch that never happened is confiscation.
  if (status.lifecycleState === "REVIEWING" && status.budget.callsReserved > 0) {
    status = await reconcileStaleReservation(options, status, infra);
    if (status.lifecycleState === "BLOCKED") return { status, confirmed: true };
  }

  // Steps 1–9 of the ordered rejection contract outrank every measurement: a
  // wrong state, a piped owner, or a spent tranche must be heard before a Git
  // or route complaint. Measured evidence cannot exist yet, so this probe
  // carries the unmeasured shape and is only ever reached where the machine
  // refuses before step 10.
  const decide = (evidence: TransitionEvidence): void => {
    transition({
      from: status.lifecycleState, to: "REVIEWING", actor: "human", tier: status.tier,
      reason: { source: "human", detail: reason }, interactive: options.terminal.interactive,
      budget: status.budget, spawn: { cost: 1 }, evidence,
    });
  };
  if (
    status.lifecycleState !== "AWAITING_OWNER" ||
    !options.terminal.interactive ||
    status.budget.ownerReentries >= status.budget.allowance.ownerReentries
  ) {
    decide({ candidateSha: status.candidateSha ?? "" });
    throw new Error("unreachable L25 authorization");
  }

  const recipe = validateAttempt(status, options.config);
  const phases = reviewPhasesOf(recipe);

  // §5.4 — two calls of headroom or nothing happens at all.
  const remainingCalls = ceilingFor(status.tier, status.budget.ceiling) - status.budget.callsSpent - status.budget.callsReserved;
  if (remainingCalls < REVIEW_HEADROOM_CALLS) throw new ReviewHeadroomInsufficient(remainingCalls, status.tier, status.taskId);

  const evidenceRecords = await readAttemptEvidence(options.attemptDir);
  const reviews = recordedReviews(evidenceRecords, status.sessionId);
  const superseded = reviews[reviews.length - 1];
  if (superseded === undefined) {
    throw new ReviewRecordMissing("no valid review envelope is retained for this attempt");
  }
  // The eligibility narrowing, at zero cost. A passing evidence row means the
  // review is not replaceable at all — the owner's reason cannot make it one.
  if (superseded.evidenceDefect === null) {
    throw new ReviewNotReplaceable(superseded.output.verdict, superseded.phaseKey, status.taskId);
  }

  const inspection = inspectCandidate(status);
  if (superseded.output.reviewedSha !== inspection.candidate) {
    throw new ReviewRecordMissing(
      `the retained review named ${superseded.output.reviewedSha}, which is not the candidate ${inspection.candidate}`,
    );
  }
  const reviewPhaseIds = new Set(reviews.map((review) => review.phaseId));
  const rows = candidateGateRows(evidenceRecords, inspection.candidate, reviewPhaseIds);
  const gateEvidence = { configured: CANDIDATE_GATE_IDS, rows };
  const recorded = recordedRoutes(evidenceRecords, reviewPhaseIds);
  const route: ReviewRoute = await resolveReviewRoute({
    config: options.config, configPath: options.configPath, infra, recipe,
    reviewPhaseId: phases.review, workerProvider: recorded.worker?.provider, priorReview: recorded.review,
  });

  const evidence = {
    candidateSha: inspection.candidate,
    gatesPass: status.gatesPass,
    gateEvidence,
    reviewInvalidated: true,
    reviewInvalidationReason: reason,
    reviewEvidenceDefect: superseded.evidenceDefect,
    candidateUnchanged: true,
    review: {
      verdict: superseded.output.verdict,
      reviewedSha: superseded.output.reviewedSha,
      findings: superseded.output.findings,
    },
  };
  // The decision, before the human is asked and before anything is held. An
  // L25 the machine would refuse must cost the owner a refusal, not a prompt.
  decide(evidence);

  const generation = status.budget.ownerReentries + 1;
  const phaseKey = `${phases.review}-re${String(generation)}`;
  options.terminal.write(`Candidate SHA: ${inspection.candidate} (unchanged; base ${inspection.base})`);
  options.terminal.write(`Summary: ${inspection.summary}`);
  options.terminal.write(`Superseded review: ${superseded.phaseKey} returned ${superseded.output.verdict} with ${String(superseded.output.findings.length)} finding(s)`);
  options.terminal.write(`Evidence defect: ${superseded.evidenceDefect} — this is what makes that review replaceable, not your reason`);
  options.terminal.write(`Reason on record: ${reason}`);
  options.terminal.write(`Route: ${route.adapterId} / ${route.model.provider} / ${route.agent.model} (cold, opposite the ${recorded.worker!.provider} worker)`);
  options.terminal.write(`Calls: ${status.budget.callsSpent}/${ceilingFor(status.tier, status.budget.ceiling)} spent — ${remainingCalls} remain; this spends one and holds one for its single permitted retry`);
  options.terminal.write(`Owner re-entries: ${status.budget.ownerReentries}/${status.budget.allowance.ownerReentries} — this spends the last one`);
  options.terminal.write(`The attempt leaves AWAITING_OWNER, where it could land, for REVIEWING, where it cannot.`);
  options.terminal.write(`Once the allowance is spent, L16 and L19 are gone: no owner rework and no accepted-finding re-entry remain on this attempt.`);
  options.terminal.write(`Warning: ${CANDIDATE_LOSS_WARNING} — a failed replacement blocks the attempt, and \`awsf retry\` rebuilds from scratch.`);
  options.terminal.write(`Replacement artefacts are written under ${phaseKey}; the ${superseded.phaseKey} record is retained unchanged.`);
  const confirmed = await options.terminal.confirm(`Replace the recorded review of ${inspection.candidate}?`);
  if (!confirmed) return { status, confirmed: false };

  // Close every display-to-launch race before the L25 record becomes durable.
  status = await readAttempt(options.attemptDir);
  credentialSafeText(status.request, "persisted original request", true);
  validateAttempt(status, options.config);
  const reinspection = inspectCandidate(status);
  if (reinspection.candidate !== inspection.candidate || reinspection.base !== inspection.base) {
    throw new ReviewCandidateMoved("after confirmation", `${reinspection.base}..${reinspection.candidate} is not ${inspection.base}..${inspection.candidate}`);
  }
  const available = await route.adapter.isAvailable();
  if (available.status !== "available") {
    throw new ProductionRouteUnavailable(route.adapterId, available.detail ?? available.code ?? "route became unavailable");
  }
  const repeated = credentialSafeValue(await route.adapter.getModelInfo(route.agent.model), "post-confirmation reviewer route");
  if (repeated.adapter !== route.model.adapter || repeated.provider !== route.model.provider || repeated.requestedModel !== route.model.requestedModel) {
    throw new ReviewRouteMismatch("adapter/provider/model changed after confirmation");
  }

  // Evidence is composed and proved FIT before L25 becomes durable, so a
  // review that could not have been evidence is refused with nothing spent and
  // the attempt still where the owner left it.
  const intent = planIntentFrom(evidenceRecords) ?? requestOutput(status, options.config);
  const prepared: PreparedReview = await prepareReview({
    subject: {
      attemptDir: options.attemptDir, stateRoot: options.stateRoot, sessionId: status.sessionId,
      repository: status.repository, worktree: status.worktree!,
      baseSha: inspection.base, candidateSha: inspection.candidate,
    },
    config: options.config, infra, recipe, reviewPhaseId: phases.review, route,
    generation: `re${String(generation)}`,
    intent: {
      request: status.request,
      goals: intent.goals,
      nonGoals: intent.nonGoals,
      acceptanceCriteria: intent.implementationSteps.flatMap((step) => step.acceptanceCriteria),
      testStrategy: intent.testStrategy,
    },
    testOutput: lastTestOutputFrom(evidenceRecords, inspection.candidate),
    workerProvider: recorded.worker!.provider,
  });

  const budget = new CallBudget({
    taskId: status.taskId, tier: status.tier, allowance: status.budget.allowance,
    // The attempt's own ceiling, including any owner grant.
    ...(status.budget.ceiling === undefined ? {} : { ceiling: status.budget.ceiling }),
    carried: {
      attempt: status.attempt,
      callsSpent: status.budget.callsSpent,
      correctionsAuto: status.budget.correctionsAuto,
      correctionsOwner: status.budget.correctionsOwner,
      ownerReentries: status.budget.ownerReentries,
    },
  });
  const authorization = budget.authorize({
    from: status.lifecycleState, to: "REVIEWING", actor: "human",
    reason: { source: "human", detail: reason }, interactive: true, spawn: { cost: 1 }, evidence,
  });

  const phaseDb = `${status.sessionId}:${prepared.phaseKey}`;
  const createdAt = infra.now();
  const state = createReviewRunState();
  let transitionOrdinal = status.revision + 1;
  let writeQueue: Promise<void> = Promise.resolve();

  const persist = async (kind: AttemptEvent["kind"], update: Partial<AttemptStatus>, carried?: AttemptEvidence): Promise<void> => {
    const operation = writeQueue.then(async () => {
      const next = nextRevision(status, update);
      status = await persistAttempt(options.attemptDir, status.revision, { kind, next, ...(carried === undefined ? {} : { evidence: carried }) }, options.projectRecord);
    });
    writeQueue = operation.catch(() => undefined);
    await operation;
  };
  const persistTransition = async (
    from: TaskState, to: TaskState, edgeId: EdgeId, actor: "host" | "human", source: string,
    code: string | null, detail: string | null, spawnSite: boolean, update: Partial<AttemptStatus>,
  ): Promise<void> => {
    const at = infra.now();
    const seq = transitionOrdinal++;
    await persist("attempt.transitioned", { lifecycleState: to, lastActivityAt: at, nextAction: nextActionFor(to, status.taskId), ...update }, {
      type: "transition", id: `${status.sessionId}:${edgeId}:${seq}`, seq,
      from, to, actor, edgeId, reasonSource: source, reasonCode: code, reasonDetail: detail, spawnSite, at,
    });
  };

  const reservation = authorization.reservation!;
  try {
    // L25 and its held reservation are durable before a broker can create a child.
    await persistTransition(authorization.result.from, "REVIEWING", authorization.result.edge, "human", "human", null, reason, true, {
      budget: budget.snapshot(), requiredReviewPresent: false, blocker: null, phase: null,
      lastActivity: `L25 owner replacement review accepted (${superseded.evidenceDefect}); call ${reservation.id} held before launch`,
    });

    const reviewOutput = await prepared.run({
      budget,
      reservation,
      retrySubject: `${recipe.id}:${prepared.phaseKey}:retry`,
      registration: { from: "AWAITING_OWNER", to: "REVIEWING", edge: "L25" },
      // The two replacement phases follow the recipe's own, one generation at a
      // time, so a second replacement never reuses a first one's ordinal.
      ordinal: recipe.phases.length + (generation - 1) * 2 + 1,
      state,
      persist,
      // §5.3.2 step 2 — the LAST host instruction before GO.
      assertBeforeGo: () => { assertCandidateUnmoved(status, inspection, "between preflight and GO"); },
      // §5.3.2 step 3 — a tree that moved under the review invalidates it
      // outright, and the failure is host-deterministic, so it takes L17.
      assertAfterAnswer: () => { assertCandidateUnmoved(status, inspection, "between the review and L15", true); },
      ...(options.assertLaunchProjection === undefined ? {} : { assertLaunchProjection: options.assertLaunchProjection }),
    });

    options.assertAdvancement?.(status.sessionId, "AWAITING_OWNER");
    const l15 = transition({
      from: "REVIEWING", to: "AWAITING_OWNER", actor: "host", tier: status.tier,
      reason: { source: "gate" }, interactive: false, budget: budget.snapshot(),
      evidence: {
        gatesPass: true, candidateSha: inspection.candidate,
        review: { verdict: reviewOutput.verdict, reviewedSha: reviewOutput.reviewedSha, findings: reviewOutput.findings },
      },
    });
    // `journeyApproved` is deliberately untouched: the candidate did not
    // change, so the owner's attestation still concerns the same tree.
    await persistTransition("REVIEWING", "AWAITING_OWNER", l15.edge, "host", "gate", null, `replacement review returned ${reviewOutput.verdict}`, false, {
      candidateSha: inspection.candidate, budget: budget.snapshot(), gatesPass: true,
      requiredReviewPresent: true, protectedApprovalsValid: true, blocker: null, phase: null, process: null,
      lastActivity: `replacement ${route.model.provider} review of ${inspection.candidate} returned ${reviewOutput.verdict} with ${String(reviewOutput.findings.length)} finding(s)`,
    });
    return { status, confirmed: true };
  } catch (error) {
    await writeQueue;
    const failure = safeFailure(error);
    let survivorReport: TerminationReport | null = null;
    const exitObserved = state.observed !== null && state.observed.settled && state.observed.status === "EXITED";
    if (state.activeTransport !== null && !exitObserved) {
      try { survivorReport = await state.activeTransport.cancel("replacement review failed closed"); }
      catch { survivorReport = null; }
    }
    // A reservation that did not reach GO is released, and — unlike
    // `awsf rework`, deliberately — the owner re-entry it charged is rewound.
    // The owner authorized one replacement review; a launch that never happened
    // is not that, and confiscating the allowance for it would leave the
    // attempt with no re-entry and no review to show for it.
    const heldBefore = budget.outstanding();
    for (const held of heldBefore) budget.releaseOnRegistrationFailure(held.id);
    if (!state.spentAnyCall && heldBefore.length > 0) budget.rewindOwnerReentry();

    status = await readAttempt(options.attemptDir);
    const recoveryAt = (() => {
      try { return credentialSafeText(infra.now(), "recovery timestamp"); }
      catch { return createdAt; }
    })();
    const recoverPersist = async (kind: AttemptEvent["kind"], update: Partial<AttemptStatus>, carried?: AttemptEvidence): Promise<void> => {
      const current = await readAttempt(options.attemptDir);
      const next = nextRevision(current, update);
      const event = { kind, next, ...(carried === undefined ? {} : { evidence: carried }) } as AttemptEvent;
      try {
        status = await persistAttempt(options.attemptDir, current.revision, event, options.projectRecord);
      } catch {
        const observed = await readAttempt(options.attemptDir);
        if (observed.revision === next.revision) {
          status = observed;
          return;
        }
        if (observed.revision !== current.revision) throw new Error("replacement review recovery found an unexpected durable revision");
        status = await persistAttempt(options.attemptDir, current.revision, event);
      }
    };

    if (status.lifecycleState !== "REVIEWING") throw failure;

    // A good review lost to a bad write is the one outcome worth more than the
    // call it cost, so a projection fault AFTER the review answered is held
    // rather than blocked — the same handling the runner gives a GATING-sourced
    // one, extended to this source.
    if (state.answered) {
      await recoverPersist("attempt.updated", {
        budget: budget.snapshot(), process: null,
        blocker: { code: "sqlite-projection-failed", detail: failure.message, ahead: null, behind: null },
        lastActivityAt: recoveryAt, lastActivity: "replacement review advancement held at REVIEWING until observability rebuild",
        nextAction: "run `awsf db rebuild`, then rerun advancement",
      });
      return { status, confirmed: true };
    }

    if (state.phase !== null) {
      const failedPhase: PhaseEvidenceRecord = {
        ...state.phase, status: "FAILED", startedAt: state.phase.startedAt ?? recoveryAt, endedAt: recoveryAt,
        errorCode: failure.name, errorMessage: failure.message,
      };
      try {
        await recoverPersist("attempt.updated", {
          phase: { name: failedPhase.name, state: "FAILED", round: 0, maximumRounds: 0 },
          budget: budget.snapshot(), process: null, lastActivityAt: recoveryAt,
          lastActivity: `${failedPhase.key} failed closed`,
        }, { type: "phase", phase: failedPhase });
      } catch { /* the halt below is the mandatory durable settlement. */ }
    }

    status = await readAttempt(options.attemptDir);
    // Bound to a const rather than narrowed in place: the shared phase writes
    // `state.processRecord` from inside the broker's `register` callback, so
    // outer-scope flow analysis cannot see that assignment.
    const registered = state.processRecord as BarrierRecord | null;
    if (registered !== null && (!state.processSettled || (state.observed as ObservedProcessOutcome | null)?.settled === false)) {
      const observed = state.observed as ObservedProcessOutcome | null;
      const outcome: ObservedProcessOutcome = observed?.settled === true
        ? observed
        : survivorReport?.terminated === true
          ? { status: "CANCELLED", exitCode: null, endedAt: recoveryAt, settled: true }
          : { status: "FAILED", exitCode: observed?.exitCode ?? null, endedAt: recoveryAt, settled: false };
      try {
        await recoverPersist("attempt.updated", {
          budget: budget.snapshot(), process: null, lastActivityAt: outcome.endedAt,
          lastActivity: `registered process ${registered.runId} settled ${outcome.status}`,
        }, {
          type: "process", phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name,
          record: registered, status: outcome.status,
          registeredAt: state.releasedAt ?? outcome.endedAt, releasedAt: state.releasedAt, endedAt: outcome.endedAt,
          exitCode: outcome.exitCode, exitSignal: null,
        });
      } catch { /* the halt below is the mandatory durable settlement. */ }
    }

    status = await readAttempt(options.attemptDir);
    const terminationFailure = !exitObserved && state.activeTransport !== null && survivorReport === null
      ? new Error(`${failure.message}; registered process termination could not be verified`)
      : !exitObserved && survivorReport !== null && !survivorReport.terminated
        ? new Error(`${failure.message}; surviving processes [${survivorReport.survivors.join(", ")}]`)
        : failure;
    const reason2 = classify(terminationFailure);
    const l17 = transition({
      from: "REVIEWING", to: "BLOCKED", actor: "host", tier: status.tier,
      reason: { source: "process", code: reason2.code, detail: reason2.detail },
      interactive: false, budget: budget.snapshot(),
      evidence: { reviewTransportRetries: state.transportRetries, reviewFailure: reason2.code },
    });
    const seq = transitionOrdinal++;
    await recoverPersist("attempt.transitioned", {
      lifecycleState: "BLOCKED", budget: budget.snapshot(), process: null,
      blocker: { code: reason2.code, detail: reason2.detail, ahead: null, behind: null },
      lastActivityAt: recoveryAt, lastActivity: reason2.detail,
      nextAction: nextActionFor("BLOCKED", status.taskId),
    }, {
      type: "transition", id: `${status.sessionId}:L17:${seq}`, seq,
      from: "REVIEWING", to: "BLOCKED", actor: "host", edgeId: l17.edge,
      reasonSource: "process", reasonCode: reason2.code, reasonDetail: reason2.detail,
      spawnSite: false, at: recoveryAt,
    });
    return { status, confirmed: true };
  }
}

/**
 * A prior process died between L25 and GO, leaving a durable REVIEWING with a
 * reservation held.
 *
 * Command-specific by necessity: generic journal replay reconstructs files, it
 * cannot decide whether an in-flight provider ran, and `beginAttempt` refuses
 * outright while a reservation is held. A durable `callsReserved > 0` means the
 * spend was never persisted, and a spend is persisted before the child's first
 * instruction — so the reservation is released and, when no process for the
 * replacement phase ever reached RUNNING, the owner re-entry it charged is
 * rewound. Since L25 cannot be entered again from REVIEWING, recovery settles
 * the exited launch to a named L17 blocker instead of leaving a dead sojourn.
 */
async function reconcileStaleReservation(
  options: ReviewCommandOptions,
  status: AttemptStatus,
  infra: ReviewInfrastructure,
): Promise<AttemptStatus> {
  const evidence = await readAttemptEvidence(options.attemptDir);
  let launched = false;
  let lastEdge: string | null = null;
  for (const record of evidence) {
    if (record.type === "transition") lastEdge = record.edgeId;
    if (record.type === "process" && record.status !== "REGISTERED") launched = true;
  }
  if (lastEdge !== "L25") return status;
  const at = infra.now();
  const rewind = !launched && status.budget.ownerReentries > 0;
  const budget = {
    ...status.budget,
    callsReserved: 0,
    ownerReentries: rewind ? status.budget.ownerReentries - 1 : status.budget.ownerReentries,
  };
  const detail = `recovered a stale L25 reservation; ${rewind ? "no provider launched, so the owner re-entry was rewound" : "a provider had already launched, so the charge stands"}`;
  const code = "phase-abort";
  const decision = transition({
    from: "REVIEWING",
    to: "BLOCKED",
    actor: "host",
    tier: status.tier,
    reason: { source: "process", code, detail },
    interactive: false,
    budget,
    evidence: { reviewTransportRetries: 0, reviewFailure: code },
  });
  const seq = evidence.reduce((maximum, record) =>
    record.type === "transition" ? Math.max(maximum, record.seq) : maximum, 0) + 1;
  return persistAttempt(options.attemptDir, status.revision, {
    kind: "attempt.transitioned",
    evidence: {
      type: "transition",
      id: `${status.sessionId}:L17:${String(seq)}`,
      seq,
      from: "REVIEWING",
      to: "BLOCKED",
      actor: "host",
      edgeId: decision.edge,
      reasonSource: "process",
      reasonCode: code,
      reasonDetail: detail,
      spawnSite: false,
      at,
    },
    next: nextRevision(status, {
      lifecycleState: "BLOCKED",
      budget,
      process: null,
      blocker: { code, detail, ahead: null, behind: null },
      lastActivityAt: at,
      lastActivity: detail,
      nextAction: nextActionFor("BLOCKED", status.taskId),
    }),
  }, options.projectRecord);
}

export async function reviewCommand(options: ReviewCommandOptions): Promise<ReviewCommandResult> {
  try {
    return await runReviewCommand(options);
  } catch (error) {
    throw safeFailure(error);
  }
}

export type { RecordedReview };
