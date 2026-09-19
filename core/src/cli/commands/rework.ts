import { existsSync, readFileSync, statSync, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { canonicalJson, composeOwnerAmendment, createOwnerAmendment, ownerText, sha256, type ReworkOwnerAmendment, type OwnerAmendmentDelivery } from "../../contracts/owner-amendment.ts";
import { withExecutionLease } from "../../execution/operation-lease.ts";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  AdapterEntry,
  AgentDefinition,
  AwsfConfig,
} from "../../config/schema.ts";
import type {
  BrokerProcessRegistration,
  HarnessAdapter,
  ModelInfo,
  ModelRequest,
  ProcessSpec,
  ProcessTransport,
  TransportBroker,
} from "../../adapters/interface.ts";
import { AdapterError, reservationIdOf } from "../../adapters/interface.ts";
import { registeredAdapter } from "../../adapters/registry.ts";
import { assertPrivateSystemPrompt, writeSystemPromptFile } from "../../adapters/system-prompt-file.ts";
import { toConfigSnapshotJson } from "../../config/effective-config.ts";
import { injectOutputSchema } from "../../contracts/json-schema.ts";
import { parseEnvelope } from "../../contracts/parse-envelope.ts";
import { wrapEnvelope } from "../../contracts/stored-envelope.ts";
import type { BuildOutput } from "../../contracts/build-output.ts";
import {
  UNREPORTED_TOKEN_USAGE,
  isPersistableKind,
  type ModelResolutionProvenance,
  type NormalizedEvent,
  type TokenUsage,
} from "../../contracts/normalized-events.ts";
import type { TestOutput } from "../../contracts/test-output.ts";
import { CallBudget } from "../../execution/call-budget.ts";
import type { BarrierRecord, TerminationReport } from "../../execution/launcher-barrier.ts";
import {
  ProcessTransportBroker,
  runSystemCommand,
  type BrokerOptions,
  type SystemCommandOptions,
} from "../../execution/transport-broker.ts";
import { artifactsExist, filesNonEmpty, jsonParses, type ArtifactObservation } from "../../gates/artifacts.ts";
import { candidateHygiene } from "../../gates/candidate-hygiene.ts";
import { commandsPass } from "../../gates/commands.ts";
import { envelopeValid } from "../../gates/envelope.ts";
import { diffMatchesClaims, headAdvanced, noProtectedPaths, writesWithinGlobs } from "../../gates/git-diff.ts";
import { GateReport, type GateId } from "../../gates/interface.ts";
import { assertClean, captureChangeSet, changedPaths, runGit, systemGitRunner } from "../../git/changes.ts";
import { commitAsHost, HOST_AUTHOR } from "../../git/commit.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../observability/attempt-evidence.ts";
import { writeRunReport } from "../../observability/run-report.ts";
import { PermissionBreach } from "../../policy/path-policy.ts";
import {
  REDACTED_VALUE,
  scrubCredentialString,
  scrubCredentials,
} from "../../policy/redaction.ts";
import { openPermissionSession, type SandboxProbe } from "../../policy/sandbox-broker.ts";
import { transition, type EdgeId, type TaskState } from "../../state/task-machine.ts";
import { ceilingFor } from "../../state/tiers.ts";
import type { WorkflowRecipe } from "../../workflow/compiler.ts";
import { composePromptBundle, type PromptBundle } from "../../workflow/prompt-composition.ts";
import { PhaseGateFailure } from "../../workflow/engine.ts";
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
  REVIEW_HEADROOM_CALLS,
  ReplacementReviewEvidenceInvalid,
  createReviewRunState,
  planIntentFrom,
  prepareReview,
  resolveReviewRoute,
  reviewFailureBlocker,
  reviewPhasesOf,
  type PreparedReview,
  type ReviewRoute,
} from "./review-phase.ts";
import {
  assertPromptCompositionCurrent,
  readAttemptEvidence,
  recordedReviews,
  recordedRoutes,
  type RecordedRoute,
} from "./review-record.ts";

const { chmod, mkdir, readFile, realpath, writeFile } = fs;

/**
 * The tier fork, as the lifecycle already draws it.
 *
 * A T1 rework is the builder phase and the host gates, and L12 carries it home.
 * A T2 rework is the same builder phase plus the opposite-provider review the
 * tier bought — `guards.ts` makes L11 require `tier >= 2` and makes L12 forbid
 * it, so there is no third shape either branch could take.
 */
const T1_SUPPORTED = new Set(["build", "plan-build-test"]);
const T2_SUPPORTED = new Map<string, WorkflowRecipe>([
  [buildReviewWorkflow.id, buildReviewWorkflow],
  [simpleSdlcWorkflow.id, simpleSdlcWorkflow],
]);
const OWNER = HOST_AUTHOR;
const MAX_EVIDENCE = 4_000;

export function nextReworkPhaseOrdinal(evidence: readonly AttemptEvidence[]): number {
  return evidence.reduce(
    (highest, record) => record.type === "phase" ? Math.max(highest, record.phase.ordinal) : highest,
    0,
  ) + 1;
}

const HOST = globalThis as unknown as {
  process: { env: Readonly<Record<string, string>> };
  AbortController: new () => { signal: Parameters<TransportBroker["startProcess"]>[2]; abort(reason?: unknown): void };
};

export class OwnerReworkDefectRequired extends Error {
  constructor() {
    super("awsf rework requires a concrete named defect, not blank or generic retry text");
    this.name = "OwnerReworkDefectRequired";
  }
}

export class OwnerReworkCredentialRejected extends Error {
  constructor(source: string) {
    super(`owner rework rejected ${source}: credential-shaped data is never persisted or sent to a provider`);
    this.name = "OwnerReworkCredentialRejected";
  }
}

export class ReworkCandidateMismatch extends Error {
  constructor(detail: string) {
    super(`owner rework candidate relationship mismatch: ${detail}`);
    this.name = "ReworkCandidateMismatch";
  }
}

export class ReworkRouteMismatch extends Error {
  constructor(detail: string) {
    super(`configured builder route mismatch: ${detail}; no fallback or substitution is permitted`);
    this.name = "ReworkRouteMismatch";
  }
}

/**
 * The attempt's tier and its workflow's tier disagree, so neither branch is the
 * one this attempt bought.
 *
 * This used to refuse T2 outright, on the reasoning that a reworked candidate
 * no review had read could never satisfy L20. That was true of the COMMAND and
 * never of the contract — L11 has demanded `tier >= 2` out of GATING all along
 * — and the missing half is now built: a T2 rework runs the builder, re-composes
 * the review context, runs the opposite-provider review, and takes L15 home.
 * What remains refused here is a genuine mismatch, where the recorded tier is
 * not the tier of the recipe the rework would have to re-run.
 */
export class ReworkTierUnsupported extends Error {
  readonly tier: number;
  constructor(tier: number, workflow: string, recipeTier: number, taskId: string) {
    super(
      `this attempt records tier ${tier} but workflow ${JSON.stringify(workflow)} is a tier-${recipeTier} recipe, ` +
        `so owner rework cannot tell which branch it bought; cancel and \`awsf retry ${taskId}\` under the intended tier`,
    );
    this.name = "ReworkTierUnsupported";
    this.tier = tier;
  }
}

/**
 * A T2 rework buys three calls before it starts: the builder, the review, and
 * the review's single permitted retry.
 *
 * Refused BEFORE anything is spent, in words, the way the replacement review
 * already does. Without it the builder's call is spent and the attempt then
 * strands in GATING holding a candidate it cannot afford to have reviewed —
 * which is the exact failure the ceiling was supposed to prevent, arriving one
 * call too late to prevent it.
 */
export class ReworkHeadroomInsufficient extends Error {
  constructor(remaining: number, required: number, tier: number, taskId: string) {
    super(
      `a T${tier} owner rework needs ${required} calls of headroom — one for the builder, one for the review, and one for its single permitted retry — ` +
        `and this attempt has ${remaining}; insufficient headroom, so nothing was spent and ` +
        `\`awsf raise ${taskId} --calls ${Math.max(1, required - remaining)} --reason "<why>"\`, ` +
        `\`awsf land ${taskId}\` or \`awsf cancel ${taskId}\` remain`,
    );
    this.name = "ReworkHeadroomInsufficient";
  }
}

export interface ReworkInfrastructure {
  adapterFor(entry: AdapterEntry, adapterId: string, config: AwsfConfig): HarnessAdapter | null;
  createBroker(options: BrokerOptions): TransportBroker;
  runCommand(executable: string, argv: readonly string[], options: SystemCommandOptions): ReturnType<typeof runSystemCommand>;
  writeSystemPrompt(text: string, directory: string): Promise<string>;
  now(): string;
  sandboxProbe?: SandboxProbe;
}

const DEFAULT_INFRASTRUCTURE: ReworkInfrastructure = {
  adapterFor: (_entry, adapterId, config) => registeredAdapter(config.adapters, adapterId, config.runtime),
  createBroker: (options) => new ProcessTransportBroker(options),
  runCommand: (executable, argv, options) => runSystemCommand(executable, argv, options),
  writeSystemPrompt: writeSystemPromptFile,
  now: () => new Date().toISOString(),
};

