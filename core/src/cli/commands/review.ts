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

import { existsSync, readFileSync, statSync, promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AdapterEntry, AgentDefinition, AwsfConfig } from "../../config/schema.ts";
import type {
  BrokerProcessRegistration,
  HarnessAdapter,
  ModelInfo,
  ModelRequest,
  ProcessSpec,
  ProcessTransport,
  TransportBroker,
} from "../../adapters/interface.ts";
import { AdapterError } from "../../adapters/interface.ts";
import { registeredAdapter } from "../../adapters/registry.ts";
import { assertPrivateSystemPrompt, writeSystemPromptFile } from "../../adapters/system-prompt-file.ts";
import { toConfigSnapshotJson } from "../../config/effective-config.ts";
import type { EnvelopeBase } from "../../contracts/envelope-base.ts";
import { parseEnvelope } from "../../contracts/parse-envelope.ts";
import type { PlanOutput } from "../../contracts/plan-output.ts";
import { REVIEW_CONTEXT_SCHEMA_ID } from "../../contracts/review-context.ts";
import { REVIEW_OUTPUT_SCHEMA_ID, type ReviewOutput } from "../../contracts/review-output.ts";
import { wrapEnvelope, type StoredEnvelope } from "../../contracts/stored-envelope.ts";
import type { TestOutput } from "../../contracts/test-output.ts";
import {
  UNREPORTED_TOKEN_USAGE,
  isPersistableKind,
  type ModelResolutionProvenance,
  type NormalizedEvent,
  type TokenUsage,
} from "../../contracts/normalized-events.ts";
import { CallBudget, type Reservation } from "../../execution/call-budget.ts";
import type { BarrierRecord, TerminationReport } from "../../execution/launcher-barrier.ts";
import {
  ProcessTransportBroker,
  type BrokerOptions,
} from "../../execution/transport-broker.ts";
import { artifactsExist, jsonParses, type ArtifactObservation } from "../../gates/artifacts.ts";
import { envelopeValid } from "../../gates/envelope.ts";
import { noProtectedPaths, writesWithinGlobs } from "../../gates/git-diff.ts";
import { GateReport, type GateId } from "../../gates/interface.ts";
import { reviewEvidencePresent, verdictConsistent } from "../../gates/review.ts";
import { assertClean, captureChangeSet, changedPaths, runGit, systemGitRunner } from "../../git/changes.ts";
import { HOST_AUTHOR } from "../../git/commit.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../observability/attempt-evidence.ts";
import { PermissionBreach } from "../../policy/path-policy.ts";
import { REDACTED_VALUE, scrubCredentialString, scrubCredentials } from "../../policy/redaction.ts";
import { openPermissionSession, type PermissionSession, type SandboxGrant, type SandboxProbe } from "../../policy/sandbox-broker.ts";
import { transition, type EdgeId, type TaskState, type TransitionEvidence } from "../../state/task-machine.ts";
import { ceilingFor } from "../../state/tiers.ts";
import { compilePhase, type WorkflowRecipe } from "../../workflow/compiler.ts";
import type { CompiledAgentPhase } from "../../workflow/phase.ts";
import {
  InvalidReviewInversion,
  MandatoryReviewUnavailable,
  oppositeProvider,
  providerPairFrom,
  runMandatoryReview,
} from "../../workflow/review-routing.ts";
import {
  ReviewEvidenceUnfit,
  candidatePathsBetween,
  composeReviewEvidence,
  sha256,
} from "../../workflow/review-evidence.ts";
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
  isReviewTransportFailure,
  requestOutput,
} from "./production-run.ts";
import {
  candidateGateRows,
  readAttemptEvidence,
  recordedReviews,
  recordedRoutes,
  type RecordedReview,
} from "./review-record.ts";

const { chmod, mkdir, readFile, realpath, writeFile } = fs;

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

/** Marks the appended block so a compiled prompt says which turn it was. */
export const CONTRACT_RETRY_HEADING = "ENVELOPE CONTRACT CORRECTION";

/**
 * The correction handed to a COLD reviewer's second turn.
 *
 * It carries the schema violations and nothing else. It does not carry the
 * owner's reason, the superseded verdict, or any hint about what this reviewer
 * should conclude — the same rule that keeps `--reason` out of the first
 * prompt applies with equal force here, because a reviewer told what to find is
 * not a reviewer. Naming the paths that failed is a correction about FORM, and
 * the instruction to leave the substance alone is what stops a retry becoming a
 * second opinion the owner never bought.
 */
export function contractRetryPrompt(prompt: string, violations: readonly string[]): string {
  const listed = violations.length === 0
    ? "  - no envelope was extracted from the response"
    : violations.map((violation) => `  - ${violation}`).join("\n");
  return [
    prompt,
    "",
    CONTRACT_RETRY_HEADING,
    `Your previous response did not validate against ${REVIEW_OUTPUT_SCHEMA_ID} and was discarded unread.`,
    listed,
    "Return the SAME review, unchanged in substance — same verdict, same findings, same limitations —",
    "as a single JSON envelope that validates. The schema permits no property beyond those it names.",
  ].join("\n");
}

const MAX_REASON = 2_000;

