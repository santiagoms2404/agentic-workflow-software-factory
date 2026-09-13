// The review half of the tier-2 lifecycle, in one module.
//
// Two commands buy a review of one exact candidate outside the production
// runner: `awsf review` replaces a review of an UNCHANGED candidate on L25, and
// `awsf rework` buys the first review of a REBUILT candidate on L11. The
// candidate differs and the edge differs; what a review of that candidate MEANS
// does not, and a second copy of this code would be a second answer to it.
//
// So this module owns the whole of that meaning and nothing else:
//
//   The route, derived rather than chosen. The provider comes from EXCLUSION
//   against the provider the worker actually ran on — read from the journal,
//   never from the config's optional label — and the configured reviewer is
//   then checked against that answer. A reviewer that can write, or that could
//   be resumed, is refused: a resumable reviewer is argued with rather than
//   asked.
//
//   The evidence, composed by the host and proved FIT before any call is held.
//   `workflow/review-evidence.ts` is the one composer; this module is the one
//   place that hands what it composed to a provider.
//
//   The turn, its single permitted retry, its gates, and its artefacts. Every
//   identity written here is GENERATION-qualified by the caller's own counter,
//   because the projection writes gate rows `INSERT OR REPLACE` and envelope
//   rows `INSERT OR IGNORE`: two reviews of two candidates in one attempt would
//   otherwise collapse into one row and the superseded evidence would vanish.
//
// What is deliberately NOT here: the edge, the owner's words, and the halt. The
// caller authorizes its own transition, decides what to display, and owns its
// own recovery — this module raises named failures and `reviewFailureBlocker`
// says which of them L17 admits.
//
// One rule this module enforces by construction: the reviewer is never briefed.
// It is handed the candidate and the recorded request, and never the owner's
// defect statement, the owner's rejection reason, or a superseded verdict. A
// reviewer told what to find is not a reviewer.

