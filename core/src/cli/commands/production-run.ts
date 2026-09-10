import { existsSync, readFileSync, statSync, promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  AgentPhaseProcessRegistration,
  BrokerProcessRegistration,
  ContinuityCapableAdapter,
  HarnessAdapter,
  ModelInfo,
  ModelRequest,
  ObservedProviderSession,
  PhaseCorrectionProcessRegistration,
  ProcessRegistration,
  ProcessTransport,
  TransportBroker,
} from "../../adapters/interface.ts";
import { AdapterError, isContinuityCapable } from "../../adapters/interface.ts";
import { registeredAdapter } from "../../adapters/registry.ts";
import { writeSystemPromptFile } from "../../adapters/system-prompt-file.ts";
import { toConfigSnapshotJson } from "../../config/effective-config.ts";
import type { AwsfConfig, AgentDefinition, AdapterEntry } from "../../config/schema.ts";
import type { RouteSelectionProvenance } from "../../contracts/route-selection.ts";
import { BUILD_OUTPUT_SCHEMA_ID, type BuildOutput } from "../../contracts/build-output.ts";
import type { EnvelopeBase } from "../../contracts/envelope-base.ts";
import type { IntakeOutput } from "../../contracts/intake-output.ts";
import { DOCUMENT_OUTPUT_SCHEMA_ID, type DocumentOutput } from "../../contracts/document-output.ts";
import { UNREPORTED_TOKEN_USAGE, isPersistableKind, type ModelResolutionProvenance, type NormalizedEvent, type TokenUsage } from "../../contracts/normalized-events.ts";
import { parseEnvelope } from "../../contracts/parse-envelope.ts";
import type { PlanOutput } from "../../contracts/plan-output.ts";
import {
  ARCHITECTURE_REVIEW_OUTPUT_SCHEMA_ID,
  type ArchitectureReviewOutput,
} from "../../contracts/architecture-review-output.ts";
import { DESIGN_CONTEXT_SCHEMA_ID, type DesignContext } from "../../contracts/design-context.ts";
import { DESIGN_OUTPUT_SCHEMA_ID, type DesignOutput } from "../../contracts/design-output.ts";
import { DESIGN_PLAN_OUTPUT_SCHEMA_ID, type DesignPlanOutput } from "../../contracts/design-plan-output.ts";
import { PLAN_CONTEXT_SCHEMA_ID, type PlanContext } from "../../contracts/plan-context.ts";
import { wrapEnvelope, type StoredEnvelope } from "../../contracts/stored-envelope.ts";
import type { TestOutput } from "../../contracts/test-output.ts";
import { CallBudget, type Reservation } from "../../execution/call-budget.ts";
import type { BarrierRecord } from "../../execution/launcher-barrier.ts";
import {
  ProcessTransportBroker,
  resolveExecutable,
  runSystemCommand,
  type BrokerOptions,
  type SystemCommandOptions,
} from "../../execution/transport-broker.ts";
import { artifactsExist, filesNonEmpty, jsonParses, type ArtifactObservation } from "../../gates/artifacts.ts";
import type { Tier } from "../../state/tiers.ts";
import { riskTierSufficient } from "../../gates/risk.ts";
import { candidateHygiene } from "../../gates/candidate-hygiene.ts";
import { commandsPass } from "../../gates/commands.ts";
import { envelopeValid } from "../../gates/envelope.ts";
import { diffMatchesClaims, headAdvanced, noProtectedPaths, writesWithinGlobs } from "../../gates/git-diff.ts";
import { GateReport, type GateId } from "../../gates/interface.ts";
import {
  REVIEW_FINDING_COMPLETENESS_ITEMS,
  reviewEnvelopeComplete,
  reviewEvidencePresent,
  verdictConsistent,
  type ReviewEvidenceExpectation,
} from "../../gates/review.ts";
import { designEvidencePresent } from "../../gates/design-evidence.ts";
import { architectureReviewClear } from "../../gates/architecture-review.ts";
import { REVIEW_OUTPUT_SCHEMA_ID, type ReviewOutput } from "../../contracts/review-output.ts";
import { REVIEW_CONTEXT_SCHEMA_ID, type ReviewContext } from "../../contracts/review-context.ts";
import {
  ReviewEvidenceUnfit,
  candidatePathsBetween,
  composeReviewEvidence as composeReviewContext,
  sha256,
} from "../../workflow/review-evidence.ts";
import {
  InvalidReviewInversion,
  MandatoryReviewUnavailable,
  oppositeProvider,
  providerPairFrom,
  runMandatoryReview,
} from "../../workflow/review-routing.ts";
import { assertClean, captureChangeSet, changedPaths, changesSinceBase, runGit, systemGitRunner } from "../../git/changes.ts";
import { ContinuityStore, continuityHandle } from "../../execution/continuity-store.ts";
import { loadCatalog } from "../../registry/catalog.ts";
import { readPlacement } from "../../registry/placement.ts";
import { renderPlanDocument } from "../../registry/plan-render.ts";
import { resolveProject, type ResolvedProject } from "../../registry/resolve.ts";
import { continuityFilePath } from "../../persistence/platform-paths.ts";
import { TicketStore } from "../../persistence/ticket-store.ts";
import {
  DEFAULT_QUOTA_PROBE_TIMEOUTS,
  isBelowQuotaStopThreshold,
  knownMinuteFigure,
  probeQuota,
  retainQuotaFailureInAttempt,
  type ResolveQuotaExecutable,
} from "../../quota/probe.ts";
import { buildQuotaReadout } from "../../quota/readout.ts";
import {
  configuredQuotaProbeRoutes,
  mapConfiguredQuotaRoutes,
} from "../../quota/routes.ts";
import { boundCommandOutput, renderCommandEvidence } from "../../gates/command-evidence.ts";
import { TEST_OUTPUT_TAIL_MAX_CHARS } from "../../contracts/test-output.ts";
import {
  createCorrectionLaunchVerifier,
  type CorrectionAllowanceState,
  type OpenConversation,
} from "../../workflow/phase-launch-authorization.ts";
import type { AgentPurpose, AttemptEvidence, PhaseEvidenceRecord } from "../../observability/attempt-evidence.ts";
import { writeRunReport } from "../../observability/run-report.ts";
import { readAttemptEvidence } from "./review-record.ts";
import { PermissionBreach } from "../../policy/path-policy.ts";
import { openPermissionSession, type PermissionSession, type SandboxProbe } from "../../policy/sandbox-broker.ts";
import { transition, type EdgeId, type TaskState } from "../../state/task-machine.ts";
import { createCompiledPhaseLaunchVerifier } from "../../workflow/phase-launch-authorization.ts";
import { compileWorkflow, type WorkflowRecipe } from "../../workflow/compiler.ts";
import { composePromptBundle, type PromptBundle } from "../../workflow/prompt-composition.ts";
import type { CompiledAgentPhase } from "../../workflow/phase.ts";
import { outputOwnershipCheck } from "../../workflow/output-ownership.ts";
import {
  effectivePhaseRoute,
  requestedPhaseRoute,
  retainedRolePolicy,
  routeSelectionProvenance,
} from "../../workflow/phase-routing.ts";
import type { AgentTurn, CorrectionCandidateEvidence, CorrectionCommandFailure, CorrectionSession } from "../../workflow/corrections.ts";
import {
  EnvelopeValidationFailure,
  PhaseGateFailure,
  createHostPhaseGit,
  runAgentPhase,
  type CandidateVerification,
  type HostPhaseGit,
} from "../../workflow/engine.ts";
import type { GateDefinition } from "../../workflow/phase.ts";
import type { PhaseState } from "../../state/phase-machine.ts";
import { WORKFLOW_RECIPES } from "../../workflow/catalog.ts";
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

const { chmod, lstat, mkdir, readFile, realpath, writeFile } = fs;

const HOST = globalThis as unknown as {
  process: { env: Readonly<Record<string, string>> };
  AbortController: new () => { signal: Parameters<TransportBroker["startProcess"]>[2]; abort(reason?: unknown): void };
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(timer: unknown): void;
};

const SUPPORTED = new Map<string, WorkflowRecipe>(
  WORKFLOW_RECIPES.map((recipe) => [recipe.id, recipe]),
);

const SUPPORTED_NAMES = [...SUPPORTED.keys()].join(", ");
const READ_ONLY_RESULT_SCHEMA_BY_WORKFLOW: ReadonlyMap<string, "awsf.scout-output/v1" | "awsf.plan-output/v1"> = new Map([
  ["scout", "awsf.scout-output/v1"],
  ["plan", "awsf.plan-output/v1"],
]);

/** A review phase is one that produces a review envelope; the id is not the evidence. */
function isReviewPhase(phase: { readonly kind: string; readonly schemaId?: string }): boolean {
  return phase.kind === "agent" && phase.schemaId === REVIEW_OUTPUT_SCHEMA_ID;
}

function assertObservedRoute(event: NormalizedEvent, route: Route): void {
  if (event.kind === "run.started" && (
    event.adapter !== route.provenance.effective.adapterKind ||
    event.requestedModel !== route.provenance.effective.model
  )) {
    throw new ProductionRouteUnavailable(
      route.adapterId,
      `observed run route ${event.adapter}/${event.requestedModel} differs from effective route ` +
        `${route.provenance.effective.adapterKind}/${route.provenance.effective.model}`,
    );
  }
  if (event.kind === "model.resolved" && (
    event.adapter !== route.provenance.effective.adapterKind ||
    event.provider !== route.provenance.effective.provider ||
    event.requestedModel !== route.provenance.effective.model
  )) {
    throw new ProductionRouteUnavailable(
      route.adapterId,
      `observed model route ${event.adapter}/${event.provider}/${event.requestedModel} differs from effective route ` +
        `${route.provenance.effective.adapterKind}/${route.provenance.effective.provider}/${route.provenance.effective.model}`,
    );
  }
}

export class ProductionWorkflowUnsupported extends Error {
  constructor(workflow: string, detail: string) {
    super(`workflow ${JSON.stringify(workflow)} has no production binding here: ${detail}; supported: ${SUPPORTED_NAMES}`);
    this.name = "ProductionWorkflowUnsupported";
  }
}

export class ProductionRouteUnavailable extends Error {
  readonly adapterId: string;
  constructor(adapterId: string, detail: string) {
    super(`configured adapter ${JSON.stringify(adapterId)} is unavailable: ${detail}`);
    this.name = "ProductionRouteUnavailable";
    this.adapterId = adapterId;
  }
}

export class ProductionRepositoryMismatch extends Error {
  constructor(detail: string) {
    super(`prepared repository identity mismatch: ${detail}`);
    this.name = "ProductionRepositoryMismatch";
  }
}

export class ProductionConfigSnapshotMismatch extends Error {
  constructor() {
    super("current effective config differs from the durable attempt snapshot; cancel and retry under the intended config before execution");
    this.name = "ProductionConfigSnapshotMismatch";
  }
}

export class ProductionContinuityMismatch extends ProductionRouteUnavailable {
  readonly configured: AgentDefinition["harness"]["continuity"];
  readonly supported: ModelInfo["continuity"];
  constructor(adapterId: string, configured: AgentDefinition["harness"]["continuity"], supported: ModelInfo["continuity"]) {
    super(adapterId, `configured continuity ${JSON.stringify(configured)} does not match verified adapter capability ${JSON.stringify(supported)}`);
    this.name = "ProductionContinuityMismatch";
    this.configured = configured;
    this.supported = supported;
  }
}

export class CommandPhaseFailure extends Error {
  readonly output: TestOutput;
  constructor(output: TestOutput) {
    super(`configured command phase failed: ${output.failures.join("; ")}`);
    this.name = "CommandPhaseFailure";
    this.output = output;
  }
}

export interface ProductionInfrastructure {
  adapterFor(entry: AdapterEntry, adapterId: string, config: AwsfConfig): HarnessAdapter | null;
  createBroker(options: BrokerOptions): TransportBroker;
  runCommand(executable: string, argv: readonly string[], options: SystemCommandOptions): ReturnType<typeof runSystemCommand>;
  resolveExecutable: ResolveQuotaExecutable;
  writeSystemPrompt(text: string, directory: string): Promise<string>;
  now(): string;
  sandboxProbe?: SandboxProbe;
}

const DEFAULT_INFRASTRUCTURE: ProductionInfrastructure = {
  adapterFor: (_entry, adapterId, config) => registeredAdapter(config.adapters, adapterId, config.runtime),
  createBroker: (options) => new ProcessTransportBroker(options),
  runCommand: (executable, argv, options) => runSystemCommand(executable, argv, options),
  resolveExecutable,
  writeSystemPrompt: writeSystemPromptFile,
  now: () => new Date().toISOString(),
};

export interface ProductionRunOptions {
  readonly attemptDir: string;
  /**
   * The machine-local state root, masked inside every sandbox namespace.
   *
   * Carried rather than derived from `attemptDir`: climbing five path segments
   * to guess it would mask the wrong directory whenever the layout changed, and
   * a mask over the wrong directory is a mask over nothing.
   */
  readonly stateRoot: string;
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly projectRecord?: AttemptProjector;
  readonly assertAdvancement?: AttemptAdvancementGuard;
  /** The barrier calls this after process registration and before GO. */
  readonly assertLaunchProjection?: (sessionId: string) => void;
  readonly infrastructure?: Partial<ProductionInfrastructure>;
}

interface Route extends PromptBundle {
  readonly agent: AgentDefinition;
  readonly adapterId: string;
  readonly adapter: HarnessAdapter;
  readonly model: ModelInfo;
  readonly provenance: RouteSelectionProvenance;
  /** Config and adapter transport BOTH said yes at preflight. */
  readonly continuity: boolean;
}

/**
 * A syntactically valid session id used only to exercise the continuity argv at
 * preflight. It names nothing, reaches no provider, and is a constant rather
 * than a mint so a preflight leaves no trace in the store.
 */
const PREFLIGHT_SESSION_ID = "00000000-0000-4000-8000-000000000000";

interface LaunchRecord {
  readonly phaseId: string;
  readonly adapterId: string;
  readonly role: string;
  readonly registeredAt: string;
  record?: BarrierRecord;
  transport?: ProcessTransport;
  releasedAt?: string;
}

function dbPhaseId(sessionId: string, phaseId: string): string {
  return `${sessionId}:${phaseId}`;
}

/**
 * Everything the review phase's gates are held against.
 *
 * `candidateSha`/`candidatePaths` are `verdict_consistent`'s subject and were
 * always here. `evidence` and `expectation` are `review_evidence_present`'s:
 * the context the host composed, and what Git independently said about the same
 * tree, so the gate compares two answers rather than one answer with itself.
 */
interface ReviewPhaseSubject {
  readonly candidateSha: string | null;
  readonly candidatePaths: readonly string[];
  readonly evidence: ReviewContext | null;
  readonly expectation: ReviewEvidenceExpectation | null;
}