export interface ReworkCommandOptions {
  readonly attemptDir: string;
  /** Masked inside the sandbox namespace; see `policy/sandbox-broker.ts`. */
  readonly stateRoot: string;
  readonly defect: string;
  readonly instruction?: string;
  readonly terminal: OwnerTerminal;
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly projectRecord?: AttemptProjector;
  readonly assertAdvancement?: AttemptAdvancementGuard;
  readonly assertLaunchProjection?: (sessionId: string) => void;
  readonly infrastructure?: Partial<ReworkInfrastructure>;
}

export interface ReworkCommandResult {
  readonly status: AttemptStatus;
  readonly confirmed: boolean;
}

interface PriorBuild {
  readonly envelopeId: string;
  readonly summary: string;
  readonly changedFiles: readonly string[];
}

interface Route extends PromptBundle {
  readonly agent: AgentDefinition;
  readonly adapterId: string;
  readonly adapter: HarnessAdapter;
  readonly model: ModelInfo;
}

interface CandidateInspection {
  readonly candidate: string;
  readonly summary: string;
}

interface ObservedProcessOutcome {
  readonly status: "EXITED" | "FAILED" | "CANCELLED";
  readonly exitCode: number | null;
  readonly endedAt: string;
  /** True only when the adapter already settled the process outcome. */
  readonly settled: boolean;
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

function bounded(value: string, maximum = MAX_EVIDENCE): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function credentialSafeText(value: string, source: string, rejectPriorRedaction = false): string {
  const scrubbed = scrubCredentialString(value);
  if (scrubbed !== value || (rejectPriorRedaction && value.includes(REDACTED_VALUE))) {
    throw new OwnerReworkCredentialRejected(source);
  }
  return scrubbed;
}

function credentialSafeValue<T>(value: T, source: string): T {
  const scrubbed = scrubCredentials(value);
  if (JSON.stringify(scrubbed) !== JSON.stringify(value)) {
    throw new OwnerReworkCredentialRejected(source);
  }
  return scrubbed;
}

function safeFailure(error: unknown): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  return scrubCredentialString(`${failure.name}: ${failure.message}`) === `${failure.name}: ${failure.message}`
    ? failure
    : new OwnerReworkCredentialRejected("failure detail");
}

export function assertConcreteReworkDefect(defect: string): string {
  const normalized = defect.trim().replace(/\s+/g, " ");
  const generic = /^(?:please\s+)?(?:fix(?:\s+it)?|retry|try\s+again|rework|redo|do\s+better|make\s+it\s+better)[.!]?$/i;
  if (normalized.length < 8 || normalized.split(" ").length < 2 || generic.test(normalized)) {
    throw new OwnerReworkDefectRequired();
  }
  return credentialSafeText(normalized, "owner defect");
}

/** Owner-rework seam retained for the three-path prompt-bundle characterization. */
export async function readReworkPromptPair(
  configPath: string,
  agent: AgentDefinition,
): Promise<PromptBundle> {
  return composePromptBundle({ configPath, agent });
}

async function priorBuild(attemptDir: string): Promise<PriorBuild> {
  const text = await readFile(join(attemptDir, "journal.jsonl"), "utf8");
  const records = text.split("\n").filter(Boolean).map((line: string) => JSON.parse(line) as {
    event?: { evidence?: AttemptEvidence };
  });
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const evidence = records[index]?.event?.evidence;
    if (evidence?.type !== "envelope") continue;
    const envelope = evidence.envelope;
    if (envelope.schemaId !== "awsf.build-output/v1" || !envelope.valid || envelope.payload === null) continue;
    const payload = envelope.payload as BuildOutput;
    return {
      envelopeId: credentialSafeText(envelope.envelopeId, "prior envelope reference", true),
      summary: bounded(credentialSafeText(payload.summary, "prior envelope summary", true), 1_000),
      changedFiles: Object.freeze(payload.changedFiles.slice(0, 100).map((path) =>
        credentialSafeText(path, "prior envelope file declaration", true))),
    };
  }
  throw new Error("owner rework requires the retained valid prior build envelope; none was found in the journal");
}

function inspectCandidate(status: AttemptStatus): CandidateInspection {
  if (status.worktree === null || status.baseSha === null || status.candidateSha === null) {
    throw new ReworkCandidateMismatch("attempt does not record a managed worktree, base, and candidate");
  }
  const canonical = systemGitRunner(status.repository);
  const worktree = systemGitRunner(status.worktree);
  assertClean(status.repository, "before", canonical);
  assertClean(status.worktree, "before", worktree);
  const canonicalHead = runGit(canonical, ["rev-parse", "HEAD"]).trim();
  const canonicalBase = runGit(canonical, ["rev-parse", `${status.baseSha}^{commit}`]).trim();
  const observedBase = runGit(worktree, ["rev-parse", `${status.baseSha}^{commit}`]).trim();
  const observedCandidate = runGit(worktree, ["rev-parse", `${status.candidateSha}^{commit}`]).trim();
  const worktreeHead = runGit(worktree, ["rev-parse", "HEAD"]).trim();
  if (canonicalHead !== status.baseSha || canonicalBase !== status.baseSha || observedBase !== status.baseSha) {
    throw new ReworkCandidateMismatch(`canonical HEAD/base must all equal recorded base ${status.baseSha}; observed ${canonicalHead}, ${canonicalBase}, ${observedBase}`);
  }
  if (observedCandidate !== status.candidateSha || worktreeHead !== status.candidateSha) {
    throw new ReworkCandidateMismatch(`recorded candidate and worktree HEAD must both equal ${status.candidateSha}; observed ${observedCandidate}, ${worktreeHead}`);
  }
  const ancestry = worktree(["merge-base", "--is-ancestor", status.baseSha, status.candidateSha]);
  if (ancestry.status !== 0) throw new ReworkCandidateMismatch("recorded candidate is not descended from the canonical base");
  const identities = runGit(worktree, ["show", "-s", "--format=%an <%ae>|%cn <%ce>", status.candidateSha]).trim();
  if (identities !== `${OWNER}|${OWNER}`) throw new ReworkCandidateMismatch(`prior candidate is not host-created under the owner identity: ${identities}`);
  return {
    candidate: status.candidateSha,
    summary: bounded(credentialSafeText(
      runGit(worktree, ["show", "--stat", "--oneline", "--format=%s", status.candidateSha]).trim(),
      "candidate summary",
      true,
    ), 2_000),
  };
}

/** The T2 recipe this rework must re-run and review, or `null` for the T1 branch. */
function validateAttempt(status: AttemptStatus, config: AwsfConfig): WorkflowRecipe | null {
  const t2 = T2_SUPPORTED.get(status.workflow);
  if (t2 === undefined && !T1_SUPPORTED.has(status.workflow)) {
    throw new ProductionWorkflowUnsupported(status.workflow, "owner rework re-runs a single writable builder phase");
  }
  if (!config.workflows.enabled.includes(status.workflow)) {
    throw new ProductionWorkflowUnsupported(status.workflow, "not enabled by the effective config");
  }
  const recipeTier = t2?.tier ?? 1;
  if (status.tier !== recipeTier) throw new ReworkTierUnsupported(status.tier, status.workflow, recipeTier, status.taskId);
  if (config.project.slug !== status.project) throw new Error("attempt and config project do not match");
  if (toConfigSnapshotJson(config) !== status.configSnapshotJson) throw new ProductionConfigSnapshotMismatch();
  return t2 ?? null;
}

async function resolveRoute(
  status: AttemptStatus,
  config: AwsfConfig,
  configPath: string,
  infra: ReworkInfrastructure,
  governingBuilder: RecordedRoute | null,
): Promise<Route> {
  const agent = config.agents.find((candidate) => candidate.name === "builder");
  if (agent === undefined || agent.writes.length === 0) throw new ProductionRouteUnavailable("builder", "supported owner rework requires the configured writable builder phase");
  const entry = config.adapters[agent.harness.adapter];
  if (entry === undefined || entry.enabled === false) throw new ProductionRouteUnavailable(agent.harness.adapter, "route is disabled or undeclared");
  const adapter = infra.adapterFor(entry, agent.harness.adapter, config);
  if (adapter === null) throw new ProductionRouteUnavailable(agent.harness.adapter, "adapter kind has no production binding");
  const available = await adapter.isAvailable();
  if (available.status !== "available") throw new ProductionRouteUnavailable(agent.harness.adapter, available.detail ?? available.code ?? "blocked");
  const model = credentialSafeValue(await adapter.getModelInfo(agent.model), "configured model route");
  if (model.adapter !== adapter.id) throw new ReworkRouteMismatch(`adapter descriptor says ${model.adapter}, selected adapter is ${adapter.id}`);
  const prompts = await readReworkPromptPair(configPath, agent);
  assertPromptCompositionCurrent(prompts, governingBuilder, "builder");
  return {
    agent,
    adapterId: agent.harness.adapter,
    adapter,
    model,
    ...prompts,
  };
}