import { existsSync, readFileSync, statSync, promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
import { assertPrivateSystemPrompt } from "../../adapters/system-prompt-file.ts";
import type { AdapterEntry, AgentDefinition, AwsfConfig } from "../../config/schema.ts";
import { BUILD_OUTPUT_SCHEMA_ID } from "../../contracts/build-output.ts";
import type { EnvelopeBase } from "../../contracts/envelope-base.ts";
import {
  UNREPORTED_TOKEN_USAGE,
  isPersistableKind,
  type ModelResolutionProvenance,
  type NormalizedEvent,
  type TokenUsage,
} from "../../contracts/normalized-events.ts";
import { parseEnvelope } from "../../contracts/parse-envelope.ts";
import type { PlanOutput } from "../../contracts/plan-output.ts";
import { REVIEW_CONTEXT_SCHEMA_ID, type ReviewContext } from "../../contracts/review-context.ts";
import { REVIEW_OUTPUT_SCHEMA_ID, type ReviewOutput } from "../../contracts/review-output.ts";
import { wrapEnvelope, type StoredEnvelope } from "../../contracts/stored-envelope.ts";
import type { TestOutput } from "../../contracts/test-output.ts";
import { CallBudget, type Reservation } from "../../execution/call-budget.ts";
import { ContinuityStore } from "../../execution/continuity-store.ts";
import { buildPhaseRequest, openRetainedColdTurn, phasePersistenceEvidence, redactPhaseProcess } from "../../execution/phase-request.ts";
import type { BarrierRecord } from "../../execution/launcher-barrier.ts";
import type { BrokerOptions } from "../../execution/transport-broker.ts";
import { artifactsExist, jsonParses, type ArtifactObservation } from "../../gates/artifacts.ts";
import { envelopeValid } from "../../gates/envelope.ts";
import { noProtectedPaths, writesWithinGlobs } from "../../gates/git-diff.ts";
import { GateReport, type GateId } from "../../gates/interface.ts";
import { reviewEnvelopeComplete, reviewEvidencePresent, verdictConsistent } from "../../gates/review.ts";
import { captureChangeSet, changedPaths } from "../../git/changes.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../observability/attempt-evidence.ts";
import { PermissionBreach } from "../../policy/path-policy.ts";
import { REDACTED_VALUE, scrubCredentialString, scrubCredentials } from "../../policy/redaction.ts";
import { openPermissionSession, type PermissionSession, type SandboxGrant, type SandboxProbe } from "../../policy/sandbox-broker.ts";
import type { EdgeId, TaskState } from "../../state/task-machine.ts";
import { compilePhase, type WorkflowRecipe } from "../../workflow/compiler.ts";
import { composePromptBundle, type PromptBundle } from "../../workflow/prompt-composition.ts";
import type { CompiledAgentPhase } from "../../workflow/phase.ts";
import {
  ReviewEvidenceUnfit,
  candidatePathsBetween,
  composeReviewEvidence,
  sha256,
  type ReviewEvidenceIntent,
} from "../../workflow/review-evidence.ts";
import {
  InvalidReviewInversion,
  MandatoryReviewUnavailable,
  oppositeProvider,
  providerPairFrom,
  runMandatoryReview,
} from "../../workflow/review-routing.ts";
import type { AttemptEvent, AttemptStatus } from "./attempt.ts";
import { ProductionRouteUnavailable, ProductionWorkflowUnsupported, isReviewTransportFailure } from "./production-run.ts";
import {
  assertPromptCompositionCurrent,
  type RecordedRoute,
} from "./review-record.ts";

const { chmod, mkdir, readFile, realpath, writeFile } = fs;

const HOST = globalThis as unknown as {
  process: { env: Readonly<Record<string, string>> };
  AbortController: new () => { signal: Parameters<TransportBroker["startProcess"]>[2]; abort(reason?: unknown): void };
};

/** Marks the appended block so a compiled prompt says which turn it was. */
export const CONTRACT_RETRY_HEADING = "ENVELOPE CONTRACT CORRECTION";

/**
 * The headroom a review needs before anything at all is spent: one call for the
 * review and one for its single permitted retry.
 *
 * With one call left the review spends the last one and a transport fault then
 * raises `CallCeilingExceeded` from inside the retry closure — which is not a
 * transport failure, so it is never wrapped, and the attempt is stranded in
 * REVIEWING having taken no L17 either. Refusing first costs nothing.
 */
export const REVIEW_HEADROOM_CALLS = 2;

// ---------------------------------------------------------------------------
// Failures. Every one of these is host-deterministic; none interprets a verdict.
// ---------------------------------------------------------------------------

export class ReviewCredentialRejected extends Error {
  constructor(source: string) {
    super(`review rejected ${source}: credential-shaped data is never persisted or sent to a provider`);
    this.name = "ReviewCredentialRejected";
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
    super(`the review needs retained evidence the attempt does not carry: ${detail}`);
    this.name = "ReviewRecordMissing";
  }
}

/** Host-deterministic: TypeBox either validated the envelope or it did not. */
export class ReplacementReviewMalformed extends Error {
  constructor(detail: string) {
    super(`the review produced no valid envelope: ${detail}`);
    this.name = "ReplacementReviewMalformed";
  }
}

/** Host-deterministic: a gate row failed, or the tree moved under the review. */
export class ReplacementReviewEvidenceInvalid extends Error {
  constructor(detail: string) {
    super(`the review's evidence is invalid: ${detail}`);
    this.name = "ReplacementReviewEvidenceInvalid";
  }
}

/** The host records the failed consistency gate without reinterpreting its content. */
export class ReplacementReviewInconsistent extends Error {
  constructor(detail: string) {
    super(`the review answered inconsistently: ${detail}`);
    this.name = "ReplacementReviewInconsistent";
  }
}

/**
 * Every review failure the host can classify without interpreting a verdict,
 * and which host-observed code L17 records after the process exits.
 *
 * `null` means this module does not recognise the failure, so the caller uses
 * `phase-abort`. Policy failures keep their own names rather than being folded
 * into review-evidence-invalid.
 */
export function reviewFailureBlocker(
  failure: Error,
  detail: string,
): { readonly code: string; readonly detail: string; readonly edge: "L17" } | null {
  if (failure instanceof MandatoryReviewUnavailable) return { code: "review-unavailable", detail, edge: "L17" };
  if (failure instanceof ReplacementReviewMalformed) return { code: "review-malformed", detail, edge: "L17" };
  if (failure instanceof ReplacementReviewEvidenceInvalid) return { code: "review-evidence-invalid", detail, edge: "L17" };
  if (failure instanceof ReviewEvidenceUnfit) return { code: "review-evidence-invalid", detail, edge: "L17" };
  if (failure instanceof PermissionBreach) return { code: "permission-breach", detail, edge: "L17" };
  if (failure instanceof ReplacementReviewInconsistent) return { code: "review-inconsistent", detail, edge: "L17" };
  if (failure instanceof AdapterError && failure.code === "E_QUOTA_EXHAUSTED") return { code: "quota-exhausted", detail, edge: "L17" };
  return null;
}

/**
 * The correction handed to a COLD reviewer's second turn.
 *
 * It carries the rejected response and schema violations, but never the owner's
 * reason, defect, superseded verdict, or a hint about what this reviewer should
 * conclude. The prior response lets a cold session preserve every finding while
 * the listed paths keep the correction about form rather than verdict content.
 */
export function contractRetryPrompt(
  prompt: string,
  previousResponse: string,
  violations: readonly string[],
): string {
  const listed = violations.length === 0
    ? "  - no envelope was extracted from the response"
    : violations.map((violation) => `  - ${violation}`).join("\n");
  return [
    prompt,
    "",
    CONTRACT_RETRY_HEADING,
    `Your previous response did not validate against ${REVIEW_OUTPUT_SCHEMA_ID}. The host did not reinterpret it.`,
    "Previous response whose substance must be preserved:",
    previousResponse,
    "Host-observed contract violations:",
    listed,
    "Return the SAME review, unchanged in substance — same verdict, same findings, same limitations —",
    "as a single JSON envelope that validates. The schema permits no property beyond those it names.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Shared helpers, deliberately the same shapes both commands already use.
// ---------------------------------------------------------------------------

function credentialSafeText(value: string, source: string, rejectPriorRedaction = false): string {
  const scrubbed = scrubCredentialString(value);
  if (scrubbed !== value || (rejectPriorRedaction && value.includes(REDACTED_VALUE))) {
    throw new ReviewCredentialRejected(source);
  }
  return scrubbed;
}

function credentialSafeValue<T>(value: T, source: string): T {
  const scrubbed = scrubCredentials(value);
  if (JSON.stringify(scrubbed) !== JSON.stringify(value)) throw new ReviewCredentialRejected(source);
  return scrubbed;
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

/** Replacement-review seam retained for the three-path prompt-bundle characterization. */
export async function readReviewPromptPair(
  configPath: string,
  agent: AgentDefinition,
): Promise<PromptBundle> {
  return composePromptBundle({ configPath, agent });
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
 * the credential pattern reviewable once and re-reviewable never — a stricter
 * rule than the production runner applies to the identical bytes, which is the
 * asymmetry rather than the protection.
 */
function credentialSafeDescriptor(spec: ProcessSpec, source: string): ProcessSpec {
  credentialSafeValue({ ...spec, stdin: "" }, source);
  return spec;
}

function preflightDescriptor(route: ReviewRoute, request: ModelRequest, spec: ProcessSpec): ProcessSpec {
  const path = request.systemPromptPath;
  if (path === undefined) throw new Error("a review requires a private system prompt path");
  credentialSafeText(path, "private system prompt path", true);
  assertPrivateSystemPrompt(route.adapter.id, path);
  const checked = credentialSafeDescriptor(spec, "final process descriptor");
  if (checked.shell !== false || checked.stdin !== request.prompt || checked.cwd !== request.cwd) {
    throw new AdapterError(route.adapter.id, "E_REDACTION", "the final review descriptor changed its prompt, cwd, or shell policy");
  }
  if (checked.argv.filter((argument) => argument === path).length !== 1) {
    throw new AdapterError(route.adapter.id, "E_REDACTION", "the final review descriptor must reference the one validated private system prompt path exactly once");
  }
  const privateText = [request.prompt, route.systemPrompt, route.userPrompt];
  if (checked.argv.some((argument) => privateText.some((text) =>
    text.length > 0 && (argument === text || (text.length >= 32 && argument.includes(text)))))) {
    throw new AdapterError(route.adapter.id, "E_REDACTION", "private prompt content appeared in argv");
  }
  return checked;
}

function routeEventExact(event: NormalizedEvent, route: ReviewRoute): void {
  if (event.kind === "run.started" && (event.adapter !== route.adapter.id || event.requestedModel !== route.model.requestedModel)) {
    throw new ReviewRouteMismatch(`run.started reported ${event.adapter}/${event.requestedModel}, expected ${route.adapter.id}/${route.model.requestedModel}`);
  }
  if (event.kind === "model.resolved" && (
    event.adapter !== route.adapter.id || event.provider !== route.model.provider || event.requestedModel !== route.model.requestedModel
  )) {
    throw new ReviewRouteMismatch(`model.resolved reported ${event.adapter}/${event.provider}/${event.requestedModel}, expected ${route.adapter.id}/${route.model.provider}/${route.model.requestedModel}`);
  }
}

// ---------------------------------------------------------------------------
// What the retained journal already says a review must be composed from.
// ---------------------------------------------------------------------------

/** The plan-shaped envelope the recipe produced — the engineer's, or the planner's. */
export function planIntentFrom(evidence: readonly AttemptEvidence[]): PlanOutput | null {
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
 * `candidateMeasurements` already holds itself to, and the reason a command
 * that REBUILDS the candidate must persist its own before it composes anything.
 */
export function lastTestOutputFrom(evidence: readonly AttemptEvidence[], candidateSha: string): TestOutput {
  let measured: TestOutput | null = null;
  for (const record of evidence) {
    if (record.type !== "envelope") continue;
    const envelope = record.envelope;
    if (envelope.schemaId !== "awsf.test-output/v1" || !envelope.valid || envelope.payload === null) continue;
    measured = envelope.payload as TestOutput;
  }
  if (measured === null) throw new ReviewRecordMissing("no retained command evidence exists to hand the reviewer");
  if (measured.candidateSha !== candidateSha) {
    throw new ReviewRecordMissing(`the retained command evidence measured ${measured.candidateSha}, not the candidate ${candidateSha}`);
  }
  if (!measured.passed) throw new ReviewRecordMissing("the retained command evidence is red; a red candidate is never reviewed");
  return measured;
}

/** The recipe's review phase, and the agent phase the inversion is taken against. */
export function reviewPhasesOf(recipe: WorkflowRecipe): { readonly review: string; readonly worker: string } {
  const review = recipe.phases.find((phase) => phase.kind === "agent" && phase.schemaId === REVIEW_OUTPUT_SCHEMA_ID);
  const worker = recipe.phases.find((phase) => phase.kind === "agent" && phase.schemaId === BUILD_OUTPUT_SCHEMA_ID);
  if (review === undefined || worker === undefined) {
    throw new ProductionWorkflowUnsupported(recipe.id, "a review needs both a review phase and a worker phase to invert against");
  }
  return { review: review.id, worker: worker.id };
}

// ---------------------------------------------------------------------------
// The route.
// ---------------------------------------------------------------------------

export interface ReviewPhaseInfrastructure {
  adapterFor(entry: AdapterEntry, adapterId: string, config: AwsfConfig): HarnessAdapter | null;
  createBroker(options: BrokerOptions): TransportBroker;
  writeSystemPrompt(text: string, directory: string): Promise<string>;
  now(): string;
  sandboxProbe?: SandboxProbe;
}

export interface ReviewRoute extends PromptBundle {
  readonly agent: AgentDefinition;
  readonly adapterId: string;
  readonly adapter: HarnessAdapter;
  readonly model: ModelInfo;
}

export interface ResolveReviewRouteOptions {
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly infra: ReviewPhaseInfrastructure;
  readonly recipe: WorkflowRecipe;
  readonly reviewPhaseId: string;
  /** The provider the worker call ACTUALLY ran on, read from the journal. */
  readonly workerProvider: string | undefined;
  /** The route a review already on record ran on, when there is one. */
  readonly priorReview?: RecordedRoute | null;
}

/**
 * The reviewer route, re-derived rather than re-chosen.
 *
 * The provider comes from EXCLUSION against the provider the worker actually
 * ran on — read from the journal, not from the config's optional label — and
 * the configured reviewer is then checked against that answer. Every drift from
 * the route a review already on record ran on is a refusal, because a second
 * review on a different model is a different experiment.
 */
export async function resolveReviewRoute(options: ResolveReviewRouteOptions): Promise<ReviewRoute> {
  const { config, infra, recipe, reviewPhaseId } = options;
  const reviewAgentName = recipe.phases.find((phase) => phase.id === reviewPhaseId)!.owner;
  const agent = config.agents.find((candidate) => candidate.name === reviewAgentName);
  if (agent === undefined) throw new ProductionRouteUnavailable(reviewAgentName, "no explicit agent definition exists");
  if (agent.writes.length !== 0) throw new ReviewRouteMismatch("a reviewer that can write is not a reviewer; `writes` must stay empty");
  // A resumable reviewer is argued with rather than briefed: a prior verdict
  // sits in its context and the new turn asks it to revise. A review bought
  // outside the runner is cold by construction, and a config that says
  // otherwise is refused here rather than quietly ignored.
  if (agent.harness.continuity !== "none") {
    throw new ReviewRouteMismatch(`this review is cold; configured continuity ${JSON.stringify(agent.harness.continuity)} would resume a reviewer`);
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
    if (phase.kind !== "agent" || phase.id === reviewPhaseId) continue;
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
  const workerProvider = options.workerProvider;
  if (workerProvider === undefined) {
    throw new ReviewRecordMissing("no recorded worker call names the provider the inversion must exclude");
  }
  const required = oppositeProvider(workerProvider, providerPairFrom(providers));
  if (model.provider !== required) {
    throw new InvalidReviewInversion(
      `the worker ran on ${JSON.stringify(workerProvider)}, so the review must run on ${JSON.stringify(required)}; ` +
        `the configured reviewer route resolves to ${JSON.stringify(model.provider)}`,
    );
  }
  const priorReview = options.priorReview ?? null;
  if (priorReview !== null && (
    priorReview.adapterId !== agent.harness.adapter ||
    priorReview.provider !== model.provider ||
    priorReview.requestedModel !== agent.model
  )) {
    throw new ReviewRouteMismatch(
      `the review on record ran on ${priorReview.adapterId}/${priorReview.provider}/${priorReview.requestedModel}; ` +
        `the configured route is now ${agent.harness.adapter}/${model.provider}/${agent.model}`,
    );
  }
  const prompts = await readReviewPromptPair(options.configPath, agent);
  if (priorReview !== null) assertPromptCompositionCurrent(prompts, priorReview, "reviewer");
  return {
    agent,
    adapterId: agent.harness.adapter,
    adapter,
    model,
    ...prompts,
  };
}

// ---------------------------------------------------------------------------
// Running the phase.
// ---------------------------------------------------------------------------

export interface ObservedProcessOutcome {
  readonly status: "EXITED" | "FAILED" | "CANCELLED";
  readonly exitCode: number | null;
  readonly endedAt: string;
  /** True only when the adapter already settled the process outcome. */
  readonly settled: boolean;
}

function observedProcessOutcome(event: NormalizedEvent, endedAt: string): ObservedProcessOutcome | null {
  switch (event.kind) {
    case "run.completed":
      return { status: event.exitCode === null ? "FAILED" : "EXITED", exitCode: event.exitCode, endedAt, settled: event.exitCode !== null };
    case "run.failed":
      return { status: "FAILED", exitCode: null, endedAt, settled: true };
    case "run.cancelled":
      return { status: "CANCELLED", exitCode: null, endedAt, settled: true };
    default:
      return null;
  }
}

/**
 * What the caller's own recovery path needs to know about a review that failed
 * halfway.
 *
 * Mutable and owned by the caller, because settling a registered process and
 * choosing a legal halt are the caller's job — this module only records what it
 * observed while the phase was in flight.
 */
export interface ReviewRunState {
  phase: PhaseEvidenceRecord | null;
  processRecord: BarrierRecord | null;
  processSettled: boolean;
  observed: ObservedProcessOutcome | null;
  releasedAt: string | null;
  spentAnyCall: boolean;
  transportRetries: number;
  contractRetries: number;
  activeTransport: ProcessTransport | null;
  answered: boolean;
}

export function createReviewRunState(): ReviewRunState {
  return {
    phase: null, processRecord: null, processSettled: false, observed: null, releasedAt: null,
    spentAnyCall: false, transportRetries: 0, contractRetries: 0, activeTransport: null, answered: false,
  };
}

/** The attempt's own identity and geometry, all of it host-observed. */
export interface ReviewPhaseSubject {
  readonly attemptDir: string;
  /** Masked inside the sandbox namespace; see `policy/sandbox-broker.ts`. */
  readonly stateRoot: string;
  readonly sessionId: string;
  readonly repository: string;
  readonly worktree: string;
  readonly baseSha: string;
  readonly candidateSha: string;
}

export interface PrepareReviewOptions {
  readonly subject: ReviewPhaseSubject;
  readonly config: AwsfConfig;
  readonly infra: ReviewPhaseInfrastructure;
  readonly recipe: WorkflowRecipe;
  readonly reviewPhaseId: string;
  readonly route: ReviewRoute;
  /**
   * The generation suffix every identity this phase writes carries — `re1` for
   * a replacement review, `rw1` for the first rework's review. Six identities
   * would otherwise collide and one review would silently overwrite another.
   */
  readonly generation: string;
  readonly intent: ReviewEvidenceIntent;
  /** The host measurement of THIS candidate, nested whole into the evidence. */
  readonly testOutput: TestOutput;
  /**
   * The provider the worker call actually ran on. The inversion is taken
   * against this and against nothing else, which is why it is read from the
   * journal by the caller rather than from the configuration here.
   */
  readonly workerProvider: string;
}

export type ReviewPersist = (
  kind: AttemptEvent["kind"],
  update: Partial<AttemptStatus>,
  evidence?: AttemptEvidence,
) => Promise<void>;

export interface RunReviewOptions {
  readonly budget: CallBudget;
  /** The call the caller's own spawn edge already holds. */
  readonly reservation: Reservation;
  readonly retrySubject: string;
  /** The caller's spawn edge, recorded on every process this phase registers. */
  readonly registration: { readonly from: TaskState; readonly to: TaskState; readonly edge: EdgeId };
  /** Ordinal of the context phase; the review phase takes the next one. */
  readonly ordinal: number;
  readonly state: ReviewRunState;
  readonly persist: ReviewPersist;
  /** The LAST host read before GO. Throws to refuse the launch. */
  readonly assertBeforeGo?: () => void;
  /**
   * The read AFTER the review answered and before its verdict is recorded.
   *
   * A tree that moved under the review invalidates it outright, and that is
   * host-deterministic — so it must be settled before the phase is marked
   * SUCCEEDED, or a review of another tree would be on record as this
   * candidate's.
   */
  readonly assertAfterAnswer?: () => void;
  readonly assertLaunchProjection?: (sessionId: string) => void;
}

export interface PreparedReview {
  /** `reviewer-re1`, `reviewer-rw1` — generation-qualified, never bare. */
  readonly phaseKey: string;
  readonly contextKey: string;
  readonly context: ReviewContext;
  readonly changedFiles: readonly string[];
  readonly truncated: boolean;
  readonly omittedFiles: readonly string[];
  run(options: RunReviewOptions): Promise<ReviewOutput>;
}

/**
 * Everything that must be true BEFORE a call may be held: the evidence is
 * composed and proved fit, the private system prompt is materialized and
 * verified, and the exact descriptor that will reach the sandbox is built and
 * swept. A review that could not have been evidence is refused here, with
 * nothing spent.
 */
export async function prepareReview(options: PrepareReviewOptions): Promise<PreparedReview> {
  const { subject, config, infra, recipe, route, generation } = options;
  const phaseKey = `${options.reviewPhaseId}-${generation}`;
  const contextKey = `review-context-${generation}`;
  const composed = await composeReviewEvidence({
    worktree: subject.worktree,
    baseSha: subject.baseSha,
    candidateSha: subject.candidateSha,
    intent: options.intent,
    testOutput: options.testOutput,
    // Generation-qualified like every other identity: a retained diff any
    // earlier review was judged against is evidence and is never rewritten.
    diffRef: join("raw", `review-context-${subject.candidateSha}-${generation}.diff`),
    retainFullDiff: async (relativePath, diff) => {
      const absolute = join(subject.attemptDir, relativePath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, diff, { mode: 0o600 });
      await chmod(absolute, 0o600);
      return readFile(absolute, "utf8");
    },
  });

  const reviewPhaseDefinition = recipe.phases.find((phase) => phase.id === options.reviewPhaseId)!;
  const compiledReviewer = compilePhase({
    ...(reviewPhaseDefinition as CompiledAgentPhase & { prompt: string }),
    prompt: route.userPrompt,
  }) as CompiledAgentPhase;
  // Not credential-swept, deliberately: this is the candidate's own diff and
  // the request the owner recorded, and the production runner hands the
  // identical bytes to the identical reviewer. A sweep here would refuse to
  // review a candidate whose source it had already allowed.
  const renderedPrompt = compiledReviewer.renderPrompt(composed.context as unknown as EnvelopeBase);

  const runtimeDir = join(subject.attemptDir, "private", phaseKey);
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  const systemPromptPath = await infra.writeSystemPrompt(route.systemPrompt, runtimeDir);
  await validateMaterializedSystemPrompt(route.adapter.id, runtimeDir, systemPromptPath, route.systemPrompt);
  const openPermission = (): PermissionSession => openPermissionSession({
    canonicalRepository: subject.repository,
    worktree: subject.worktree,
    sessionRuntime: runtimeDir,
    stateRoot: subject.stateRoot,
    profile: route.agent.tools.profile,
    tools: route.agent.tools.allow,
    writes: route.agent.writes,
    protectedPaths: config.policy.protected_paths,
    ...(infra.sandboxProbe === undefined ? {} : { sandboxProbe: infra.sandboxProbe }),
  });
  /**
   * The privacy preflight is a function of the PROMPT, because the contract
   * retry's prompt is not attempt 1's.
   *
   * The launch wrapper refuses any descriptor that differs from the one
   * validated before it, which is the guarantee that a sandbox grant cannot
   * change between validation and GO. Reusing attempt 1's preflight for a retry
   * that carries a different prompt would trip exactly that check, so each
   * attempt gets its own preflight of its own descriptor and the guarantee is
   * preserved rather than widened.
   */
  const continuity = new ContinuityStore({ path: join(runtimeDir, "continuity.json") });
  let nextColdTurn = 0;
  type ReviewTurnPreflight = { request: ModelRequest; grant: SandboxGrant; spec: ProcessSpec; continuityHandle: string | null };
  const preflightFor = async (prompt: string): Promise<ReviewTurnPreflight> => {
    const retained = await openRetainedColdTurn({ agent: route.agent, adapter: route.adapter,
      store: continuity, phaseKey, round: nextColdTurn++, runtimeDir });
    const request = buildPhaseRequest({ agent: route.agent, prompt, systemPromptPath, cwd: subject.worktree,
      env: HOST.process.env,
      ...(retained === null ? {} : { continuity: { ref: retained.ref, turn: "open" as const } }),
    });
    const grant = openPermission().sandbox(route.adapter.buildSpec(request));
    return { request, grant, spec: preflightDescriptor(route, request, grant.spec), continuityHandle: retained?.handle ?? null };
  };
  // The actual final descriptor, including the materialized private path,
  // validated before the caller's spawn edge can become durable.
  const preflight = await preflightFor(renderedPrompt);

  const run = async (runOptions: RunReviewOptions): Promise<ReviewOutput> => {
    const { budget, state, persist } = runOptions;
    const phaseDb = `${subject.sessionId}:${phaseKey}`;
    const createdAt = infra.now();
    let contractViolations: readonly string[] = [];
    let contractPreviousResponse = "";

    let contextPhase: PhaseEvidenceRecord = {
      phaseId: `${subject.sessionId}:${contextKey}`, ordinal: runOptions.ordinal, key: contextKey, name: contextKey,
      kind: "code", owner: "host",
      description: `Compose the host-observed evidence for the review of ${subject.candidateSha}`,
      status: "QUEUED", correctionCount: 0, maxCorrections: 0, errorCode: null, errorMessage: null,
      startedAt: null, endedAt: null, createdAt,
    };
    let phase: PhaseEvidenceRecord = {
      phaseId: phaseDb, ordinal: runOptions.ordinal + 1, key: phaseKey, name: phaseKey,
      kind: "agent", owner: route.agent.name,
      description: `Audit exact candidate ${subject.candidateSha} on the opposite provider`,
      status: "QUEUED", correctionCount: 0, maxCorrections: 0, errorCode: null, errorMessage: null,
      startedAt: null, endedAt: null, createdAt,
    };
    state.phase = phase;

    const persistPhaseState = async (record: PhaseEvidenceRecord, phaseState: string): Promise<PhaseEvidenceRecord> => {
      const at = infra.now();
      const next: PhaseEvidenceRecord = {
        ...record, status: phaseState,
        startedAt: record.startedAt ?? (phaseState === "RUNNING" ? at : null),
        endedAt: ["SUCCEEDED", "FAILED", "CANCELLED"].includes(phaseState) ? at : null,
        errorCode: null, errorMessage: null,
      };
      await persist("attempt.updated", {
        phase: { name: next.name, state: phaseState, round: 0, maximumRounds: 0 },
        lastActivityAt: at, lastActivity: `${next.key} is ${phaseState}`,
      }, { type: "phase", phase: next });
      return next;
    };
    /**
     * Round-scoped, because the projection writes gate rows `INSERT OR
     * REPLACE`. A contract retry reusing round 0 would overwrite the very rows
     * that record why the first turn failed — the same silent-overwrite hazard
     * the generation-qualified identities exist to prevent, one level down.
     */
    const persistGate = async (report: GateReport, round: number): Promise<void> => {
      const at = infra.now();
      await persist("attempt.updated", {}, {
        type: "gate", id: `${phaseDb}:${String(round)}:${report.gateId}`, phaseId: phaseDb, round,
        gateId: report.gateId, kind: gateKind(report.gateId), candidateSha: subject.candidateSha,
        passed: report.passed, exitCode: null, checks: report.checks,
        violations: report.checks.filter((check) => !check.ok).map((check) => `${check.item}: ${check.note}`),
        outputPath: null, startedAt: at, endedAt: at,
      });
    };
    const persistEnvelope = async (key: string, rawName: string, envelope: StoredEnvelope<EnvelopeBase>, rawOutput: string): Promise<void> => {
      const rawRelative = join("raw", `${rawName}.txt`);
      const rawAbsolute = join(subject.attemptDir, rawRelative);
      await mkdir(dirname(rawAbsolute), { recursive: true });
      await writeFile(rawAbsolute, rawOutput, { mode: 0o600 });
      await chmod(rawAbsolute, 0o600);
      const stored = { ...envelope, rawOutputPath: rawRelative };
      const envelopePath = join(subject.attemptDir, "envelopes", `${key}-${envelope.correctionRound}.json`);
      await mkdir(dirname(envelopePath), { recursive: true });
      if (existsSync(envelopePath)) throw new Error(`immutable envelope already exists: ${envelopePath}`);
      await writeFile(envelopePath, JSON.stringify(stored), { mode: 0o600 });
      await persist("attempt.updated", {}, { type: "envelope", phaseId: `${subject.sessionId}:${key}`, envelope: stored });
    };

    await persist("attempt.updated", {}, { type: "phase", phase: contextPhase });
    await persist("attempt.updated", {}, { type: "phase", phase });

    contextPhase = await persistPhaseState(contextPhase, "RUNNING");
    const contextEnvelope = wrapEnvelope({
      envelopeId: `${subject.sessionId}:${contextKey}:0`, sessionId: subject.sessionId, phaseId: contextKey,
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
      ...route.evidence,
      lineCount: route.systemPrompt.split(/\r?\n/).length, at: infra.now(),
    });
    phase = await persistPhaseState(phase, "RUNNING");
    state.phase = phase;

    const broker = infra.createBroker({
      ledger: budget,
      register: async (record) => {
        state.processRecord = redactPhaseProcess(record, continuity);
        state.processSettled = false;
        const registeredAt = infra.now();
        await persist("attempt.updated", {
          process: record.identity, budget: budget.snapshot(), lastActivityAt: registeredAt,
          lastActivity: `process ${record.runId} registered before GO`,
        }, {
          type: "process", phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name,
          record: redactPhaseProcess(record, continuity), status: "REGISTERED", registeredAt, releasedAt: null, endedAt: null, exitCode: null, exitSignal: null,
        });
        runOptions.assertLaunchProjection?.(subject.sessionId);
      },
      onSpent: async (record) => {
        state.spentAnyCall = true;
        state.releasedAt = infra.now();
        await persist("attempt.updated", {
          budget: budget.snapshot(), lastActivityAt: state.releasedAt,
          lastActivity: `${runOptions.registration.edge} call ${record.reservationId} spent immediately before GO`,
        }, {
          type: "process", phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name,
          record: redactPhaseProcess(record, continuity), status: "RUNNING", registeredAt: state.releasedAt, releasedAt: state.releasedAt,
          endedAt: null, exitCode: null, exitSignal: null,
        });
      },
    } as BrokerOptions);

    const runTurn = async (
      held: Reservation,
      attempt: 1 | 2,
      turnPrompt: string,
      turnPreflight: ReviewTurnPreflight,
    ): Promise<ReviewOutput> => {
      // The envelope's own correction round, so a retry neither collides with
      // the immutable file on disk nor is dropped by the projection's
      // `INSERT OR IGNORE` on envelope id.
      const round = attempt - 1;
      const request = turnPreflight.request;
      const runId = `${subject.sessionId}:${phaseKey}:run${attempt === 1 ? "" : `-${String(attempt)}`}`;
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
            persistence: phasePersistenceEvidence(route.agent, route.adapter, turnPreflight.continuityHandle, finalSpec, route.systemPrompt),
          });
          // The LAST host instruction before GO. The permission session is open
          // and the grant is built; this is the narrowest the window between
          // the host's final read and the child's first instruction can be made
          // without an immutable materialization.
          runOptions.assertBeforeGo?.();
          state.activeTransport = await broker.startProcess(registration, finalSpec, signal);
          return state.activeTransport;
        },
      };
      const registration: BrokerProcessRegistration = {
        runId, sessionId: subject.sessionId,
        from: runOptions.registration.from, to: runOptions.registration.to, edge: runOptions.registration.edge,
        reservationId: held.id, adapterId: route.adapterId, role: route.agent.name,
      };
      const controller = new HOST.AbortController();
      const events: NormalizedEvent[] = [];
      let output = "";
      let resolved: { model: string; provenance: ModelResolutionProvenance } | null = null;
      let terminal: NormalizedEvent | null = null;
      state.observed = null;
      for await (const event of route.adapter.execute(request, capturingBroker, registration, controller.signal)) {
        routeEventExact(event, route);
        events.push(event);
        if (event.kind === "text.delta") output += event.text;
        if (event.kind === "model.resolved") resolved = { model: event.resolvedModel, provenance: event.provenance };
        const outcome = observedProcessOutcome(event, event.hostAt);
        if (outcome !== null) {
          terminal = event;
          state.observed = outcome;
        }
      }
      const endedAt = infra.now();
      if (state.observed !== null) state.observed = { ...state.observed, endedAt };
      // The reviewer's own words are not swept, for the reason the prompt is
      // not: it is reading the candidate and quoting it back, and the runner
      // retains the identical output from the identical phase unswept.
      for (const event of events) {
        if (!isPersistableKind(event.kind)) continue;
        await persist("attempt.updated", { lastActivityAt: event.hostAt, lastActivity: `${phaseKey}: ${event.kind}` }, {
          type: "normalized-event", phaseId: phaseDb, event,
        });
      }
      if (state.processRecord !== null) {
        const outcome = state.observed ?? { status: "FAILED" as const, exitCode: null, endedAt, settled: false };
        await persist("attempt.updated", { process: null, lastActivityAt: outcome.endedAt }, {
          type: "process", phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name,
          record: state.processRecord, status: outcome.status,
          registeredAt: state.releasedAt ?? outcome.endedAt, releasedAt: state.releasedAt, endedAt: outcome.endedAt,
          exitCode: outcome.exitCode, exitSignal: null,
        });
        state.processSettled = true;
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
      state.phase = phase;
      const parsed = parseEnvelope(output, REVIEW_OUTPUT_SCHEMA_ID);
      const envelope = wrapEnvelope({
        envelopeId: `${phaseDb}:${String(round)}`, sessionId: subject.sessionId, phaseId: phaseKey, correctionRound: round,
        agent: route.agent.name, schemaId: REVIEW_OUTPUT_SCHEMA_ID, createdAt: endedAt,
        rawOutputPath: join("raw", `${phaseKey}.txt`),
      }, parsed);
      await persistEnvelope(phaseKey, attempt === 1 ? phaseKey : `${phaseKey}-${String(attempt)}`, envelope, output);
      const payload = envelope.payload as ReviewOutput | null;

      const reader = artifactReader(subject.worktree);
      const mutations = changedPaths(permission.before, captureChangeSet(subject.worktree));
      const envelopeReport = envelopeValid(parsed);
      if (payload !== null) {
        for (const check of reviewEnvelopeComplete(payload).checks) {
          envelopeReport.check(check.item, check.ok, check.note);
        }
      }
      const structural = [
        envelopeReport,
        ...(payload === null ? [] : [artifactsExist(payload.artifacts, reader), jsonParses(payload.artifacts, reader)]),
        noProtectedPaths(mutations, config.policy.protected_paths),
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
          candidateSha: subject.candidateSha,
          candidatePaths: candidatePathsBetween(subject.worktree, subject.baseSha, subject.candidateSha),
          reviewContext: composed.context,
        })]),
      ];
      for (const report of structural) await persistGate(report, round);
      // A real policy breach outranks every gate reading of it.
      permission.enforce();
      if (!parsed.valid) {
        // Retained for the cold correction so it can preserve all review
        // substance while repairing only the host-listed contract paths.
        contractPreviousResponse = output;
        contractViolations = parsed.violations.map((violation) => `${violation.path || "(root)"}: ${violation.message}`);
        throw new ReplacementReviewMalformed(contractViolations.join("; ") || "no envelope was extracted");
      }
      if (payload === null) {
        contractPreviousResponse = output;
        contractViolations = ["(root): the envelope validated but carried no payload"];
        throw new ReplacementReviewMalformed(contractViolations[0]!);
      }
      if (!envelopeReport.passed) {
        contractPreviousResponse = JSON.stringify(payload);
        contractViolations = envelopeReport.checks
          .filter((check) => !check.ok)
          .map((check) => `${check.item}: ${check.note}`);
        throw new ReplacementReviewMalformed(contractViolations.join("; "));
      }
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

    const output = await runMandatoryReview({
      workerProvider: options.workerProvider,
      providers: providerPairFrom([options.workerProvider, route.model.provider]),
      isTransportFailure: (error) => {
        const transport = isReviewTransportFailure(error);
        if (transport) state.transportRetries += 1;
        return transport;
      },
      /**
       * The reviewer route is `continuity: "none"` — `resolveReviewRoute`
       * refuses anything else — so a second turn is a cold re-ask rather than
       * an argued-with resume, and the held call is exactly what pays for it.
       */
      isContractFailure: (error) => {
        const contract = error instanceof ReplacementReviewMalformed;
        if (contract) state.contractRetries += 1;
        return contract;
      },
      execute: async (reviewProvider, attempt) => {
        if (reviewProvider !== route.model.provider) {
          throw new InvalidReviewInversion(`the routed review provider ${JSON.stringify(reviewProvider)} is not the preflighted reviewer route`);
        }
        const held = attempt === 1 ? runOptions.reservation : budget.reserve({ cost: 1, subject: runOptions.retrySubject });
        if (attempt !== 1) {
          await persist("attempt.updated", {
            budget: budget.snapshot(), lastActivityAt: infra.now(),
            lastActivity: state.contractRetries > 0
              ? `held one call for the single permitted review retry; the first turn did not validate against ${REVIEW_OUTPUT_SCHEMA_ID}`
              : "held one call for the single permitted review retry",
          });
        }
        // A transport retry never reached the parser, so it re-sends the
        // original prompt; a contract retry appends the violations it must fix.
        const turnPrompt = attempt === 1 || contractViolations.length === 0
          ? renderedPrompt
          : contractRetryPrompt(renderedPrompt, contractPreviousResponse, contractViolations);
        const turnPreflight = attempt === 1 ? preflight : await preflightFor(turnPrompt);
        return runTurn(held, attempt, turnPrompt, turnPreflight);
      },
    });
    runOptions.assertAfterAnswer?.();
    state.answered = true;
    phase = await persistPhaseState(phase, "SUCCEEDED");
    state.phase = phase;
    await persist("attempt.updated", {
      lastActivityAt: infra.now(), lastActivity: `${phaseKey}: ${route.model.provider} returned ${output.verdict}`,
    }, {
      type: "review", phaseId: phaseDb, adapterId: route.adapterId, provider: route.model.provider,
      verdict: output.verdict, reviewedSha: output.reviewedSha,
      findingCount: output.findings.length, at: infra.now(),
    });
    return output;
  };

  return {
    phaseKey,
    contextKey,
    context: composed.context,
    changedFiles: composed.changedFiles,
    truncated: composed.truncated,
    omittedFiles: composed.omittedFiles,
    run,
  };
}