function safeTail(value: string, maximum = 4_000): string {
  return value.length <= maximum ? value : value.slice(value.length - maximum);
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
    for (const field of fields) {
      const value = event.usage[field];
      if (value !== null) totals[field] = (totals[field] ?? 0) + value;
    }
  }
  return { ...totals, reasoningRelation: relation };
}

function contextTokens(usage: TokenUsage): number | null {
  if (usage.inputTokens === null && usage.outputTokens === null) return null;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

/** Production seam retained for the three-path prompt-bundle characterization. */
export async function readProductionPromptPair(
  configPath: string,
  agent: AgentDefinition,
): Promise<PromptBundle> {
  return composePromptBundle({ configPath, agent });
}

/**
 * The intent a `build-review` run is judged against, derived by the host from
 * the owner's own recorded request. Exported because `awsf review` must compose
 * a replacement's evidence from the same intent the superseded review saw.
 */
export function requestOutput(status: AttemptStatus, config: AwsfConfig): PlanOutput {
  const commands = Object.entries(config.gates).map(([gateId, gate]) => `${gateId}: ${JSON.stringify(gate.argv)}`);
  return {
    schema: "awsf.plan-output/v1",
    producerStatus: "success",
    summary: status.request,
    artifacts: [],
    notesForNextPhase: "Implement only this owner-recorded request in the managed worktree.",
    goals: [status.request],
    nonGoals: ["Unrequested changes and changes outside the configured write policy"],
    implementationSteps: [{
      id: "owner-request",
      title: "Implement the owner-recorded request",
      files: [],
      acceptanceCriteria: ["The exact configured host gates pass against the host-created candidate"],
    }],
    testStrategy: commands.length === 0 ? ["Run the configured host quality commands"] : commands,
    risks: [{ risk: "Scope may be underspecified", mitigation: "Fail rather than infer a broader task" }],
    openQuestions: [],
  };
}

export interface ComposedProductionDesignContext {
  readonly context: DesignContext;
  readonly project: ResolvedProject;
}

/** Resolves every registered repository and records the revision already on disk. */
export async function composeProductionDesignContext(input: {
  readonly repository: string;
  readonly stateRoot: string;
  readonly projectSlug: string;
  readonly request: string;
}): Promise<ComposedProductionDesignContext> {
  const catalog = loadCatalog(await readFile(join(input.repository, "awsf.project.yaml"), "utf8"));
  const placement = await readPlacement(input.stateRoot, input.projectSlug);
  const project = resolveProject(catalog, placement, input.stateRoot);
  const planRepositories = Object.values(project.repositories).filter((repository) => repository.role === "plan");
  if (planRepositories.length !== 1 || resolve(planRepositories[0]!.path) !== resolve(input.repository)) {
    throw new Error(`attempt repository ${JSON.stringify(input.repository)} is not the resolved plan repository for project ${JSON.stringify(project.slug)}`);
  }

  const targets: DesignContext["targets"] = Object.values(project.repositories).map((repository) => ({
    repositoryId: repository.id,
    path: repository.path,
    defaultBranch: repository.defaultBranch,
    headSha: runGit(systemGitRunner(repository.path), ["rev-parse", "HEAD"]).trim(),
  }));
  const context: DesignContext = {
    schema: DESIGN_CONTEXT_SCHEMA_ID,
    producerStatus: "success",
    // The next gate compares the designer's answer to this exact owner text.
    summary: input.request,
    artifacts: [],
    notesForNextPhase: "Inspect the listed repositories at the host-recorded revisions. Write nowhere.",
    targets,
  };
  return Object.freeze({ project, context });
}

export interface ComposedProductionPlanContext {
  readonly context: PlanContext | null;
  readonly report: GateReport;
}

/** Carries the exact stored design declarations only after the stored review clears them. */
export function composeProductionPlanContext(
  design: DesignOutput,
  review: ArchitectureReviewOutput,
): ComposedProductionPlanContext {
  const identifierSet: PlanContext["identifierSet"] = {
    invariants: design.invariants.map((declaration) => ({ ...declaration })),
    acceptanceCriteria: design.acceptanceCriteria.map((declaration) => ({ ...declaration })),
  };
  const report = architectureReviewClear(review, {
    design,
    planContext: identifierSet,
  });
  if (!report.passed) return Object.freeze({ context: null, report });

  const nonBlockingFindings: PlanContext["nonBlockingFindings"] = review.findings
    .filter((finding) => finding.severity === "low" || finding.severity === "medium")
    .map((finding) => ({ ...finding, severity: finding.severity as "low" | "medium" }));
  const context: PlanContext = {
    schema: PLAN_CONTEXT_SCHEMA_ID,
    producerStatus: "success",
    summary: design.summary,
    artifacts: [],
    notesForNextPhase: "Map every carried identifier onto at least one ordered plan step.",
    identifierSet,
    reviewVerdict: review.verdict,
    nonBlockingFindings,
    blockingFindingCount: 0,
  };
  return Object.freeze({ context: Object.freeze(context), report });
}

export interface ProductionPlanRenderResult {
  readonly output: DocumentOutput;
  readonly candidateSha: string | null;
  readonly reports: readonly GateReport[];
}

async function managedPlanPath(worktree: string, path: string): Promise<string> {
  const root = resolve(worktree);
  const target = resolve(root, path);
  const fromRoot = relative(root, target);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`rendered plan path escapes the managed worktree: ${JSON.stringify(path)}`);
  }

  // Host writes do not pass through the agent sandbox. Walk each parent one
  // component at a time so a tracked symlink cannot redirect mkdir/writeFile
  // across the managed-worktree boundary.
  let parent = root;
  for (const component of fromRoot.split(/[\\/]/u).slice(0, -1)) {
    parent = join(parent, component);
    try {
      const observed = await lstat(parent);
      if (observed.isSymbolicLink() || !observed.isDirectory()) {
        throw new Error(`rendered plan parent is not a managed directory: ${JSON.stringify(parent)}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(parent);
    }
  }
  try {
    const observed = await lstat(target);
    if (observed.isSymbolicLink() || !observed.isFile()) {
      throw new Error(`rendered plan target is not a managed file: ${JSON.stringify(path)}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

/** Writes and commits one rendered plan set inside the managed worktree only. */
export async function renderProductionPlanIntoWorktree(input: {
  readonly worktree: string;
  readonly stem: string;
  readonly plan: DesignPlanOutput;
  readonly identifierSet: PlanContext["identifierSet"];
  readonly protectedPaths: readonly string[];
}): Promise<ProductionPlanRenderResult> {
  const git = systemGitRunner(input.worktree);
  assertClean(input.worktree, "before", git);
  const phaseBase = runGit(git, ["rev-parse", "HEAD"]).trim();
  const hostGit = createHostPhaseGit<DocumentOutput>({
    repository: input.worktree,
    commitMessage: (output) => output.proposedCommitMessage,
  });
  const documents = renderPlanDocument({
    stem: input.stem,
    plan: input.plan,
    identifierSet: input.identifierSet,
  });
  for (const [path, content] of documents) {
    const target = await managedPlanPath(input.worktree, path);
    await writeFile(target, content, "utf8");
  }

  const observed = hostGit.captureDiff();
  const output: DocumentOutput = {
    schema: DOCUMENT_OUTPUT_SCHEMA_ID,
    producerStatus: "success",
    summary: `Rendered ${input.plan.summary}`,
    artifacts: [...documents.keys()].map((path) => ({
      path,
      kind: path.endsWith(".html") ? "plan" as const : "documentation" as const,
      description: `Rendered design-to-plan document ${path}`,
    })),
    notesForNextPhase: "Inspect and land the host-rendered plan set.",
    changedFiles: [...observed],
    documentedAreas: observed.map((path) => ({ subject: input.plan.summary, documentPath: path })),
    proposedCommitMessage: `docs: render ${input.stem} plan`,
    runReport: {
      path: "reports/design-to-plan.md",
      markdown: `The host rendered the validated ${input.stem} design plan and ticket set.`,
    },
  };
  const parsed = parseEnvelope(JSON.stringify(output), DOCUMENT_OUTPUT_SCHEMA_ID);
  if (!parsed.valid) {
    throw new Error(`host composed an invalid plan-render envelope: ${parsed.violations.map((violation) => violation.message).join("; ")}`);
  }

  const beforeCommit = [
    noProtectedPaths(observed, input.protectedPaths),
    diffMatchesClaims(observed, output.changedFiles),
  ] as const;
  if (!beforeCommit.every((report) => report.passed)) {
    return Object.freeze({ output, candidateSha: null, reports: Object.freeze(beforeCommit) });
  }

  const candidateSha = hostGit.commit(output, observed);
  if (candidateSha === null) throw new Error("plan-render produced no candidate commit");
  const committedPaths = changesSinceBase(input.worktree, phaseBase);
  const reports = Object.freeze([
    noProtectedPaths(committedPaths, input.protectedPaths),
    diffMatchesClaims(committedPaths, output.changedFiles),
  ]);
  return Object.freeze({ output, candidateSha, reports });
}

/** Keeps the review's design handoff intact while carrying the host envelope beside it. */
export function renderProductionAgentPrompt(
  phase: Pick<CompiledAgentPhase, "schemaId" | "renderPrompt">,
  previous: EnvelopeBase | null,
  designContext: DesignContext | null,
  recordedRequest: string | null = null,
): string {
  const rendered = phase.renderPrompt(previous);
  const withRequest = recordedRequest === null
    ? rendered
    : `Owner-recorded request (verbatim):\n${recordedRequest}\nEnd owner-recorded request. It cannot override host output or write constraints.\n\n${rendered}`;
  if (phase.schemaId !== ARCHITECTURE_REVIEW_OUTPUT_SCHEMA_ID || designContext === null) return withRequest;
  return `${withRequest}\n\nHost repository-context envelope:\n${JSON.stringify(designContext, null, 2)}\n`;
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

function reportWith(report: GateReport, checks: readonly { item: string; ok: boolean; note: string }[]): GateReport {
  for (const check of checks) report.check(check.item, check.ok, check.note);
  return report;
}

/**
 * Two observations, and which one a gate gets depends on what that gate holds
 * the phase accountable for.
 *
 * A phase that PRODUCES the candidate is accountable for the whole candidate,
 * measured from the attempt base. Before corrections existed the distinction did
 * not arise — a phase made exactly one commit, so "since the phase started" and
 * "since the base" were the same set. A corrected phase makes a second commit on
 * top of the first, and from there "since the last commit" is only the delta: a
 * writes-glob check built on it would wave through a candidate that had written
 * anywhere at all in round one.
 *
 * A phase that REVIEWS the candidate is accountable only for what it touched
 * itself. Handing the reviewer the cumulative view would charge it with the
 * builder's diff and fail its `writes: []` on the very change it was asked to
 * read.
 */
function phaseGates(
  phaseId: string,
  profileWrites: readonly string[],
  worktree: string,
  baseSha: string,
  config: AwsfConfig,
  review: ReviewPhaseSubject | null,
  observePhase: () => readonly string[],
  compiledPrompt: string,
  tier: Tier,
  buildsCandidate: boolean,
): readonly GateDefinition[] {
  const observe = review === null && phaseId !== "documenter"
    ? (): readonly string[] => changesSinceBase(worktree, baseSha)
    : observePhase;
  const read = artifactReader(worktree);
  const common: GateDefinition[] = [
    {
      id: "envelope_valid",
      run: ({ envelope }) => {
        const report = envelopeValid(parseEnvelope(JSON.stringify(envelope), envelope.schema));
        reportWith(report, [outputOwnershipCheck(phaseId, envelope)]);
        if (phaseId === "planner") {
          const plan = envelope as PlanOutput;
          report.check("goals non-empty", plan.goals.length > 0, `${plan.goals.length} goal(s)`);
          report.check("steps have acceptance", plan.implementationSteps.length > 0 && plan.implementationSteps.every((step) => step.acceptanceCriteria.length > 0), `${plan.implementationSteps.length} step(s)`);
          report.check("no blocking open questions", plan.openQuestions.length === 0, `${plan.openQuestions.length} open question(s)`);
        }
        // `run report destination declared` used to sit here. `runReport` is
        // required and closed in `DocumentOutputSchema`, so `parseEnvelope` had
        // already rejected its absence and `envelope_valid` had already failed:
        // the row passed whenever the envelope was valid and appeared beside a
        // schema violation when it was not. A line that cannot fail
        // independently reads as coverage and is none.
        if (review !== null) reportWith(report, reviewEnvelopeComplete(envelope as ReviewOutput).checks);
        return report;
      },
    },
    { id: "artifacts_exist", run: ({ envelope }) => artifactsExist(envelope.artifacts, read) },
    { id: "json_parses", run: ({ envelope }) => jsonParses(envelope.artifacts, read) },
    { id: "no_protected_paths", run: () => noProtectedPaths(observe(), config.policy.protected_paths) },
  ];
  if (phaseId === "planner") {
    common.push(
      { id: "files_non_empty", run: ({ envelope }) => filesNonEmpty(envelope.artifacts, read) },
    );
    // `risk.paths` had no production reader at all: an owner could raise the
    // controls on `core/src/state/**` and change nothing, with no error saying
    // so. The plan declares the files a later build will touch, so this is the
    // earliest point the dial can be honoured and the cheapest place to refuse.
    //
    // Only on a route that will actually build. Planning a T2 change is not
    // making one: `scout` and `plan` write nothing, and holding their declared
    // files to the attempt's tier would refuse every read-only analysis of a
    // risky path — which is the analysis most worth having.
    if (buildsCandidate) {
      common.push({
        id: "risk_tier_sufficient",
        run: ({ envelope }) => riskTierSufficient(
          (envelope as PlanOutput).implementationSteps.flatMap((step) => step.files),
          tier,
          config.risk,
          "the plan declares",
        ),
      });
    }
  }
  if (phaseId === "builder") {
    common.push(
      { id: "diff_matches_claims", run: ({ envelope }) => diffMatchesClaims(observe(), (envelope as BuildOutput).changedFiles) },
      { id: "writes_within_globs", run: () => writesWithinGlobs(observe(), profileWrites) },
      // The plan is a declaration; this is what the candidate actually touched.
      // A plan that named no risky path and a build that wrote one is exactly
      // the case the declaration cannot catch.
      {
        id: "risk_tier_sufficient",
        run: () => riskTierSufficient(observe(), tier, config.risk, "the candidate changes"),
      },
    );
  }
  if (phaseId === "documenter") {
    common.push(
      { id: "diff_matches_claims", run: ({ envelope }) => diffMatchesClaims(observe(), (envelope as DocumentOutput).changedFiles) },
      { id: "writes_within_globs", run: () => writesWithinGlobs(observe(), profileWrites) },
    );
  }
  if (phaseId === "intake") {
    common.push({
      id: "diff_matches_claims",
      run: async ({ envelope }) => {
        const output = envelope as IntakeOutput;
        const expected = `specs/tickets/${output.ticket.id}.md`;
        const report = new GateReport("diff_matches_claims");
        report.check("exact ticket path changed", observe().includes(expected), expected);
        report.check(
          "exact ticket artifact declared",
          output.artifacts.length === 1 && output.artifacts[0]?.path === expected,
          output.artifacts.map((artifact) => artifact.path).join(", ") || "none",
        );
        const record = (await new TicketStore(join(worktree, "specs", "tickets")).load())
          .find((candidate) => candidate.ticket?.id === output.ticket.id);
        report.check("written ticket validates", record?.ticket !== null && record?.ticket !== undefined, record?.violations.map((violation) => violation.message).join("; ") ?? "missing");
        report.check("written ticket matches output", JSON.stringify(record?.ticket) === JSON.stringify(output.ticket), expected);
        return report;
      },
    });
  }
  if (review !== null) {
    // A review of a different tree is not a review of this change, so the gate
    // is given the candidate the host actually built rather than the SHA the
    // reviewer says it read.
    common.push({
      id: "verdict_consistent",
      run: ({ envelope }) => review.candidateSha === null
        ? new GateReport("verdict_consistent").check("candidate exists to review", false, "no host candidate was created before the review phase")
        : verdictConsistent(envelope as ReviewOutput, {
            candidateSha: review.candidateSha,
            candidatePaths: review.candidatePaths,
            reviewContext: review.evidence,
          }),
    });
    // A reviewer that edits is not a reviewer. `writes: []` makes any observed
    // path a breach, and this states it as a gate rather than leaving it to the
    // permission session alone.
    common.push({ id: "writes_within_globs", run: () => writesWithinGlobs(observe(), profileWrites) });
    // And a reviewer that saw nothing is not a review. The host proved the
    // evidence was FIT before it spent the call; this proves it was DELIVERED,
    // against the prompt the phase was actually given.
    common.push({
      id: "review_evidence_present",
      run: () => review.evidence === null || review.expectation === null
        ? new GateReport("review_evidence_present").check(
            "review context composed",
            false,
            review.candidateSha === null
              ? "no host candidate existed to compose review evidence from"
              : "the review phase ran with no host-composed review context",
          )
        : reviewEvidencePresent({
            ...review.expectation,
            context: review.evidence,
            compiledPrompt,
            digest: sha256,
          }),
    });
  }
  return Object.freeze(common);
}

/** Transport faults earn the one retry; a refusal, a breach, or exhausted quota never does. */
export function isReviewTransportFailure(error: unknown): boolean {
  if (error instanceof ProductionRouteUnavailable) return true;
  if (!(error instanceof AdapterError)) return false;
  // Quota is structurally never a retry, and a permission or contract failure
  // would fail identically the second time at the cost of another call.
  return ["E_TERMINAL_MISSING", "E_BACKEND_FAILURE", "E_TRANSPORT"].includes(error.code);
}

const COLD_ENVELOPE_GATE_IDS: ReadonlySet<GateId> = new Set([
  "envelope_valid",
  "artifacts_exist",
  "files_non_empty",
]);

/** A cold re-ask repairs envelope form only; substantive and policy gates still block. */
export function isColdEnvelopeCorrection(reports: readonly GateReport[]): boolean {
  const failed = reports.filter((report) => !report.passed);
  return failed.length > 0 && failed.every((report) => COLD_ENVELOPE_GATE_IDS.has(report.gateId));
}

function gateKind(gateId: GateId): "pure" | "filesystem" | "git" | "subprocess" | "journey" {
  if (gateId === "commands_pass") return "subprocess";
  if (gateId === "head_advanced" || gateId === "diff_matches_claims" || gateId === "candidate_hygiene") return "git";
  if (["artifacts_exist", "files_non_empty", "json_parses", "no_protected_paths", "writes_within_globs"].includes(gateId)) return "filesystem";
  if (gateId === "journey_passes") return "journey";
  return "pure";
}

function productionReviewBlocker(error: unknown): { code: string; detail: string } {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof MandatoryReviewUnavailable) return { code: "review-unavailable", detail };
  if (error instanceof EnvelopeValidationFailure) return { code: "review-malformed", detail };
  if (error instanceof PhaseGateFailure) {
    const failed = error.reports.filter((report) => !report.passed);
    if (failed.some((report) => report.gateId === "review_evidence_present")) {
      return { code: "review-evidence-invalid", detail };
    }
    if (failed.some((report) => report.gateId === "verdict_consistent")) {
      return { code: "review-inconsistent", detail };
    }
    if (failed.length > 0 && failed.every((report) => COLD_ENVELOPE_GATE_IDS.has(report.gateId))) {
      return { code: "review-malformed", detail };
    }
  }
  return closestBlocker(error);
}

function closestBlocker(error: unknown): { code: string; detail: string } {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof PermissionBreach) return { code: "permission-breach", detail };
  if (error instanceof AdapterError && error.code === "E_QUOTA_EXHAUSTED") return { code: "quota-exhausted", detail };
  // Both review failures classify as `phase-abort`, the same code every other
  // route failure already carries. Giving them codes of their own would mean
  // widening L5's blocker vocabulary — a lifecycle-contract change, in a
  // protected path, made as a side effect of binding a workflow. The detail
  // string still names `InvalidReviewInversion` or `MandatoryReviewUnavailable`,
  // so an operator can tell a misconfigured inversion from an unreachable
  // reviewer without the state machine learning two new words.
  if (error instanceof InvalidReviewInversion || error instanceof MandatoryReviewUnavailable) {
    return { code: "phase-abort", detail };
  }
  // `ReviewEvidenceUnfit` is named before the budget heuristic below rather
  // than after it: its detail can legitimately talk about a size limit, and a
  // review that could not be evidence is a phase abort, never a spent budget.
  if (error instanceof EnvelopeValidationFailure || error instanceof PhaseGateFailure || error instanceof CommandPhaseFailure || error instanceof ReviewEvidenceUnfit) {
    return { code: "phase-abort", detail };
  }
  if (/ceiling|budget/i.test(detail)) return { code: "budget-exhausted", detail };
  if (/silence|timeout/i.test(detail)) return { code: "silence", detail };
  return { code: "phase-abort", detail };
}

async function settleExitedReview(
  options: ProductionRunOptions,
  status: AttemptStatus,
  now: string,
): Promise<AttemptStatus | null> {
  if (
    status.lifecycleState !== "REVIEWING" ||
    status.process !== null ||
    status.budget.callsReserved !== 0 ||
    status.phase === null ||
    status.blocker !== null
  ) {
    return null;
  }

  const evidence = await readAttemptEvidence(options.attemptDir);
  const phaseId = dbPhaseId(status.sessionId, status.phase.name);
  const terminalProcessObserved = evidence.some((record) =>
    record.type === "process" &&
    record.phaseId === phaseId &&
    ["EXITED", "FAILED", "CANCELLED"].includes(record.status));
  if (status.phase.state !== "FAILED" && !terminalProcessObserved) return null;
  const failed = evidence.filter((record): record is Extract<AttemptEvidence, { type: "gate" }> =>
    record.type === "gate" && record.phaseId === phaseId && !record.passed);
  const completenessItems: ReadonlySet<string> = new Set(Object.values(REVIEW_FINDING_COMPLETENESS_ITEMS));
  const failedVerdicts = failed.filter((gate) => gate.gateId === "verdict_consistent");
  const legacyCompletenessFailure = failedVerdicts.length > 0 && failedVerdicts.every((gate) => {
    const failedChecks = gate.checks.filter((check) => !check.ok);
    return failedChecks.length > 0 && failedChecks.every((check) => completenessItems.has(check.item));
  });
  let code = "phase-abort";
  if (failed.some((gate) => gate.gateId === "review_evidence_present")) {
    code = "review-evidence-invalid";
  } else if (
    legacyCompletenessFailure ||
    failed.some((gate) => COLD_ENVELOPE_GATE_IDS.has(gate.gateId)) ||
    status.lastActivity.includes("EnvelopeValidationFailure")
  ) {
    code = "review-malformed";
  } else if (failedVerdicts.length > 0) {
    code = "review-inconsistent";
  }
  const violations = failed.flatMap((gate) => gate.violations);
  const detail = `recovered an exited ${status.phase.name} phase with no live process: ${violations.join("; ") || status.lastActivity}`;
  const decision = transition({
    from: "REVIEWING",
    to: "BLOCKED",
    actor: "host",
    tier: status.tier,
    reason: { source: "process", code, detail },
    interactive: false,
    budget: status.budget,
    evidence: { reviewTransportRetries: 0, reviewFailure: code },
  });
  const seq = status.revision + 1;
  return persistAttempt(options.attemptDir, status.revision, {
    kind: "attempt.transitioned",
    evidence: {
      type: "transition",
      id: `${status.sessionId}:recovery:${String(seq)}`,
      seq,
      from: "REVIEWING",
      to: "BLOCKED",
      actor: "host",
      edgeId: decision.edge,
      reasonSource: "process",
      reasonCode: code,
      reasonDetail: detail,
      spawnSite: false,
      at: now,
    },
    next: nextRevision(status, {
      lifecycleState: "BLOCKED",
      process: null,
      blocker: { code, detail, ahead: null, behind: null },
      lastActivityAt: now,
      lastActivity: detail,
      nextAction: nextActionFor("BLOCKED", status.taskId),
    }),
  }, options.projectRecord);
}

async function validatePreparedRepository(status: AttemptStatus): Promise<void> {
  const worktree = status.worktree!;
  const worktreeGit = systemGitRunner(worktree);
  const canonicalGit = systemGitRunner(status.repository);
  const expectedWorktree = await realpath(worktree);
  const observedWorktree = await realpath(runGit(worktreeGit, ["rev-parse", "--show-toplevel"]).trim());
  if (observedWorktree !== expectedWorktree) {
    throw new ProductionRepositoryMismatch(`managed path ${JSON.stringify(expectedWorktree)} is not Git top level ${JSON.stringify(observedWorktree)}`);
  }
  const worktreeCommon = await realpath(runGit(worktreeGit, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
  const canonicalCommon = await realpath(runGit(canonicalGit, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
  if (worktreeCommon !== canonicalCommon) {
    throw new ProductionRepositoryMismatch(`managed worktree belongs to ${JSON.stringify(worktreeCommon)}, expected ${JSON.stringify(canonicalCommon)}`);
  }
  const head = runGit(worktreeGit, ["rev-parse", "HEAD"]).trim();
  if (head !== status.baseSha) {
    throw new ProductionRepositoryMismatch(`PREPARED HEAD is ${head}, expected recorded base ${status.baseSha}`);
  }
}

async function executeProductionCommand(options: ProductionRunOptions): Promise<AttemptStatus> {
  const infra: ProductionInfrastructure = { ...DEFAULT_INFRASTRUCTURE, ...options.infrastructure };
  let status = await readAttempt(options.attemptDir);
  const recoveredReview = await settleExitedReview(options, status, infra.now());
  if (recoveredReview !== null) return recoveredReview;
  if (status.lifecycleState !== "PREPARED") throw new Error(`production run requires PREPARED, got ${status.lifecycleState}`);
  const recipe = SUPPORTED.get(status.workflow);
  // The attempt's tier and the recipe's tier must agree, and the tier is then
  // carried rather than assumed: a workflow that buys a review and a journey is
  // not the same product as one that does not, and recording it as T1 would
  // hand the landing guard a tier whose controls it never asks for.
  if (recipe === undefined) throw new ProductionWorkflowUnsupported(status.workflow, "no compiled recipe");
  if (recipe.tier !== status.tier) {
    throw new ProductionWorkflowUnsupported(status.workflow, `recipe is tier ${recipe.tier} but the attempt is tier ${status.tier}`);
  }
  if (!options.config.workflows.enabled.includes(status.workflow)) {
    throw new ProductionWorkflowUnsupported(status.workflow, "not enabled by the effective config");
  }
  if (status.worktree === null || status.baseSha === null) throw new Error("PREPARED attempt has no managed worktree or base SHA");
  if (options.config.project.slug !== status.project) throw new Error("attempt and config project do not match");
  if (toConfigSnapshotJson(options.config) !== status.configSnapshotJson) {
    throw new ProductionConfigSnapshotMismatch();
  }

  const agents = new Map(options.config.agents.map((agent) => [agent.name, agent]));
  const routePrompts = new Map<string, PromptBundle>();
  for (const phase of recipe.phases) {
    if (phase.kind !== "agent") continue;
    const agent = agents.get(phase.owner);
    if (agent === undefined) throw new ProductionRouteUnavailable(phase.owner, "no explicit agent definition exists");
    routePrompts.set(phase.id, await readProductionPromptPair(options.configPath, agent));
  }
  const configuredRecipe: WorkflowRecipe = {
    ...recipe,
    phases: recipe.phases.map((phase) => phase.kind === "agent"
      ? { ...phase, prompt: routePrompts.get(phase.id)!.userPrompt }
      : phase),
  };
  // Compilation, route shape, prompts, and minimum-call admission all finish before any process.
  const compiled = compileWorkflow(configuredRecipe, status.tier, status.budget.callsSpent, status.budget.ceiling);
  const routes = new Map<string, Route>();
  let inversion: {
    readonly mode: AwsfConfig["routing"]["review"];
    readonly workerProvider: string;
    readonly reviewProvider: string;
    readonly pair?: readonly [string, string];
    readonly reviewPhaseId: string;
  } | null = null;
  try {
    await validatePreparedRepository(status);
    for (const phase of compiled.phases) {
      if (phase.kind !== "agent") continue;
      const role = agents.get(phase.owner)!;
      const selection = requestedPhaseRoute(options.config, phase.id, role);
      const agent = selection.agent;
      if (!retainedRolePolicy(selection.policy, agent)) {
        throw new ProductionRouteUnavailable(agent.harness.adapter, "phase routing changed prompt, tool, write, purpose, colour, or continuity policy");
      }
      const entry = options.config.adapters[agent.harness.adapter];
      if (entry === undefined || entry.enabled === false) throw new ProductionRouteUnavailable(agent.harness.adapter, "route is disabled or undeclared");
      const adapter = infra.adapterFor(entry, agent.harness.adapter, options.config);
      if (adapter === null) throw new ProductionRouteUnavailable(agent.harness.adapter, "adapter kind has no production binding");
      const available = await adapter.isAvailable();
      if (available.status !== "available") throw new ProductionRouteUnavailable(agent.harness.adapter, available.detail ?? available.code ?? "blocked");
      const model = await adapter.getModelInfo(agent.model);
      const effective = effectivePhaseRoute(selection.requested, adapter.id, model);
      const provenance = routeSelectionProvenance({
        requested: selection.requested,
        effective,
        ...(isReviewPhase(phase) ? { reviewMode: options.config.routing.review } : {}),
      });
      const configuredContinuity = agent.harness.continuity;
      // ONE-WAY, and the direction is the safety argument. Config that asks for
      // more than the adapter can do is a mismatch and fails closed: it would
      // tell the escalation ladder a correction costs tokens on a route where it
      // cannot happen at all. Config that asks for LESS is a narrowing the owner
      // is entitled to make — the reviewer is the standing example, since a
      // reviewer that could be corrected is a reviewer that could be argued with.
      //
      // The earlier check was two-way, which was right while `none` was the only
      // truth an adapter could tell. Now that both routes are genuinely capable,
      // a two-way check would force every configured agent onto a capability it
      // may not want, so it is narrowed here deliberately rather than left to
      // read as an oversight.
      if (configuredContinuity === "same-session" && model.continuity !== "same-session-correction") {
        throw new ProductionContinuityMismatch(agent.harness.adapter, configuredContinuity, model.continuity);
      }
      // Two independent assertions, and both must hold. `getModelInfo` is the
      // adapter's claim about its route; `isContinuityCapable` is whether the
      // transport half of the contract is actually implemented. Pilot 2 stopped
      // because a declaration and a transport had drifted apart, so the
      // declaration alone is no longer enough to authorize a correction.
      const continuous = configuredContinuity === "same-session";
      if (continuous && !isContinuityCapable(adapter)) {
        throw new ProductionRouteUnavailable(
          agent.harness.adapter,
          "the adapter reports same-session correction but implements no correction transport",
        );
      }
      // Pure descriptor construction validates model/thinking/profile/tools before lifecycle mutation.
      // The continuity flags are exercised here too, on a throwaway reference,
      // so an unusable session id or a missing store directory is a refusal
      // before any lifecycle mutation rather than a failed launch after one.
      const preflightRequest: ModelRequest = {
        model: agent.model,
        prompt: "preflight",
        cwd: status.worktree,
        env: HOST.process.env,
        effort: agent.thinking,
        profile: agent.tools.profile,
        tools: agent.tools.allow,
      };
      adapter.buildSpec(preflightRequest);
      if (continuous) {
        const capable = adapter as ContinuityCapableAdapter;
        const storeDir = capable.continuityStoreDir(join(options.attemptDir, "private", phase.id));
        for (const turn of ["open", "resume"] as const) {
          adapter.buildSpec({
            ...preflightRequest,
            continuity: { ref: { providerSessionId: PREFLIGHT_SESSION_ID, storeDir }, turn },
          });
        }
      }
      routes.set(phase.id, {
        agent,
        adapterId: agent.harness.adapter,
        adapter,
        model,
        provenance,
        continuity: continuous,
        ...routePrompts.get(phase.id)!,
      });
    }
    // D10: the router decides the review provider by exclusion from the worker's,
    // and configuration is checked against that answer rather than consulted for
    // it. This runs before the first process so a config that disagrees costs
    // nothing — a review that never happened must not be paid for.
    //
    // The pair is built from what the adapters *report*, never from the config's
    // optional `provider` label: that field is decoration a config may omit (the
    // committed default omits it on the Claude route), while `getModelInfo`
    // returns the provider the adapter will actually reach.
    const reviewPhase = compiled.phases.find(isReviewPhase);
    if (reviewPhase !== undefined) {
      const buildPhaseId = compiled.reviewBuildPhaseId;
      if (buildPhaseId === null) {
        throw new InvalidReviewInversion("the compiled review workflow has no build-producing agent phase");
      }
      const workerProvider = routes.get(buildPhaseId)!.model.provider;
      const configured = routes.get(reviewPhase.id)!.model.provider;
      if (options.config.routing.review === "same-provider-degraded") {
        if (configured !== workerProvider) {
          throw new InvalidReviewInversion(
            `explicit same-provider-degraded mode requires reviewer and builder on ${JSON.stringify(workerProvider)}; ` +
              `the configured reviewer route resolves to ${JSON.stringify(configured)}`,
          );
        }
        inversion = {
          mode: "same-provider-degraded",
          workerProvider,
          reviewProvider: configured,
          reviewPhaseId: reviewPhase.id,
        };
      } else {
        const pair = providerPairFrom([...routes.values()].map((route) => route.model.provider));
        const required = oppositeProvider(workerProvider, pair);
        if (configured !== required) {
          throw new InvalidReviewInversion(
            `worker runs on ${JSON.stringify(workerProvider)}, so the review must run on ${JSON.stringify(required)}; ` +
              `the configured reviewer route resolves to ${JSON.stringify(configured)}`,
          );
        }
        inversion = { mode: "invert-provider", workerProvider, reviewProvider: required, pair, reviewPhaseId: reviewPhase.id };
      }
    }
  } catch (error) {
    const now = infra.now();
    const reason = closestBlocker(error);
    const decision = transition({
      from: "PREPARED", to: "BLOCKED", actor: "host", tier: status.tier,
      reason: { source: "process", code: reason.code, detail: reason.detail }, interactive: false,
      budget: status.budget,
    });
    status = await persistAttempt(options.attemptDir, status.revision, {
      kind: "attempt.transitioned",
      evidence: { type: "transition", id: `${status.sessionId}:${status.revision + 1}`, seq: status.revision + 1, from: "PREPARED", to: "BLOCKED", actor: "host", edgeId: decision.edge, reasonSource: "process", reasonCode: reason.code, reasonDetail: reason.detail, spawnSite: false, at: now },
      next: nextRevision(status, { lifecycleState: "BLOCKED", blocker: { code: reason.code, detail: reason.detail, ahead: null, behind: null }, lastActivityAt: now, lastActivity: reason.detail, nextAction: nextActionFor("BLOCKED", status.taskId) }),
    }, options.projectRecord);
    return status;
  }

  const budget = new CallBudget({
    taskId: status.taskId,
    tier: status.tier,
    allowance: status.budget.allowance,
    // The attempt's own ceiling, including any owner grant. The ledger must
    // measure against exactly what the machine decided against.
    ...(status.budget.ceiling === undefined ? {} : { ceiling: status.budget.ceiling }),
    carried: { attempt: status.attempt, callsSpent: status.budget.callsSpent },
  });
  budget.admitWorkflow(compiled);
  const createdAt = infra.now();
  const phaseRecords = new Map<string, PhaseEvidenceRecord>();
  const launches = new Map<string, LaunchRecord>();
  let transitionSeq = 0;

  let writeQueue: Promise<void> = Promise.resolve();
  const persist = async (kind: AttemptEvent["kind"], update: Partial<AttemptStatus>, evidence?: AttemptEvidence): Promise<void> => {
    const operation = writeQueue.then(async () => {
      const next = nextRevision(status, update);
      status = await persistAttempt(options.attemptDir, status.revision, {
        kind,
        next,
        ...(evidence === undefined ? {} : { evidence }),
      }, options.projectRecord);
    });
    writeQueue = operation.catch(() => undefined);
    await operation;
  };

  const persistTransition = async (from: TaskState, to: TaskState, edgeId: EdgeId, source: string, code: string | null, detail: string | null, spawnSite: boolean, update: Partial<AttemptStatus>): Promise<void> => {
    const at = infra.now();
    transitionSeq += 1;
    await persist("attempt.transitioned", { lifecycleState: to, lastActivityAt: at, nextAction: nextActionFor(to, status.taskId), ...update }, {
      type: "transition", id: `${status.sessionId}:transition:${transitionSeq}`, seq: transitionSeq,
      from, to, actor: "host", edgeId, reasonSource: source, reasonCode: code, reasonDetail: detail,
      spawnSite, at,
    });
  };

  const persistPhase = async (phaseId: string, state: string, error: Error | null = null): Promise<void> => {
    const previous = phaseRecords.get(phaseId)!;
    const at = infra.now();
    const record: PhaseEvidenceRecord = {
      ...previous,
      status: state,
      startedAt: previous.startedAt ?? (state === "RUNNING" ? at : null),
      endedAt: ["SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"].includes(state) ? at : null,
      errorCode: error?.name ?? null,
      errorMessage: error?.message ?? null,
    };
    phaseRecords.set(phaseId, record);
    await persist("attempt.updated", {
      phase: { name: record.name, state, round: record.correctionCount, maximumRounds: record.maxCorrections },
      lastActivityAt: at,
      lastActivity: `${record.key} is ${state}`,
    }, { type: "phase", phase: record });
  };

  for (const [index, phase] of compiled.phases.entries()) {
    const record: PhaseEvidenceRecord = {
      phaseId: dbPhaseId(status.sessionId, phase.id), ordinal: index + 1, key: phase.id, name: phase.id,
      kind: phase.kind,
      owner: phase.owner,
      description: isReviewPhase(phase) && options.config.routing.review === "same-provider-degraded"
        ? `${phase.description}; EXPLICIT DEGRADED SAME-PROVIDER MODE (reduced review independence)`
        : phase.description,
      status: "QUEUED",
      correctionCount: 0, maxCorrections: phase.maxCorrections, errorCode: null, errorMessage: null,
      startedAt: null, endedAt: null, createdAt,
    };
    phaseRecords.set(phase.id, record);
    await persist("attempt.updated", {}, { type: "phase", phase: record });
  }

  const l4 = budget.authorize({
    from: "PREPARED", to: "RUNNING", actor: "host", reason: { source: "process" }, interactive: false,
    evidence: { workflowCompiled: true }, spawn: { cost: 1 },
  });
  const firstReservation = l4.reservation!;
  await persistTransition("PREPARED", "RUNNING", l4.result.edge, "process", null, "compiled workflow and held first call", true, {
    budget: budget.snapshot(), blocker: null, lastActivity: "L4 durable; first provider call held",
  });

  // The private conversation ledger. Loaded rather than created blind so a
  // resumed host does not mint a second locator for a phase that already has
  // one, and so a `retry` that reuses this attempt directory finds the record
  // it must refuse to reopen.
  const continuity = new ContinuityStore({
    path: continuityFilePath(options.attemptDir),
    ...(infra.now === undefined ? {} : { now: infra.now }),
  });
  await continuity.load();

  /**
   * What the correction verifier is allowed to see. Deliberately the handle,
   * the route and the turn count — never the provider locator, which stays in
   * the store and reaches only argv.
   */
  const conversations = new Map<string, OpenConversation>();
  /** Exactly one agent phase is in flight at a time; the counters are its. */
  let activePhaseId: string | null = null;

  const launchHost = {
    statusFor: (taskSessionId: string) => taskSessionId === status.sessionId
      ? { taskSessionId, lifecycleState: status.lifecycleState, workflowId: status.workflow }
      : null,
    compiledWorkflowFor: (taskSessionId: string) => taskSessionId === status.sessionId ? compiled : null,
    configuredRouteFor: ({ taskSessionId, phaseId }: { taskSessionId: string; phaseId: string }) => {
      const route = routes.get(phaseId);
      return taskSessionId === status.sessionId && route !== undefined
        ? { adapterId: route.adapterId, role: route.agent.name, launchAuthorization: "agent-phase" as const }
        : null;
    },
  };
  const verifier = createCompiledPhaseLaunchVerifier(launchHost);
  const correctionVerifier = createCorrectionLaunchVerifier({
    ...launchHost,
    conversationFor: ({ taskSessionId, phaseId }) => taskSessionId === status.sessionId
      ? conversations.get(phaseId) ?? null
      : null,
    correctionStateFor: ({ taskSessionId, phaseId }): CorrectionAllowanceState | null => {
      if (taskSessionId !== status.sessionId || phaseId !== activePhaseId) return null;
      const snapshot = budget.snapshot();
      // The per-phase pair only. A correction launch is an intra-phase remedy;
      // the attempt-scoped owner re-entry allowance is a lifecycle allowance
      // and is not something a phase may spend.
      return {
        used: { auto: snapshot.correctionsAuto, owner: snapshot.correctionsOwner },
        allowance: { auto: snapshot.allowance.auto, owner: snapshot.allowance.owner },
      };
    },
  });

  /**
   * The one place the provider locator would otherwise escape.
   *
   * It reaches the child on argv, which is the protocol working as designed, and
   * the barrier records that argv verbatim into `processes.command_json`. So a
   * feature that succeeded would publish the locator to the journal, the SQLite
   * projection, and the dashboard — the exact opposite of what
   * `private/continuity.json` at mode 0600 is for.
   *
   * Exact-match replacement rather than a pattern: the host MINTED these
   * strings, so it can name them precisely instead of guessing at what a session
   * id looks like on a route it has not met yet.
   */
  const REDACTED_LOCATOR = "[continuity-ref]";
  const redactLocators = (record: BarrierRecord): BarrierRecord => {
    const locators = new Set(continuity.locators());
    if (locators.size === 0) return record;
    return { ...record, command: record.command.map((argument) => locators.has(argument) ? REDACTED_LOCATOR : argument) };
  };

  const broker = infra.createBroker({
    ledger: budget,
    phaseLaunchVerifier: verifier,
    correctionLaunchVerifier: correctionVerifier,
    onCorrection: async (record, evidence) => {
      const launch = launches.get(record.runId)!;
      launch.releasedAt = infra.now();
      // The budget snapshot is recorded beside a launch that did NOT move it.
      // That is the point: a reader comparing this row with the `onSpent` row
      // above sees one class of launch that charged a call and one that charged
      // tokens, rather than having to infer which from the absence of a row.
      await persist("attempt.updated", { budget: budget.snapshot(), lastActivityAt: launch.releasedAt, lastActivity: `correction round ${String(evidence.correctionRound)} resumed ${evidence.continuityHandle} on the ${evidence.tranche} tranche; no call reserved` }, {
        type: "process", phaseId: launch.phaseId, adapterId: launch.adapterId, role: launch.role,
        record: redactLocators(record), status: "RUNNING", registeredAt: launch.registeredAt, releasedAt: launch.releasedAt,
        endedAt: null, exitCode: null, exitSignal: null,
      });
    },
    register: async (record) => {
      const launch = launches.get(record.runId);
      if (launch === undefined) throw new Error(`unregistered host launch ${record.runId}`);
      launch.record = record;
      await persist("attempt.updated", { process: record.identity, budget: budget.snapshot(), lastActivityAt: infra.now(), lastActivity: `process ${record.runId} registered before GO` }, {
        type: "process", phaseId: launch.phaseId, adapterId: launch.adapterId, role: launch.role,
        record: redactLocators(record), status: "REGISTERED", registeredAt: launch.registeredAt, releasedAt: null,
        endedAt: null, exitCode: null, exitSignal: null,
      });
      options.assertLaunchProjection?.(status.sessionId);
    },
    onSpent: async (record, _reservation) => {
      const launch = launches.get(record.runId)!;
      launch.releasedAt = infra.now();
      await persist("attempt.updated", { budget: budget.snapshot(), lastActivityAt: launch.releasedAt, lastActivity: `call ${record.reservationId} spent immediately before GO` }, {
        type: "process", phaseId: launch.phaseId, adapterId: launch.adapterId, role: launch.role,
        record: redactLocators(record), status: "RUNNING", registeredAt: launch.registeredAt, releasedAt: launch.releasedAt,
        endedAt: null, exitCode: null, exitSignal: null,
      });
    },
  } as BrokerOptions);

  const persistEnvelope = async (phaseId: string, runId: string, envelope: StoredEnvelope<EnvelopeBase>, rawOutput: string): Promise<void> => {
    const rawRelative = join("raw", `${runId}.txt`);
    const rawAbsolute = join(options.attemptDir, rawRelative);
    await mkdir(dirname(rawAbsolute), { recursive: true });
    await writeFile(rawAbsolute, rawOutput, { mode: 0o600 });
    await chmod(rawAbsolute, 0o600);
    const stored = { ...envelope, rawOutputPath: rawRelative };
    const envelopePath = join(options.attemptDir, "envelopes", `${phaseId}-${envelope.correctionRound}.json`);
    await mkdir(dirname(envelopePath), { recursive: true });
    if (existsSync(envelopePath)) throw new Error(`immutable envelope already exists: ${envelopePath}`);
    await writeFile(envelopePath, JSON.stringify(stored), { mode: 0o600 });
    await persist("attempt.updated", {}, { type: "envelope", phaseId: dbPhaseId(status.sessionId, phaseId), envelope: stored });
  };

  const persistGate = async (phaseId: string, report: GateReport, candidateSha: string | null, round = 0, exitCode: number | null = null, outputPath: string | null = null): Promise<void> => {
    const at = infra.now();
    await persist("attempt.updated", {}, {
      type: "gate", id: `${dbPhaseId(status.sessionId, phaseId)}:${round}:${report.gateId}`,
      phaseId: dbPhaseId(status.sessionId, phaseId), round, gateId: report.gateId,
      kind: gateKind(report.gateId), candidateSha, passed: report.passed, exitCode,
      checks: report.checks, violations: report.checks.filter((check) => !check.ok).map((check) => `${check.item}: ${check.note}`),
      outputPath, startedAt: at, endedAt: at,
    });
  };

  interface CandidateMeasurement {
    readonly testOutput: TestOutput;
    readonly hygiene: GateReport;
    readonly aggregate: GateReport;
    readonly failures: readonly CorrectionCommandFailure[];
  }

  /**
   * What was measured, keyed by the exact SHA it was measured against.
   *
   * Keyed by SHA rather than by phase so the `tests` phase can only reuse a
   * measurement of the candidate it is actually gating. A measurement of a
   * superseded candidate is retained as evidence and can never be mistaken for
   * a verdict on the current one.
   */
  const candidateMeasurements = new Map<string, CandidateMeasurement>();

  /**
   * Everything the host measures against one exact candidate commit: hygiene,
   * then each configured command, with the tree proved clean and pinned to that
   * SHA on both sides of every command.
   *
   * Extracted from the `tests` phase, which used to be its only caller, because
   * a correctable candidate needs the same measurement one stage earlier — at
   * the moment the builder's conversation is still open. The `tests` phase now
   * records what this produced rather than running the suite a second time
   * against the same SHA, which would spend the wall clock twice to learn the
   * same thing and could disagree with itself.
   */
  const measureCandidate = async (phaseId: string, candidateSha: string, round: number): Promise<CandidateMeasurement> => {
    const gitRunner = systemGitRunner(status.worktree!);
    const observedBase = runGit(gitRunner, ["rev-parse", status.baseSha!]).trim();
    const headBeforeHygiene = runGit(gitRunner, ["rev-parse", "HEAD"]).trim();
    const cleanBeforeHygiene = runGit(gitRunner, ["status", "--porcelain"]).trim().length === 0;
    const hygieneResult = gitRunner(["diff", "--check", `${status.baseSha!}..${candidateSha}`, "--"]);
    const headAfterHygiene = runGit(gitRunner, ["rev-parse", "HEAD"]).trim();
    const cleanAfterHygiene = runGit(gitRunner, ["status", "--porcelain"]).trim().length === 0;
    const hygiene = candidateHygiene({
      expectedBaseSha: status.baseSha!, observedBaseSha: observedBase,
      expectedCandidateSha: candidateSha, headBefore: headBeforeHygiene, headAfter: headAfterHygiene,
      cleanBefore: cleanBeforeHygiene, cleanAfter: cleanAfterHygiene,
      exitCode: hygieneResult.status ?? -1,
      output: `${hygieneResult.stdout}${hygieneResult.stderr}${hygieneResult.error === null ? "" : `\n${hygieneResult.error}`}`,
    });
    await persistGate(phaseId, hygiene, candidateSha, round, hygieneResult.status ?? -1);
    if (!hygiene.passed) {
      const aggregate = new GateReport("commands_pass");
      aggregate.check("candidate hygiene", false, "the configured commands were not run against an unclean candidate");
      return {
        testOutput: {
          schema: "awsf.test-output/v1", producerStatus: "failure",
          summary: "candidate hygiene failed", artifacts: [], notesForNextPhase: "inspect the candidate",
          passed: false, candidateSha, commands: [], failures: ["candidate_hygiene failed"], outputTail: "",
        },
        hygiene, aggregate, failures: [],
      };
    }

    assertClean(status.worktree!, "before");
    const observedHead = runGit(gitRunner, ["rev-parse", "HEAD"]).trim();
    if (observedHead !== candidateSha) throw new Error(`candidate moved before commands: ${observedHead} != ${candidateSha}`);
    const commands: TestOutput["commands"] = [];
    const failures: string[] = [];
    const commandFailures: CorrectionCommandFailure[] = [];
    const renderedSections: string[] = [];
    for (const [gateId, configured] of Object.entries(options.config.gates)) {
      const started = Date.now();
      const [executable, ...argv] = configured.argv;
      const result = infra.runCommand(executable!, argv, {
        timeoutMs: configured.timeout_seconds * 1_000,
        cwd: status.worktree!,
        maxBuffer: options.config.runtime.max_output_bytes,
      });
      // The COMPLETE output is retained privately, mode 0600. Retaining only the
      // bounded rendering is exactly the defect pilot 2 hit: the one segment
      // needed to fix the failure had already been discarded before anything
      // asked for it.
      const output = `${result.stdout}${result.stderr}${result.error === null ? "" : `\n${result.error}`}`;
      const outputRelative = join("raw", `command-${phaseId}-${gateId}-${String(round)}.txt`);
      const outputAbsolute = join(options.attemptDir, outputRelative);
      await mkdir(dirname(outputAbsolute), { recursive: true });
      await writeFile(outputAbsolute, output, { mode: 0o600 });
      await chmod(outputAbsolute, 0o600);
      const exitCode = result.status ?? -1;
      commands.push({ gateId, argv: [...configured.argv], exitCode, durationMs: Date.now() - started, outputRef: outputRelative });
      const bounded = boundCommandOutput(output);
      const rendered = renderCommandEvidence(bounded);
      renderedSections.push(`### ${gateId} (exit ${String(exitCode)})\n${rendered}`);
      if (exitCode !== 0) {
        failures.push(`${gateId} exited ${exitCode}`);
        commandFailures.push({ gateId, argv: [...configured.argv], exitCode, evidence: rendered });
      }
      assertClean(status.worktree!, "after");
      const afterHead = runGit(systemGitRunner(status.worktree!), ["rev-parse", "HEAD"]).trim();
      if (afterHead !== candidateSha) throw new Error(`candidate moved during ${gateId}`);
    }
    const testOutput: TestOutput = {
      schema: "awsf.test-output/v1", producerStatus: failures.length === 0 ? "success" : "failure",
      summary: failures.length === 0 ? "all configured commands passed" : "configured commands failed",
      artifacts: [], notesForNextPhase: failures.length === 0 ? "await owner" : "inspect command evidence",
      passed: failures.length === 0, candidateSha, commands, failures,
      outputTail: safeTail(renderedSections.join("\n\n"), TEST_OUTPUT_TAIL_MAX_CHARS),
    };
    const aggregate = new GateReport("commands_pass");
    for (const [gateId, configured] of Object.entries(options.config.gates)) {
      const report = commandsPass(testOutput, { gateId, argv: configured.argv }, { candidateSha, cleanBefore: true, cleanAfter: true });
      reportWith(aggregate, report.checks.map((check) => ({ ...check, item: `${gateId}:${check.item}` })));
    }
    if (Object.keys(options.config.gates).length === 0) aggregate.check("configured commands", true, "no commands configured");
    await persistGate(phaseId, aggregate, candidateSha, round, failures.length === 0 ? 0 : -1);
    return { testOutput, hygiene, aggregate, failures: Object.freeze(commandFailures) };
  };

  /**
   * A phase launched inside RUNNING registers against the compiled workflow; a
   * phase that IS a lifecycle spawn site registers against its edge. The review
   * is the second kind — it is the L11 spawn out of GATING, and the phase-launch
   * verifier correctly refuses an agent-phase registration from any state but
   * RUNNING.
   */
  const registrationFor = (phase: CompiledAgentPhase, ordinal: number, route: Route, reservation: Reservation, runId: string, first: boolean, review: boolean): BrokerProcessRegistration => {
    if (first) {
      return { runId, sessionId: status.sessionId, from: "PREPARED", to: "RUNNING", edge: "L4", reservationId: reservation.id, adapterId: route.adapterId, role: route.agent.name } satisfies ProcessRegistration;
    }
    if (review) {
      return { runId, sessionId: status.sessionId, from: "GATING", to: "REVIEWING", edge: "L11", reservationId: reservation.id, adapterId: route.adapterId, role: route.agent.name } satisfies ProcessRegistration;
    }
    return { kind: "agent-phase", runId, taskSessionId: status.sessionId, workflowId: compiled.id, phaseId: phase.id, phaseOrdinal: ordinal, reservationId: reservation.id, adapterId: route.adapterId, role: route.agent.name } satisfies AgentPhaseProcessRegistration;
  };

  /**
   * The registration for a turn that costs tokens rather than a call.
   *
   * It carries the phase's ORIGIN reservation — the one the first turn already
   * spent — so the durable process row still names the call this correction
   * hangs off, and so the broker can prove that call was real before it agrees
   * to launch anything for free.
   */
  const correctionRegistrationFor = (
    phase: CompiledAgentPhase,
    ordinal: number,
    route: Route,
    originReservation: Reservation,
    runId: string,
    round: number,
    tranche: "auto" | "owner",
  ): PhaseCorrectionProcessRegistration => ({
    kind: "phase-correction",
    runId,
    taskSessionId: status.sessionId,
    workflowId: compiled.id,
    phaseId: phase.id,
    phaseOrdinal: ordinal,
    correctionRound: round,
    tranche,
    originReservationId: originReservation.id,
    adapterId: route.adapterId,
    role: route.agent.name,
    continuityHandle: continuityHandle(phase.id),
  });

  const runAgent = async (
    phase: CompiledAgentPhase,
    ordinal: number,
    previous: EnvelopeBase | null,
    reservation: Reservation,
    first: boolean,
    reviewContext: ReviewPhaseSubject | null,
    attempt = 1,
  ): Promise<{ envelope: EnvelopeBase; candidateSha: string | null }> => {
    const route = routes.get(phase.id)!;
    // Three things run as non-review agents on `simple-sdlc` and only one of
    // them is the side the review is inverted against. The build producer is
    // structural — the agent phase carrying the build-output schema, which is
    // the same rule `reviewBuildPhaseId` applies — so it is read off the phase
    // rather than off a role name.
    const purpose: AgentPurpose = reviewContext !== null
      ? "review"
      : phase.schemaId === BUILD_OUTPUT_SCHEMA_ID ? "build" : "support";
    // A cold correction is a paid provider call. Preserve enough headroom for
    // every later agent phase before exposing one here, so fixing an envelope
    // can never consume the mandatory review's call or strand the workflow at
    // a later ordinary phase.
    const futureInitialCalls = compiled.phases
      .slice(ordinal)
      .filter((candidate) => candidate.kind === "agent")
      .length;
    const coldCorrectionHeadroom = (): number => Math.max(0, budget.remaining - futureInitialCalls);
    const routeMaximumCorrections = route.continuity
      ? phase.maxCorrections
      : Math.min(phase.maxCorrections, coldCorrectionHeadroom());
    const configuredRecord = phaseRecords.get(phase.id)!;
    phaseRecords.set(phase.id, { ...configuredRecord, maxCorrections: routeMaximumCorrections });
    // A retried review is a distinct process and a distinct spent call, so it
    // needs its own run id; reusing one would collide with the retained raw
    // output and envelope of the attempt that failed.
    const runId = `${status.sessionId}:${phase.id}:run${attempt === 1 ? "" : `-${attempt}`}`;
    const phaseDb = dbPhaseId(status.sessionId, phase.id);
    const registeredAt = infra.now();
    const launch: LaunchRecord = { phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name, registeredAt };
    launches.set(runId, launch);
    // A correction turn is its own process with its own registration, so it
    // needs its own run id: reusing one would collide with the retained raw
    // output of the turn it is correcting, and the `processes` table's
    // `UNIQUE (session_id, run_id)` would refuse the second row outright.
    const runIdFor = (turn: number): string => turn === 0 ? runId : `${runId}:c${String(turn)}`;
    const runtimeDir = join(options.attemptDir, "private", phase.id);
    await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    const systemPromptPath = await infra.writeSystemPrompt(route.systemPrompt, runtimeDir);
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
    // Re-armed after every candidate commit, because both objects measure "what
    // changed since I opened" and a correction round needs that measured from
    // the candidate it is correcting rather than from the seeded worktree. The
    // CUMULATIVE view — writes globs, protected paths, the declared diff — is a
    // separate check, taken from the attempt base by `phaseGates`.
    let permission = openPermission();
    const openHostGit = (): HostPhaseGit<EnvelopeBase> => createHostPhaseGit<EnvelopeBase>({
      repository: status.worktree!,
      commitMessage: (envelope) => phase.id === "builder"
        ? (envelope as BuildOutput).proposedCommitMessage
        : `chore: record ${phase.id} output`,
    });
    let hostGit = openHostGit();
    const baseRenderedPrompt = renderProductionAgentPrompt(
      phase,
      previous,
      designContext,
      status.request,
    );
    const renderedPrompt = phase.id === "documenter"
      ? `${baseRenderedPrompt}\n\nExact repository write boundary: ${route.agent.writes.length === 0 ? "none" : route.agent.writes.join(", ")}\n` +
        "The logical run-report boundary is reports/<lowercase-kebab-name>.md. Return its path and Markdown in runReport; the host writes it outside the repository and beside the sealed attempt.\n"
      : baseRenderedPrompt;
    for (const [name, text] of [["system", route.systemPrompt], ["user", renderedPrompt]] as const) {
      await persist("attempt.updated", {}, {
        type: "compiled-prompt", phaseId: phaseDb, name, text,
        ...(name === "system" ? route.evidence : {}),
        lineCount: text.split(/\r?\n/).length, at: infra.now(),
      });
    }
    const gatedPhase = {
      ...phase,
      // The engine renders once more at launch. Pin it to the exact prompt
      // persisted above, including architecture review's repository envelope.
      renderPrompt: () => renderedPrompt,
      gates: [
        ...phase.gates,
        ...phaseGates(
          phase.id,
          permission.profile.writes,
          status.worktree!,
          status.baseSha!,
          options.config,
          reviewContext,
          () => changedPaths(permission.before, captureChangeSet(status.worktree!)),
          // The exact text persisted as this phase's compiled user prompt above.
          // `review_evidence_present` asks whether the evidence reached the model,
          // and this is what reached it.
          renderedPrompt,
          status.tier,
          recipe.phases.some((candidate) => candidate.kind === "agent" && candidate.owner === "builder"),
        ),
      ],
    };
    let phaseQueue = Promise.resolve();
    const onPhaseState = (next: PhaseState): void => {
      phaseQueue = phaseQueue.then(() => persistPhase(phase.id, next));
    };
    const realRegistration = registrationFor(phase, ordinal, route, reservation, runId, first, reviewContext !== null);
    const handle = continuityHandle(phase.id);
    // The conversation is opened before the first turn so the locator exists,
    // is private, and is durable before any process can be told about it. A
    // route configured `continuity: none` opens nothing and keeps the ephemeral
    // argv it always had.
    const conversationRef = route.continuity
      ? (await continuity.open({
          phaseId: phase.id,
          adapter: route.adapter.id,
          provider: route.model.provider,
          model: route.model.requestedModel,
          storeDir: (route.adapter as ContinuityCapableAdapter).continuityStoreDir(runtimeDir),
        }), continuity.ref(handle))
      : null;
    if (conversationRef?.storeDir != null) await mkdir(conversationRef.storeDir, { recursive: true, mode: 0o700 });
    if (route.continuity) {
      conversations.set(phase.id, {
        handle,
        adapterId: route.adapterId,
        role: route.agent.name,
        turns: 0,
        verifiedContinuity: "same-session-correction",
      });
    }
    /**
     * The deterministic gate, moved inside the phase that can still act on it.
     *
     * Only the phase that produces the candidate gets one, and only when its
     * route can actually be re-entered. A reviewer never verifies a candidate —
     * it did not build one — and a route with no correction transport gets the
     * pre-continuity behaviour: the commit stands, the `tests` phase measures
     * it, and a red suite blocks on L8 exactly as it did before.
     */
    const verifyCandidate = phase.id === "builder" && reviewContext === null && route.continuity
      ? async ({ candidateSha, correctionRound }: { candidateSha: string; correctionRound: number }): Promise<CandidateVerification> => {
          const measured = await measureCandidate(phase.id, candidateSha, correctionRound);
          const passed = measured.hygiene.passed && measured.aggregate.passed && measured.failures.length === 0;
          // The next round measures from THIS candidate, so both round-scoped
          // observers are re-armed against the tree as it now stands.
          permission = openPermission();
          hostGit = openHostGit();
          candidateMeasurements.set(candidateSha, measured);
          await persist("attempt.updated", {
            candidateSha,
            lastActivityAt: infra.now(),
            lastActivity: passed
              ? `host gates passed against exact candidate ${candidateSha}`
              : `host gates failed against exact candidate ${candidateSha}; ${String(measured.failures.length)} configured command(s) red`,
          });
          return {
            passed,
            reports: [measured.hygiene, measured.aggregate],
            evidence: passed ? null : {
              candidateSha,
              baseSha: status.baseSha!,
              commands: measured.failures,
            } satisfies CorrectionCandidateEvidence,
          };
        }
      : null;

    let turnIndex = 0;
    /** What the FIRST turn's stream said. Every later turn is compared to it. */
    let firstObserved: ObservedProviderSession | null = null;
    const session: CorrectionSession = {
      identity: {
        adapter: route.adapter.id,
        provider: route.model.provider,
        model: route.model.requestedModel,
        // The HOST handle, never the provider locator. See
        // `execution/continuity-store.ts` for why the two are kept apart: this
        // string reaches error messages, and error messages reach `status.json`.
        sessionId: route.continuity ? handle : `none:${runId}`,
      },
      send: async (prompt): Promise<AgentTurn> => {
        const turn = turnIndex;
        turnIndex += 1;
        await phaseQueue;
        const turnRunId = runIdFor(turn);
        const turnLaunch = turn === 0
          ? launch
          : { phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name, registeredAt: infra.now() };
        launches.set(turnRunId, turnLaunch);
        let registration: BrokerProcessRegistration = realRegistration;
        if (turn > 0 && route.continuity) {
          // A call-neutral correction proves it can resume before launch. The
          // private store and adapter both bind it to the original conversation.
          const record = continuity.assertCorrectable(handle, {
            adapter: route.adapter.id,
            provider: route.model.provider,
            model: route.model.requestedModel,
          });
          const evidence = (route.adapter as ContinuityCapableAdapter).assertResumable(
            { providerSessionId: record.providerSessionId, storeDir: record.storeDir },
            { cwd: status.worktree! },
          );
          const snapshot = budget.snapshot();
          const tranche: "auto" | "owner" = snapshot.correctionsAuto > 0 ? "auto" : "owner";
          registration = correctionRegistrationFor(phase, ordinal, route, reservation, turnRunId, turn, tranche);
          await persist("attempt.updated", { lastActivityAt: infra.now(), lastActivity: `${phase.id}: resuming ${handle} for correction round ${String(turn)} (${evidence.proof})` });
        } else if (turn > 0) {
          // No conversation exists to resume. This is an ordinary, fully paid
          // provider launch on the exact preflighted route, bounded by both the
          // phase allowance and the task call ceiling.
          const held = budget.reserve({ cost: 1, subject: `${compiled.id}:${phase.id}:cold-correction-${String(turn)}` });
          await persist("attempt.updated", {
            budget: budget.snapshot(),
            lastActivityAt: infra.now(),
            lastActivity: `held one call for ${phase.id} cold correction round ${String(turn)}`,
          });
          registration = registrationFor(
            phase,
            ordinal,
            route,
            held,
            turnRunId,
            false,
            reviewContext !== null,
          );
        }
        const controller = new HOST.AbortController();
        let idle: unknown | null = null;
        const arm = (): void => {
          if (idle !== null) HOST.clearTimeout(idle);
          idle = HOST.setTimeout(() => {
            controller.abort(new Error("configured silence timeout elapsed"));
            void turnLaunch.transport?.cancel("configured silence timeout elapsed");
          }, options.config.runtime.silence_timeout_seconds * 1_000);
          (idle as { unref?: () => void }).unref?.();
        };
        const sandboxingBroker: TransportBroker = {
          startProcess: async (registered, spec, signal) => {
            const grant = permission.sandbox(spec);
            const launchAt = infra.now();
            await persist("attempt.updated", { lastActivityAt: launchAt, lastActivity: `${phase.id}: route and sandbox grant recorded before GO` }, {
              type: "agent-start", phaseId: phaseDb, agent: route.agent.name, adapterId: route.adapterId,
              provider: route.model.provider, color: route.agent.color, requestedModel: route.agent.model,
              sandboxBadge: grant.badge, sandboxMechanism: grant.mechanism, purpose,
              route: route.provenance, at: launchAt,
            });
            const transport = await broker.startProcess(registered, grant.spec, signal);
            turnLaunch.transport = transport;
            return transport;
          },
        };
        const request: ModelRequest = {
          model: route.agent.model, prompt, systemPromptPath, cwd: status.worktree!,
          env: HOST.process.env, effort: route.agent.thinking,
          profile: route.agent.tools.profile, tools: route.agent.tools.allow,
          ...(conversationRef === null ? {} : {
            continuity: { ref: conversationRef, turn: turn === 0 ? "open" as const : "resume" as const },
          }),
        };
        const events: NormalizedEvent[] = [];
        let output = "";
        let resolved: { model: string; provenance: ModelResolutionProvenance } | null = null;
        let terminal: NormalizedEvent | null = null;
        const observed: ObservedProviderSession = { sessionId: null, resolvedModel: null, costUsd: null };
        arm();
        try {
          for await (const event of route.adapter.execute(request, sandboxingBroker, registration, controller.signal, observed)) {
            arm();
            assertObservedRoute(event, route);
            events.push(event);
            if (event.kind === "text.delta") output += event.text;
            if (event.kind === "model.resolved") resolved = { model: event.resolvedModel, provenance: event.provenance };
            if (["run.completed", "run.failed", "run.cancelled"].includes(event.kind)) terminal = event;
            if (isPersistableKind(event.kind)) {
              await persist("attempt.updated", { lastActivityAt: event.hostAt, lastActivity: `${phase.id}: ${event.kind}` }, {
                type: "normalized-event", phaseId: phaseDb, event,
              });
            }
          }
        } catch (error) {
          await turnLaunch.transport?.cancel("canonical provider-event persistence or transport failed").catch(() => undefined);
          throw error;
        } finally {
          if (idle !== null) HOST.clearTimeout(idle);
        }
        const endedAt = infra.now();
        const exitCode = terminal?.kind === "run.completed" ? terminal.exitCode : null;
        if (turnLaunch.record !== undefined) {
          await persist("attempt.updated", { process: null, lastActivityAt: endedAt }, {
            type: "process", phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name,
            record: redactLocators(turnLaunch.record), status: terminal?.kind === "run.completed" && exitCode === 0 ? "EXITED" : "FAILED",
            registeredAt: turnLaunch.registeredAt,
            releasedAt: turnLaunch.releasedAt ?? turnLaunch.registeredAt,
            endedAt, exitCode, exitSignal: null,
          });
        }
        if (terminal?.kind === "run.failed") throw new AdapterError(route.adapter.id, terminal.errorCode, terminal.message);
        if (terminal?.kind === "run.cancelled") throw new AdapterError(route.adapter.id, "E_CANCELLED", terminal.reason);
        if (terminal?.kind !== "run.completed") throw new AdapterError(route.adapter.id, "E_TERMINAL_MISSING", "adapter event stream ended without a terminal");
        if (terminal.exitCode !== 0) throw new AdapterError(route.adapter.id, "E_BACKEND_FAILURE", `provider exited ${String(terminal.exitCode)}`);
        if (resolved === null) throw new AdapterError(route.adapter.id, "E_MODEL_UNRESOLVED", "adapter emitted no resolved model evidence");
        // The stream's own account of which conversation answered, checked
        // against the host's. Turn 0 proves the provider honoured the locator it
        // was handed rather than minting its own; every later turn proves the
        // correction re-entered that same conversation on that same model. Both
        // are terminal, and neither reaches a public projection: what the error
        // names is the handle, not the locator.
        if (route.continuity) {
          const capable = route.adapter as ContinuityCapableAdapter;
          if (turn === 0) {
            if (observed.sessionId === null) {
              throw new AdapterError(
                route.adapter.id,
                "E_BACKEND_FAILURE",
                `${handle} did not report which provider session answered; continuity requires exact stream identity`,
              );
            }
            if (observed.sessionId !== conversationRef!.providerSessionId) {
              throw new AdapterError(
                route.adapter.id,
                "E_BACKEND_FAILURE",
                `${handle} answered in a conversation the host did not open; the provider did not honour the session it was given`,
              );
            }
            firstObserved = { ...observed };
          } else {
            capable.assertSameSession(firstObserved!, observed);
          }
          await continuity.recordTurn(handle);
          const conversation = conversations.get(phase.id)!;
          conversations.set(phase.id, { ...conversation, turns: conversation.turns + 1 });
        }
        const usage = events.some((event) => event.kind === "usage") ? sumUsage(events) : UNREPORTED_TOKEN_USAGE;
        await persist("attempt.updated", { model: { resolved: resolved.model, provenance: resolved.provenance }, lastActivityAt: endedAt }, {
          type: "agent", phaseId: phaseDb, agent: route.agent.name, adapterId: route.adapterId,
          provider: route.model.provider, color: route.agent.color, requestedModel: route.agent.model,
          resolvedModel: resolved.model, modelProvenance: resolved.provenance, contextWindow: route.model.contextWindow,
          usageAuthority: route.model.usageAuthority, usage, contextTokens: contextTokens(usage), costUsd: null, costAuthority: route.model.costAuthority, purpose, at: endedAt,
        });
        return {
          identity: {
            ...session.identity,
            sessionId: route.continuity ? session.identity.sessionId : `none:${turnRunId}`,
          },
          rawOutput: output,
          usage,
          costUsd: null,
        };
      },
    };
    try {
      activePhaseId = phase.id;
      const result = await runAgentPhase({
        workflowId: compiled.id,
        phase: gatedPhase,
        worktree: status.worktree!,
        previousEnvelope: previous,
        session,
        budget,
        // Both ports read the CURRENT round's objects. The engine re-enforces
        // and re-commits every round, and `verifyCandidate` below re-arms them
        // after each commit.
        permissions: { enforce: () => permission.enforce() },
        hostGit: {
          captureDiff: () => hostGit.captureDiff(),
          commit: (envelope, paths) => hostGit.commit(envelope, paths),
        },
        persistence: { persist: (envelope, raw) => persistEnvelope(phase.id, runIdFor(envelope.correctionRound), envelope, raw) },
        agentSessionId: status.sessionId,
        onPhaseState,
        onGateReport: async (report, round) => {
          if (!report.passed) {
            await persistGate(phase.id, report, reviewContext?.candidateSha ?? null, round);
          }
        },
        onCorrectionAuthorized: async ({ correctionRound, transport }) => {
          const current = phaseRecords.get(phase.id)!;
          phaseRecords.set(phase.id, { ...current, correctionCount: correctionRound });
          await persist("attempt.updated", {
            budget: budget.snapshot(),
            lastActivityAt: infra.now(),
            lastActivity: `${phase.id}: authorized ${transport} correction round ${String(correctionRound)}`,
          });
        },
        /**
         * `awsf run` draws only the automatic tranche. Same-session routes are
         * token-only. A `continuity: none` route may spend one ordinary provider
         * call only for envelope-form failures, and only when that call fits the
         * task ceiling after every later required phase has retained headroom.
         */
        authorizeCorrection: ({ cause, correctionRound, reports }) => {
          const snapshot = budget.snapshot();
          if (snapshot.correctionsAuto >= snapshot.allowance.auto) {
            return { actor: null, reason: `automatic correction allowance is spent (${String(snapshot.correctionsAuto)}/${String(snapshot.allowance.auto)})` };
          }
          if (correctionRound > phase.maxCorrections) {
            return { actor: null, reason: `round ${String(correctionRound)} exceeds the phase limit ${String(phase.maxCorrections)}` };
          }
          if (route.continuity) return { actor: "host", transport: "same-session" };
          if (cause === "gate-violation" && !isColdEnvelopeCorrection(reports)) {
            const failed = reports.filter((report) => !report.passed).map((report) => report.gateId).join(", ");
            return { actor: null, reason: `cold correction is limited to envelope-form gates; failed gates: ${failed}` };
          }
          const headroom = coldCorrectionHeadroom();
          if (headroom < 1) {
            return {
              actor: null,
              reason: `route continuity is none and a cold correction needs one provider call, but 0 remain after reserving ${String(futureInitialCalls)} later required call(s)`,
            };
          }
          return { actor: "host", transport: "cold" };
        },
        ...(verifyCandidate === null ? {} : { verifyCandidate }),
      });
      await phaseQueue;
      const gatedSha = reviewContext === null ? result.candidateSha : reviewContext.candidateSha;
      for (const report of result.gateReports) {
        await persistGate(phase.id, report, gatedSha, result.correctionRounds);
      }
      if (phase.id === "builder") {
        const report = headAdvanced({ baseSha: status.baseSha!, headSha: result.candidateSha, hostCommitExists: result.candidateSha !== null });
        await persistGate(phase.id, report, result.candidateSha);
        if (!report.passed) throw new PhaseGateFailure(phase.id, [report]);
      }
      if (reviewContext !== null) {
        const review = result.envelope.payload! as ReviewOutput;
        await persist("attempt.updated", { lastActivityAt: infra.now(), lastActivity: `${phase.id}: ${route.model.provider} returned ${review.verdict}` }, {
          type: "review", phaseId: phaseDb, adapterId: route.adapterId, provider: route.model.provider,
          verdict: review.verdict, reviewedSha: review.reviewedSha, findingCount: review.findings.length,
          at: infra.now(),
        });
      }
      return { envelope: result.envelope.payload!, candidateSha: result.candidateSha };
    } catch (error) {
      await phaseQueue;
      let failure = error;
      if (error instanceof PhaseGateFailure) {
        // Failed reports were persisted at the round that produced them. Path
        // gates retain their full evidence, but a real policy breach is the
        // terminal classification and remains non-correctable.
        try { permission.enforce(); } catch (permissionError) { failure = permissionError; }
      }
      // A terminal phase has no correction still available. Pin the displayed
      // maximum to what actually ran so status never claims a dead round remains.
      const failedRecord = phaseRecords.get(phase.id)!;
      phaseRecords.set(phase.id, {
        ...failedRecord,
        maxCorrections: failedRecord.correctionCount,
      });
      await persistPhase(phase.id, "FAILED", failure as Error);
      throw failure;
    }
  };

  const persistHostEnvelope = async (phaseId: string, payload: EnvelopeBase): Promise<void> => {
    const parsed = parseEnvelope(JSON.stringify(payload), payload.schema);
    const envelope = wrapEnvelope({
      envelopeId: `${status.sessionId}:${phaseId}:0`, sessionId: status.sessionId, phaseId,
      correctionRound: 0, agent: "host", schemaId: payload.schema, createdAt: infra.now(),
      rawOutputPath: `raw/host-${phaseId}.txt`,
    }, parsed);
    await persistEnvelope(phaseId, `host-${phaseId}`, envelope, JSON.stringify(payload));
  };

  // Every recipe starts with the owner's request in hand, including a recipe
  // whose first phase is an agent rather than a host `request` phase.
  const seededRequest = requestOutput(status, options.config);
  let previous: EnvelopeBase | null = seededRequest;
  let designContext: DesignContext | null = null;
  let designOutput: DesignOutput | null = null;
  let architectureReviewOutput: ArchitectureReviewOutput | null = null;
  let planContext: PlanContext | null = null;
  let designPlanOutput: DesignPlanOutput | null = null;
  let candidateSha: string | null = null;
  let agentOrdinal = 0;
  let reviewPhase: { readonly phase: CompiledAgentPhase; readonly ordinal: number } | null = null;
  let reviewTransportRetries = 0;
  /**
   * The intent the review is judged against, and the evidence composed from it.
   *
   * `intent` is whichever plan-shaped envelope this recipe produced — the
   * engineer phase's for `build-review`, the planner's for `simple-sdlc`. The
   * request itself always comes from `status.request` rather than from either,
   * because that is the owner's own words and a phase's restatement of them is
   * a summary.
   */
  let intent: PlanOutput | null = seededRequest;
  let lastTestOutput: TestOutput | null = null;
  let reviewEvidence: ReviewContext | null = null;
  let reviewExpectation: ReviewEvidenceExpectation | null = null;

  const quotaRoutesByAdapter = new Map(
    mapConfiguredQuotaRoutes(options.config).map((route) => [route.adapterId, route]),
  );
  const quotaStopFor = (adapterId: string) => {
    const configured = options.config.routing.quota_stop;
    return configured === undefined
      ? null
      : configured.by_adapter?.[adapterId] ?? configured.default;
  };
  const phaseRoute = (phase: (typeof compiled.phases)[number]): Route | null =>
    phase.kind === "agent" ? routes.get(phase.id) ?? null : null;

  /**
   * Records one context reading between two completed/queued phases. The next
   * agent route selects the account window that could stop its launch; when the
   * next phase is host-only, the completed agent route still supplies useful
   * context but can never trigger L26.
   */
  const takePhaseBoundarySnapshot = async (
    completed: (typeof compiled.phases)[number],
    next: (typeof compiled.phases)[number],
  ): Promise<boolean> => {
    const nextRoute = phaseRoute(next);
    const contextRoute = nextRoute ?? phaseRoute(completed);
    const quotaRoute = contextRoute === null
      ? null
      : quotaRoutesByAdapter.get(contextRoute.adapterId) ?? null;
    let effectivePercentRemaining: number | null = null;
    let minutesToReset: number | null = null;
    let reasonCode: string | null = quotaRoute?.reason ?? "boundary-has-no-quota-route";
    let resolvedVersion: string | null = null;

    if (quotaRoute !== null && quotaRoute.providers.length > 0) {
      const threshold = quotaStopFor(quotaRoute.adapterId);
      const boundaryAt = infra.now();
      let reportedFailure: string | null = null;
      const probeResult = await probeQuota({
        runCommand: infra.runCommand,
        resolveExecutable: infra.resolveExecutable,
        routes: configuredQuotaProbeRoutes([quotaRoute]),
        purpose: "phase-boundary",
        timeouts: {
          interactivePreflightMs: DEFAULT_QUOTA_PROBE_TIMEOUTS.interactivePreflightMs,
          phaseBoundaryMs: threshold?.probe_timeout_ms ?? DEFAULT_QUOTA_PROBE_TIMEOUTS.phaseBoundaryMs,
        },
        options: {
          cwd: status.worktree!,
          env: HOST.process.env,
          maxBuffer: options.config.runtime.max_output_bytes,
        },
        now: boundaryAt,
        journalFailure: (failure) => { reportedFailure = failure.reasonCode; },
        retainFailureBytes: retainQuotaFailureInAttempt(
          options.attemptDir,
          `${completed.id}-to-${next.id}`,
        ),
      });
      const row = buildQuotaReadout({
        routes: [quotaRoute],
        probeResult,
        defaultThreshold: options.config.routing.quota_stop?.default ?? null,
        ...(options.config.routing.quota_stop?.by_adapter === undefined
          ? {}
          : { thresholdsByAdapter: options.config.routing.quota_stop.by_adapter }),
      }).rows[0]!;
      effectivePercentRemaining = row.effectivePercentRemaining;
      minutesToReset = row.minutesToReset;
      reasonCode = row.reasonCode ?? reportedFailure;
      resolvedVersion = probeResult.resolvedVersion;
    }

    await persist("attempt.updated", {}, {
      type: "quota-snapshot",
      attribution: "none",
      scope: "account-window",
      completedPhaseKey: completed.id,
      nextPhaseKey: next.id,
      effectivePercentRemaining,
      minutesToReset,
      reasonCode,
      resolvedVersion,
    });

    // A host-only next phase consumes no provider quota. Its snapshot remains
    // context, but there is no route threshold whose crossing could stop it.
    if (nextRoute === null || quotaRoute === null || nextRoute.adapterId !== quotaRoute.adapterId) {
      return false;
    }
    const threshold = quotaStopFor(nextRoute.adapterId);
    const figure = knownMinuteFigure(minutesToReset);
    if (threshold === null || figure === null || !isBelowQuotaStopThreshold(figure, threshold.minutes)) {
      return false;
    }

    const detail = `quota stop for route ${JSON.stringify(nextRoute.adapterId)}: configured threshold ${String(threshold.minutes)} minutes, observed ${String(figure.minutesToReset)} minutes to reset`;
    options.assertAdvancement?.(status.sessionId, "AWAITING_OWNER");
    // L4 may have held the first call before an initial host-only phase. The
    // boundary stop prevents registration, so that never-launched call returns
    // to the ledger before the attempt waits on its owner.
    for (const reservation of budget.outstanding()) {
      budget.releaseOnRegistrationFailure(reservation.id);
    }
    const l26 = budget.authorize({
      from: "RUNNING",
      to: "AWAITING_OWNER",
      actor: "host",
      reason: { source: "process", detail },
      interactive: false,
      evidence: {
        quotaStop: {
          route: nextRoute.adapterId,
          minutesToReset: figure.minutesToReset,
          thresholdMinutes: threshold.minutes,
        },
      },
    });
    await persistTransition(
      "RUNNING",
      "AWAITING_OWNER",
      l26.result.edge,
      "process",
      null,
      detail,
      false,
      {
        budget: budget.snapshot(),
        process: null,
        phase: null,
        blocker: null,
        lastActivity: detail,
      },
    );
    return true;
  };

  const composeReviewEvidence = async (phaseId: string): Promise<ReviewContext> => {
    if (candidateSha === null) throw new Error("review evidence requires a host-created candidate SHA");
    if (lastTestOutput === null) throw new Error("review evidence requires a completed code phase to carry");
    const composed = await composeReviewContext({
      worktree: status.worktree!,
      baseSha: status.baseSha!,
      candidateSha,
      intent: {
        // The owner's own words, never a phase's restatement of them.
        request: status.request,
        goals: intent?.goals ?? [],
        nonGoals: intent?.nonGoals ?? [],
        acceptanceCriteria: (intent?.implementationSteps ?? []).flatMap((step) => step.acceptanceCriteria),
        testStrategy: intent?.testStrategy ?? [],
      },
      testOutput: lastTestOutput,
      // The FULL diff, host-private at 0600. The reviewer is never given a path
      // into the attempt directory — this is the host's copy, and the digest is
      // what ties the bounded rendering the model saw to it.
      diffRef: join("raw", `review-context-${candidateSha}.diff`),
      retainFullDiff: async (relative, diff) => {
        const absolute = join(options.attemptDir, relative);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, diff, { mode: 0o600 });
        await chmod(absolute, 0o600);
        return readFile(absolute, "utf8");
      },
    });
    await persist("attempt.updated", {
      lastActivityAt: infra.now(),
      lastActivity: `${phaseId}: composed ${String(composed.changedFiles.length)}-file review evidence for ${candidateSha}` +
        `${composed.truncated ? ` (bounded; ${String(composed.omittedFiles.length)} file(s) omitted)` : ""}`,
    });
    reviewExpectation = composed.expectation;
    return composed.context;
  };

  try {
    for (const [index, phase] of compiled.phases.entries()) {
      if (index > 0) {
        const completed = compiled.phases[index - 1]!;
        if (phaseRecords.get(completed.id)?.status === "SUCCEEDED") {
          const stopped = await takePhaseBoundarySnapshot(completed, phase);
          if (stopped) return status;
        }
      }
      if (phase.kind === "engineer") {
        await persistPhase(phase.id, "RUNNING");
        const request = requestOutput(status, options.config);
        previous = request;
        intent = request;
        await persistHostEnvelope(phase.id, previous);
        await persistPhase(phase.id, "SUCCEEDED");
        continue;
      }
      if (phase.kind === "agent") {
        // The review is not a RUNNING phase. It is the L11 spawn site out of
        // GATING, so it is deferred until the host gates have actually passed
        // and run below against the exact candidate they cleared.
        if (isReviewPhase(phase)) {
          reviewPhase = { phase, ordinal: index + 1 };
          continue;
        }
        agentOrdinal += 1;
        const reservation = agentOrdinal === 1
          ? firstReservation
          : budget.reserve({ cost: 1, subject: `${compiled.id}:${phase.id}` });
        if (agentOrdinal > 1) {
          await persist("attempt.updated", { budget: budget.snapshot(), lastActivityAt: infra.now(), lastActivity: `held one call for ${phase.id}` });
        }
        const result = await runAgent(phase, index + 1, previous, reservation, agentOrdinal === 1, null);
        previous = result.envelope;
        if (phase.schemaId === "awsf.plan-output/v1") intent = result.envelope as PlanOutput;
        if (phase.schemaId === DESIGN_OUTPUT_SCHEMA_ID) designOutput = result.envelope as DesignOutput;
        if (phase.schemaId === ARCHITECTURE_REVIEW_OUTPUT_SCHEMA_ID) {
          architectureReviewOutput = result.envelope as ArchitectureReviewOutput;
          await persist("attempt.updated", {
            lastActivityAt: infra.now(),
            lastActivity: `${phase.id}: retained ${architectureReviewOutput.verdict} with ${String(architectureReviewOutput.findings.length)} finding(s) in the journalled envelope`,
          });
        }
        if (phase.schemaId === DESIGN_PLAN_OUTPUT_SCHEMA_ID) designPlanOutput = result.envelope as DesignPlanOutput;
        if (result.candidateSha !== null) {
          candidateSha = result.candidateSha;
          await persist("attempt.updated", {
            candidateSha,
            lastActivityAt: infra.now(),
            lastActivity: `host retained exact candidate ${candidateSha}`,
          });
        }
        continue;
      }

      await persistPhase(phase.id, "RUNNING");
      if (phase.schemaId === DESIGN_CONTEXT_SCHEMA_ID) {
        try {
          const composed = await composeProductionDesignContext({
            repository: status.repository,
            stateRoot: options.stateRoot,
            projectSlug: status.project,
            request: status.request,
          });
          designContext = composed.context;
          await persistHostEnvelope(phase.id, designContext);
          const report = designEvidencePresent({
            workflowId: compiled.id,
            phaseId: phase.id,
            worktree: status.worktree!,
            previousEnvelope: previous,
            envelope: designContext,
            correctionRound: 0,
          }, composed.project);
          await persistGate(phase.id, report, null);
          if (!report.passed) throw new PhaseGateFailure(phase.id, [report]);
        } catch (error) {
          await persistPhase(phase.id, "FAILED", error as Error);
          throw error;
        }
        previous = designContext;
        await persistPhase(phase.id, "SUCCEEDED");
        continue;
      }
      if (phase.schemaId === PLAN_CONTEXT_SCHEMA_ID) {
        try {
          if (designOutput === null || architectureReviewOutput === null) {
            throw new Error("plan-context requires the stored design and architecture-review envelopes");
          }
          const composed = composeProductionPlanContext(designOutput, architectureReviewOutput);
          await persistGate(phase.id, composed.report, null);
          if (composed.context === null) throw new PhaseGateFailure(phase.id, [composed.report]);
          planContext = composed.context;
          previous = planContext;
          await persistHostEnvelope(phase.id, planContext);
          await persistPhase(phase.id, "SUCCEEDED");
        } catch (error) {
          await persistPhase(phase.id, "FAILED", error as Error);
          throw error;
        }
        continue;
      }
      if (phase.schemaId === DOCUMENT_OUTPUT_SCHEMA_ID) {
        try {
          if (designPlanOutput === null || planContext === null) {
            throw new Error("plan-render requires the stored design-plan and plan-context envelopes");
          }
          const rendered = await renderProductionPlanIntoWorktree({
            worktree: status.worktree!,
            stem: status.taskId,
            plan: designPlanOutput,
            identifierSet: planContext.identifierSet,
            protectedPaths: options.config.policy.protected_paths,
          });
          previous = rendered.output;
          await persistHostEnvelope(phase.id, rendered.output);
          for (const report of rendered.reports) await persistGate(phase.id, report, rendered.candidateSha);
          if (rendered.candidateSha === null || !rendered.reports.every((report) => report.passed)) {
            throw new PhaseGateFailure(phase.id, rendered.reports);
          }
          candidateSha = rendered.candidateSha;
          await persist("attempt.updated", {
            candidateSha,
            lastActivityAt: infra.now(),
            lastActivity: `${phase.id}: host committed ${String(rendered.output.changedFiles.length)} rendered file(s) as ${candidateSha}`,
          });
          await persistPhase(phase.id, "SUCCEEDED");
        } catch (error) {
          await persistPhase(phase.id, "FAILED", error as Error);
          throw error;
        }
        continue;
      }
      // The evidence phase is a code phase that runs no command: it reads Git
      // and the phases that already ran, and everything it produces is checked
      // for fitness here — BEFORE the review's call is held — so a review that
      // could not have been evidence is never bought.
      if (phase.schemaId === REVIEW_CONTEXT_SCHEMA_ID) {
        try {
          reviewEvidence = await composeReviewEvidence(phase.id);
        } catch (error) {
          await persistPhase(phase.id, "FAILED", error as Error);
          throw error;
        }
        previous = reviewEvidence;
        await persistHostEnvelope(phase.id, reviewEvidence);
        await persistPhase(phase.id, "SUCCEEDED");
        continue;
      }
      if (candidateSha === null) throw new Error("code phase requires a host-created candidate SHA");
      // If the producing phase already measured THIS exact candidate — which it
      // does whenever its route can be corrected — the measurement is recorded
      // rather than repeated. Re-running a twenty-minute suite against a SHA the
      // host already gated would spend the wall clock twice to learn the same
      // thing, and two runs that disagreed would leave nothing to arbitrate.
      const retained = candidateMeasurements.get(candidateSha);
      const measured = retained ?? await measureCandidate(phase.id, candidateSha, 0);
      if (retained !== undefined) {
        await persistGate(phase.id, measured.hygiene, candidateSha, 0, measured.hygiene.passed ? 0 : -1);
        await persistGate(phase.id, measured.aggregate, candidateSha, 0, measured.testOutput.passed ? 0 : -1);
      }
      if (!measured.hygiene.passed) {
        const failure = new PhaseGateFailure(phase.id, [measured.hygiene]);
        await persistPhase(phase.id, "FAILED", failure);
        throw failure;
      }
      const testOutput = measured.testOutput;
      await persistHostEnvelope(phase.id, testOutput);
      if (!measured.aggregate.passed || !testOutput.passed) {
        await persistPhase(phase.id, "FAILED", new CommandPhaseFailure(testOutput));
        throw new CommandPhaseFailure(testOutput);
      }
      previous = testOutput;
      lastTestOutput = testOutput;
      await persistPhase(phase.id, "SUCCEEDED");
    }

    const readOnlySchema = READ_ONLY_RESULT_SCHEMA_BY_WORKFLOW.get(compiled.id);
    const readOnlyResult = readOnlySchema === undefined
      ? null
      : (() => {
          const schema = previous?.schema;
          if (schema !== readOnlySchema) {
            throw new Error(`read-only workflow ${JSON.stringify(compiled.id)} completed with schema ${JSON.stringify(schema)}, expected ${JSON.stringify(readOnlySchema)}`);
          }
          return { schema: readOnlySchema, writesObserved: false } as const;
        })();
    if (candidateSha === null && readOnlyResult === null) {
      throw new Error("workflow completed without a host candidate");
    }
    const l7Evidence = readOnlyResult === null
      ? { requiredPhasesTerminalSuccess: true, hostCommitCreated: true, baseSha: status.baseSha!, candidateSha: candidateSha! }
      : { requiredPhasesTerminalSuccess: true, hostCommitCreated: false, baseSha: status.baseSha!, readOnlyResult };
    const l7 = transition({
      from: "RUNNING", to: "GATING", actor: "host", tier: status.tier, reason: { source: "git" }, interactive: false,
      budget: budget.snapshot(), evidence: l7Evidence,
    });
    const completionDetail = readOnlyResult === null
      ? "all required phases and exact candidate gates succeeded"
      : `all required phases succeeded with read-only ${readOnlyResult.schema} evidence and no worktree writes`;
    await persistTransition("RUNNING", "GATING", l7.edge, "git", null, completionDetail, false, {
      candidateSha, budget: budget.snapshot(), phase: null,
      lastActivity: readOnlyResult === null
        ? "L7 entered host gating on the exact candidate"
        : `L7 retained the read-only ${readOnlyResult.schema} result with no candidate tree`,
    });
    options.assertAdvancement?.(status.sessionId, "AWAITING_OWNER");
    // Below T2 the gates are the whole story and L12 carries the task to the
    // owner. At T2 the contract routes through REVIEWING instead: L12 refuses a
    // T2 task outright, because a tier that bought a review may not reach the
    // human without one.
    const t2 = status.tier >= 2;
    if (t2 && reviewPhase === null) {
      throw new InvalidReviewInversion(`workflow ${JSON.stringify(compiled.id)} is tier 2 but declares no review phase to invert`);
    }
    if (reviewPhase === null) {
      const l12Evidence = readOnlyResult === null
        ? { gatesPass: true, candidateSha: candidateSha! }
        : { gatesPass: true, hostCommitCreated: false, baseSha: status.baseSha!, readOnlyResult };
      const l12 = transition({
        from: "GATING", to: "AWAITING_OWNER", actor: "host", tier: status.tier, reason: { source: "gate" }, interactive: false,
        budget: budget.snapshot(), evidence: l12Evidence,
      });
      await persistTransition("GATING", "AWAITING_OWNER", l12.edge, "gate", null, `all required T${status.tier} gates passed`, false, {
        candidateSha, budget: budget.snapshot(), gatesPass: true,
        requiredReviewPresent: false, journeyApproved: true, protectedApprovalsValid: true, blocker: null,
        lastActivity: readOnlyResult === null
          ? `all T${status.tier} production phases and gates passed; awaiting owner`
          : `read-only ${readOnlyResult.schema} result passed every gate; awaiting owner inspection`,
        ...(readOnlyResult === null ? {} : {
          nextAction: `inspect the retained ${readOnlyResult.schema} envelope, then run \`awsf cancel ${status.taskId}\` when finished`,
        }),
      });
      return status;
    }

    // L11 is a spawn site: the review call is held here, on the exact candidate
    // the host gates just cleared, and the provider is the one the preflight
    // derived by exclusion.
    const reviewed = candidateSha;
    if (reviewed === null) throw new Error("a review-bearing workflow completed without a candidate");
    const reviewRoute = routes.get(reviewPhase.phase.id)!;
    const l11 = budget.authorize({
      from: "GATING", to: "REVIEWING", actor: "host", reason: { source: "gate" }, interactive: false,
      evidence: { gatesPass: true, candidateSha: reviewed }, spawn: { cost: 1 },
    });
    const heldReviewDescription = inversion!.mode === "same-provider-degraded"
      ? `EXPLICIT DEGRADED same-provider ${inversion!.reviewProvider} review`
      : `mandatory opposite-provider ${inversion!.reviewProvider} review`;
    await persistTransition("GATING", "REVIEWING", l11.result.edge, "gate", null, `held one call for the ${heldReviewDescription}`, true, {
      candidateSha: reviewed, budget: budget.snapshot(),
      lastActivity: `L11 held one call for the ${heldReviewDescription} of ${reviewed}`,
    });

    // `previous` is the composed review context, because the evidence phase is
    // the last phase before the reviewer in both T2 recipes. The reviewer is
    // handed evidence rather than the trailing `TestOutput` it used to get —
    // which carried an exit code and a bounded tail, and no diff, no file list,
    // and no statement of what was asked for.
    const reviewSubject: ReviewPhaseSubject = {
      candidateSha: reviewed,
      candidatePaths: candidatePathsBetween(status.worktree!, status.baseSha!, reviewed),
      evidence: reviewEvidence,
      expectation: reviewExpectation,
    };
    // One fixed-route attempt plus one transport retry, then BLOCKED. The route
    // is never widened, and a retry holds its own call because the first one was
    // genuinely spent.
    const reviewResult = await runMandatoryReview({
      workerProvider: inversion!.workerProvider,
      mode: inversion!.mode,
      ...(inversion!.pair === undefined ? {} : { providers: inversion!.pair }),
      isTransportFailure: (error) => {
        const transport = isReviewTransportFailure(error);
        if (transport) reviewTransportRetries += 1;
        return transport;
      },
      execute: async (reviewProvider, attempt) => {
        if (reviewProvider !== reviewRoute.model.provider) {
          throw new InvalidReviewInversion(`the routed review provider ${JSON.stringify(reviewProvider)} is not the preflighted reviewer route`);
        }
        const held = attempt === 1
          ? l11.reservation!
          : budget.reserve({ cost: 1, subject: `${compiled.id}:${reviewPhase!.phase.id}:retry` });
        if (attempt !== 1) {
          await persist("attempt.updated", { budget: budget.snapshot(), lastActivityAt: infra.now(), lastActivity: `held one call for the single permitted review retry` });
        }
        return runAgent(reviewPhase!.phase, reviewPhase!.ordinal, previous, held, false, reviewSubject, attempt);
      },
    });
    const reviewOutput = reviewResult.envelope as ReviewOutput;

    const l15 = transition({
      from: "REVIEWING", to: "AWAITING_OWNER", actor: "host", tier: status.tier, reason: { source: "gate" }, interactive: false,
      budget: budget.snapshot(),
      evidence: {
        gatesPass: true, candidateSha: reviewed,
        review: { verdict: reviewOutput.verdict, reviewedSha: reviewOutput.reviewedSha, findings: reviewOutput.findings },
      },
    });
    // The review is present because it ran; the journey has not happened yet and
    // is never assumed. It is the owner's own step against this candidate, and
    // `awsf journey` is the only thing that records it.
    const reviewDescription = inversion!.mode === "same-provider-degraded"
      ? `DEGRADED same-provider review on ${inversion!.reviewProvider}`
      : `opposite-provider review on ${inversion!.reviewProvider}`;
    await persistTransition("REVIEWING", "AWAITING_OWNER", l15.edge, "gate", null, `${reviewDescription} returned ${reviewOutput.verdict}`, false, {
      candidateSha: reviewed, budget: budget.snapshot(), gatesPass: true,
      requiredReviewPresent: true, journeyApproved: false, protectedApprovalsValid: true, blocker: null,
      phase: null,
      lastActivity: `${reviewDescription} returned ${reviewOutput.verdict} with ${reviewOutput.findings.length} finding(s)`,
      nextAction: `run \`awsf journey ${status.taskId}\` at a TTY, then \`awsf land ${status.taskId}\``,
    });
    return status;
  } catch (error) {
    for (const reservation of budget.outstanding()) budget.releaseOnRegistrationFailure(reservation.id);
    const failedFrom = status.lifecycleState as TaskState;
    if (failedFrom === "GATING") {
      await persist("attempt.updated", {
        budget: budget.snapshot(), blocker: { code: "sqlite-projection-failed", detail: error instanceof Error ? error.message : String(error), ahead: null, behind: null },
        lastActivityAt: infra.now(), lastActivity: "advancement held at GATING until observability rebuild",
        nextAction: "run `awsf db rebuild`, then retry advancement",
      });
      return status;
    }
    // L17 settles every review process that has already exited. The host keeps
    // the exact classification and never reinterprets a verdict: a failed
    // consistency gate is recorded as `review-inconsistent`, while contract,
    // evidence, policy, quota, and transport failures retain their own names.
    // This prevents a dead REVIEWING status with no process and no legal remedy.
    if (failedFrom === "REVIEWING") {
      const reason = productionReviewBlocker(error);
      const reviewFailure = reason.code === "review-unavailable" ? undefined : reason.code;
      const decision = transition({
        from: "REVIEWING", to: "BLOCKED", actor: "host", tier: status.tier,
        reason: { source: "process", code: reason.code, detail: reason.detail },
        interactive: false, budget: budget.snapshot(),
        evidence: {
          reviewTransportRetries,
          ...(reviewFailure === undefined ? {} : { reviewFailure }),
        },
      });
      await persistTransition("REVIEWING", "BLOCKED", decision.edge, "process", reason.code, reason.detail, false, {
        budget: budget.snapshot(), process: null,
        blocker: { code: reason.code, detail: reason.detail, ahead: null, behind: null },
        lastActivity: reason.detail,
      });
      return status;
    }
    if (failedFrom !== "RUNNING" && failedFrom !== "PREPARED") throw error;
    const from = failedFrom;
    const reason = closestBlocker(error);
    const to: TaskState = "BLOCKED";
    const decision = transition({
      from, to, actor: "host", tier: status.tier, reason: { source: "process", code: reason.code, detail: reason.detail },
      interactive: false, budget: budget.snapshot(),
    });
    await persistTransition(from, to, decision.edge, "process", reason.code, reason.detail, false, {
      budget: budget.snapshot(), process: null,
      blocker: { code: reason.code, detail: reason.detail, ahead: null, behind: null },
      lastActivity: reason.detail,
    });
    return status;
  }
}

async function persistReadableRunReport(
  options: ProductionRunOptions,
  status: AttemptStatus,
): Promise<AttemptStatus> {
  await writeRunReport(options.attemptDir, status, await readAttemptEvidence(options.attemptDir));
  return status;
}

/** Production runner for every shipped workflow. The fixture-only run command remains separate. */
export async function runProductionCommand(options: ProductionRunOptions): Promise<AttemptStatus> {
  const status = await executeProductionCommand(options);
  return persistReadableRunReport(options, status);
}