function reworkPrompt(status: AttemptStatus, defect: string, prior: PriorBuild, route: Route): string {
  const request = bounded(credentialSafeText(status.request, "persisted original request", true), 2_000);
  const handoff = [
    route.userPrompt,
    "",
    "Owner-authorized fresh rework call (L19). This is not a same-session correction.",
    `Concrete defect: ${defect}`,
    `Exact prior candidate: ${status.candidateSha}`,
    `Prior build envelope reference: ${prior.envelopeId}`,
    `Bounded prior build summary: ${prior.summary}`,
    `Prior declared files: ${prior.changedFiles.join(", ") || "(none)"}`,
    `Original bounded request: ${request}`,
    `Write policy: ${route.agent.writes.join(", ")}`,
    "Edit only the named defect on top of the exact prior candidate. Do not commit, change HEAD, route work, broaden scope, or touch protected paths. The host owns Git and all gates.",
  ].join("\n");
  return credentialSafeText(
    injectOutputSchema(handoff, "awsf.build-output/v1")
      .replaceAll("{previous_envelope}", "See the exact retained envelope reference and bounded summary above."),
    "final provider prompt",
    true,
  );
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
  const materialized = credentialSafeText(
    await readFile(promptPhysical, "utf8"),
    "materialized system prompt",
    true,
  );
  if (materialized !== expectedText) {
    throw new AdapterError(adapterId, "E_REDACTION", "the materialized system prompt differs from the credential-checked prompt");
  }
}