const HOST = globalThis as unknown as {
  process: { env: Readonly<Record<string, string>> };
  AbortController: new () => { signal: Parameters<TransportBroker["startProcess"]>[2]; abort(reason?: unknown): void };
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

export class ReviewCredentialRejected extends Error {
  constructor(source: string) {
    super(`replacement review rejected ${source}: credential-shaped data is never persisted or sent to a provider`);
    this.name = "ReviewCredentialRejected";
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

export class ReviewRouteMismatch extends Error {
  constructor(detail: string) {
    super(`configured reviewer route mismatch: ${detail}; no fallback or substitution is permitted`);
    this.name = "ReviewRouteMismatch";
  }
}

export class ReviewRecordMissing extends Error {
  constructor(detail: string) {
    super(`awsf review needs the retained evidence of the review it supersedes: ${detail}`);
    this.name = "ReviewRecordMissing";
  }
}

/** Host-deterministic: TypeBox either validated the envelope or it did not. */
export class ReplacementReviewMalformed extends Error {
  constructor(detail: string) {
    super(`the replacement review produced no valid envelope: ${detail}`);
    this.name = "ReplacementReviewMalformed";
  }
}

/** Host-deterministic: a gate row failed, or the tree moved under the review. */
export class ReplacementReviewEvidenceInvalid extends Error {
  constructor(detail: string) {
    super(`the replacement review's evidence is invalid: ${detail}`);
    this.name = "ReplacementReviewEvidenceInvalid";
  }
}

/**
 * The one residual, named rather than fixed. An inconsistent verdict is
 * CONTENT, so the host does not decide what it means and invents no terminal
 * state for it: the attempt stays in REVIEWING with the failed gate recorded.
 */
export class ReplacementReviewInconsistent extends Error {
  constructor(detail: string) {
    super(`the replacement review answered inconsistently: ${detail}`);
    this.name = "ReplacementReviewInconsistent";
  }
}

// ---------------------------------------------------------------------------
// Options.
// ---------------------------------------------------------------------------

export interface ReviewInfrastructure {
  adapterFor(entry: AdapterEntry, adapterId: string, config: AwsfConfig): HarnessAdapter | null;
  createBroker(options: BrokerOptions): TransportBroker;
  writeSystemPrompt(text: string, directory: string): Promise<string>;
  now(): string;
  sandboxProbe?: SandboxProbe;
}

const DEFAULT_INFRASTRUCTURE: ReviewInfrastructure = {
  adapterFor: (_entry, adapterId, config) => registeredAdapter(config.adapters, adapterId, config.runtime),
  createBroker: (options) => new ProcessTransportBroker(options),
  writeSystemPrompt: writeSystemPromptFile,
  now: () => new Date().toISOString(),
};

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

interface Route {
  readonly agent: AgentDefinition;
  readonly adapterId: string;
  readonly adapter: HarnessAdapter;
  readonly model: ModelInfo;
  readonly userPrompt: string;
  readonly systemPrompt: string;
}

interface CandidateInspection {
  readonly base: string;
  readonly candidate: string;
  readonly summary: string;
}

interface ObservedProcessOutcome {
  readonly status: "EXITED" | "FAILED" | "CANCELLED";
  readonly exitCode: number | null;
  readonly endedAt: string;
  readonly settled: boolean;
}

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

function observedProcessOutcome(event: NormalizedEvent, endedAt: string): ObservedProcessOutcome | null {
  switch (event.kind) {
    case "run.completed":
      return {
        status: event.exitCode === null ? "FAILED" : "EXITED",
        exitCode: event.exitCode,
        endedAt,
        settled: event.exitCode !== null,
      };
    case "run.failed":
      return { status: "FAILED", exitCode: null, endedAt, settled: true };
    case "run.cancelled":
      return { status: "CANCELLED", exitCode: null, endedAt, settled: true };
    default:
      return null;
  }
}

function sumUsage(events: readonly NormalizedEvent[]): TokenUsage {
  const fields = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"] as const;
  const totals: Record<(typeof fields)[number], number | null> = {
    inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null,
  };
  let relation: TokenUsage["reasoningRelation"] = "unknown";
  for (const event of events) {
    if (event.kind !== "usage") continue;
    relation = event.usage.reasoningRelation;
    for (const field of fields) if (event.usage[field] !== null) totals[field] = (totals[field] ?? 0) + event.usage[field]!;
  }
  return { ...totals, reasoningRelation: relation };
}

function contextTokens(usage: TokenUsage): number | null {
  return usage.inputTokens === null && usage.outputTokens === null ? null : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

function gateKind(gateId: GateId): "pure" | "filesystem" | "git" | "subprocess" | "journey" {
  if (gateId === "commands_pass") return "subprocess";
  if (["head_advanced", "diff_matches_claims", "candidate_hygiene"].includes(gateId)) return "git";
  if (["artifacts_exist", "files_non_empty", "json_parses", "no_protected_paths", "writes_within_globs"].includes(gateId)) return "filesystem";
  return gateId === "journey_passes" ? "journey" : "pure";
}

function artifactReader(worktree: string): (path: string) => ArtifactObservation {
  return (path) => {
    const root = resolve(worktree);
    const candidate = resolve(root, path);
    const fromRoot = relative(root, candidate);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) return { exists: false, size: 0 };
    try {
      const observed = statSync(candidate);
      if (!observed.isFile()) return { exists: false, size: 0 };
      const content = path.toLowerCase().endsWith(".json") ? readFileSync(candidate, "utf8") : undefined;
      return { exists: true, size: observed.size, ...(content === undefined ? {} : { content }) };
    } catch {
      return { exists: false, size: 0 };
    }
  };
}

async function readCommittedPrompt(configPath: string, path: string): Promise<string> {
  if (isAbsolute(path)) throw new Error(`prompt path must be relative: ${path}`);
  const root = await realpath(dirname(resolve(configPath)));
  const candidate = resolve(root, path);
  const fromRoot = relative(root, candidate);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error(`prompt path escapes config context: ${path}`);
  const physical = await realpath(candidate);
  const physicalFromRoot = relative(root, physical);
  if (physicalFromRoot.startsWith("..") || isAbsolute(physicalFromRoot)) throw new Error(`prompt symlink escapes config context: ${path}`);
  return readFile(physical, "utf8");
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

/** The recipe's review phase, and the agent phase the inversion is taken against. */
function reviewPhaseOf(recipe: WorkflowRecipe): { review: string; worker: string } {
  const review = recipe.phases.find((phase) => phase.kind === "agent" && phase.schemaId === REVIEW_OUTPUT_SCHEMA_ID);
  const worker = recipe.phases.find((phase) => phase.kind === "agent" && phase.schemaId !== REVIEW_OUTPUT_SCHEMA_ID);
  if (review === undefined || worker === undefined) {
    throw new ProductionWorkflowUnsupported(recipe.id, "a replacement review needs both a review phase and a worker phase to invert against");
  }
  return { review: review.id, worker: worker.id };
}

/**
 * The reviewer route, re-derived rather than re-chosen.
 *
 * The provider comes from EXCLUSION against the provider the worker actually
 * ran on — read from the journal, not from the config's optional label — and
 * the configured reviewer is then checked against that answer. Every drift from
 * the route the superseded review ran on is a refusal, because a replacement on
 * a different model is a different experiment.
 */
async function resolveReviewRoute(
  status: AttemptStatus,
  config: AwsfConfig,
  configPath: string,
  infra: ReviewInfrastructure,
  recipe: WorkflowRecipe,
  phases: { review: string; worker: string },
  recorded: ReturnType<typeof recordedRoutes>,
): Promise<Route> {
  const reviewAgentName = recipe.phases.find((phase) => phase.id === phases.review)!.owner;
  const agent = config.agents.find((candidate) => candidate.name === reviewAgentName);
  if (agent === undefined) throw new ProductionRouteUnavailable(reviewAgentName, "no explicit agent definition exists");
  if (agent.writes.length !== 0) throw new ReviewRouteMismatch("a reviewer that can write is not a reviewer; `writes` must stay empty");
  // A resumable reviewer is argued with rather than briefed: its prior verdict
  // sits in its context and the new turn asks it to revise. The replacement is
  // cold by construction, and a config that says otherwise is refused here
  // rather than quietly ignored.
  if (agent.harness.continuity !== "none") {
    throw new ReviewRouteMismatch(`the replacement review is cold; configured continuity ${JSON.stringify(agent.harness.continuity)} would resume a reviewer`);
  }
  const entry = config.adapters[agent.harness.adapter];
  if (entry === undefined || entry.enabled === false) throw new ProductionRouteUnavailable(agent.harness.adapter, "route is disabled or undeclared");
  const adapter = infra.adapterFor(entry, agent.harness.adapter, config);
  if (adapter === null) throw new ProductionRouteUnavailable(agent.harness.adapter, "adapter kind has no production binding");
  const available = await adapter.isAvailable();
  if (available.status !== "available") throw new ProductionRouteUnavailable(agent.harness.adapter, available.detail ?? available.code ?? "blocked");
  const model = credentialSafeValue(await adapter.getModelInfo(agent.model), "configured reviewer route");
  if (model.adapter !== adapter.id) throw new ReviewRouteMismatch(`adapter descriptor says ${model.adapter}, selected adapter is ${adapter.id}`);

  // The pair is a property of the configured route surface. It is read from
  // what the adapters REPORT, never from the config's optional `provider`
  // label, which the committed default omits on the Claude route.
  const providers: string[] = [model.provider];
  for (const phase of recipe.phases) {
    if (phase.kind !== "agent" || phase.id === phases.review) continue;
    const other = config.agents.find((candidate) => candidate.name === phase.owner);
    if (other === undefined) throw new ProductionRouteUnavailable(phase.owner, "no explicit agent definition exists");
    const otherEntry = config.adapters[other.harness.adapter];
    if (otherEntry === undefined || otherEntry.enabled === false) throw new ProductionRouteUnavailable(other.harness.adapter, "route is disabled or undeclared");
    const otherAdapter = infra.adapterFor(otherEntry, other.harness.adapter, config);
    if (otherAdapter === null) throw new ProductionRouteUnavailable(other.harness.adapter, "adapter kind has no production binding");
    // Availability is deliberately NOT asked of the worker route. Nothing is
    // going to launch on it, and refusing a review because the builder's
    // provider is down would forfeit the candidate for an unrelated outage.
    providers.push((await otherAdapter.getModelInfo(other.model)).provider);
  }
  const workerProvider = recorded.worker?.provider;
  if (workerProvider === undefined) {
    throw new ReviewRecordMissing("no recorded worker call names the provider the inversion must exclude");
  }
  const required = oppositeProvider(workerProvider, providerPairFrom(providers));
  if (model.provider !== required) {
    throw new InvalidReviewInversion(
      `the worker ran on ${JSON.stringify(workerProvider)}, so the replacement review must run on ${JSON.stringify(required)}; ` +
        `the configured reviewer route resolves to ${JSON.stringify(model.provider)}`,
    );
  }
  const priorReview = recorded.review;
  if (priorReview !== null && (
    priorReview.adapterId !== agent.harness.adapter ||
    priorReview.provider !== model.provider ||
    priorReview.requestedModel !== agent.model
  )) {
    throw new ReviewRouteMismatch(
      `the superseded review ran on ${priorReview.adapterId}/${priorReview.provider}/${priorReview.requestedModel}; ` +
        `the configured route is now ${agent.harness.adapter}/${model.provider}/${agent.model}`,
    );
  }
  return {
    agent,
    adapterId: agent.harness.adapter,
    adapter,
    model,
    userPrompt: credentialSafeText(await readCommittedPrompt(configPath, agent.prompt.user), "configured user prompt", true),
    systemPrompt: credentialSafeText(await readCommittedPrompt(configPath, agent.prompt.system), "configured system prompt", true),
  };
}

async function validateMaterializedSystemPrompt(
  adapterId: string,
  runtimeDir: string,
  systemPromptPath: string,
  expectedText: string,
): Promise<void> {
  credentialSafeText(systemPromptPath, "private system prompt path", true);
  assertPrivateSystemPrompt(adapterId, systemPromptPath);
  const runtimePhysical = await realpath(runtimeDir);
  const promptPhysical = await realpath(systemPromptPath);
  const fromRuntime = relative(runtimePhysical, promptPhysical);
  if (fromRuntime.startsWith("..") || isAbsolute(fromRuntime)) {
    throw new AdapterError(adapterId, "E_REDACTION", "the private system prompt file is outside its session runtime");
  }
  const materialized = credentialSafeText(await readFile(promptPhysical, "utf8"), "materialized system prompt", true);
  if (materialized !== expectedText) {
    throw new AdapterError(adapterId, "E_REDACTION", "the materialized system prompt differs from the credential-checked prompt");
  }
}

/**
 * The credential sweep over a descriptor, with the prompt payload excluded.
 *
 * `argv` is world-readable on every platform this harness targets and is the
 * exposure the sweep exists for; `stdin` is not, and the payload here is the
 * candidate's own diff. Sweeping it would make a candidate whose SOURCE trips
 * the credential pattern reviewable once and replaceable never — a stricter
 * rule than the production runner applies to the identical bytes, which is the
 * asymmetry rather than the protection.
 */
function credentialSafeDescriptor(spec: ProcessSpec, source: string): ProcessSpec {
  credentialSafeValue({ ...spec, stdin: "" }, source);
  return spec;
}

function preflightDescriptor(route: Route, request: ModelRequest, spec: ProcessSpec): ProcessSpec {
  const path = request.systemPromptPath;
  if (path === undefined) throw new Error("a replacement review requires a private system prompt path");
  credentialSafeText(path, "private system prompt path", true);
  assertPrivateSystemPrompt(route.adapter.id, path);
  const checked = credentialSafeDescriptor(spec, "final process descriptor");
  if (checked.shell !== false || checked.stdin !== request.prompt || checked.cwd !== request.cwd) {
    throw new AdapterError(route.adapter.id, "E_REDACTION", "the final replacement-review descriptor changed its prompt, cwd, or shell policy");
  }
  if (checked.argv.filter((argument) => argument === path).length !== 1) {
    throw new AdapterError(route.adapter.id, "E_REDACTION", "the final replacement-review descriptor must reference the one validated private system prompt path exactly once");
  }
  const privateText = [request.prompt, route.systemPrompt, route.userPrompt];
  if (checked.argv.some((argument) => privateText.some((text) =>
    text.length > 0 && (argument === text || (text.length >= 32 && argument.includes(text)))))) {
    throw new AdapterError(route.adapter.id, "E_REDACTION", "private prompt content appeared in argv");
  }
  return checked;
}

function routeEventExact(event: NormalizedEvent, route: Route): void {
  if (event.kind === "run.started" && (event.adapter !== route.adapter.id || event.requestedModel !== route.model.requestedModel)) {
    throw new ReviewRouteMismatch(`run.started reported ${event.adapter}/${event.requestedModel}, expected ${route.adapter.id}/${route.model.requestedModel}`);
  }
  if (event.kind === "model.resolved" && (
    event.adapter !== route.adapter.id || event.provider !== route.model.provider || event.requestedModel !== route.model.requestedModel
  )) {
    throw new ReviewRouteMismatch(`model.resolved reported ${event.adapter}/${event.provider}/${event.requestedModel}, expected ${route.adapter.id}/${route.model.provider}/${route.model.requestedModel}`);
  }
}

/**
 * Every non-transport review failure gets a name, and the two that L17 admits
 * get an edge.
 *
 * A permission breach is deliberately NOT `review-evidence-invalid`: a breach
 * is a policy failure, not a statement about the evidence, and mapping it onto
 * a review vocabulary would let the host declare a policy violation terminal
 * under a word that does not mean that. It is recorded explicitly instead of
 * being rethrown unclassified, which is what the runner does today.
 */
function classify(error: unknown): { code: string; detail: string; edge: "L17" | null } {
  const failure = safeFailure(error);
  const detail = `${failure.name}: ${failure.message}`;
  if (failure instanceof MandatoryReviewUnavailable) return { code: "review-unavailable", detail, edge: "L17" };
  if (failure instanceof ReplacementReviewMalformed) return { code: "review-malformed", detail, edge: "L17" };
  if (failure instanceof ReplacementReviewEvidenceInvalid) return { code: "review-evidence-invalid", detail, edge: "L17" };
  if (failure instanceof ReviewCandidateMoved) {
    return failure.afterReview
      ? { code: "review-evidence-invalid", detail, edge: "L17" }
      : { code: "candidate-moved", detail, edge: null };
  }
  if (failure instanceof PermissionBreach) return { code: "permission-breach", detail, edge: null };
  if (failure instanceof ReplacementReviewInconsistent) return { code: "review-inconsistent", detail, edge: null };
  if (failure instanceof AdapterError && failure.code === "E_QUOTA_EXHAUSTED") return { code: "quota-exhausted", detail, edge: null };
  if (failure instanceof ReviewEvidenceUnfit) return { code: "review-evidence-invalid", detail, edge: "L17" };
  return { code: "phase-abort", detail, edge: null };
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
  const phases = reviewPhaseOf(recipe);

  // §5.4 — two calls of headroom or nothing happens at all.
  const remainingCalls = ceilingFor(status.tier, status.budget.ceiling) - status.budget.callsSpent - status.budget.callsReserved;
  if (remainingCalls < 2) throw new ReviewHeadroomInsufficient(remainingCalls, status.tier, status.taskId);

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
  const route = await resolveReviewRoute(status, options.config, options.configPath, infra, recipe, phases, recorded);

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
  const contextKey = `review-context-re${String(generation)}`;
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
  const testOutput = lastTestOutputFrom(evidenceRecords, inspection.candidate);
  const composed = await composeReviewEvidence({
    worktree: status.worktree!,
    baseSha: inspection.base,
    candidateSha: inspection.candidate,
    intent: {
      request: status.request,
      goals: intent.goals,
      nonGoals: intent.nonGoals,
      acceptanceCriteria: intent.implementationSteps.flatMap((step) => step.acceptanceCriteria),
      testStrategy: intent.testStrategy,
    },
    testOutput,
    // Generation-qualified like every other identity: the superseded review's
    // retained diff is evidence and is never rewritten.
    diffRef: join("raw", `review-context-${inspection.candidate}-re${String(generation)}.diff`),
    retainFullDiff: async (relativePath, diff) => {
      const absolute = join(options.attemptDir, relativePath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, diff, { mode: 0o600 });
      await chmod(absolute, 0o600);
      return readFile(absolute, "utf8");
    },
  });

  const reviewPhaseDefinition = recipe.phases.find((phase) => phase.id === phases.review)!;
  const compiledReviewer = compilePhase({
    ...(reviewPhaseDefinition as CompiledAgentPhase & { prompt: string }),
    prompt: route.userPrompt,
  }) as CompiledAgentPhase;
  // Not credential-swept, deliberately: this is the candidate's own diff and
  // the request the owner recorded, and the production runner hands the
  // identical bytes to the identical reviewer. A sweep here would refuse to
  // REPLACE a review of a candidate whose source it had already allowed.
  const renderedPrompt = compiledReviewer.renderPrompt(composed.context as unknown as EnvelopeBase);

  const runtimeDir = join(options.attemptDir, "private", phaseKey);
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  const systemPromptPath = await infra.writeSystemPrompt(route.systemPrompt, runtimeDir);
  await validateMaterializedSystemPrompt(route.adapter.id, runtimeDir, systemPromptPath, route.systemPrompt);
  const openPermission = (): PermissionSession => openPermissionSession({
    canonicalRepository: status.repository,
    worktree: status.worktree!,
    sessionRuntime: runtimeDir,
    stateRoot: options.stateRoot,
    profile: route.agent.tools.profile,
    tools: route.agent.tools.allow,
    writes: route.agent.writes,
    protectedPaths: options.config.policy.protected_paths,
    ...(infra.sandboxProbe === undefined ? {} : { sandboxProbe: infra.sandboxProbe }),
  });
  /**
   * The privacy preflight is a function of the PROMPT, because the contract
   * retry's prompt is not attempt 1's.
   *
   * The launch wrapper refuses any descriptor that differs from the one
   * validated before it, which is the guarantee that a sandbox grant cannot
   * change between validation and GO. Reusing attempt 1's preflight for a
   * retry that carries a different prompt would trip exactly that check, so
   * each attempt gets its own preflight of its own descriptor and the
   * guarantee is preserved rather than widened.
   */
  const preflightFor = (prompt: string): { request: ModelRequest; grant: SandboxGrant; spec: ProcessSpec } => {
    const request: ModelRequest = {
      model: route.agent.model, prompt, systemPromptPath, cwd: status.worktree!,
      env: HOST.process.env, effort: route.agent.thinking,
      profile: route.agent.tools.profile, tools: route.agent.tools.allow,
    };
    const grant = openPermission().sandbox(route.adapter.buildSpec(request));
    return { request, grant, spec: preflightDescriptor(route, request, grant.spec) };
  };
  // The actual final descriptor, including the materialized private path,
  // validated before L25 can become durable.
  const preflight = preflightFor(renderedPrompt);

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

  const dbPhaseId = (key: string): string => `${status.sessionId}:${key}`;
  const phaseDb = dbPhaseId(phaseKey);
  const createdAt = infra.now();
  const baseOrdinal = recipe.phases.length + (generation - 1) * 2;
  let contextPhase: PhaseEvidenceRecord = {
    phaseId: dbPhaseId(contextKey), ordinal: baseOrdinal + 1, key: contextKey, name: contextKey,
    kind: "code", owner: "host",
    description: `Recompose the host-observed evidence for the replacement review of ${inspection.candidate}`,
    status: "QUEUED", correctionCount: 0, maxCorrections: 0, errorCode: null, errorMessage: null,
    startedAt: null, endedAt: null, createdAt,
  };
  let phase: PhaseEvidenceRecord = {
    phaseId: phaseDb, ordinal: baseOrdinal + 2, key: phaseKey, name: phaseKey,
    kind: "agent", owner: route.agent.name,
    description: `Re-audit exact candidate ${inspection.candidate} on the opposite provider under owner authorization`,
    status: "QUEUED", correctionCount: 0, maxCorrections: 0, errorCode: null, errorMessage: null,
    startedAt: null, endedAt: null, createdAt,
  };

  let processRecord: BarrierRecord | null = null;
  let processSettled = false;
  let observedProcess: ObservedProcessOutcome | null = null;
  let releasedAt: string | null = null;
  let spentAnyCall = false;
  let reviewAccepted = false;
  let transportRetries = 0;
  let contractRetries = 0;
  let contractViolations: readonly string[] = [];
  const activeTransport: { current: ProcessTransport | null } = { current: null };
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
  const persistPhaseState = async (record: PhaseEvidenceRecord, state: string, error: Error | null = null): Promise<PhaseEvidenceRecord> => {
    const at = infra.now();
    const next: PhaseEvidenceRecord = {
      ...record, status: state,
      startedAt: record.startedAt ?? (state === "RUNNING" ? at : null),
      endedAt: ["SUCCEEDED", "FAILED", "CANCELLED"].includes(state) ? at : null,
      errorCode: error?.name ?? null, errorMessage: error?.message ?? null,
    };
    await persist("attempt.updated", {
      phase: { name: next.name, state, round: 0, maximumRounds: 0 },
      lastActivityAt: at, lastActivity: `${next.key} is ${state}`,
    }, { type: "phase", phase: next });
    return next;
  };
  /**
   * Round-scoped, because the projection writes gate rows `INSERT OR REPLACE`.
   * A contract retry reusing round 0 would overwrite the very rows that record
   * why the first turn failed — the same silent-overwrite hazard the
   * generation-qualified `-re<N>` identities exist to prevent, one level down.
   */
  const persistGate = async (report: GateReport, candidateSha: string | null, round: number): Promise<void> => {
    const at = infra.now();
    await persist("attempt.updated", {}, {
      type: "gate", id: `${phaseDb}:${String(round)}:${report.gateId}`, phaseId: phaseDb, round,
      gateId: report.gateId, kind: gateKind(report.gateId), candidateSha,
      passed: report.passed, exitCode: null, checks: report.checks,
      violations: report.checks.filter((check) => !check.ok).map((check) => `${check.item}: ${check.note}`),
      outputPath: null, startedAt: at, endedAt: at,
    });
  };
  const persistEnvelope = async (key: string, rawName: string, envelope: StoredEnvelope<EnvelopeBase>, rawOutput: string): Promise<void> => {
    const rawRelative = join("raw", `${rawName}.txt`);
    const rawAbsolute = join(options.attemptDir, rawRelative);
    await mkdir(dirname(rawAbsolute), { recursive: true });
    await writeFile(rawAbsolute, rawOutput, { mode: 0o600 });
    await chmod(rawAbsolute, 0o600);
    const stored = { ...envelope, rawOutputPath: rawRelative };
    const envelopePath = join(options.attemptDir, "envelopes", `${key}-${envelope.correctionRound}.json`);
    await mkdir(dirname(envelopePath), { recursive: true });
    if (existsSync(envelopePath)) throw new Error(`immutable envelope already exists: ${envelopePath}`);
    await writeFile(envelopePath, JSON.stringify(stored), { mode: 0o600 });
    await persist("attempt.updated", {}, { type: "envelope", phaseId: dbPhaseId(key), envelope: stored });
  };

  const reservation = authorization.reservation!;
  try {
    // L25 and its held reservation are durable before a broker can create a child.
    await persistTransition(authorization.result.from, "REVIEWING", authorization.result.edge, "human", "human", null, reason, true, {
      budget: budget.snapshot(), requiredReviewPresent: false, blocker: null, phase: null,
      lastActivity: `L25 owner replacement review accepted (${superseded.evidenceDefect}); call ${reservation.id} held before launch`,
    });
    await persist("attempt.updated", {}, { type: "phase", phase: contextPhase });
    await persist("attempt.updated", {}, { type: "phase", phase });

    contextPhase = await persistPhaseState(contextPhase, "RUNNING");
    const contextEnvelope = wrapEnvelope({
      envelopeId: `${status.sessionId}:${contextKey}:0`, sessionId: status.sessionId, phaseId: contextKey,
      correctionRound: 0, agent: "host", schemaId: REVIEW_CONTEXT_SCHEMA_ID, createdAt: infra.now(),
      rawOutputPath: `raw/host-${contextKey}.txt`,
    }, parseEnvelope(JSON.stringify(composed.context), REVIEW_CONTEXT_SCHEMA_ID));
    await persistEnvelope(contextKey, `host-${contextKey}`, contextEnvelope, JSON.stringify(composed.context));
    contextPhase = await persistPhaseState(contextPhase, "SUCCEEDED");

    // The system prompt is fixed for the phase; the user prompt is recorded by
    // each turn, because a contract retry sends a different one and a record
    // showing only the first would misstate what the provider was asked.
    await persist("attempt.updated", {}, {
      type: "compiled-prompt", phaseId: phaseDb, name: "system", text: route.systemPrompt,
      lineCount: route.systemPrompt.split(/\r?\n/).length, at: infra.now(),
    });
    phase = await persistPhaseState(phase, "RUNNING");

    const broker = infra.createBroker({
      ledger: budget,
      register: async (record) => {
        processRecord = record;
        processSettled = false;
        const registeredAt = infra.now();
        await persist("attempt.updated", {
          process: record.identity, budget: budget.snapshot(), lastActivityAt: registeredAt,
          lastActivity: `process ${record.runId} registered before GO`,
        }, {
          type: "process", phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name,
          record, status: "REGISTERED", registeredAt, releasedAt: null, endedAt: null, exitCode: null, exitSignal: null,
        });
        options.assertLaunchProjection?.(status.sessionId);
      },
      onSpent: async (record) => {
        spentAnyCall = true;
        releasedAt = infra.now();
        await persist("attempt.updated", {
          budget: budget.snapshot(), lastActivityAt: releasedAt,
          lastActivity: `L25 call ${record.reservationId} spent immediately before GO`,
        }, {
          type: "process", phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name,
          record, status: "RUNNING", registeredAt: releasedAt, releasedAt, endedAt: null, exitCode: null, exitSignal: null,
        });
      },
    } as BrokerOptions);

    const runTurn = async (
      held: Reservation,
      attempt: 1 | 2,
      turnPrompt: string,
      turnPreflight: { request: ModelRequest; grant: SandboxGrant; spec: ProcessSpec },
    ): Promise<ReviewOutput> => {
      // The envelope's own correction round, so a retry neither collides with
      // the immutable file on disk nor is dropped by the projection's
      // `INSERT OR IGNORE` on envelope id.
      const round = attempt - 1;
      const request = turnPreflight.request;
      const runId = `${status.sessionId}:${phaseKey}:run${attempt === 1 ? "" : `-${String(attempt)}`}`;
      await persist("attempt.updated", {}, {
        type: "compiled-prompt", phaseId: phaseDb, name: round === 0 ? "user" : `user-round-${String(round)}`,
        text: turnPrompt, lineCount: turnPrompt.split(/\r?\n/).length, at: infra.now(),
      });
      const permission = openPermission();
      const capturingBroker: TransportBroker = {
        startProcess: async (registration, spec, signal) => {
          const launchGrant = permission.sandbox(spec);
          const finalSpec = credentialSafeDescriptor(launchGrant.spec, "launch process descriptor");
          if (
            JSON.stringify(finalSpec) !== JSON.stringify(turnPreflight.spec) ||
            launchGrant.badge !== turnPreflight.grant.badge ||
            launchGrant.mechanism !== turnPreflight.grant.mechanism
          ) {
            throw new ReviewRouteMismatch("launch descriptor or sandbox grant changed after its privacy preflight");
          }
          const launchAt = infra.now();
          await persist("attempt.updated", {
            lastActivityAt: launchAt, lastActivity: `${phaseKey}: route and sandbox grant recorded before GO`,
          }, {
            type: "agent-start", phaseId: phaseDb, agent: route.agent.name, adapterId: route.adapterId,
            provider: route.model.provider, color: route.agent.color, requestedModel: route.agent.model,
            sandboxBadge: launchGrant.badge, sandboxMechanism: launchGrant.mechanism, purpose: "review", at: launchAt,
          });
          // §5.3.2 step 2 — the LAST host instruction before GO. The permission
          // session is open and the grant is built; this is the narrowest the
          // window between the host's final read and the child's first
          // instruction can be made without an immutable materialization.
          assertCandidateUnmoved(status, inspection, "between preflight and GO");
          activeTransport.current = await broker.startProcess(registration, finalSpec, signal);
          return activeTransport.current;
        },
      };
      const registration: BrokerProcessRegistration = {
        runId, sessionId: status.sessionId, from: "AWAITING_OWNER", to: "REVIEWING", edge: "L25",
        reservationId: held.id, adapterId: route.adapterId, role: route.agent.name,
      };
      const controller = new HOST.AbortController();
      const events: NormalizedEvent[] = [];
      let output = "";
      let resolved: { model: string; provenance: ModelResolutionProvenance } | null = null;
      let terminal: NormalizedEvent | null = null;
      observedProcess = null;
      for await (const event of route.adapter.execute(request, capturingBroker, registration, controller.signal)) {
        routeEventExact(event, route);
        events.push(event);
        if (event.kind === "text.delta") output += event.text;
        if (event.kind === "model.resolved") resolved = { model: event.resolvedModel, provenance: event.provenance };
        const outcome = observedProcessOutcome(event, event.hostAt);
        if (outcome !== null) {
          terminal = event;
          observedProcess = outcome;
        }
      }
      const endedAt = infra.now();
      if (observedProcess !== null) observedProcess = { ...(observedProcess as ObservedProcessOutcome), endedAt };
      // The reviewer's own words are not swept, for the reason the prompt is
      // not: it is reading the candidate and quoting it back, and the runner
      // retains the identical output from the identical phase unswept.
      for (const event of events) {
        if (!isPersistableKind(event.kind)) continue;
        await persist("attempt.updated", { lastActivityAt: event.hostAt, lastActivity: `${phaseKey}: ${event.kind}` }, {
          type: "normalized-event", phaseId: phaseDb, event,
        });
      }
      if (processRecord !== null) {
        const outcome = observedProcess ?? { status: "FAILED" as const, exitCode: null, endedAt, settled: false };
        await persist("attempt.updated", { process: null, lastActivityAt: outcome.endedAt }, {
          type: "process", phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name,
          record: processRecord, status: outcome.status,
          registeredAt: releasedAt ?? outcome.endedAt, releasedAt, endedAt: outcome.endedAt,
          exitCode: outcome.exitCode, exitSignal: null,
        });
        processSettled = true;
      }
      if (terminal?.kind === "run.failed") throw new AdapterError(route.adapter.id, terminal.errorCode, terminal.message);
      if (terminal?.kind === "run.cancelled") throw new AdapterError(route.adapter.id, "E_CANCELLED", terminal.reason);
      if (terminal?.kind !== "run.completed") throw new AdapterError(route.adapter.id, "E_TERMINAL_MISSING", "adapter event stream ended without a terminal");
      if (terminal.exitCode !== 0) throw new AdapterError(route.adapter.id, "E_BACKEND_FAILURE", `provider exited ${String(terminal.exitCode)}`);
      if (resolved === null) throw new AdapterError(route.adapter.id, "E_MODEL_UNRESOLVED", "adapter emitted no resolved model evidence");
      const usage = events.some((event) => event.kind === "usage") ? sumUsage(events) : UNREPORTED_TOKEN_USAGE;
      await persist("attempt.updated", { model: { resolved: resolved.model, provenance: resolved.provenance } }, {
        type: "agent", phaseId: phaseDb, agent: route.agent.name, adapterId: route.adapterId,
        provider: route.model.provider, color: route.agent.color, requestedModel: route.agent.model,
        resolvedModel: resolved.model, modelProvenance: resolved.provenance,
        contextWindow: route.model.contextWindow, usageAuthority: route.model.usageAuthority,
        usage, contextTokens: contextTokens(usage), costUsd: null, costAuthority: route.model.costAuthority,
        purpose: "review", at: endedAt,
      });

      phase = await persistPhaseState(phase, "VALIDATING");
      const parsed = parseEnvelope(output, REVIEW_OUTPUT_SCHEMA_ID);
      const envelope = wrapEnvelope({
        envelopeId: `${phaseDb}:${String(round)}`, sessionId: status.sessionId, phaseId: phaseKey, correctionRound: round,
        agent: route.agent.name, schemaId: REVIEW_OUTPUT_SCHEMA_ID, createdAt: endedAt,
        rawOutputPath: join("raw", `${phaseKey}.txt`),
      }, parsed);
      await persistEnvelope(phaseKey, attempt === 1 ? phaseKey : `${phaseKey}-${String(attempt)}`, envelope, output);
      const payload = envelope.payload as ReviewOutput | null;

      const reader = artifactReader(status.worktree!);
      const mutations = changedPaths(permission.before, captureChangeSet(status.worktree!));
      const structural = [
        envelopeValid(parsed),
        ...(payload === null ? [] : [artifactsExist(payload.artifacts, reader), jsonParses(payload.artifacts, reader)]),
        noProtectedPaths(mutations, options.config.policy.protected_paths),
        // A reviewer that edits is not a reviewer: `writes: []` makes any
        // observed path a breach, and this states it as a gate rather than
        // leaving it to the permission session alone.
        writesWithinGlobs(mutations, route.agent.writes),
        reviewEvidencePresent({
          ...composed.expectation,
          context: composed.context,
          // The prompt THIS turn sent. A contract retry appends to it and the
          // gate is a containment check, so the composed evidence still has to
          // be provably inside whatever actually reached the provider.
          compiledPrompt: turnPrompt,
          digest: sha256,
        }),
        ...(payload === null ? [] : [verdictConsistent(payload, {
          candidateSha: inspection.candidate,
          candidatePaths: candidatePathsBetween(status.worktree!, inspection.base, inspection.candidate),
        })]),
      ];
      for (const report of structural) await persistGate(report, inspection.candidate, round);
      // A real policy breach outranks every gate reading of it.
      permission.enforce();
      if (!parsed.valid) {
        // Retained for the retry's contract correction, which names the paths
        // that failed and nothing about what the review should say.
        contractViolations = parsed.violations.map((violation) => `${violation.path || "(root)"}: ${violation.message}`);
        throw new ReplacementReviewMalformed(contractViolations.join("; ") || "no envelope was extracted");
      }
      if (payload === null) throw new ReplacementReviewMalformed("the envelope validated but carried no payload");
      const failedEvidence = structural.find((report) => report.gateId === "review_evidence_present" && !report.passed);
      if (failedEvidence !== undefined) {
        throw new ReplacementReviewEvidenceInvalid(failedEvidence.checks.filter((check) => !check.ok).map((check) => check.item).join("; "));
      }
      const otherFailed = structural.find((report) => !report.passed && report.gateId !== "verdict_consistent");
      if (otherFailed !== undefined) {
        throw new ReplacementReviewEvidenceInvalid(`${otherFailed.gateId} failed: ${otherFailed.checks.filter((check) => !check.ok).map((check) => check.item).join("; ")}`);
      }
      const inconsistent = structural.find((report) => report.gateId === "verdict_consistent" && !report.passed);
      if (inconsistent !== undefined) {
        throw new ReplacementReviewInconsistent(inconsistent.checks.filter((check) => !check.ok).map((check) => `${check.item}: ${check.note}`).join("; "));
      }
      return payload;
    };

    const reviewOutput = await runMandatoryReview({
      workerProvider: recorded.worker!.provider,
      providers: providerPairFrom([recorded.worker!.provider, route.model.provider]),
      isTransportFailure: (error) => {
        const transport = isReviewTransportFailure(error);
        if (transport) transportRetries += 1;
        return transport;
      },
      /**
       * The reviewer route is `continuity: "none"` — `resolveReviewRoute`
       * refuses anything else — so a second turn is a cold re-ask rather than
       * an argued-with resume, and the held call is exactly what pays for it.
       */
      isContractFailure: (error) => {
        const contract = error instanceof ReplacementReviewMalformed;
        if (contract) contractRetries += 1;
        return contract;
      },
      execute: async (reviewProvider, attempt) => {
        if (reviewProvider !== route.model.provider) {
          throw new InvalidReviewInversion(`the routed review provider ${JSON.stringify(reviewProvider)} is not the preflighted reviewer route`);
        }
        const held = attempt === 1
          ? reservation
          : budget.reserve({ cost: 1, subject: `${recipe.id}:${phaseKey}:retry` });
        if (attempt !== 1) {
          await persist("attempt.updated", {
            budget: budget.snapshot(), lastActivityAt: infra.now(),
            lastActivity: contractRetries > 0
              ? `held one call for the single permitted replacement-review retry; the first turn did not validate against ${REVIEW_OUTPUT_SCHEMA_ID}`
              : "held one call for the single permitted replacement-review retry",
          });
        }
        // A transport retry never reached the parser, so it re-sends the
        // original prompt; a contract retry appends the violations it must fix.
        const turnPrompt = attempt === 1 || contractViolations.length === 0
          ? renderedPrompt
          : contractRetryPrompt(renderedPrompt, contractViolations);
        const turnPreflight = turnPrompt === renderedPrompt ? preflight : preflightFor(turnPrompt);
        return runTurn(held, attempt, turnPrompt, turnPreflight);
      },
    });

    // §5.3.2 step 3 — a tree that moved under the review invalidates it
    // outright, and the failure is host-deterministic, so it takes L17.
    assertCandidateUnmoved(status, inspection, "between the review and L15", true);
    phase = await persistPhaseState(phase, "SUCCEEDED");
    await persist("attempt.updated", { lastActivityAt: infra.now(), lastActivity: `${phaseKey}: ${route.model.provider} returned ${reviewOutput.verdict}` }, {
      type: "review", phaseId: phaseDb, adapterId: route.adapterId, provider: route.model.provider,
      verdict: reviewOutput.verdict, reviewedSha: reviewOutput.reviewedSha,
      findingCount: reviewOutput.findings.length, at: infra.now(),
    });
    reviewAccepted = true;

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
    const exitObserved = observedProcess !== null
      && (observedProcess as ObservedProcessOutcome).settled
      && (observedProcess as ObservedProcessOutcome).status === "EXITED";
    if (activeTransport.current !== null && !exitObserved) {
      try { survivorReport = await activeTransport.current.cancel("replacement review failed closed"); }
      catch { survivorReport = null; }
    }
    // A reservation that did not reach GO is released, and — unlike
    // `awsf rework`, deliberately — the owner re-entry it charged is rewound.
    // The owner authorized one replacement review; a launch that never happened
    // is not that, and confiscating the allowance for it would leave the
    // attempt with no re-entry and no review to show for it.
    const heldBefore = budget.outstanding();
    for (const held of heldBefore) budget.releaseOnRegistrationFailure(held.id);
    if (!spentAnyCall && heldBefore.length > 0) budget.rewindOwnerReentry();

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
    if (reviewAccepted) {
      await recoverPersist("attempt.updated", {
        budget: budget.snapshot(), process: null,
        blocker: { code: "sqlite-projection-failed", detail: failure.message, ahead: null, behind: null },
        lastActivityAt: recoveryAt, lastActivity: "replacement review advancement held at REVIEWING until observability rebuild",
        nextAction: "run `awsf db rebuild`, then rerun advancement",
      });
      return { status, confirmed: true };
    }

    const failedPhase: PhaseEvidenceRecord = {
      ...phase, status: "FAILED", startedAt: phase.startedAt ?? recoveryAt, endedAt: recoveryAt,
      errorCode: failure.name, errorMessage: failure.message,
    };
    try {
      await recoverPersist("attempt.updated", {
        phase: { name: failedPhase.name, state: "FAILED", round: 0, maximumRounds: 0 },
        budget: budget.snapshot(), process: null, lastActivityAt: recoveryAt,
        lastActivity: `${failedPhase.key} failed closed`,
      }, { type: "phase", phase: failedPhase });
    } catch { /* the halt below is the mandatory durable settlement. */ }

    status = await readAttempt(options.attemptDir);
    // Bound to a const rather than narrowed in place: `processRecord` is only
    // ever assigned inside the broker's `register` callback, so outer-scope
    // flow analysis cannot see that assignment and the guard alone is not a
    // durable narrowing.
    const registered = processRecord as BarrierRecord | null;
    if (registered !== null && (!processSettled || (observedProcess as ObservedProcessOutcome | null)?.settled === false)) {
      const observed = observedProcess as ObservedProcessOutcome | null;
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
          registeredAt: releasedAt ?? outcome.endedAt, releasedAt, endedAt: outcome.endedAt,
          exitCode: outcome.exitCode, exitSignal: null,
        });
      } catch { /* the halt below is the mandatory durable settlement. */ }
    }

    status = await readAttempt(options.attemptDir);
    const terminationFailure = !exitObserved && activeTransport.current !== null && survivorReport === null
      ? new Error(`${failure.message}; registered process termination could not be verified`)
      : !exitObserved && survivorReport !== null && !survivorReport.terminated
        ? new Error(`${failure.message}; surviving processes [${survivorReport.survivors.join(", ")}]`)
        : failure;
    const reason2 = classify(terminationFailure);
    if (reason2.edge === null) {
      // Named rather than rethrown. REVIEWING has no host exit for a policy
      // breach or an inconsistent verdict — inventing one would mean the host
      // deciding what a bad review means — so the classification is recorded
      // and the owner's own exits are stated.
      await recoverPersist("attempt.updated", {
        budget: budget.snapshot(), process: null,
        blocker: { code: reason2.code, detail: reason2.detail, ahead: null, behind: null },
        lastActivityAt: recoveryAt, lastActivity: reason2.detail,
        nextAction: `run \`awsf cancel ${status.taskId}\`; REVIEWING has no host exit for ${reason2.code}`,
      });
      return { status, confirmed: true };
    }
    const l17 = transition({
      from: "REVIEWING", to: "BLOCKED", actor: "host", tier: status.tier,
      reason: { source: "process", code: reason2.code, detail: reason2.detail },
      interactive: false, budget: budget.snapshot(),
      evidence: { reviewTransportRetries: transportRetries, reviewFailure: reason2.code },
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
 * rewound. The attempt is left rerunnable rather than blocked; the rerun then
 * refuses, because REVIEWING is not where L25 starts.
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
  return persistAttempt(options.attemptDir, status.revision, {
    kind: "attempt.updated",
    next: nextRevision(status, {
      budget, process: null, lastActivityAt: at,
      lastActivity: `recovered a stale L25 reservation; ${rewind ? "no provider launched, so the owner re-entry was rewound" : "a provider had already launched, so the charge stands"}`,
    }),
  }, options.projectRecord);
}

/** The plan-shaped envelope the recipe produced — the engineer's, or the planner's. */
function planIntentFrom(evidence: readonly AttemptEvidence[]): PlanOutput | null {
  let intent: PlanOutput | null = null;
  for (const record of evidence) {
    if (record.type !== "envelope") continue;
    const envelope = record.envelope;
    if (envelope.schemaId !== "awsf.plan-output/v1" || !envelope.valid || envelope.payload === null) continue;
    intent = envelope.payload as PlanOutput;
  }
  return intent;
}

/**
 * The retained `TestOutput` of the last code phase.
 *
 * Reused rather than re-measured, and this is the ONE class of reuse the design
 * allows: a host measurement keyed by the exact SHA it measured. It is admitted
 * only when it names this candidate and passed — the same rule
 * `candidateMeasurements` already holds itself to.
 */
function lastTestOutputFrom(evidence: readonly AttemptEvidence[], candidateSha: string): TestOutput {
  let measured: TestOutput | null = null;
  for (const record of evidence) {
    if (record.type !== "envelope") continue;
    const envelope = record.envelope;
    if (envelope.schemaId !== "awsf.test-output/v1" || !envelope.valid || envelope.payload === null) continue;
    measured = envelope.payload as TestOutput;
  }
  if (measured === null) throw new ReviewRecordMissing("no retained command evidence exists to hand the replacement reviewer");
  if (measured.candidateSha !== candidateSha) {
    throw new ReviewRecordMissing(`the retained command evidence measured ${measured.candidateSha}, not the candidate ${candidateSha}`);
  }
  if (!measured.passed) throw new ReviewRecordMissing("the retained command evidence is red; a red candidate is never re-reviewed");
  return measured;
}

export async function reviewCommand(options: ReviewCommandOptions): Promise<ReviewCommandResult> {
  try {
    return await runReviewCommand(options);
  } catch (error) {
    throw safeFailure(error);
  }
}

export type { RecordedReview };