function preflightDescriptor(
  route: Route,
  request: ModelRequest,
  finalize: (spec: ProcessSpec) => ProcessSpec,
): ProcessSpec {
  const path = request.systemPromptPath;
  if (path === undefined) throw new Error("owner rework requires a private system prompt path");
  credentialSafeText(path, "private system prompt path", true);
  assertPrivateSystemPrompt(route.adapter.id, path);
  const spec = credentialSafeValue(finalize(route.adapter.buildSpec(request)), "final process descriptor");
  if (spec.shell !== false || spec.stdin !== request.prompt || spec.cwd !== request.cwd) {
    throw new AdapterError(route.adapter.id, "E_REDACTION", "the final owner-rework descriptor changed its prompt, cwd, or shell policy");
  }
  if (spec.argv.filter((argument) => argument === path).length !== 1) {
    throw new AdapterError(route.adapter.id, "E_REDACTION", "the final owner-rework descriptor must reference the one validated private system prompt path exactly once");
  }
  const privateText = [request.prompt, route.systemPrompt, route.userPrompt];
  if (spec.argv.some((argument) => privateText.some((text) =>
    text.length > 0 && (argument === text || (text.length >= 32 && argument.includes(text)))))) {
    throw new AdapterError(route.adapter.id, "E_REDACTION", "private prompt content appeared in argv");
  }
  return spec;
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

function sumUsage(events: readonly NormalizedEvent[]): TokenUsage {
  const fields = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"] as const;
  const totals: Record<(typeof fields)[number], number | null> = {
    inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null,
  };
  let reasoningRelation: TokenUsage["reasoningRelation"] = "unknown";
  for (const event of events) {
    if (event.kind !== "usage") continue;
    reasoningRelation = event.usage.reasoningRelation;
    for (const field of fields) if (event.usage[field] !== null) totals[field] = (totals[field] ?? 0) + event.usage[field]!;
  }
  return { ...totals, reasoningRelation };
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

function reportWith(report: GateReport, prefix: string, other: GateReport): GateReport {
  for (const check of other.checks) report.check(`${prefix}:${check.item}`, check.ok, check.note);
  return report;
}

function routeEventExact(event: NormalizedEvent, route: Route): void {
  if (event.kind === "run.started") {
    if (event.adapter !== route.adapter.id || event.requestedModel !== route.model.requestedModel) {
      throw new ReworkRouteMismatch(`run.started reported ${event.adapter}/${event.requestedModel}, expected ${route.adapter.id}/${route.model.requestedModel}`);
    }
  }
  if (event.kind === "model.resolved") {
    if (event.adapter !== route.adapter.id || event.provider !== route.model.provider || event.requestedModel !== route.model.requestedModel) {
      throw new ReworkRouteMismatch(`model.resolved reported ${event.adapter}/${event.provider}/${event.requestedModel}, expected ${route.adapter.id}/${route.model.provider}/${route.model.requestedModel}`);
    }
  }
}

function blocker(error: unknown): { code: string; detail: string } {
  const failure = safeFailure(error);
  const detail = `${failure.name}: ${failure.message}`;
  if (failure instanceof PermissionBreach) return { code: "permission-breach", detail };
  if (failure instanceof AdapterError && failure.code === "E_QUOTA_EXHAUSTED") return { code: "quota-exhausted", detail };
  if (/ceiling|budget|allowance/i.test(detail)) return { code: "budget-exhausted", detail };
  if (/silence|timeout/i.test(detail)) return { code: "silence", detail };
  return { code: "phase-abort", detail };
}

/** Owner-facing production implementation of the literal L19 spawn edge. */
async function runReworkCommand(options: ReworkCommandOptions): Promise<ReworkCommandResult> {
  const defect = assertConcreteReworkDefect(options.defect);
  const instructionText = options.instruction === undefined ? null : ownerText(options.instruction);
  credentialSafeValue(options.config, "configured owner rework data");
  const configuredInfra: ReworkInfrastructure = { ...DEFAULT_INFRASTRUCTURE, ...options.infrastructure };
  const delegatedReservations = new Set<string>();
  const infra: ReworkInfrastructure = { ...configuredInfra, createBroker: brokerOptions => {
    const delegate = configuredInfra.createBroker(brokerOptions);
    return { startProcess: async (registration, spec, signal) => {
      delegatedReservations.add(reservationIdOf(registration));
      try { return await delegate.startProcess(registration, spec, signal); }
      catch (error) {
        // No returned transport means the caller cannot prove whether a child exists. Do not retry it.
        throw new ReworkRouteMismatch(`broker launch outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`);
      }
    } };
  } };
  let status = await readAttempt(options.attemptDir);
  credentialSafeText(status.request, "persisted original request", true);

  // Ask the normative machine before Git or route I/O. This is a decision only;
  // the reservation is not made until after the human confirms.
  transition({
    from: status.lifecycleState, to: "RUNNING", actor: "human", tier: status.tier,
    reason: { source: "human", detail: defect }, interactive: options.terminal.interactive,
    budget: status.budget, spawn: { cost: 1 },
    evidence: { candidateSha: status.candidateSha ?? "", reworkRequest: defect, gatesInvalidated: true, reviewInvalidated: true },
  });
  const recipe = validateAttempt(status, options.config);
  const firstInspection = inspectCandidate(status);
  const prior = await priorBuild(options.attemptDir);
  const governingEvidence = await readAttemptEvidence(options.attemptDir);
  const governingReviewPhaseIds = new Set(
    recordedReviews(governingEvidence, status.sessionId).map((review) => review.phaseId),
  );
  const governingRoutes = recordedRoutes(governingEvidence, governingReviewPhaseIds);
  const route = await resolveRoute(status, options.config, options.configPath, infra, governingRoutes.worker);
  const displayedRevision = status.revision;
  const displayedOrdinal = nextReworkPhaseOrdinal(governingEvidence);
  const originalBundle = await readReworkPromptPair(options.configPath, route.agent);
  if (originalBundle.systemPrompt !== route.systemPrompt || originalBundle.userPrompt !== route.userPrompt) throw new ReworkRouteMismatch("prompt changed during preflight");
  const originalInput = reworkPrompt(status, defect, prior, route);
  const remainingCalls = ceilingFor(status.tier, status.budget.ceiling) - status.budget.callsSpent - status.budget.callsReserved;
  const remainingOwner = status.budget.allowance.ownerReentries - status.budget.ownerReentries;
  // The T2 branch buys a review as well as a builder, so its whole cost is
  // refused up front rather than one call into it. The T1 branch is left
  // exactly as it was: it buys one call, and the ledger refuses that itself.
  if (recipe !== null) {
    const required = 1 + REVIEW_HEADROOM_CALLS;
    if (remainingCalls < required) {
      throw new ReworkHeadroomInsufficient(remainingCalls, required, status.tier, status.taskId);
    }
  }
  options.terminal.write(`Candidate SHA: ${firstInspection.candidate}`);
  options.terminal.write(`Summary: ${firstInspection.summary}`);
  options.terminal.write(`Route: ${route.adapterId} / ${route.model.provider} / ${route.agent.model}`);
  options.terminal.write(`Budget: ${remainingCalls} call(s) and ${remainingOwner} owner re-entry allowance(s) remain`);
  options.terminal.write("This act spends one owner re-entry, invalidates every candidate gate and review, and gives up the option to land or cancel the current candidate unchanged.");
  if (recipe !== null) {
    options.terminal.write(
      `This T${status.tier} rework spends one call on the builder and one on the mandatory opposite-provider review of the new candidate, ` +
        "and holds one more for that review's single permitted retry.",
    );
    options.terminal.write("The end-user journey attestation does not survive a new candidate; `awsf journey` runs again before landing.");
  } else {
    options.terminal.write("This T1 rework spends exactly one builder call; any correction would require separate remaining allowance and call headroom.");
  }
  options.terminal.write(`Defect: ${defect}`);
  if (instructionText !== null) options.terminal.write(`Supplement recipient: owner-rework-${status.budget.ownerReentries + 1}, phase ${displayedOrdinal}. Exact instruction (JSON string): ${JSON.stringify(instructionText)}\nThis is separate from the defect and grants no extra calls, corrections, tools or write access.`);
  const confirmed = await options.terminal.confirm(`Rework exact candidate ${firstInspection.candidate}?`);
  if (!confirmed) return { status, confirmed: false };

  return withExecutionLease(options.attemptDir, async () => {
    if ((await readAttempt(options.attemptDir)).revision !== displayedRevision) throw new ReworkCandidateMismatch("rework anchor changed after confirmation");
  }, async operationId => {
  // Close every display-to-launch race before the L19 record becomes durable.
  status = await readAttempt(options.attemptDir);
  if (status.revision !== displayedRevision || canonicalJson(await priorBuild(options.attemptDir)) !== canonicalJson(prior) ||
      canonicalJson(await readReworkPromptPair(options.configPath, route.agent)) !== canonicalJson(originalBundle)) throw new ReworkCandidateMismatch("rework input changed after confirmation");
  credentialSafeText(status.request, "persisted original request", true);
  validateAttempt(status, options.config);
  const secondInspection = inspectCandidate(status);
  if (secondInspection.candidate !== firstInspection.candidate) throw new ReworkCandidateMismatch("candidate changed after confirmation");
  // Evidence can advance while the owner is considering the prompt. Derive the
  // ordinal from the journal state this confirmed launch actually proceeds on.
  const launchEvidence = await readAttemptEvidence(options.attemptDir);
  const builderOrdinal = nextReworkPhaseOrdinal(launchEvidence);
  const available = await route.adapter.isAvailable();
  if (available.status !== "available") throw new ProductionRouteUnavailable(route.adapterId, available.detail ?? available.code ?? "route became unavailable");
  const repeatedModel = credentialSafeValue(
    await route.adapter.getModelInfo(route.agent.model),
    "post-confirmation model route",
  );
  if (
    repeatedModel.adapter !== route.model.adapter ||
    repeatedModel.provider !== route.model.provider ||
    repeatedModel.requestedModel !== route.model.requestedModel
  ) {
    throw new ReworkRouteMismatch("adapter/provider/model changed after confirmation");
  }

  if (builderOrdinal !== displayedOrdinal || reworkPrompt(status, defect, prior, route) !== originalInput) throw new ReworkCandidateMismatch("rework phase input changed after confirmation");
  const anticipatedKey = `owner-rework-${status.budget.ownerReentries + 1}`;
  const ownerAmendment: ReworkOwnerAmendment | null = instructionText === null ? null : createOwnerAmendment({
    id: randomUUID(), text: instructionText, confirmedAt: infra.now(), binding: {
      entry: "rework", project: status.project, taskId: status.taskId, attempt: status.attempt, sessionId: status.sessionId,
      authorizationId: randomUUID(), operationId, phaseKey: anticipatedKey, phaseOrdinal: builderOrdinal,
      anchorId: `${status.sessionId}:candidate:${firstInspection.candidate}`, anchorRevision: displayedRevision,
      candidateSha: firstInspection.candidate, defectDigest: sha256(defect), ownerReentry: status.budget.ownerReentries + 1,
      logicalTurnId: `${status.sessionId}:${anticipatedKey}:run`, correctionRound: 0, priorAmendmentDigest: null,
      originalRequestDigest: sha256(status.request), originalPromptBundleDigest: sha256(canonicalJson(originalBundle)), deliveryFrontier: "rework-input",
    },
  });
  const composedInput = composeOwnerAmendment(originalInput, ownerAmendment);
  const prompt = composedInput.composedText;
  // Generation-qualified by the OWNER RE-ENTRY counter, which is the one this
  // command is about to charge. Naming it after the per-phase owner counter
  // would collide the moment a second rework ran in the same attempt, because
  // the phase in between had already zeroed that counter.
  const runtimeDir = join(options.attemptDir, "private", `owner-rework-${status.budget.ownerReentries + 1}`);
  await mkdir(runtimeDir, { recursive: true });
  const systemPromptPath = await infra.writeSystemPrompt(route.systemPrompt, runtimeDir);
  await validateMaterializedSystemPrompt(route.adapter.id, runtimeDir, systemPromptPath, route.systemPrompt);
  const permission = openPermissionSession({
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
  const request: ModelRequest = {
    model: route.agent.model, prompt, systemPromptPath, cwd: status.worktree!, env: HOST.process.env,
    effort: route.agent.thinking, profile: route.agent.tools.profile, tools: route.agent.tools.allow,
  };
  // This is the actual final request and sandboxed descriptor, including the
  // materialized private path. It is validated before L19 can become durable.
  const preflightGrant = permission.sandbox(route.adapter.buildSpec(request));
  const preflightSpec = preflightDescriptor(route, request, () => preflightGrant.spec);
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
    from: status.lifecycleState, to: "RUNNING", actor: "human", reason: { source: "human", detail: defect }, interactive: true,
    spawn: { cost: 1 },
    evidence: { candidateSha: status.candidateSha!, reworkRequest: defect, gatesInvalidated: true, reviewInvalidated: true },
  });
  const reservation = authorization.reservation!;
  const reworkNumber = budget.snapshot().ownerReentries;
  const phaseKey = `owner-rework-${reworkNumber}`;
  if (phaseKey !== anticipatedKey) throw new ReworkCandidateMismatch("owner re-entry changed before activation");
  const phaseId = `${status.sessionId}:${phaseKey}`;
  const runId = `${phaseId}:run`;
  const createdAt = infra.now();
  // The host measurement and review phases follow the post-confirmation
  // builder ordinal in order.
  let phase: PhaseEvidenceRecord = {
    phaseId, ordinal: builderOrdinal, key: phaseKey, name: "builder rework",
    kind: "agent", owner: route.agent.name,
    description: `Repair the owner-named defect on exact candidate ${status.candidateSha}`,
    status: "QUEUED", correctionCount: 0, maxCorrections: 0, errorCode: null, errorMessage: null,
    startedAt: null, endedAt: null, createdAt,
  };
  let instructionIntent = false;
  let instructionSubmitted = false;
  let processRecord: BarrierRecord | null = null;
  let processSettled = false;
  let observedProcess: ObservedProcessOutcome | null = null;
  let releasedAt: string | null = null;
  const activeTransport: { current: ProcessTransport | null } = { current: null };
  let transitionOrdinal = status.revision + 1;
  let writeQueue: Promise<void> = Promise.resolve();
  // What the shared review phase observed, when this rework reaches one. The
  // builder's own bookkeeping above stays separate: two phases in one command
  // settle two different processes, and merging them would let a builder that
  // exited cleanly answer for a reviewer that did not.
  const reviewState = createReviewRunState();
  let reviewRoute: ReviewRoute | null = null;
  let reviewPhaseDb: string | null = null;

  const persist = async (kind: AttemptEvent["kind"], update: Partial<AttemptStatus>, evidence?: AttemptEvidence): Promise<void> => {
    const operation = writeQueue.then(async () => {
      const next = nextRevision(status, update);
      status = await persistAttempt(options.attemptDir, status.revision, { kind, next, ...(evidence === undefined ? {} : { evidence }) }, options.projectRecord);
    });
    writeQueue = operation.catch(() => undefined);
    await operation;
  };
  const persistTransition = async (
    from: TaskState, to: TaskState, edgeId: EdgeId, actor: "host" | "human", source: string,
    code: string | null, detail: string | null, spawnSite: boolean, update: Partial<AttemptStatus>, amendment?: ReworkOwnerAmendment,
  ): Promise<void> => {
    const at = infra.now();
    const seq = transitionOrdinal++;
    await persist("attempt.transitioned", { lifecycleState: to, lastActivityAt: at, nextAction: nextActionFor(to, status.taskId), ...update }, {
      type: "transition", ...(amendment === undefined ? {} : { ownerAmendment: amendment }), id: `${status.sessionId}:${edgeId}:${seq}`, seq,
      from, to, actor, edgeId, reasonSource: source, reasonCode: code, reasonDetail: detail, spawnSite, at,
    });
  };
  const persistPhase = async (state: string, error: Error | null = null): Promise<void> => {
    const at = infra.now();
    phase = {
      ...phase, status: state,
      startedAt: phase.startedAt ?? (state === "RUNNING" ? at : null),
      endedAt: ["SUCCEEDED", "FAILED", "CANCELLED"].includes(state) ? at : null,
      errorCode: error?.name ?? null, errorMessage: error?.message ?? null,
    };
    await persist("attempt.updated", {
      phase: { name: phase.name, state, round: 0, maximumRounds: 0 },
      lastActivityAt: at, lastActivity: `${phase.key} is ${state}`,
    }, { type: "phase", phase });
  };
  const persistGate = async (report: GateReport, candidateSha: string | null, exitCode: number | null = null, outputPath: string | null = null): Promise<void> => {
    const at = infra.now();
    await persist("attempt.updated", {}, {
      type: "gate", id: `${phaseId}:${report.gateId}`, phaseId, round: 0,
      gateId: report.gateId, kind: gateKind(report.gateId), candidateSha,
      passed: report.passed, exitCode, checks: report.checks,
      violations: report.checks.filter((check) => !check.ok).map((check) => `${check.item}: ${check.note}`),
      outputPath, startedAt: at, endedAt: at,
    });
  };

  try {
    // L19 and its held reservation are durable before createBroker can create a child.
    await persistTransition(authorization.result.from, "RUNNING", authorization.result.edge, "human", "human", null, defect, true, {
    budget: budget.snapshot(), gatesPass: false, requiredReviewPresent: false,
    journeyApproved: false, protectedApprovalsValid: false, blocker: null, phase: null,
    lastActivity: `L19 human rework request accepted; call ${reservation.id} held before launch`,
  }, ownerAmendment ?? undefined);
  await persist("attempt.updated", {}, { type: "phase", phase });
  await persist("attempt.updated", {}, {
    type: "compiled-prompt", phaseId, name: "system", text: route.systemPrompt,
    ...route.evidence,
    lineCount: route.systemPrompt.split(/\r?\n/).length, at: infra.now(),
  });
  await persist("attempt.updated", {}, {
    type: "compiled-prompt", phaseId, name: "user", text: originalInput,
    lineCount: originalInput.split(/\r?\n/).length, at: infra.now(),
  });
  if (ownerAmendment !== null) await persist("attempt.updated", {}, { type: "compiled-prompt", phaseId,
    name: "user+owner-amendment", text: prompt, lineCount: prompt.split(/\r?\n/).length, at: infra.now() });

  const broker = infra.createBroker({
    ledger: budget,
    register: async (record) => {
      processRecord = record;
      const registeredAt = infra.now();
      await persist("attempt.updated", {
        process: record.identity, budget: budget.snapshot(), lastActivityAt: registeredAt,
        lastActivity: `process ${record.runId} registered before GO`,
      }, {
        type: "process", phaseId, adapterId: route.adapterId, role: route.agent.name,
        record, status: "REGISTERED", registeredAt, releasedAt: null, endedAt: null, exitCode: null, exitSignal: null,
      });
      options.assertLaunchProjection?.(status.sessionId);
    },
    onSpent: async (record) => {
      releasedAt = infra.now();
      await persist("attempt.updated", {
        budget: budget.snapshot(), lastActivityAt: releasedAt,
        lastActivity: `L19 call ${record.reservationId} spent immediately before GO`,
      }, {
        type: "process", phaseId, adapterId: route.adapterId, role: route.agent.name,
        record, status: "RUNNING", registeredAt: releasedAt, releasedAt, endedAt: null, exitCode: null, exitSignal: null,
      });
    },
  } as BrokerOptions);

  const capturingBroker: TransportBroker = {
    startProcess: async (registration, spec, signal) => {
      const launchGrant = permission.sandbox(spec);
      const finalSpec = credentialSafeValue(launchGrant.spec, "launch process descriptor");
      if (
        JSON.stringify(finalSpec) !== JSON.stringify(preflightSpec) ||
        launchGrant.badge !== preflightGrant.badge ||
        launchGrant.mechanism !== preflightGrant.mechanism
      ) {
        throw new ReworkRouteMismatch("launch descriptor or sandbox grant changed after its privacy preflight");
      }
      const launchAt = infra.now();
      await persist("attempt.updated", {
        lastActivityAt: launchAt,
        lastActivity: `${phaseKey}: route and sandbox grant recorded before GO`,
      }, {
        type: "agent-start", phaseId, agent: route.agent.name, adapterId: route.adapterId,
        provider: route.model.provider, color: route.agent.color, requestedModel: route.agent.model,
        sandboxBadge: launchGrant.badge, sandboxMechanism: launchGrant.mechanism, at: launchAt,
      });
      let delivery: OwnerAmendmentDelivery | null = null;
      if (ownerAmendment !== null) {
        if (instructionIntent || finalSpec.stdin !== prompt || registration.runId !== runId) throw new ReworkRouteMismatch("owner instruction input was changed or already submitted");
        delivery = { schema: "awsf.owner-amendment-delivery/v1", amendmentId: ownerAmendment.id, amendmentDigest: ownerAmendment.digest,
          bindingDigest: sha256(canonicalJson(ownerAmendment.binding)), operationId, logicalTurnId: runId,
          originalInputDigest: composedInput.originalInputDigest, composedDigest: composedInput.composedDigest,
          state: "intent", providerAcknowledgementDigest: null };
        await persist("attempt.updated", {}, { type: "rework-instruction-delivery", phaseId, delivery, at: infra.now() });
        instructionIntent = true;
      }
      activeTransport.current = await broker.startProcess(registration, finalSpec, signal);
      if (delivery !== null) {
        await persist("attempt.updated", {}, { type: "rework-instruction-delivery", phaseId, delivery: { ...delivery, state: "submitted" }, at: infra.now() });
        instructionSubmitted = true;
      }
      return activeTransport.current;
    },
  };

    await persistPhase("RUNNING");
    const registration: BrokerProcessRegistration = {
      runId, sessionId: status.sessionId, from: "AWAITING_OWNER", to: "RUNNING", edge: "L19",
      reservationId: reservation.id, adapterId: route.adapterId, role: route.agent.name,
    };
    const controller = new HOST.AbortController();
    const events: NormalizedEvent[] = [];
    let output = "";
    let resolved: { model: string; provenance: ModelResolutionProvenance } | null = null;
    let terminal: NormalizedEvent | null = null;
    for await (const event of route.adapter.execute(request, capturingBroker, registration, controller.signal)) {
      const safeEvent = credentialSafeValue(event, "provider event");
      routeEventExact(safeEvent, route);
      events.push(safeEvent);
      if (safeEvent.kind === "text.delta") output += safeEvent.text;
      if (safeEvent.kind === "model.resolved") resolved = { model: safeEvent.resolvedModel, provenance: safeEvent.provenance };
      const outcome = observedProcessOutcome(safeEvent, safeEvent.hostAt);
      if (outcome !== null) {
        terminal = safeEvent;
        observedProcess = outcome;
      }
    }
    const endedAt = infra.now();
    if (observedProcess !== null) observedProcess = { ...observedProcess, endedAt };
    // Deltas may split a credential shape across arbitrary stream boundaries.
    // Validate the reassembled output before any provider event is journaled.
    credentialSafeText(output, "provider output");
    for (const event of events) {
      if (!isPersistableKind(event.kind)) continue;
      await persist("attempt.updated", { lastActivityAt: event.hostAt, lastActivity: `${phaseKey}: ${event.kind}` }, {
        type: "normalized-event", phaseId, event,
      });
    }
    if (processRecord !== null) {
      const outcome = observedProcess ?? {
        status: "FAILED" as const, exitCode: null, endedAt, settled: false,
      };
      await persist("attempt.updated", { process: null, lastActivityAt: outcome.endedAt }, {
        type: "process", phaseId, adapterId: route.adapterId, role: route.agent.name,
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
      type: "agent", phaseId, agent: route.agent.name, adapterId: route.adapterId,
      provider: route.model.provider, color: route.agent.color, requestedModel: route.agent.model,
      resolvedModel: resolved.model, modelProvenance: resolved.provenance,
      contextWindow: route.model.contextWindow, usageAuthority: route.model.usageAuthority,
      usage, contextTokens: contextTokens(usage), costUsd: null, costAuthority: route.model.costAuthority, at: endedAt,
    });

    if (ownerAmendment !== null && !instructionSubmitted) throw new ReworkRouteMismatch("owner instruction never reached the actual launch");
    await persistPhase("VALIDATING");
    const parsed = parseEnvelope(output, "awsf.build-output/v1");
    const envelope = wrapEnvelope({
      envelopeId: `${phaseId}:0`, sessionId: status.sessionId, phaseId, correctionRound: 0,
      agent: route.agent.name, schemaId: "awsf.build-output/v1", createdAt: endedAt,
      rawOutputPath: join("raw", `${phaseKey}.txt`),
    }, parsed);
    const rawPath = join(options.attemptDir, envelope.rawOutputPath);
    await mkdir(dirname(rawPath), { recursive: true });
    await writeFile(rawPath, output, { mode: 0o600 });
    await chmod(rawPath, 0o600);
    const envelopePath = join(options.attemptDir, "envelopes", `${phaseKey}.json`);
    await mkdir(dirname(envelopePath), { recursive: true });
    if (existsSync(envelopePath)) throw new Error(`immutable envelope already exists: ${envelopePath}`);
    await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
    await persist("attempt.updated", {}, { type: "envelope", phaseId, envelope });

    const payload = envelope.payload as BuildOutput | null;
    const agentHead = runGit(systemGitRunner(status.worktree!), ["rev-parse", "HEAD"]).trim();
    if (agentHead !== firstInspection.candidate) {
      throw new ReworkCandidateMismatch(`agent changed HEAD to ${agentHead}; agents never commit`);
    }
    const reader = artifactReader(status.worktree!);
    const mutations = changedPaths(permission.before, captureChangeSet(status.worktree!));
    const structural = [
      envelopeValid(parsed),
      artifactsExist(payload?.artifacts ?? [], reader),
      filesNonEmpty(payload?.artifacts ?? [], reader),
      jsonParses(payload?.artifacts ?? [], reader),
      noProtectedPaths(mutations, options.config.policy.protected_paths),
      writesWithinGlobs(mutations, route.agent.writes),
      diffMatchesClaims(mutations, payload?.changedFiles ?? []),
    ];
    try { permission.enforce(); } catch (error) {
      for (const report of structural) await persistGate(report, null);
      throw error;
    }
    if (payload === null || structural.some((report) => !report.passed)) {
      for (const report of structural) await persistGate(report, null);
      throw new PhaseGateFailure(phaseKey, structural);
    }
    const beforeCommitHead = runGit(systemGitRunner(status.worktree!), ["rev-parse", "HEAD"]).trim();
    if (beforeCommitHead !== firstInspection.candidate) throw new ReworkCandidateMismatch(`agent changed HEAD to ${beforeCommitHead}; agents never commit`);
    const candidate = commitAsHost({ repository: status.worktree!, message: "fix: address owner rework request" });
    const parent = runGit(systemGitRunner(status.worktree!), ["rev-parse", `${candidate}^`]).trim();
    if (parent !== firstInspection.candidate) throw new ReworkCandidateMismatch(`new candidate parent ${parent} is not prior candidate ${firstInspection.candidate}`);
    await persist("attempt.updated", {
      candidateSha: candidate, budget: budget.snapshot(), lastActivityAt: infra.now(),
      lastActivity: `host created owner-identity candidate ${candidate} on prior candidate ${firstInspection.candidate}`,
    });
    for (const report of structural) await persistGate(report, candidate);
    const advanced = headAdvanced({ baseSha: firstInspection.candidate, headSha: candidate, hostCommitExists: true });
    await persistGate(advanced, candidate);
    if (!advanced.passed) throw new PhaseGateFailure(phaseKey, [advanced]);

    const git = systemGitRunner(status.worktree!);
    const headBeforeHygiene = runGit(git, ["rev-parse", "HEAD"]).trim();
    const cleanBeforeHygiene = runGit(git, ["status", "--porcelain"]).trim().length === 0;
    const hygieneResult = git(["diff", "--check", `${status.baseSha!}..${candidate}`, "--"]);
    const headAfterHygiene = runGit(git, ["rev-parse", "HEAD"]).trim();
    const cleanAfterHygiene = runGit(git, ["status", "--porcelain"]).trim().length === 0;
    const hygiene = candidateHygiene({
      expectedBaseSha: status.baseSha!, observedBaseSha: runGit(git, ["rev-parse", status.baseSha!]).trim(),
      expectedCandidateSha: candidate, headBefore: headBeforeHygiene, headAfter: headAfterHygiene,
      cleanBefore: cleanBeforeHygiene, cleanAfter: cleanAfterHygiene,
      exitCode: hygieneResult.status ?? -1,
      output: `${hygieneResult.stdout}${hygieneResult.stderr}${hygieneResult.error === null ? "" : `\n${hygieneResult.error}`}`,
    });
    await persistGate(hygiene, candidate, hygieneResult.status ?? -1);
    if (!hygiene.passed) throw new PhaseGateFailure(phaseKey, [hygiene]);

    const commands: TestOutput["commands"] = [];
    const commandReports: GateReport[] = [];
    const failures: string[] = [];
    let outputTail = "";
    for (const [gateId, configured] of Object.entries(options.config.gates)) {
      const started = Date.now();
      const cleanBefore = runGit(git, ["status", "--porcelain"]).trim().length === 0 && runGit(git, ["rev-parse", "HEAD"]).trim() === candidate;
      const [executable, ...argv] = configured.argv;
      const result = infra.runCommand(executable!, argv, {
        timeoutMs: configured.timeout_seconds * 1_000, cwd: status.worktree!, maxBuffer: options.config.runtime.max_output_bytes,
      });
      const rawCommandOutput = `${result.stdout}${result.stderr}${result.error === null ? "" : `\n${result.error}`}`;
      credentialSafeText(rawCommandOutput, "configured gate output");
      const commandOutput = bounded(rawCommandOutput);
      const outputRelative = join("raw", `command-${phaseKey}-${gateId}.txt`);
      await writeFile(join(options.attemptDir, outputRelative), commandOutput, { mode: 0o600 });
      const exit = result.status ?? -1;
      commands.push({ gateId, argv: [...configured.argv], exitCode: exit, durationMs: Date.now() - started, outputRef: outputRelative });
      if (exit !== 0) failures.push(`${gateId} exited ${exit}`);
      outputTail = bounded(`${outputTail}\n${commandOutput}`);
      const cleanAfter = runGit(git, ["status", "--porcelain"]).trim().length === 0 && runGit(git, ["rev-parse", "HEAD"]).trim() === candidate;
      const partial: TestOutput = {
        schema: "awsf.test-output/v1", producerStatus: exit === 0 ? "success" : "failure", summary: `${gateId} host command`,
        artifacts: [], notesForNextPhase: "owner rework host gates", passed: exit === 0,
        candidateSha: candidate, commands: [...commands], failures: [...failures], outputTail,
      };
      const report = commandsPass(partial, { gateId, argv: configured.argv }, { candidateSha: candidate, cleanBefore, cleanAfter });
      commandReports.push(report);
      if (!cleanAfter) break;
    }
    const testOutput: TestOutput = {
      schema: "awsf.test-output/v1", producerStatus: failures.length === 0 ? "success" : "failure",
      summary: failures.length === 0 ? "all configured owner-rework commands passed" : "owner-rework commands failed",
      artifacts: [], notesForNextPhase: failures.length === 0 ? "return exact candidate to owner" : "inspect retained command evidence",
      passed: failures.length === 0 && commandReports.every((report) => report.passed), candidateSha: candidate,
      commands, failures, outputTail,
    };
    const aggregate = new GateReport("commands_pass");
    for (const [index, report] of commandReports.entries()) reportWith(aggregate, commands[index]?.gateId ?? String(index), report);
    if (Object.keys(options.config.gates).length === 0) aggregate.check("configured commands", true, "no commands configured");
    await persistGate(aggregate, candidate, testOutput.passed ? 0 : -1);
    if (!testOutput.passed || !aggregate.passed) throw new PhaseGateFailure(phaseKey, [aggregate]);
    await persistPhase("SUCCEEDED");

    /**
     * The T2 half, composed while the attempt is still RUNNING.
     *
     * Everything a review needs — the persisted measurement of THIS candidate,
     * the inverted route, the composed evidence, the materialized private
     * prompt and the swept descriptor — is built before L7, so a rework that
     * could not have been reviewed halts on L8 with its candidate retained
     * rather than one call later, from a state whose only other exit is a
     * projection hold.
     */
    let prepared: PreparedReview | null = null;
    if (recipe !== null) {
      // Rework used to build this `TestOutput` in memory and never write it
      // down. The reviewer would then have been handed the retained evidence of
      // the SUPERSEDED candidate — `lastTestOutputFrom` reads the last one on
      // record and refuses anything that names another SHA — so the envelope
      // goes down before anything composes from it.
      //
      // It gets a host phase of its own, exactly as the recipes' own `tests`
      // phase does: the envelopes table is `UNIQUE (phase_id, correction_round)`
      // and the builder's own build-output already holds the builder phase's
      // round 0, so hanging a second envelope there would be refused.
      const testsKey = `${phaseKey}-tests`;
      const testsPhaseId = `${status.sessionId}:${testsKey}`;
      const testsAt = infra.now();
      const testsPhase = (state: string): PhaseEvidenceRecord => ({
        phaseId: testsPhaseId, ordinal: builderOrdinal + 1, key: testsKey, name: testsKey,
        kind: "code", owner: "host",
        description: `Retain the host measurement of reworked candidate ${candidate} for the review that judges it`,
        status: state, correctionCount: 0, maxCorrections: 0, errorCode: null, errorMessage: null,
        startedAt: testsAt, endedAt: state === "SUCCEEDED" ? infra.now() : null, createdAt: testsAt,
      });
      await persist("attempt.updated", {}, { type: "phase", phase: testsPhase("RUNNING") });
      const testsRaw = join("raw", `host-${testsKey}.txt`);
      const testsEnvelope = wrapEnvelope({
        envelopeId: `${testsPhaseId}:0`, sessionId: status.sessionId, phaseId: testsKey,
        correctionRound: 0, agent: "host", schemaId: "awsf.test-output/v1", createdAt: testsAt,
        rawOutputPath: testsRaw,
      }, parseEnvelope(JSON.stringify(testOutput), "awsf.test-output/v1"));
      await mkdir(join(options.attemptDir, "raw"), { recursive: true });
      await writeFile(join(options.attemptDir, testsRaw), JSON.stringify(testOutput), { mode: 0o600 });
      await chmod(join(options.attemptDir, testsRaw), 0o600);
      const testsEnvelopePath = join(options.attemptDir, "envelopes", `${testsKey}-0.json`);
      await mkdir(dirname(testsEnvelopePath), { recursive: true });
      if (existsSync(testsEnvelopePath)) throw new Error(`immutable envelope already exists: ${testsEnvelopePath}`);
      await writeFile(testsEnvelopePath, JSON.stringify(testsEnvelope), { mode: 0o600 });
      await persist("attempt.updated", {}, { type: "envelope", phaseId: testsPhaseId, envelope: testsEnvelope });
      await persist("attempt.updated", {
        lastActivityAt: infra.now(), lastActivity: `${testsKey}: retained the host measurement of ${candidate}`,
      }, { type: "phase", phase: testsPhase("SUCCEEDED") });

      const evidenceRecords = await readAttemptEvidence(options.attemptDir);
      const reviewPhaseIds = new Set(recordedReviews(evidenceRecords, status.sessionId).map((review) => review.phaseId));
      const recorded = recordedRoutes(evidenceRecords, reviewPhaseIds);
      const phases = reviewPhasesOf(recipe);
      // The inversion is taken against the call that produced THIS candidate —
      // the rework's own builder, whose route record was written moments ago —
      // and never against an older one.
      reviewRoute = await resolveReviewRoute({
        config: options.config, configPath: options.configPath, infra, recipe,
        reviewPhaseId: phases.review,
        workerProvider: recorded.worker?.provider,
        priorReview: recorded.review,
      });
      const intent = planIntentFrom(evidenceRecords) ?? requestOutput(status, options.config);
      prepared = await prepareReview({
        subject: {
          attemptDir: options.attemptDir, stateRoot: options.stateRoot, sessionId: status.sessionId,
          repository: status.repository, worktree: status.worktree!,
          baseSha: status.baseSha!, candidateSha: candidate,
        },
        config: options.config, infra, recipe, reviewPhaseId: phases.review, route: reviewRoute,
        // The OWNER RE-ENTRY counter again, the same one the builder's runtime
        // directory carries, so a second rework's review can never overwrite a
        // first one's artefacts or collapse onto its gate rows.
        generation: `rw${String(reworkNumber)}`,
        intent: {
          // The owner's own words. The DEFECT is deliberately absent: the
          // builder was told what to fix, and a reviewer told what to find is
          // not a reviewer.
          request: status.request,
          goals: intent.goals,
          nonGoals: intent.nonGoals,
          acceptanceCriteria: intent.implementationSteps.flatMap((step) => step.acceptanceCriteria),
          testStrategy: intent.testStrategy,
        },
        testOutput,
        workerProvider: recorded.worker!.provider,
      });
      reviewPhaseDb = `${status.sessionId}:${prepared.phaseKey}`;
    }

    const l7 = transition({
      from: "RUNNING", to: "GATING", actor: "host", tier: status.tier, reason: { source: "git" }, interactive: false,
      budget: budget.snapshot(), evidence: { requiredPhasesTerminalSuccess: true, hostCommitCreated: true, baseSha: status.baseSha!, candidateSha: candidate },
    });
    await persistTransition("RUNNING", "GATING", l7.edge, "host", "git", null, `owner rework produced exact candidate ${candidate}`, false, {
      candidateSha: candidate, budget: budget.snapshot(), phase: null, lastActivity: "L7 entered host gating on the new exact candidate",
    });

    if (recipe === null) {
      options.assertAdvancement?.(status.sessionId, "AWAITING_OWNER");
      const l12 = transition({
        from: "GATING", to: "AWAITING_OWNER", actor: "host", tier: status.tier, reason: { source: "gate" }, interactive: false,
        budget: budget.snapshot(), evidence: { gatesPass: true, candidateSha: candidate },
      });
      await persistTransition("GATING", "AWAITING_OWNER", l12.edge, "host", "gate", null, "all fresh owner-rework gates passed", false, {
        candidateSha: candidate, budget: budget.snapshot(), gatesPass: true, requiredReviewPresent: false,
        journeyApproved: true, protectedApprovalsValid: true, blocker: null,
        lastActivity: "fresh L19 candidate and gates passed; awaiting owner",
      });
      return { status, confirmed: true };
    }

    /**
     * L11 — the spawn site the lifecycle has always had, now with a caller.
     *
     * The call is held on the exact candidate the fresh gates just cleared, and
     * the provider is the one the inversion derived by exclusion. The candidate
     * is re-read immediately before GO and again after the review answers: a
     * clean checkout of a DIFFERENT commit is invisible to `assertClean`, so
     * both reads are SHA comparisons.
     */
    const worktree = status.worktree!;
    const baseSha = status.baseSha!;
    const assertCandidatePinned = (when: string, afterAnswer: boolean): void => {
      const observed = systemGitRunner(worktree);
      const canonicalRunner = systemGitRunner(status.repository);
      const problems: string[] = [];
      const head = runGit(observed, ["rev-parse", "HEAD"]).trim();
      if (head !== candidate) problems.push(`worktree HEAD is ${head}, not the candidate ${candidate}`);
      const canonicalHead = runGit(canonicalRunner, ["rev-parse", "HEAD"]).trim();
      if (canonicalHead !== baseSha) problems.push(`canonical HEAD is ${canonicalHead}, not the recorded base ${baseSha}`);
      const dirty = runGit(observed, ["status", "--porcelain"]).trim();
      if (dirty.length > 0) problems.push(`the managed worktree is not clean: ${bounded(dirty, 400)}`);
      if (problems.length === 0) return;
      const detail = `the candidate under review moved ${when}: ${problems.join("; ")}`;
      // After the answer this is host-deterministic evidence that the tree the
      // reviewer read is not the tree the guard would approve, which is what
      // L17 admits as `review-evidence-invalid`. Before GO nothing was bought,
      // so it is an ordinary refusal instead.
      throw afterAnswer ? new ReplacementReviewEvidenceInvalid(detail) : new ReworkCandidateMismatch(detail);
    };

    const l11 = budget.authorize({
      from: "GATING", to: "REVIEWING", actor: "host", reason: { source: "gate" }, interactive: false,
      evidence: { gatesPass: true, candidateSha: candidate }, spawn: { cost: 1 },
    });
    await persistTransition("GATING", "REVIEWING", l11.result.edge, "host", "gate", null,
      `held one call for the ${reviewRoute!.model.provider} review of the reworked candidate`, true, {
        candidateSha: candidate, budget: budget.snapshot(), gatesPass: true, requiredReviewPresent: false,
        protectedApprovalsValid: true, blocker: null,
        lastActivity: `L11 held one call for the mandatory ${reviewRoute!.model.provider} review of ${candidate}`,
      });

    const reviewOutput = await prepared!.run({
      budget,
      reservation: l11.reservation!,
      retrySubject: `${recipe.id}:${prepared!.phaseKey}:retry`,
      registration: { from: "GATING", to: "REVIEWING", edge: "L11" },
      ordinal: builderOrdinal + 2,
      state: reviewState,
      persist,
      assertBeforeGo: () => { assertCandidatePinned("between preflight and GO", false); },
      assertAfterAnswer: () => { assertCandidatePinned("between the review and L15", true); },
      ...(options.assertLaunchProjection === undefined ? {} : { assertLaunchProjection: options.assertLaunchProjection }),
    });

    options.assertAdvancement?.(status.sessionId, "AWAITING_OWNER");
    const l15 = transition({
      from: "REVIEWING", to: "AWAITING_OWNER", actor: "host", tier: status.tier, reason: { source: "gate" }, interactive: false,
      budget: budget.snapshot(),
      evidence: {
        gatesPass: true, candidateSha: candidate,
        review: { verdict: reviewOutput.verdict, reviewedSha: reviewOutput.reviewedSha, findings: reviewOutput.findings },
      },
    });
    // `journeyApproved` goes back to false, unlike the replacement review's:
    // that one changed no tree, and this one changed the tree the owner
    // attested against. L20 demands the attestation at T2, so `awsf journey`
    // runs again against the new candidate before this can land.
    await persistTransition("REVIEWING", "AWAITING_OWNER", l15.edge, "host", "gate", null,
      `${reviewRoute!.model.provider} review of the reworked candidate returned ${reviewOutput.verdict}`, false, {
        candidateSha: candidate, budget: budget.snapshot(), gatesPass: true,
        requiredReviewPresent: true, journeyApproved: false, protectedApprovalsValid: true,
        blocker: null, phase: null, process: null,
        lastActivity: `opposite-provider review on ${reviewRoute!.model.provider} of reworked candidate ${candidate} returned ${reviewOutput.verdict} with ${String(reviewOutput.findings.length)} finding(s)`,
        nextAction: `run \`awsf journey ${status.taskId}\` at a TTY, then \`awsf land ${status.taskId}\``,
      });
    return { status, confirmed: true };
  } catch (error) {
    await writeQueue;
    const failure = safeFailure(error);
    let survivorReport: TerminationReport | null = null;
    // Whichever phase was in flight owns the survivor question. Once the review
    // has a transport it is that one: the builder's already exited, and letting
    // a clean builder exit answer for a reviewer that did not would be a
    // survivor claim about the wrong process.
    const failedTransport = reviewState.activeTransport ?? activeTransport.current;
    const failedObservation = reviewState.activeTransport === null ? observedProcess : reviewState.observed;
    const processExitAlreadyObserved = failedObservation?.settled === true && failedObservation.status === "EXITED";
    if (failedTransport !== null && !processExitAlreadyObserved) {
      try { survivorReport = await failedTransport.cancel("owner rework failed closed"); }
      catch { survivorReport = null; }
    }
    // Only positive non-delegation permits releasing an unused reservation, for either phase.
    for (const held of budget.outstanding()) {
      if (!delegatedReservations.has(held.id)) budget.releaseOnRegistrationFailure(held.id);
    }

    // persistAttempt may throw after journal+status are already durable (the
    // projector is deliberately the last fallible step). Always recover the
    // observed revision before deciding which legal halt remains available.
    status = await readAttempt(options.attemptDir);
    const recoveryAt = (() => {
      try { return credentialSafeText(infra.now(), "recovery timestamp"); }
      catch { return createdAt; }
    })();
    const recoverPersist = async (
      kind: AttemptEvent["kind"],
      update: Partial<AttemptStatus>,
      evidence?: AttemptEvidence,
    ): Promise<void> => {
      const current = await readAttempt(options.attemptDir);
      const next = nextRevision(current, update);
      const event = { kind, next, ...(evidence === undefined ? {} : { evidence }) } as AttemptEvent;
      try {
        status = await persistAttempt(options.attemptDir, current.revision, event, options.projectRecord);
      } catch {
        const observed = await readAttempt(options.attemptDir);
        if (observed.revision === next.revision) {
          status = observed;
          return;
        }
        if (observed.revision !== current.revision) {
          throw new Error("owner rework recovery found an unexpected durable revision");
        }
        status = await persistAttempt(options.attemptDir, current.revision, event);
      }
    };

    if (status.lifecycleState === "RUNNING") {
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
      } catch { /* L8 below is the mandatory durable settlement. */ }

      // Refresh again because even a thrown phase projection may have committed.
      status = await readAttempt(options.attemptDir);
      if (
        status.lifecycleState === "RUNNING" && processRecord !== null &&
        (!processSettled || observedProcess?.settled === false)
      ) {
        const recoveryOutcome: ObservedProcessOutcome = observedProcess?.settled === true
          ? observedProcess
          : survivorReport?.terminated === true
            ? { status: "CANCELLED", exitCode: null, endedAt: recoveryAt, settled: true }
            : { status: "FAILED", exitCode: observedProcess?.exitCode ?? null, endedAt: recoveryAt, settled: false };
        try {
          await recoverPersist("attempt.updated", {
            budget: budget.snapshot(), process: null, lastActivityAt: recoveryOutcome.endedAt,
            lastActivity: `registered process ${processRecord.runId} settled ${recoveryOutcome.status}`,
          }, {
            type: "process", phaseId, adapterId: route.adapterId, role: route.agent.name,
            record: processRecord, status: recoveryOutcome.status,
            registeredAt: releasedAt ?? recoveryOutcome.endedAt, releasedAt, endedAt: recoveryOutcome.endedAt,
            exitCode: recoveryOutcome.exitCode, exitSignal: null,
          });
        } catch { /* L8 below remains the mandatory durable settlement. */ }
      }

      status = await readAttempt(options.attemptDir);
      if (status.lifecycleState === "RUNNING") {
        const terminationFailure = !processExitAlreadyObserved && activeTransport.current !== null && survivorReport === null
          ? new Error(`${failure.message}; registered process termination could not be verified`)
          : !processExitAlreadyObserved && survivorReport !== null && !survivorReport.terminated
            ? new Error(`${failure.message}; surviving processes [${survivorReport.survivors.join(", ")}]`)
            : failure;
        const reason = blocker(terminationFailure);
        const l8 = transition({
          from: "RUNNING", to: "BLOCKED", actor: "host", tier: status.tier,
          reason: { source: "process", code: reason.code, detail: reason.detail }, interactive: false,
          budget: budget.snapshot(),
        });
        const seq = transitionOrdinal++;
        await recoverPersist("attempt.transitioned", {
          lifecycleState: "BLOCKED", budget: budget.snapshot(), process: null,
          blocker: { code: reason.code, detail: reason.detail, ahead: null, behind: null },
          lastActivityAt: recoveryAt, lastActivity: reason.detail,
          nextAction: nextActionFor("BLOCKED", status.taskId),
        }, {
          type: "transition", id: `${status.sessionId}:L8:${seq}`, seq,
          from: "RUNNING", to: "BLOCKED", actor: "host", edgeId: l8.edge,
          reasonSource: "process", reasonCode: reason.code, reasonDetail: reason.detail,
          spawnSite: false, at: recoveryAt,
        });
      }
      status = await readAttempt(options.attemptDir);
      if (status.lifecycleState !== "BLOCKED" || status.budget.callsReserved !== budget.snapshot().callsReserved || status.process !== null) {
        throw new Error("owner rework recovery did not retain the accounted liability at a BLOCKED halt");
      }
      return { status, confirmed: true };
    }
    /**
     * The T2 review failed, and REVIEWING is where the attempt is.
     *
     * An answer whose projection failed is held for database rebuild. Every
     * exited review failure takes L17 with its host-observed classification, so
     * no dead review sojourn survives after the command returns.
     */
    if (status.lifecycleState === "REVIEWING") {
      if (reviewState.answered) {
        await recoverPersist("attempt.updated", {
          budget: budget.snapshot(), process: null,
          blocker: { code: "sqlite-projection-failed", detail: failure.message, ahead: null, behind: null },
          lastActivityAt: recoveryAt, lastActivity: "owner rework review advancement held at REVIEWING until observability rebuild",
          nextAction: "run `awsf db rebuild`, then rerun advancement",
        });
        return { status, confirmed: true };
      }
      if (reviewState.phase !== null) {
        const failedReviewPhase: PhaseEvidenceRecord = {
          ...reviewState.phase, status: "FAILED",
          startedAt: reviewState.phase.startedAt ?? recoveryAt, endedAt: recoveryAt,
          errorCode: failure.name, errorMessage: failure.message,
        };
        try {
          await recoverPersist("attempt.updated", {
            phase: { name: failedReviewPhase.name, state: "FAILED", round: 0, maximumRounds: 0 },
            budget: budget.snapshot(), process: null, lastActivityAt: recoveryAt,
            lastActivity: `${failedReviewPhase.key} failed closed`,
          }, { type: "phase", phase: failedReviewPhase });
        } catch { /* the halt below is the mandatory durable settlement. */ }
      }
      status = await readAttempt(options.attemptDir);
      const registered = reviewState.processRecord as BarrierRecord | null;
      if (registered !== null && (!reviewState.processSettled || reviewState.observed?.settled === false)) {
        const outcome: ObservedProcessOutcome = reviewState.observed?.settled === true
          ? reviewState.observed
          : survivorReport?.terminated === true
            ? { status: "CANCELLED", exitCode: null, endedAt: recoveryAt, settled: true }
            : { status: "FAILED", exitCode: reviewState.observed?.exitCode ?? null, endedAt: recoveryAt, settled: false };
        try {
          await recoverPersist("attempt.updated", {
            budget: budget.snapshot(), process: null, lastActivityAt: outcome.endedAt,
            lastActivity: `registered process ${registered.runId} settled ${outcome.status}`,
          }, {
            type: "process", phaseId: reviewPhaseDb!, adapterId: reviewRoute!.adapterId, role: reviewRoute!.agent.name,
            record: registered, status: outcome.status,
            registeredAt: reviewState.releasedAt ?? outcome.endedAt, releasedAt: reviewState.releasedAt,
            endedAt: outcome.endedAt, exitCode: outcome.exitCode, exitSignal: null,
          });
        } catch { /* the halt below is the mandatory durable settlement. */ }
      }
      status = await readAttempt(options.attemptDir);
      const terminationFailure = !processExitAlreadyObserved && failedTransport !== null && survivorReport === null
        ? new Error(`${failure.message}; registered process termination could not be verified`)
        : !processExitAlreadyObserved && survivorReport !== null && !survivorReport.terminated
          ? new Error(`${failure.message}; surviving processes [${survivorReport.survivors.join(", ")}]`)
          : failure;
      const named = safeFailure(terminationFailure);
      const detail = `${named.name}: ${named.message}`;
      const reason = reviewFailureBlocker(named, detail) ?? { code: "phase-abort", detail, edge: "L17" as const };
      const l17 = transition({
        from: "REVIEWING", to: "BLOCKED", actor: "host", tier: status.tier,
        reason: { source: "process", code: reason.code, detail: reason.detail },
        interactive: false, budget: budget.snapshot(),
        evidence: { reviewTransportRetries: reviewState.transportRetries, reviewFailure: reason.code },
      });
      const seq = transitionOrdinal++;
      await recoverPersist("attempt.transitioned", {
        lifecycleState: "BLOCKED", budget: budget.snapshot(), process: null,
        blocker: { code: reason.code, detail: reason.detail, ahead: null, behind: null },
        lastActivityAt: recoveryAt, lastActivity: reason.detail,
        nextAction: nextActionFor("BLOCKED", status.taskId),
      }, {
        type: "transition", id: `${status.sessionId}:L17:${seq}`, seq,
        from: "REVIEWING", to: "BLOCKED", actor: "host", edgeId: l17.edge,
        reasonSource: "process", reasonCode: reason.code, reasonDetail: reason.detail,
        spawnSite: false, at: recoveryAt,
      });
      return { status, confirmed: true };
    }
    if (status.lifecycleState === "GATING") {
      await recoverPersist("attempt.updated", {
        budget: budget.snapshot(), blocker: { code: "sqlite-projection-failed", detail: failure.message, ahead: null, behind: null },
        lastActivityAt: recoveryAt, lastActivity: "owner rework advancement held at GATING until observability rebuild",
        nextAction: "run `awsf db rebuild`, then retry advancement",
      });
      return { status, confirmed: true };
    }
    if (status.lifecycleState === "BLOCKED") return { status, confirmed: true };
    throw failure;
  }
  });
}


/**
 * Keep the readable projection level with the record this act just moved.
 *
 * A projection is disposable and Git plus the journal remain authoritative, so
 * this is deliberately last and deliberately cheap. It is not optional: a
 * report naming a superseded candidate while `awsf status` calls it current is
 * how an owner reads the wrong review of the wrong change.
 */
async function refreshRunReport(attemptDir: string, status: AttemptStatus): Promise<void> {
  await writeRunReport(attemptDir, status, await readAttemptEvidence(attemptDir));
}

export async function reworkCommand(options: ReworkCommandOptions): Promise<ReworkCommandResult> {
  try {
    const result = await runReworkCommand(options);
    if (result.confirmed) await refreshRunReport(options.attemptDir, result.status);
    return result;
  } catch (error) {
    throw safeFailure(error);
  }
}
