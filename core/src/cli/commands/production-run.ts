import { existsSync, readFileSync, statSync, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { recoveryDigest, recoveryBudgetDigest, type AcceptedPhase, type BoundaryQuota, type PhaseRecovery } from "../../contracts/phase-recovery.ts";
import { inspectPhaseRecovery, verifyRecoveryWorktree, reconcileRecoveryStatus, reducePhaseContext } from "../../workflow/phase-recovery.ts";
import { withExecutionLease, assertNoExecutionController, assertOwnExecutionLease } from "../../execution/operation-lease.ts";
import { argvDigest, gateConfigDigest, gatesConfigDigest, COMMAND_LEDGER_PROTOCOL_VERSION } from "../../contracts/command-ledger.ts";
import { ledgerGovernanceFailure, planAdoptedMeasurement, planCommandRecovery, planVerifyCandidateLedger, type CommandRecovery } from "../../workflow/command-ledger.ts";
import type { VerifyCandidateLedgerVerdict } from "../../workflow/host-validation.ts";
import { occurrenceKeyForMeasurement, readCommandLedger, retainedOutputDigest } from "../../workflow/command-ledger-store.ts";
import type { OwnerTerminal } from "../tty.ts";
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
import { composeOwnerAmendment, composeOwnerAmendmentChain, createOwnerAmendment, ownerAmendmentDeliveryAction, ownerText, type OwnerAmendmentDelivery } from "../../contracts/owner-amendment.ts";
import { assertResumeInstruction, type ResumeInstruction } from "../../contracts/resume-instruction.ts";
import { savedResultPermissions, savedResultTreeDigest, ResultSnapshotUnavailable } from "../../workflow/saved-phase-result.ts";
import type { SavedPhaseResult } from "../../contracts/saved-phase-result.ts";
import { composeResumeInstruction, resumeInstructionContext } from "../../workflow/resume-instruction.ts";
import { seedContext, assertSeedTarget, verifiedTargetSeed, validateSeedStartup } from "../../workflow/candidate-seed.ts";
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
import { MAX_CALL_CEILING, type Tier } from "../../state/tiers.ts";
import { riskTierSufficient } from "../../gates/risk.ts";
import { candidateHygiene } from "../../gates/candidate-hygiene.ts";
import { commandsPass } from "../../gates/commands.ts";
import { envelopeValid } from "../../gates/envelope.ts";
import { prepareProtectedConsumption, protectedGrantForPhase, readProtectedState, inspectProtectedCandidate, protectedPromptContext, assertProtectedOutput, type ProtectedState } from "../../workflow/protected-grants.ts";
import { verifyProtectedWrite, verifyProtectedPreservation, type ProtectedFilesCapability } from "../../contracts/protected-capability.ts";
import { protectedRootIdentity } from "../../workflow/protected-files.ts";
import { commitProtectedAsHost, type ProtectedCommitIntent } from "../../git/protected-commit.ts";
import { completeProtectedPublication, inspectProtectedPublication, retainedLockWitness, unfinishedProtectedEffect } from "../../git/protected-reconcile.ts";
import { protectedWriteContext } from "../../contracts/protected-capability.ts";
import { stageOrdinal, type HostValidationProgress, type HostValidationStage } from "../../contracts/host-validation.ts";
import { HOST_AUTHOR } from "../../git/commit.ts";
import { hostCommitContentDigest, reconcileHostCommit } from "../../git/commit-reconcile.ts";
import type { HostCommitAdoption } from "../../workflow/engine.ts";
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
import { assertClean, captureChangeSet, changedPaths, changesSinceBase, runGit, systemGitRunner, WorktreeNotClean } from "../../git/changes.ts";
import { ContinuityStore, continuityHandle } from "../../execution/continuity-store.ts";
import { buildPhaseRequest, openRetainedColdTurn, phasePersistenceMode, phasePersistenceEvidence, redactPhaseProcess } from "../../execution/phase-request.ts";
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
import type { VisualReferenceBinding, VisualReferencesBound } from "../../contracts/visual-references.ts";
import { visualReferencesInspected, type PhaseVisualObservation } from "../../gates/visual-inspection.ts";
import {
  assertRouteDeliversImages, assertSameFrames, assertVisualRoute, deliverVisualReferences, deliveryDirectory, matchObservations,
  plannedDelivery, readVisualBinding, recordedVisualBound, revalidateDelivery, verifyVisualReferences, visualReferencePrompt,
  type VisualDelivery,
} from "../../workflow/visual-references.ts";
import { PermissionBreach } from "../../policy/path-policy.ts";
import { openPermissionSession, type PermissionSession, type SandboxProbe } from "../../policy/sandbox-broker.ts";
import { transition, SEALED_STATES, type EdgeId, type TaskState } from "../../state/task-machine.ts";
import { CallCeilingExceeded } from "../../state/errors.ts";
import { createCompiledPhaseLaunchVerifier } from "../../workflow/phase-launch-authorization.ts";
import { compileWorkflow, compileWorkflowStructure, reviewWorkerProvider, type WorkflowRecipe } from "../../workflow/compiler.ts";
import { composePromptBundle, type PromptBundle } from "../../workflow/prompt-composition.ts";
import type { CompiledAgentPhase } from "../../workflow/phase.ts";
import { outputOwnershipCheck } from "../../workflow/output-ownership.ts";
import {
  effectivePhaseRoute,
  requestedPhaseRoute,
  retainedRolePolicy,
  routeSelectionProvenance,
} from "../../workflow/phase-routing.ts";
import { UsageAccumulator, type AgentTurn, type CorrectionCandidateEvidence, type CorrectionCommandFailure, type CorrectionSession } from "../../workflow/corrections.ts";
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
import { SHIFT_WORKFLOW_ID, type ShiftBriefPhase } from "../../workflow/shift/compile.ts";
import { bindShiftRecipe, shiftPhaseRole, shiftTicketOf } from "../../workflow/shift/bind.ts";
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

const { chmod, lstat, mkdir, open, readFile, realpath, writeFile } = fs;

/**
 * Make one path's bytes durable. The file must be fsynced before any journal
 * record cites its digest, and its parent directory after, or the entry naming
 * it can survive without it.
 */
async function fsyncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

/**
 * Observe the worktree pins without throwing.
 *
 * `runGit` raises on a non-zero git exit, and `git status` failing is not
 * hypothetical here — a held `index.lock` is the whole subject of I2. If the
 * observation threw, the result record below it would never be written and the
 * occurrence would be stuck holding an intent with no result: the permanent
 * refusal, for a command that in fact settled and whose output is already
 * durable. An unreadable observation is recorded as unknown instead.
 */
function observePins(worktree: string): { clean: boolean; head: string | null } {
  try {
    const runner = systemGitRunner(worktree);
    const clean = runGit(runner, ["status", "--porcelain"]).trim().length === 0;
    const head = runGit(runner, ["rev-parse", "HEAD"]).trim();
    return { clean, head: /^[0-9a-f]{40}$/u.test(head) ? head : null };
  } catch {
    return { clean: false, head: null };
  }
}

/** This dispatch site's ledger identity. The list of sites is closed in the contract. */
const MEASURE_DISPATCHER = "production-run/measure-candidate" as const;

/**
 * What the command ledger can say about an interrupted `verify-candidate`.
 *
 * A3 left that stage refusing unconditionally because a missing per-command
 * result is not proof a command did not run. With the ledger the stage becomes
 * decidable, so this reduces the durable evidence to one verdict and hands it
 * to the pure planner. `undefined` — no worktree, or an unreadable ledger —
 * keeps the original refusal rather than guessing.
 */
async function verifyCandidateLedgerVerdict(
  attemptDir: string, config: AwsfConfig, status: AttemptStatus, checkpoint: PhaseRecovery,
): Promise<VerifyCandidateLedgerVerdict | undefined> {
  const progress = checkpoint.validation;
  if (progress === undefined || progress.stage !== "verify-candidate" || status.worktree === null) return undefined;
  const candidateSha = progress.commitResult?.commitSha ?? checkpoint.prefix.at(-1)?.candidateSha ?? null;
  if (candidateSha === null) return undefined;
  let snapshot;
  let worktreeRealPath;
  try {
    snapshot = await readCommandLedger(attemptDir);
    worktreeRealPath = await realpath(status.worktree);
  } catch { return undefined; }
  const occurrenceKey = occurrenceKeyForMeasurement(progress.phaseKey, candidateSha, progress.round);
  const gateIds = Object.keys(config.gates);
  const gatesDigest = gatesConfigDigest(config.gates);
  return planVerifyCandidateLedger(snapshot, gateIds.map(gateId => ({
    dispatcherId: MEASURE_DISPATCHER, occurrenceKey, gateId, gateIds,
    argvDigest: argvDigest(config.gates[gateId]!.argv),
    gateConfigDigest: gateConfigDigest(config.gates[gateId]!), gatesConfigDigest: gatesDigest,
    cwd: status.worktree!, worktreeRealPath,
    timeoutMs: config.gates[gateId]!.timeout_seconds * 1_000,
    maxOutputBytes: config.runtime.max_output_bytes,
    candidateSha, attempt: status.attempt, sessionId: status.sessionId,
  })));
}

/**
 * A configured command whose recovery the ledger refuses to decide.
 *
 * Its own class, because it must not read as an ordinary gate failure: the
 * candidate is untouched and nothing was re-dispatched. The phase record keeps
 * the name, so the refusal is legible after the fact.
 */
class CommandLedgerRefusal extends Error {
  constructor(gateId: string, reason: string) {
    super(`configured command ${gateId} cannot be recovered: ${reason}`);
    this.name = "CommandLedgerRefusal";
  }
}

const HOST = globalThis as unknown as {
  process: { env: Readonly<Record<string, string>> };
  AbortController: new () => { signal: Parameters<TransportBroker["startProcess"]>[2]; abort(reason?: unknown): void };
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(timer: unknown): void;
};

const SUPPORTED = new Map<string, WorkflowRecipe>(
  WORKFLOW_RECIPES.map((recipe) => [recipe.id, recipe]),
);

const SUPPORTED_NAMES = [...SUPPORTED.keys(), SHIFT_WORKFLOW_ID].join(", ");

/**
 * The recipe this attempt runs: a shipped one by id, or a shift compiled from
 * the selection bound to the attempt at `awsf new`. The first run, the
 * recovery binding and every resume entry resolve through here, so they can
 * never compile two different phase lists for one attempt.
 */
async function attemptRecipe(options: Pick<ProductionRunOptions, "config" | "configPath">, status: AttemptStatus): Promise<WorkflowRecipe | undefined> {
  const shipped = SUPPORTED.get(status.workflow);
  if (shipped !== undefined || status.workflow !== SHIFT_WORKFLOW_ID || status.shift == null) return shipped;
  const userPrompt = async (name: string): Promise<string> => {
    const agent = options.config.agents.find((candidate) => candidate.name === name);
    if (agent === undefined) throw new ProductionRouteUnavailable(name, "no explicit agent definition exists");
    return (await readProductionPromptPair(options.configPath, agent)).userPrompt;
  };
  return bindShiftRecipe(status.repository, status.shift,
    { prompts: { builder: await userPrompt("builder"), reviewer: await userPrompt("reviewer") } });
}
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
  /** Test seam for the durable protected commit intent / HEAD / index crash cut. */
  readonly afterProtectedHeadPublished?: () => Promise<void> | void;
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

/** Shared with external role proofs so role-specific host instructions cannot drift. */
export function renderProductionRolePrompt(
  phase: Pick<CompiledAgentPhase, "id" | "schemaId" | "renderPrompt">,
  previous: EnvelopeBase | null, designContext: DesignContext | null,
  recordedRequest: string, agent: AgentDefinition,
): string {
  const rendered = renderProductionAgentPrompt(phase, previous, designContext, recordedRequest);
  return phase.id === "documenter"
    ? `${rendered}\n\nExact repository write boundary: ${agent.writes.length === 0 ? "none" : agent.writes.join(", ")}\n` +
      "The logical run-report boundary is reports/<lowercase-kebab-name>.md. Return its path and Markdown in runReport; the host writes it outside the repository and beside the sealed attempt.\n"
    : rendered;
}

/** Original launches preserve the distinction between lifecycle edges and interior phases. */
export function productionPhaseRegistration(input: {
  readonly phaseId: string; readonly phaseOrdinal: number; readonly adapterId: string; readonly role: string;
  readonly reservationId: string; readonly runId: string; readonly taskSessionId: string; readonly workflowId: string;
  readonly first: boolean; readonly review: boolean;
}): ProcessRegistration | AgentPhaseProcessRegistration {
  const common = { runId: input.runId, reservationId: input.reservationId, adapterId: input.adapterId, role: input.role };
  if (input.first) return { ...common, sessionId: input.taskSessionId, from: "PREPARED", to: "RUNNING", edge: "L4" } satisfies ProcessRegistration;
  if (input.review) return { ...common, sessionId: input.taskSessionId, from: "GATING", to: "REVIEWING", edge: "L11" } satisfies ProcessRegistration;
  return { ...common, kind: "agent-phase", taskSessionId: input.taskSessionId, workflowId: input.workflowId,
    phaseId: input.phaseId, phaseOrdinal: input.phaseOrdinal } satisfies AgentPhaseProcessRegistration;
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
  attributionBaseSha: string | null = null,
  protectedCapabilities: () => Promise<readonly ProtectedFilesCapability[]> = async () => [],
): readonly GateDefinition[] {
  const observe = attributionBaseSha !== null && review === null
    ? (): readonly string[] => changesSinceBase(worktree, attributionBaseSha)
    : review === null && phaseId !== "documenter"
      ? (): readonly string[] => changesSinceBase(worktree, baseSha)
      : observePhase;
  const assurance = attributionBaseSha === null ? observe : (): readonly string[] => changesSinceBase(worktree, baseSha);
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
    { id: "no_protected_paths", run: async () => noProtectedPaths(assurance(), config.policy.protected_paths, true, await protectedCapabilities()) },
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
        run: () => riskTierSufficient(assurance(), tier, config.risk, "the candidate changes"),
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
  const expectedHead = status.seed?.seedCandidateSha ?? status.baseSha;
  if (head !== expectedHead) {
    throw new ProductionRepositoryMismatch(`PREPARED HEAD is ${head}, expected recorded initial HEAD ${expectedHead}`);
  }
  if (status.seed != null && runGit(canonicalGit, ["rev-parse", "HEAD"]).trim() !== status.baseSha) {
    throw new ProductionRepositoryMismatch("seeded target canonical HEAD differs from its integration base");
  }
}

type RecoveryInspection = Awaited<ReturnType<typeof inspectPhaseRecovery>>;

export async function productionRecoveryBinding(options: Pick<ProductionRunOptions, "config" | "configPath">, status: AttemptStatus): Promise<string> {
  const recipe = await attemptRecipe(options, status);
  if (recipe === undefined) throw new Error("recovery recipe unavailable");
  const prompts = await Promise.all(recipe.phases.filter(phase => phase.kind === "agent").map(async phase => {
    const agent = options.config.agents.find(agent => agent.name === phase.owner);
    if (agent === undefined) throw new Error("recovery route missing");
    const bundle = await readProductionPromptPair(options.configPath, agent);
    return { phase: phase.id, system: bundle.systemPrompt, user: bundle.userPrompt };
  }));
  const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
  const entries = await fs.readdir(sourceRoot, { recursive: true, withFileTypes: true });
  const sources = (await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith(".ts")).map(async entry => {
    const path = join(entry.parentPath, entry.name);
    return [relative(sourceRoot, path), sha256(await readFile(path, "utf8"))] as const;
  }))).sort(([a], [b]) => a.localeCompare(b));
  return recoveryDigest({ request: status.request, seed: status.seed ?? null, config: options.config,
    // Present only for a shift, so every shipped attempt's digest is unchanged.
    // The manifest digest covers each ticket's byte digest, and the recipe
    // above was compiled only because the bytes on disk still match them.
    ...(status.shift == null ? {} : { shift: status.shift.manifestDigest }),
    routeOverrides: status.routeOverrides, reviewDegradation: status.reviewDegradation, prompts, sources,
    phases: recipe.phases.map(phase => ({ id: phase.id, kind: phase.kind, owner: phase.owner, schema: phase.schemaId,
      maxCorrections: phase.maxCorrections, gates: phase.gates.map(gate => gate.id) })) });
}

export async function protectedGrantSubject(options: Pick<ProductionRunOptions, "config" | "configPath">, status: AttemptStatus, phaseKey: string): Promise<import("../../contracts/protected-grant.ts").ProtectedGrantSubject> {
  const recipe = await attemptRecipe(options, status);
  const ordinal = recipe?.phases.findIndex(phase => phase.id === phaseKey) ?? -1;
  const phase = recipe?.phases[ordinal];
  if (phase?.kind !== "agent" || ordinal < 0 || status.worktree === null || status.baseSha === null ||
      !options.config.agents.some(agent => agent.name === phase.owner && agent.writes.length > 0)) throw new Error("protected grant requires a prepared writing model phase");
  if (resolve(status.worktree) === resolve(fileURLToPath(new URL("../../../../", import.meta.url)))) throw new Error("protected bootstrap cannot authorize the runtime implementing its own verifier");
  const git = systemGitRunner(status.worktree);
  return { project: status.project, taskId: status.taskId, sessionId: status.sessionId, attempt: status.attempt,
    repository: status.repository, worktree: status.worktree, commonGitDir: runGit(git, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(),
    worktreeGitDir: runGit(git, ["rev-parse", "--absolute-git-dir"]).trim(),
    roots: [status.repository, runGit(git, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(), status.worktree, runGit(git, ["rev-parse", "--absolute-git-dir"]).trim()].map(protectedRootIdentity),
    integrationBaseSha: status.baseSha, preWriteHeadSha: runGit(git, ["rev-parse", "HEAD"]).trim(), phaseKey, phaseOrdinal: ordinal + 1,
    bindingDigest: await productionRecoveryBinding(options, status) };
}

async function executeProductionCommand(options: ProductionRunOptions, operationId: string,
  recovery?: { inspected: RecoveryInspection; reason: string; quotaReadings: BoundaryQuota[]; instruction?: ResumeInstruction | null }, preflightOnly = false): Promise<AttemptStatus> {
  const infra: ProductionInfrastructure = { ...DEFAULT_INFRASTRUCTURE, ...options.infrastructure };
  let status = recovery?.inspected.status ?? await readAttempt(options.attemptDir);
  const protectedState = readProtectedState(options.attemptDir);
  /**
   * The crash window inside `commitProtectedAsHost`, between its durable intent
   * and its durable binding.
   *
   * It is reconciled, never replayed: the candidate object already exists, and
   * what is missing is a compare-and-swap and one pre-staged index whose bytes
   * the intent pinned by digest. A consumption with no intent at all never
   * reached that window and has no exact outcome to complete, so it still
   * refuses.
   */
  // A retained protected host effect is reconciled by its own owner-confirmed
  // act, never by a workflow run. Running one while it is outstanding would
  // measure a later phase against whichever revision the crash left behind.
  if (recovery !== undefined && protectedState.consumptions.some(consumption => !protectedState.bindings.some(binding => binding.consumptionId === consumption.id))) {
    throw new Error(unfinishedProtectedEffect(protectedState) === null
      ? "protected generation is consumed without a durable commit intent; no exact host effect exists to reconcile and no replay is authorized"
      : "an interrupted protected host effect is retained; reconcile it before resuming this workflow");
  }
  if (recovery === undefined) {
    if (status.recovery != null) throw new Error("saved phase completion or quota anchor exists; use awsf resume");
    const recoveredReview = await settleExitedReview(options, status, infra.now());
    if (recoveredReview !== null) return recoveredReview;
    if (status.lifecycleState !== "PREPARED") throw new Error(`production run requires PREPARED, got ${status.lifecycleState}`);
  }
  const recipe = await attemptRecipe(options, status);
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

  const seed = recovery === undefined ? await verifiedTargetSeed(options.attemptDir, status) : assertSeedTarget(status);
  if (seed !== null && recovery === undefined) await validateSeedStartup(seed, status, options.config, options.configPath, options.attemptDir);
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
  const compiled = recovery === undefined
    ? compileWorkflow(configuredRecipe, status.tier, status.budget.callsSpent, status.budget.ceiling)
    : compileWorkflowStructure(configuredRecipe);
  const bindingDigest = await productionRecoveryBinding(options, status);
  if (recovery !== undefined && bindingDigest !== recovery.inspected.checkpoint.bindingDigest) throw new Error("recovery configuration, request, recipe, prompts or runtime source changed");
  const routes = new Map<string, Route>();
  // The project's durable mode, relaxed only by this attempt's own owner grant.
  // Read once so the inversion check, the provenance and the phase description
  // can never disagree about which review this run bought.
  const reviewMode: AwsfConfig["routing"]["review"] =
    status.reviewDegradation === null ? options.config.routing.review : "same-provider-degraded";
  let inversion: {
    readonly mode: AwsfConfig["routing"]["review"];
    readonly workerProvider: string;
    readonly reviewProvider: string;
    readonly pair?: readonly [string, string];
    readonly reviewPhaseId: string;
  } | null = null;
  // The owner's visual binding, if this attempt was started with one. Read
  // inside the preflight so a missing, changed or unrecorded binding blocks
  // before any call rather than letting a visual attempt run text-only.
  let visualBound: VisualReferencesBound | null = null;
  let visualBinding: VisualReferenceBinding | null = null;
  try {
    if (recovery === undefined) await validatePreparedRepository(status);
    else await verifyRecoveryWorktree(status, recovery.inspected.checkpoint, await verifyCandidateLedgerVerdict(options.attemptDir, options.config, status, recovery.inspected.checkpoint));
    const boundRecord = (await readAttemptEvidence(options.attemptDir)).findLast((evidence) => evidence.type === "visual-references-bound");
    visualBound = boundRecord?.type === "visual-references-bound" ? boundRecord.bound : null;
    visualBinding = await readVisualBinding(options.attemptDir, visualBound);
    for (const [phaseIndex, phase] of compiled.phases.entries()) {
      if (phase.kind !== "agent" || phaseIndex < (recovery?.inspected.checkpoint.prefix.length ?? 0)) continue;
      const role = agents.get(phase.owner)!;
      const selection = requestedPhaseRoute(options.config, phase.id, role, status.routeOverrides);
      const agent = selection.agent;
      if (!retainedRolePolicy(selection.policy, agent)) {
        throw new ProductionRouteUnavailable(agent.harness.adapter, "phase routing changed prompt, tool, write, purpose, colour, or continuity policy");
      }
      const entry = options.config.adapters[agent.harness.adapter];
      if (entry === undefined || entry.enabled === false) throw new ProductionRouteUnavailable(agent.harness.adapter, "route is disabled or undeclared");
      const saved = recovery?.inspected.checkpoint.pending;
      if (saved?.phaseKey === phase.id) {
        const originalRoute = recovery!.inspected.records.map(row => row.event.evidence).findLast(evidence =>
          evidence?.type === "agent-start" && evidence.phaseId === dbPhaseId(status.sessionId, phase.id));
        if (originalRoute?.type !== "agent-start" || originalRoute.adapterId !== agent.harness.adapter ||
            saved.model.requestedModel !== agent.model) throw new Error("saved reply route changed");
        const unavailable = () => { throw new Error("saved reply validation cannot reopen a model adapter"); };
        const adapter: HarnessAdapter = { id: saved.model.adapter, isAvailable: unavailable, getModelInfo: unavailable,
          buildSpec: unavailable, parse: unavailable, execute: unavailable };
        routes.set(phase.id, { agent, adapterId: agent.harness.adapter, adapter, model: saved.model,
          provenance: routeSelectionProvenance({ requested: selection.requested,
            effective: effectivePhaseRoute(selection.requested, adapter.id, saved.model),
            ...(isReviewPhase(phase) ? { reviewMode } : {}) }),
          continuity: agent.harness.continuity === "same-session", ...routePrompts.get(phase.id)! });
        continue;
      }
      const adapter = infra.adapterFor(entry, agent.harness.adapter, options.config);
      if (adapter === null) throw new ProductionRouteUnavailable(agent.harness.adapter, "adapter kind has no production binding");
      const available = await adapter.isAvailable();
      if (available.status !== "available") throw new ProductionRouteUnavailable(agent.harness.adapter, available.detail ?? available.code ?? "blocked");
      const model = await adapter.getModelInfo(agent.model);
      // A bound phase must reach the model through a demonstrated image route
      // with its read tool intact — checked on the EFFECTIVE route, after any
      // per-phase override, and before any call is reserved.
      if (visualBinding?.phases.includes(phase.id) === true) {
        assertVisualRoute({ phaseId: phase.id, adapterId: adapter.id, model, profile: agent.tools.profile, tools: agent.tools.allow });
        await assertRouteDeliversImages(adapter.id, { home: HOST.process.env.HOME, cwd: status.worktree });
      }
      const effective = effectivePhaseRoute(selection.requested, adapter.id, model);
      const provenance = routeSelectionProvenance({
        requested: selection.requested,
        effective,
        ...(isReviewPhase(phase) ? { reviewMode } : {}),
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
      if (phasePersistenceMode(agent, adapter) === "unavailable") {
        throw new ProductionRouteUnavailable(agent.harness.adapter,
          "original-turn persistence was requested but the adapter implements no complete continuity transport");
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
      if (continuous || phasePersistenceMode(agent, adapter) === "interrupted-turn-retention") {
        const capable = adapter as ContinuityCapableAdapter;
        const storeDir = capable.continuityStoreDir(join(options.attemptDir, "private", phase.id));
        for (const turn of continuous ? ["open", "resume"] as const : ["open"] as const) {
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
      const providerFor = (phaseId: string): string => {
        const fresh = routes.get(phaseId)?.model.provider;
        if (fresh !== undefined) return fresh;
        const evidence = recovery?.inspected.records.map(record => record.event.evidence).findLast(evidence =>
          evidence?.type === "agent-start" && evidence.phaseId === dbPhaseId(status.sessionId, phaseId));
        if (evidence?.type !== "agent-start") throw new InvalidReviewInversion("accepted phase has no recorded original provider");
        return evidence.provider;
      };
      // A shift has one builder per ticket, and routes are keyed by phase id,
      // so one override can move one builder. The worker is the one provider
      // every builder resolves to; builders on two providers are refused here
      // by name. This runs before the mode is read, so under
      // same-provider-degraded the builders must still agree and the reviewer
      // must join them: a degraded shift runs on one provider end to end.
      const workerProvider = reviewWorkerProvider(compiled, providerFor);
      const configured = providerFor(reviewPhase.id);
      if (reviewMode === "same-provider-degraded") {
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
        const pair = providerPairFrom(compiled.phases.filter(phase => phase.kind === "agent").map(phase => providerFor(phase.id)));
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
    if (recovery !== undefined) throw error;
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

  for (const grant of protectedState.grants) {
    if (protectedState.consumptions.some(value => value.grantId === grant.id)) continue;
    if (process.platform !== "linux" || !(infra.sandboxProbe?.("bwrap") ?? (runSystemCommand("bwrap", ["--version"], 5000).status === 0))) throw new Error("protected grants require an OS-enforced sandbox");
    prepareProtectedConsumption(options.attemptDir, await protectedGrantSubject(options, status, grant.subject.phaseKey), "preflight", "preflight");
  }
  if (preflightOnly) return status;
  const budget = new CallBudget({
    taskId: status.taskId,
    tier: status.tier,
    allowance: status.budget.allowance,
    // The attempt's own ceiling, including any owner grant. The ledger must
    // measure against exactly what the machine decided against.
    ...(status.budget.ceiling === undefined ? {} : { ceiling: status.budget.ceiling }),
    reservationNamespace: operationId,
    carried: { attempt: status.attempt, callsSpent: status.budget.callsSpent,
      correctionsAuto: status.budget.correctionsAuto, correctionsOwner: status.budget.correctionsOwner,
      ownerReentries: status.budget.ownerReentries },
  });
  const prefix: AcceptedPhase[] = [...(recovery?.inspected.checkpoint.prefix ?? [])];
  const savedResult = recovery?.inspected.checkpoint.pending;
  const remainingCalls = compiled.phases.slice(prefix.length).filter(phase => phase.kind === "agent" && phase.id !== savedResult?.phaseKey).length;
  budget.admitWorkflow(recovery === undefined ? compiled : { id: compiled.id, minimumCalls: remainingCalls });
  const instructions = [...(recovery?.inspected.instructions ?? [])];
  const submittedInstructions = new Set<string>(recovery?.inspected.pendingInstruction === null || recovery?.inspected.pendingInstruction === undefined ? [] : [recovery.inspected.pendingInstruction.amendment.digest]);
  const brokerDelegatedReservations = new Set<string>();
  const instructionFor = (phaseKey: string): ResumeInstruction | null => recovery?.inspected.pendingInstruction?.amendment.binding.phaseKey === phaseKey
    ? recovery.inspected.pendingInstruction : recovery?.instruction?.amendment.binding.phaseKey === phaseKey ? recovery.instruction : null;
  const acceptedEnvelopes = new Map<string, EnvelopeBase>(recovery?.inspected.envelopes);
  const storedEnvelopes = new Map<string, StoredEnvelope<EnvelopeBase>>();
  if (savedResult !== undefined && recovery?.inspected.pendingEnvelope != null) storedEnvelopes.set(savedResult.phaseKey, recovery.inspected.pendingEnvelope);
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

  const persistTransition = async (from: TaskState, to: TaskState, edgeId: EdgeId, source: string, code: string | null, detail: string | null, spawnSite: boolean, update: Partial<AttemptStatus>, protectedConsumption?: import("../../contracts/protected-grant.ts").ProtectedGrantConsumption): Promise<void> => {
    const at = infra.now();
    transitionSeq += 1;
    await persist("attempt.transitioned", { lifecycleState: to, lastActivityAt: at, nextAction: nextActionFor(to, status.taskId), ...update }, {
      type: "transition", id: `${status.sessionId}:transition:${transitionSeq}`, seq: transitionSeq,
      from, to, actor: "host", edgeId, reasonSource: source, reasonCode: code, reasonDetail: detail,
      spawnSite, at, ...(protectedConsumption === undefined ? {} : { protectedConsumption }),
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
    if (state === "SUCCEEDED" && record.kind !== "agent") { await acceptPhase(phaseId, null); return; }
    await persist("attempt.updated", {
      phase: { name: record.name, state, round: record.correctionCount, maximumRounds: record.maxCorrections },
      lastActivityAt: at,
      lastActivity: `${record.key} is ${state}`,
    }, { type: "phase", phase: record });
  };

  for (const [index, phase] of compiled.phases.entries()) {
    if (recovery !== undefined) {
      const retained = recovery.inspected.phases.get(phase.id);
      if (retained === undefined || retained.ordinal !== index + 1) throw new Error("recovery phase record missing or reordered");
      phaseRecords.set(phase.id, retained);
      continue;
    }
    const record: PhaseEvidenceRecord = {
      phaseId: dbPhaseId(status.sessionId, phase.id), ordinal: index + 1, key: phase.id, name: phase.id,
      kind: phase.kind,
      owner: phase.owner,
      description: isReviewPhase(phase) && reviewMode === "same-provider-degraded"
        ? `${phase.description}; EXPLICIT DEGRADED SAME-PROVIDER MODE (reduced review independence)`
        : phase.description,
      status: "QUEUED",
      correctionCount: 0, maxCorrections: phase.maxCorrections, errorCode: null, errorMessage: null,
      startedAt: null, endedAt: null, createdAt,
    };
    phaseRecords.set(phase.id, record);
    await persist("attempt.updated", {}, { type: "phase", phase: record });
  }

  let firstReservation: Reservation | null = null;
  if (recovery === undefined) {
  const l4 = budget.authorize({
    from: "PREPARED", to: "RUNNING", actor: "host", reason: { source: "process" }, interactive: false,
    evidence: { workflowCompiled: true }, spawn: { cost: 1 },
  });
  firstReservation = l4.reservation!;
  await persistTransition("PREPARED", "RUNNING", l4.result.edge, "process", null, "compiled workflow and held first call", true, {
    activeOperation: operationId, budget: budget.snapshot(), blocker: null, lastActivity: "L4 durable; first provider call held",
  });
  }

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
   * Known-literal replacement rather than a pattern: the host MINTED these
   * strings, so it can name them precisely instead of guessing at what a session
   * id looks like on a route it has not met yet.
   */
  const redactLocators = (record: BarrierRecord): BarrierRecord => redactPhaseProcess(record, continuity);

  const brokerOptions = {
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
  } as BrokerOptions;
  let broker: TransportBroker | null = null;

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
    storedEnvelopes.set(phaseId, stored);
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
  const measureCandidate = async (phaseId: string, candidateSha: string, round: number, origin: "verify-candidate" | "phase-dispatch" = "phase-dispatch"): Promise<CandidateMeasurement> => {
    await assertOwnExecutionLease(options.attemptDir);
    // Read BEFORE this run writes its own hygiene record. A dispatch point
    // visible in this snapshot therefore belongs to an earlier run, which is
    // what lets a pre-ledger run's bare hygiene record be told apart from this
    // run's own — the two are otherwise identical.
    const ledger = await readCommandLedger(options.attemptDir);
    const gitRunner = systemGitRunner(status.worktree!);
    if (seed !== null) {
      const paths = candidatePathsBetween(status.worktree!, seed.integrationBaseSha, candidateSha);
      for (const report of [noProtectedPaths(paths, options.config.policy.protected_paths), riskTierSufficient(paths, status.tier, options.config.risk, "complete seeded candidate changes")]) {
        await persistGate(phaseId, report, candidateSha, round);
        if (!report.passed) throw new Error(`complete seeded candidate failed ${report.gateId}`);
      }
    }
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

    // Four aborts sit between the unconditional hygiene record above and the
    // first spawn below. Each one reaches the dispatch point and dispatches
    // nothing, so without a closure marker the completeness predicate reads the
    // silence as an ungoverned dispatch and refuses every later decision in the
    // attempt — for something that never happened.
    const occurrenceKey = occurrenceKeyForMeasurement(phaseId, candidateSha, round);
    const closeOccurrence = async (reason: string): Promise<void> => {
      await persist("attempt.updated", {}, { type: "command-occurrence-closed", closure: {
        schema: "awsf.command-occurrence-closed/v1", dispatcherId: MEASURE_DISPATCHER,
        occurrenceKey, reason, closedAt: infra.now(),
      } });
    };
    // Governance is decided from the snapshot taken BEFORE this run wrote
    // anything, and decided BEFORE the opening below is persisted. Writing the
    // opening first would be self-exculpating: a run that correctly refuses an
    // earlier ungoverned dispatch would leave behind the very marker that makes
    // the next run believe the occurrence was always governed, and that run
    // would re-dispatch the owner's argv over an unknown prior effect.
    const ungoverned = ledgerGovernanceFailure(ledger, MEASURE_DISPATCHER, occurrenceKey);
    if (ungoverned !== null) throw new CommandLedgerRefusal("candidate measurement", ungoverned);
    await persist("attempt.updated", {}, { type: "command-occurrence-opened", opening: {
      schema: "awsf.command-occurrence-opened/v1", dispatcherId: MEASURE_DISPATCHER,
      occurrenceKey, protocolVersion: COMMAND_LEDGER_PROTOCOL_VERSION, openedAt: infra.now(),
    } });
    try {
      assertClean(status.worktree!, "before");
    } catch (error) {
      await closeOccurrence("the worktree was dirty before any configured command was dispatched");
      throw error;
    }
    const observedHead = runGit(gitRunner, ["rev-parse", "HEAD"]).trim();
    if (observedHead !== candidateSha) {
      await closeOccurrence("the candidate moved before any configured command was dispatched");
      throw new Error(`candidate moved before commands: ${observedHead} != ${candidateSha}`);
    }
    const gateIds = Object.keys(options.config.gates);
    const gatesDigest = gatesConfigDigest(options.config.gates);
    const worktreeRealPath = await realpath(status.worktree!);
    const baseExpectation = {
      dispatcherId: MEASURE_DISPATCHER, gateIds, gatesConfigDigest: gatesDigest,
      cwd: status.worktree!, worktreeRealPath, candidateSha,
      attempt: status.attempt, sessionId: status.sessionId,
    };
    /**
     * A host command phase reuses the builder's measurement of this exact
     * candidate — the one edge that exists today, and only that one. The
     * builder's occurrence is looked up by its own recorded key, so a SECOND
     * command phase cannot inherit the FIRST one's dispatch and quietly run
     * nothing: only `origin: "verify-candidate"` entries are adoptable.
     */
    let adopted: ReadonlyMap<string, CommandRecovery & { action: "restore" }> | null = null;
    if (origin === "phase-dispatch") {
      const first = Object.entries(options.config.gates)[0];
      if (first !== undefined) {
        const plan = planAdoptedMeasurement(ledger, {
          ...baseExpectation,
          argvDigest: argvDigest(first[1].argv), gateConfigDigest: gateConfigDigest(first[1]),
          timeoutMs: first[1].timeout_seconds * 1_000, maxOutputBytes: options.config.runtime.max_output_bytes,
        });
        if (plan.action === "refuse") throw new CommandLedgerRefusal("candidate measurement", plan.reason);
        if (plan.action === "adopt") {
          adopted = new Map(plan.entries.map(entry =>
            [entry.intent.gateId, { action: "restore" as const, intent: entry.intent, result: entry.result }]));
        }
      }
    }
    const commands: TestOutput["commands"] = [];
    const failures: string[] = [];
    const commandFailures: CorrectionCommandFailure[] = [];
    const renderedSections: string[] = [];
    const commandPins = new Map<string, { cleanBefore: boolean; cleanAfter: boolean }>();
    for (const [gateId, configured] of Object.entries(options.config.gates)) {
      const started = Date.now();
      const outputRelative = join("raw", `command-${phaseId}-${gateId}-${String(round)}.txt`);
      const outputAbsolute = join(options.attemptDir, outputRelative);
      const expectation = {
        dispatcherId: MEASURE_DISPATCHER, occurrenceKey, gateId, gateIds,
        argvDigest: argvDigest(configured.argv), gateConfigDigest: gateConfigDigest(configured),
        gatesConfigDigest: gatesDigest, cwd: status.worktree!, worktreeRealPath,
        timeoutMs: configured.timeout_seconds * 1_000, maxOutputBytes: options.config.runtime.max_output_bytes,
        candidateSha, attempt: status.attempt, sessionId: status.sessionId,
      } as const;
      const planned = adopted?.get(gateId) ?? planCommandRecovery(ledger, expectation);
      if (planned.action === "refuse") throw new CommandLedgerRefusal(gateId, planned.reason);

      let output: string;
      let exitCode: number;
      let durationMs: number;
      if (planned.action === "restore") {
        // The command body never runs again. Everything the measurement needs is
        // rebuilt from the bytes the digest check just verified.
        output = await readFile(join(options.attemptDir, planned.result.outputRef!), "utf8");
        exitCode = planned.result.exitCode;
        durationMs = planned.result.durationMs;
        commandPins.set(gateId, { cleanBefore: planned.intent.cleanBefore, cleanAfter: planned.result.cleanAfter });
      } else {
        const intentId = randomUUID();
        await persist("attempt.updated", {}, { type: "command-dispatch-intent", intent: {
          schema: "awsf.command-dispatch-intent/v1", intentId, dispatcherId: MEASURE_DISPATCHER,
          occurrenceKey, gateId, origin, phaseKey: phaseId, phaseOrdinal: 0, round,
          attempt: status.attempt, sessionId: status.sessionId,
          argv: [...configured.argv], argvDigest: expectation.argvDigest,
          cwd: expectation.cwd, worktreeRealPath, timeoutMs: expectation.timeoutMs,
          maxOutputBytes: expectation.maxOutputBytes, gateConfigDigest: expectation.gateConfigDigest,
          gatesConfigDigest: gatesDigest, candidateSha, headBefore: candidateSha, cleanBefore: true,
          dispatchedAt: infra.now(),
        } });
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
        output = `${result.stdout}${result.stderr}${result.error === null ? "" : `\n${result.error}`}`;
        await mkdir(dirname(outputAbsolute), { recursive: true });
        await writeFile(outputAbsolute, output, { mode: 0o600 });
        await chmod(outputAbsolute, 0o600);
        // fsync AFTER the chmod, so the mode is durable too, and before the
        // result record, so no journal line ever cites bytes that are not.
        await fsyncPath(outputAbsolute);
        await fsyncPath(dirname(outputAbsolute));
        exitCode = result.status ?? -1;
        durationMs = Date.now() - started;

        // Observe, record, THEN abort. The two checks below used to throw
        // outright, which left an intent with no result for a command whose
        // effect on the tree is precisely what was observed — the one case a
        // restore must never treat as a clean measurement.
        const pins = observePins(status.worktree!);
        const cleanAfter = pins.clean && pins.head !== null;
        await persist("attempt.updated", {}, { type: "command-dispatch-result", result: {
          // An unreadable observation is `no-exit`: not restorable, rather than
          // an `exited` record asserting pins nothing actually read.
          schema: "awsf.command-dispatch-result/v1", intentId,
          outcome: result.status === null || pins.head === null ? "no-exit" : "exited",
          exitCode, durationMs, outputRef: outputRelative,
          outputBytes: Buffer.byteLength(output), outputDigest: retainedOutputDigest(output),
          headAfter: pins.head ?? candidateSha, cleanAfter,
          descendantQuiescence: "unproved", settledAt: infra.now(),
        } });
        commandPins.set(gateId, { cleanBefore: true, cleanAfter });
        if (!cleanAfter) {
          await closeOccurrence(`${gateId} left the worktree dirty`);
          // Abort unconditionally. Re-asserting would let the loop continue if a
          // surviving descendant tidied up in between — leaving the occurrence
          // both closed and still accumulating intents, which contradicts what
          // the closure means. `assertClean` is called first only so the
          // original `WorktreeNotClean` class reaches the phase record's
          // errorCode; if the tree now looks clean it cannot supply one.
          assertClean(status.worktree!, "after");
          throw new WorktreeNotClean("after", "the worktree was dirty when the command settled");
        }
        if (pins.head !== candidateSha) {
          await closeOccurrence(`${gateId} moved the candidate`);
          throw new Error(`candidate moved during ${gateId}`);
        }
      }

      // A restore cites the path its own result recorded. For a same-key
      // restore that is this occurrence's path; for an adopted one it is the
      // producing phase's, and citing this phase's would name a file that does
      // not exist.
      commands.push({ gateId, argv: [...configured.argv], exitCode, durationMs,
        outputRef: planned.action === "restore" ? planned.result.outputRef ?? outputRelative : outputRelative });
      const bounded = boundCommandOutput(output);
      const rendered = renderCommandEvidence(bounded);
      renderedSections.push(`### ${gateId} (exit ${String(exitCode)})\n${rendered}`);
      if (exitCode !== 0) {
        failures.push(`${gateId} exited ${exitCode}`);
        commandFailures.push({ gateId, argv: [...configured.argv], exitCode, evidence: rendered });
      }
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
      // The pins come from what each command actually recorded, not from
      // literals. A restored measurement is only ever offered when its own
      // recorded pins held, so passing them through keeps the aggregate from
      // asserting a fact nothing checked.
      const pins = commandPins.get(gateId) ?? { cleanBefore: true, cleanAfter: true };
      const report = commandsPass(testOutput, { gateId, argv: configured.argv }, { candidateSha, ...pins });
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
    return productionPhaseRegistration({ phaseId: phase.id, phaseOrdinal: ordinal, adapterId: route.adapterId,
      role: route.agent.name, reservationId: reservation.id, runId, taskSessionId: status.sessionId,
      workflowId: compiled.id, first, review });
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

  // A compiled shift phase answers to the shipped role it repeats; every other
  // phase is its own role, exactly as before.
  const roleOf = (phaseId: string): string => shiftPhaseRole(recipe.phases, phaseId) ?? phaseId;
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
    const restored = savedResult?.phaseKey === phase.id ? savedResult : null;
    const originalUsage = new UsageAccumulator();
    if (restored !== null) for (const row of recovery!.inspected.records) {
      const evidence = row.event.evidence;
      if (evidence?.type === "agent" && evidence.phaseId === dbPhaseId(status.sessionId, phase.id)) originalUsage.add({ usage: evidence.usage, costUsd: evidence.costUsd });
    }
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
    const phaseGrant = protectedState.grants.find(grant => grant.subject.phaseKey === phase.id) ?? null;
    const protectedCapability = phaseGrant === null ? undefined : await verifyProtectedWrite({ attemptDir: options.attemptDir,
      subject: await protectedGrantSubject(options, status, phase.id), operationId, reservationId: reservation.id });
    const routeMaximumCorrections = phaseGrant !== null ? 0 : route.continuity
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
    const systemPromptPath = restored === null ? await infra.writeSystemPrompt(route.systemPrompt, runtimeDir) : "";
    // Visual references: re-verified from source against the start-time record
    // and copied fresh for THIS launch. A saved reply re-validates from the
    // journal's inspection records alone and launches nothing, so it copies
    // nothing. Observations are phase-local: another phase's never count.
    const visualPhase = visualBinding !== null && visualBound !== null && visualBinding.phases.includes(phase.id);
    const visualObservations: PhaseVisualObservation[] = restored === null ? [] : (recovery?.inspected.records ?? [])
      .flatMap((row) => row.event.evidence?.type === "visual-reference-inspection" && row.event.evidence.phaseId === phaseDb
        ? row.event.evidence.observations.map((observation) => ({ ...observation, phaseId: phaseDb })) : []);
    let visualDelivery: VisualDelivery | null = null;
    if (visualPhase && restored === null) {
      const fresh = await verifyVisualReferences(visualBinding!, { planRef: status.planRef,
        agentPhases: compiled.phases.filter((candidate) => candidate.kind === "agent").map((candidate) => candidate.id) });
      assertSameFrames(visualBound!, fresh.bound);
      await assertRouteDeliversImages(route.adapter.id, { home: HOST.process.env.HOME, cwd: status.worktree! });
      visualDelivery = await deliverVisualReferences(fresh, deliveryDirectory(options.attemptDir, runId));
    }
    const openPermission = (): PermissionSession => openPermissionSession({
      canonicalRepository: status.repository,
      worktree: status.worktree!,
      sessionRuntime: runtimeDir,
      stateRoot: options.stateRoot,
      profile: route.agent.tools.profile,
      tools: route.agent.tools.allow,
      writes: route.agent.writes,
      protectedPaths: options.config.policy.protected_paths,
      ...(visualDelivery === null ? {} : { readOnlyRoots: [visualDelivery.directory] }),
      providerWritableRoots: route.adapter.providerWritableRoots?.(HOST.process.env) ?? [],
      ...(protectedCapability === undefined ? {} : { protectedCapability }),
      ...(infra.sandboxProbe === undefined ? {} : { sandboxProbe: infra.sandboxProbe }),
    });
    // Re-armed after every candidate commit, because both objects measure "what
    // changed since I opened" and a correction round needs that measured from
    // the candidate it is correcting rather than from the seeded worktree. The
    // CUMULATIVE view — writes globs, protected paths, the declared diff — is a
    // separate check, taken from the attempt base by `phaseGates`.
    let permission: Pick<PermissionSession, "before" | "enforce" | "sandbox" | "sandboxBadge" | "profile"> = restored === null ? openPermission()
      : savedResultPermissions(restored, route.agent, status.worktree!, options.config.policy.protected_paths);
    if (visualDelivery !== null) {
      await persist("attempt.updated", { lastActivityAt: infra.now(), lastActivity: `${phase.id}: delivered ${String(visualDelivery.frames.length)} visual reference(s)` }, {
        type: "visual-references-delivered", phaseId: phaseDb, runId, bindingDigest: visualBound!.bindingDigest,
        frames: visualDelivery.frames.map((frame) => ({ id: frame.id, sha256: frame.sha256 })),
        readOnly: permission.sandboxBadge === "os-enforced" ? "os-enforced" : "digest-checked", at: infra.now(),
      });
    }
    // A seeded phase, and a shift phase after the first ticket's, starts on a
    // head that already holds work it did not write. Its claims are measured
    // from the head it started on (for ticket 1, the base itself); the risk
    // and protected checks still see the whole candidate from the base.
    const attributionBaseSha = seed === null && shiftPhaseRole(recipe.phases, phase.id) === null ? null : runGit(systemGitRunner(status.worktree!), ["rev-parse", "HEAD"]).trim();
    const openHostGit = (): HostPhaseGit<EnvelopeBase> => {
      const message = (envelope: EnvelopeBase): string => roleOf(phase.id) === "builder" ? (envelope as BuildOutput).proposedCommitMessage : `chore: record ${phase.id} output`;
      const ordinary = createHostPhaseGit<EnvelopeBase>({ repository: status.worktree!, ...(restored === null ? {} : { before: restored.before }), commitMessage: message });
      if (protectedCapability === undefined) return ordinary;
      let observed: readonly string[] | null = null;
      return { captureDiff: () => { observed = ordinary.captureDiff(); return observed; }, commit: async (envelope, paths) => {
        if (observed === null || paths !== observed) throw new Error("protected commit requires its host-captured diff object");
        return commitProtectedAsHost({ attemptDir: options.attemptDir, capability: protectedCapability, message: message(envelope), paths,
          writes: route.agent.writes, protectedPaths: options.config.policy.protected_paths,
          ...(infra.afterProtectedHeadPublished === undefined ? {} : { afterHeadPublished: infra.afterProtectedHeadPublished }),
          persistIntent: async intent => persist("attempt.updated", {}, { type: "protected-commit-intent", intent }),
          persistWitness: async witness => persist("attempt.updated", {}, { type: "protected-lock-witness", witness }),
          persistBinding: async binding => persist("attempt.updated", {}, { type: "protected-candidate", binding }) });
      } };
    };
    let hostGit = openHostGit();
    const commitMessageFor = (envelope: EnvelopeBase): string => roleOf(phase.id) === "builder" ? (envelope as BuildOutput).proposedCommitMessage : `chore: record ${phase.id} output`;
    const protectedConsumptionId = protectedCapability === undefined ? null : protectedWriteContext(protectedCapability)!.consumption.id;
    /** The durable stage this phase is being resumed into, or null for an ordinary run. */
    const restoredValidation = restored === null ? null : recovery?.inspected.checkpoint.validation ?? null;

    /**
     * The progress record for one stage. Only the `commit` stage carries an
     * intent, and it records it from the worktree as it stands immediately
     * before the transport — the same measurement the reconciliation will make
     * again afterwards.
     */
    const validationProgressFor = async (stage: HostValidationStage, current: PhaseRecovery,
      changed: readonly string[], envelope: StoredEnvelope<EnvelopeBase>): Promise<HostValidationProgress> => {
      const pending = current.pending!;
      const base: HostValidationProgress = { schema: "awsf.host-validation/v1", phaseKey: phase.id, ordinal,
        round: pending.round, runId: pending.runId, envelopeId: pending.envelopeId, envelopeDigest: pending.envelopeDigest,
        resultCheckpointId: current.validation?.resultCheckpointId ?? current.id, stage,
        commitIntent: current.validation?.commitIntent ?? null, commitResult: current.validation?.commitResult ?? null,
        protectedConsumptionId: current.validation?.protectedConsumptionId ?? null };
      if (stageOrdinal(stage) < stageOrdinal("commit")) return { ...base, commitIntent: null, commitResult: null, protectedConsumptionId: null };
      if (stage === "commit" && base.commitIntent === null && base.protectedConsumptionId === null) {
        const git = systemGitRunner(status.worktree!);
        const parentSha = runGit(git, ["rev-parse", "HEAD"]).trim();
        if (protectedConsumptionId !== null) return { ...base, protectedConsumptionId };
        return { ...base, commitIntent: { intentId: randomUUID(), phaseKey: phase.id, ordinal, round: pending.round, runId: pending.runId,
          parentSha, message: commitMessageFor(envelope.payload!), author: HOST_AUTHOR, committer: HOST_AUTHOR,
          changedPaths: [...changed], committedPaths: [...changesSinceBase(status.worktree!, parentSha, git)],
          contentDigest: await hostCommitContentDigest(status.worktree!, parentSha, git),
          treeDigest: await savedResultTreeDigest(status.worktree!, git) } };
      }
      if (stageOrdinal(stage) > stageOrdinal("commit") && base.commitResult === null && base.commitIntent !== null) {
        const git = systemGitRunner(status.worktree!);
        const head = runGit(git, ["rev-parse", "HEAD"]).trim();
        return { ...base, commitResult: { intentId: base.commitIntent.intentId,
          commitSha: head === base.commitIntent.parentSha ? null : head,
          treeDigest: await savedResultTreeDigest(status.worktree!, git) } };
      }
      return base;
    };

    /**
     * Adopt whatever the interrupted run actually produced.
     *
     * The ordinary path asks Git objects whether the recorded intent's commit
     * exists; the protected path completes a publication whose every byte the
     * intent pinned. Neither creates a commit that already exists, and neither
     * re-dispatches a configured command that already ran.
     */
    const adoptRestoredCommit = async (progress: HostValidationProgress): Promise<HostCommitAdoption | null> => {
      const verified = stageOrdinal(progress.stage) > stageOrdinal("verify-candidate");
      // A protected generation is one-use, so its phase is never re-entered and
      // this is unreachable for it: `verifyProtectedWrite` refuses a consumed
      // activation long before the engine runs. Its publication is reconciled
      // once, before any phase starts, by the block at the top of this command.
      if (progress.protectedConsumptionId !== null) throw new Error("a protected generation's host effect is reconciled before re-entry, never inside one");
      if (progress.commitIntent === null) return null;
      const reconciliation = await reconcileHostCommit(progress.commitIntent, { worktree: status.worktree!, git: systemGitRunner(status.worktree!) });
      if (reconciliation.outcome === "refused") throw new Error(`recovery refused: ${reconciliation.reason}`);
      if (reconciliation.outcome === "not-committed") return null;
      return { candidateSha: reconciliation.commitSha, verified };
    };
    const rolePrompt = renderProductionRolePrompt(phase, previous, designContext, status.request, route.agent);
    const grantContext = protectedPromptContext(phaseGrant);
    const originalPrompt = rolePrompt + seedContext(status) + resumeInstructionContext(instructions) + grantContext +
      (visualDelivery === null ? "" : visualReferencePrompt(visualDelivery));
    const amendment = phase.id === seed?.builderPhaseKey ? seed.ownerAmendment : null;
    const instruction = instructionFor(phase.id);
    if (instruction !== null) {
      assertResumeInstruction(instruction);
      if (attempt !== 1 || (restored === null && instruction.amendment.binding.operationId !== operationId) || instruction.amendment.binding.phaseOrdinal !== ordinal ||
          instruction.amendment.binding.originalPromptBundleDigest !== recoveryDigest(routePrompts.get(phase.id)!)) throw new Error("resume instruction launch binding changed");
    }
    const composedInput = instruction === null ? composeOwnerAmendment(originalPrompt, amendment) : composeResumeInstruction(originalPrompt, amendment, instruction);
    const renderedPrompt = composedInput.composedText;
    for (const [name, text] of (restored === null ? [["system", route.systemPrompt], ["user", originalPrompt],
      ...(amendment === null && instruction === null ? [] : [["user+owner-amendment", renderedPrompt]])] : []) as [string, string][]) {
      await persist("attempt.updated", {}, {
        type: "compiled-prompt", phaseId: phaseDb, name, text,
        ...(name === "system" ? route.evidence : {}),
        lineCount: text.split(/\r?\n/).length, at: infra.now(),
      });
    }
    const gatedPhase = {
      ...phase,
      ...(phaseGrant === null ? {} : { maxCorrections: 0 }),
      // The engine renders once more at launch. Pin it to the exact prompt
      // persisted above, including architecture review's repository envelope.
      renderPrompt: () => renderedPrompt,
      gates: [
        ...phase.gates,
        ...phaseGates(
          roleOf(phase.id),
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
          attributionBaseSha,
          async () => {
            if (protectedState.grants.length === 0) return [];
            const capabilities: ProtectedFilesCapability[] = protectedCapability === undefined ? [] : [protectedCapability];
            if (readProtectedState(options.attemptDir).bindings.length > 0) capabilities.push(await verifyProtectedPreservation(options.attemptDir, runGit(systemGitRunner(status.worktree!), ["rev-parse", "HEAD"]).trim(), protectedCapability));
            return capabilities;
          },
        ),
        ...(visualPhase ? [{
          id: "visual_references_inspected",
          run: () => visualReferencesInspected({ phaseId: phaseDb, frames: visualBound!.frames, observations: visualObservations }),
        }] : []),
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
    // route configured `continuity: none` gets no correction conversation.
    // Explicit interrupted-turn retention opens a separate cold-turn record below.
    const conversationRef = route.continuity && restored === null
      ? (await continuity.open({
          phaseId: phase.id,
          adapter: route.adapter.id,
          provider: route.model.provider,
          model: route.model.requestedModel,
          storeDir: (route.adapter as ContinuityCapableAdapter).continuityStoreDir(runtimeDir),
        }), continuity.ref(handle))
      : null;
    if (conversationRef?.storeDir != null) await mkdir(conversationRef.storeDir, { recursive: true, mode: 0o700 });
    if (route.continuity && restored === null) {
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
    const verifyCandidate = roleOf(phase.id) === "builder" && reviewContext === null && route.continuity
      ? async ({ candidateSha, correctionRound }: { candidateSha: string; correctionRound: number }): Promise<CandidateVerification> => {
          const measured = await measureCandidate(phase.id, candidateSha, correctionRound, "verify-candidate");
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
    let amendmentInputBound = false;
    let instructionInputBound = false;
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
        if (restored !== null) throw new Error("saved reply validation cannot call a model");
        const turn = turnIndex;
        turnIndex += 1;
        await phaseQueue;
        const turnRunId = runIdFor(turn);
        // Every turn — corrections included — re-proves the delivered bytes
        // before anything is held or launched, rather than trusting that the
        // copy an earlier turn saw is still the copy on disk.
        if (visualDelivery !== null) await revalidateDelivery(visualDelivery);
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
        const retainedColdTurn = await openRetainedColdTurn({ agent: route.agent, adapter: route.adapter,
          store: continuity, phaseKey: phase.id, round: turn, runtimeDir });
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
            let delivery: OwnerAmendmentDelivery | null = null;
            if (instruction !== null && turn === 0) {
              if (instructionInputBound || prompt !== renderedPrompt || spec.stdin !== renderedPrompt || sha256(spec.stdin) !== instruction.composedDigest) {
                if (!instructionInputBound) {
                  // This callback has not delegated to the provider broker. No process was launched for this held call.
                  budget.releaseOnRegistrationFailure(reservation.id);
                  await persist("attempt.updated", { budget: budget.snapshot(), lastActivity: "rejected amended input before provider broker delegation" });
                }
                throw new Error("resume instruction differs from actual adapter input or was already submitted");
              }
              const target = { operationId, logicalTurnId: turnRunId, originalInputDigest: instruction.originalInputDigest, composedDigest: instruction.composedDigest };
              if (ownerAmendmentDeliveryAction(instruction.amendment, null, "new-phase-input", target) !== "deliver-initial-input") throw new Error("resume instruction cannot be delivered");
              delivery = { schema: "awsf.owner-amendment-delivery/v1", amendmentId: instruction.amendment.id,
                amendmentDigest: instruction.amendment.digest, bindingDigest: recoveryDigest(instruction.amendment.binding),
                ...target, state: "intent", providerAcknowledgementDigest: null };
              await persist("attempt.updated", {}, { type: "resume-instruction-delivery", phaseId: phaseDb, delivery, at: infra.now() });
              instructionInputBound = true;
            }
            if (amendment !== null && turn === 0) {
              if (amendmentInputBound) throw new Error("owner amendment input was already bound to this turn");
              if (prompt !== renderedPrompt || spec.stdin !== renderedPrompt || sha256(spec.stdin) !== composedInput.composedDigest) {
                throw new Error("owner amendment differs from the actual adapter input");
              }
              await persist("attempt.updated", {}, {
                type: "owner-amendment-delivery", amendmentId: amendment.id, amendmentDigest: amendment.digest,
                phaseId: phaseDb, logicalTurnId: turnRunId, originalInputDigest: composedInput.originalInputDigest,
                composedDigest: composedInput.composedDigest, at: infra.now(),
              });
              amendmentInputBound = true;
            }
            const grant = permission.sandbox(spec);
            const launchAt = infra.now();
            await persist("attempt.updated", { lastActivityAt: launchAt, lastActivity: `${phase.id}: route and sandbox grant recorded before GO` }, {
              type: "agent-start", phaseId: phaseDb, agent: route.agent.name, adapterId: route.adapterId,
              provider: route.model.provider, color: route.agent.color, requestedModel: route.agent.model,
              sandboxBadge: grant.badge, sandboxMechanism: grant.mechanism, purpose,
              persistence: phasePersistenceEvidence(route.agent, route.adapter,
                retainedColdTurn?.handle ?? (conversationRef === null ? null : handle), grant.spec, route.systemPrompt),
              route: route.provenance, at: launchAt,
            });
            if (instruction !== null && turn === 0 && grant.spec.stdin !== renderedPrompt) throw new Error("sandbox changed the authorized resume input");
            brokerDelegatedReservations.add(reservation.id);
            const transport = await (broker ??= infra.createBroker(brokerOptions)).startProcess(registered, grant.spec, signal);
            turnLaunch.transport = transport;
            if (delivery !== null) {
              await persist("attempt.updated", {}, { type: "resume-instruction-delivery", phaseId: phaseDb,
                delivery: { ...delivery, state: "submitted" }, at: infra.now() });
              submittedInstructions.add(delivery.amendmentDigest);
            }
            return transport;
          },
        };
        const request = buildPhaseRequest({ agent: route.agent, prompt, systemPromptPath, cwd: status.worktree!,
          env: HOST.process.env,
          ...(retainedColdTurn !== null ? { continuity: { ref: retainedColdTurn.ref, turn: "open" as const } }
            : conversationRef === null ? {} : { continuity: { ref: conversationRef, turn: turn === 0 ? "open" as const : "resume" as const } }),
        });
        const events: NormalizedEvent[] = [];
        let output = "";
        let resolved: { model: string; provenance: ModelResolutionProvenance } | null = null;
        let terminal: NormalizedEvent | null = null;
        const observed: ObservedProviderSession = { sessionId: null, resolvedModel: null, costUsd: null,
          ...(visualDelivery === null ? {} : { images: [] }) };
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
        if (visualDelivery !== null) {
          const observations = matchObservations(visualBound!.frames, observed.images ?? []);
          visualObservations.push(...observations.map((observation) => ({ ...observation, phaseId: phaseDb })));
          await persist("attempt.updated", {}, { type: "visual-reference-inspection", phaseId: phaseDb, runId: turnRunId, observations, at: infra.now() });
        }
        if (terminal?.kind === "run.completed" && terminal.exitCode === 0 && turnLaunch.transport !== undefined) {
          const stopped = await turnLaunch.transport.cancel("completed provider turn cleanup");
          if (!stopped.terminated || stopped.survivors.length > 0 || stopped.skipped !== null) throw new Error("completed provider turn has unresolved descendants");
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
        ...(restored === null ? {} : { initialEnvelope: recovery!.inspected.pendingEnvelope!, initialUsage: originalUsage.snapshot() }),
        onResultStored: async envelope => {
          if (protectedCapability !== undefined) assertProtectedOutput(protectedCapability, status.worktree!);
          await phaseQueue;
          if (!envelope.valid || envelope.payload === null) return;
          const original = budget.reservation(reservation.id)!;
          if (original.state !== "spent" || original.kind !== "single" || original.cost !== 1 || (original.edge !== null && original.edge !== "L4" && original.edge !== "L11")) throw new Error("completed reply has no original debit");
          let treeDigest: string;
          try { treeDigest = await savedResultTreeDigest(status.worktree!, systemGitRunner(status.worktree!)); }
          catch (error) { if (error instanceof ResultSnapshotUnavailable) return; throw error; }
          const stored = storedEnvelopes.get(phase.id)!;
          const pending: SavedPhaseResult = { phaseKey: phase.id, runId: runIdFor(envelope.correctionRound), ordinal,
            envelopeId: stored.envelopeId, envelopeDigest: recoveryDigest(stored), round: envelope.correctionRound,
            ...(instruction === null ? {} : { ownerAmendmentDigest: instruction.amendment.digest }),
            worktreeDigest: treeDigest, before: permission.before, sandboxBadge: permission.sandboxBadge,
            reservation: { ...original, edge: original.edge, cost: 1, kind: "single", state: "spent", spent: 1 }, model: route.model };
          const checkpoint = await checkpointAt("result-ready", null, pending);
          if (checkpoint === null) throw new Error("completed reply has unsettled execution");
          await persist("attempt.updated", { recovery: checkpoint, budget: budget.snapshot() },
            { type: "phase-result-ready", phase: phaseRecords.get(phase.id)!, checkpoint });
        },
        /**
         * Advance the durable stage instead of clearing the checkpoint.
         *
         * Before A3 this wrote `{ recovery: null }`, so a crash anywhere in
         * host validation left a journal that could not say whether a gate had
         * run or a commit had been created. Each stage now supersedes the last,
         * citing the checkpoint it replaces, and the `commit` stage carries the
         * exact intent its reconciliation needs.
         */
        onValidationStage: async (stage, context) => {
          const current = status.recovery;
          if (current?.pending?.phaseKey !== phase.id || context.correctionRound !== current.pending.round) return;
          const progress = await validationProgressFor(stage, current, context.changedPaths, context.envelope);
          const next: PhaseRecovery = { ...current, id: randomUUID(), kind: "validating", validation: progress, createdAt: infra.now() };
          await persist("attempt.updated", { recovery: next },
            { type: "phase-validation-started", phaseId: phaseDb, checkpointId: current.id });
        },
        ...(restoredValidation === null ? {} : { reconcileCommit: async () => adoptRestoredCommit(restoredValidation) }),
        agentSessionId: status.sessionId,
        onPhaseState,
        onAccepted: async result => {
          await phaseQueue;
          const gatedSha = reviewContext === null ? result.candidateSha : reviewContext.candidateSha;
          for (const report of result.gateReports) await persistGate(phase.id, report, gatedSha, result.correctionRounds);
          if (roleOf(phase.id) === "builder") {
            const report = headAdvanced({ baseSha: status.baseSha!, headSha: result.candidateSha, hostCommitExists: result.candidateSha !== null });
            await persistGate(phase.id, report, result.candidateSha);
            if (!report.passed) throw new PhaseGateFailure(phase.id, [report]);
          }
          if (reviewContext !== null) {
            const review = result.envelope.payload! as ReviewOutput;
            await persist("attempt.updated", { lastActivityAt: infra.now(), lastActivity: `${phase.id}: ${route.model.provider} returned ${review.verdict}` }, {
              type: "review", phaseId: phaseDb, adapterId: route.adapterId, provider: route.model.provider,
              verdict: review.verdict, reviewedSha: review.reviewedSha, findingCount: review.findings.length, at: infra.now(),
            });
          }
          await acceptPhase(phase.id, result.candidateSha);
        },
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
          if (phaseGrant !== null) return { actor: null, reason: "protected generation is one-use; corrections require separate authorization" };
          if (restored !== null) return { actor: null, reason: "saved reply validation cannot authorize another model call" };
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
  let agentOrdinal = compiled.phases.slice(0, prefix.length).filter(phase => phase.kind === "agent" && !isReviewPhase(phase)).length;
  const restartIndex = prefix.length;
  let activationPending = recovery !== undefined;
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

  const applyAcceptedContext = (): void => {
    const context = reducePhaseContext(acceptedEnvelopes, seededRequest);
    previous = context.previous;
    intent = context.schemas.get("awsf.plan-output/v1") as PlanOutput | undefined ?? seededRequest;
    designContext = context.schemas.get(DESIGN_CONTEXT_SCHEMA_ID) as DesignContext | undefined ?? null;
    designOutput = context.schemas.get(DESIGN_OUTPUT_SCHEMA_ID) as DesignOutput | undefined ?? null;
    architectureReviewOutput = context.schemas.get(ARCHITECTURE_REVIEW_OUTPUT_SCHEMA_ID) as ArchitectureReviewOutput | undefined ?? null;
    planContext = context.schemas.get(PLAN_CONTEXT_SCHEMA_ID) as PlanContext | undefined ?? null;
    designPlanOutput = context.schemas.get(DESIGN_PLAN_OUTPUT_SCHEMA_ID) as DesignPlanOutput | undefined ?? null;
    lastTestOutput = context.schemas.get("awsf.test-output/v1") as TestOutput | undefined ?? null;
    reviewEvidence = context.schemas.get(REVIEW_CONTEXT_SCHEMA_ID) as ReviewContext | undefined ?? null;
    candidateSha = prefix.at(-1)?.candidateSha ?? null;
  };
  if (recovery !== undefined) applyAcceptedContext();

  const checkpointAt = async (kind: PhaseRecovery["kind"], quota: BoundaryQuota | null, pending?: SavedPhaseResult): Promise<PhaseRecovery | null> => {
    if ((prefix.length === 0 && pending === undefined) || status.process !== null || budget.outstanding().length > 0) return null;
    const git = systemGitRunner(status.worktree!);
    if (pending === undefined) assertClean(status.worktree!, "after", git);
    const nextPhase = recipe.phases[prefix.length];
    const ticket = nextPhase === undefined ? null : shiftTicketOf(recipe.phases, nextPhase.id);
    const checkpoint: PhaseRecovery = { schema: "awsf.phase-recovery/v1", id: randomUUID(), sessionId: status.sessionId,
      kind, ...(pending === undefined ? {} : { pending }), ...(ticket === null ? {} : { ticket }), workflowId: compiled.id, bindingDigest, prefix: [...prefix],
      repository: await realpath(status.repository), worktree: await realpath(status.worktree!),
      commonGitDir: await realpath(runGit(git, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()),
      integrationBaseSha: status.baseSha!, worktreeHeadSha: runGit(git, ["rev-parse", "HEAD"]).trim(),
      budgetDigest: recoveryBudgetDigest(budget.snapshot()), quota, createdAt: infra.now() };
    return checkpoint;
  };
  const acceptPhase = async (phaseId: string, producedSha: string | null): Promise<void> => {
    const stored = storedEnvelopes.get(phaseId);
    const phase = phaseRecords.get(phaseId)!;
    if (!stored?.valid || stored.payload === null || phase.ordinal !== prefix.length + 1) throw new Error("cannot accept an invalid or out-of-order phase result");
    if (producedSha !== null) candidateSha = producedSha;
    const instruction = instructionFor(phaseId);
    if (instruction !== null && !submittedInstructions.has(instruction.amendment.digest)) throw new Error("resume instruction never reached the actual provider launch");
    const accepted: AcceptedPhase = { phaseKey: phaseId, ordinal: phase.ordinal, envelopeId: stored.envelopeId,
      ...(instruction === null ? {} : { ownerAmendmentDigest: instruction.amendment.digest }),
      envelopeDigest: recoveryDigest(stored), round: stored.correctionRound, candidateSha };
    prefix.push(accepted);
    acceptedEnvelopes.set(phaseId, stored.payload);
    const record = { ...phase, status: "SUCCEEDED", correctionCount: stored.correctionRound, endedAt: infra.now() };
    phaseRecords.set(phaseId, record);
    const checkpoint = await checkpointAt("completed-phase", null);
    await persist("attempt.updated", { recovery: checkpoint, candidateSha, budget: budget.snapshot(),
      phase: { name: phaseId, state: "SUCCEEDED", round: stored.correctionRound, maximumRounds: phase.maxCorrections },
      lastActivity: `${phaseId}: accepted result and recovery checkpoint durable`, lastActivityAt: infra.now() },
      { type: "phase-accepted", phase: record, accepted });
    if (instruction !== null) instructions.push(instruction);
    applyAcceptedContext();
  };

  /**
   * A shift that can no longer fund the correction round its next ticket build
   * declares stops at the clean boundary before that build, instead of running
   * it with the round silently removed. A malformed reply there would otherwise
   * block the attempt terminally, and a BLOCKED attempt cannot be raised.
   *
   * It is `awsf start`'s unfundable-correction rule applied again at each
   * ticket, and `preflightRecovery` asks the same question, so a resume
   * without a raise refuses and one after it proceeds. The shift never widens
   * its own ceiling: only the owner's `awsf raise` at a TTY does (INV-5).
   * The stop is placed before, not after, a failed build because the host has
   * no path that discards a reply's uncommitted writes, and must not gain one.
   */
  const ceilingPauseBefore = async (phase: CompiledAgentPhase, index: number): Promise<boolean> => {
    const ticket = shiftTicketOf(recipe.phases, phase.id);
    const route = routes.get(phase.id);
    if (ticket === null || route === undefined || route.continuity || phase.maxCorrections === 0 ||
        budget.allowance.auto === 0 || prefix.length !== index) return false;
    const initialCalls = compiled.phases.slice(index).filter((candidate) => candidate.kind === "agent").length;
    if (budget.remaining >= initialCalls + 1) return false;
    const short = initialCalls + 1 - budget.remaining;
    const checkpoint = await checkpointAt("ceiling-pause", null);
    if (checkpoint === null) throw new Error("ceiling boundary has unsettled execution; no pause permitted");
    await verifyRecoveryWorktree(status, checkpoint, await verifyCandidateLedgerVerdict(options.attemptDir, options.config, status, checkpoint));
    const detail = `ceiling stop before ticket ${ticket} (${phase.id}): ${String(budget.committed)} of ${String(budget.ceiling)} calls spent; ` +
      `${ticket}, every ticket after it and the review need ${String(initialCalls)} call(s), and ${ticket}'s declared correction round needs 1 more`;
    const remedy = budget.ceiling + short > MAX_CALL_CEILING
      ? `no awsf raise can fund it, because ${String(budget.ceiling + short)} exceeds MAX_CALL_CEILING (${String(MAX_CALL_CEILING)})`
      : `the owner runs \`awsf raise ${status.taskId} --calls ${String(short)} --reason "<why>"\` at a TTY, then \`awsf resume ${status.taskId} --reason "<why>"\``;
    await persist("attempt.updated", { recovery: checkpoint, phase: null, process: null, budget: budget.snapshot(),
      lastActivity: detail, lastActivityAt: infra.now(), nextAction: `ceiling-paused before ticket ${ticket}; ${remedy}` },
      { type: "ceiling-pause", checkpoint });
    return true;
  };

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
    let selectedQuota: BoundaryQuota | null = null;

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
      if (row.provider !== null && row.scope !== null && row.minutesToReset !== null && threshold !== null && row.verdict === "below") {
        selectedQuota = { adapterId: row.adapterId, provider: row.provider, scope: row.scope,
          minutes: row.minutesToReset, threshold: threshold.minutes, observedAt: boundaryAt, readoutDigest: recoveryDigest(row) };
      }
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
    if (!isReviewPhase(next) && agentOrdinal > 0 && selectedQuota !== null && prefix.length === compiled.phases.indexOf(next)) {
      const checkpoint = await checkpointAt("quota-pause", selectedQuota);
      if (checkpoint === null) throw new Error("quota boundary has unsettled execution; no pause or refund permitted");
      await verifyRecoveryWorktree(status, checkpoint, await verifyCandidateLedgerVerdict(options.attemptDir, options.config, status, checkpoint));
      await persist("attempt.updated", { recovery: checkpoint, phase: null, process: null, budget: budget.snapshot(),
        lastActivity: detail, lastActivityAt: infra.now(), nextAction: `quota-paused before ${next.id}; run awsf resume ${status.taskId} --reason "quota recovered"` },
        { type: "quota-pause", checkpoint });
      return true;
    }
    options.assertAdvancement?.(status.sessionId, "AWAITING_OWNER");
    // L4 may have held the first call before an initial host-only phase. The
    // boundary stop prevents registration, so that never-launched call returns
    // to the ledger before the attempt waits on its owner.
    for (const reservation of budget.outstanding()) {
      if (agentOrdinal !== 0 || reservation.id !== firstReservation?.id) throw new Error("quota boundary has an unresolved reservation");
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
        request: composeOwnerAmendment(status.request, seed?.ownerAmendment ?? null).composedText + seedContext(status) + resumeInstructionContext(instructions),
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
    if (recovery !== undefined && (savedResult !== undefined || remainingCalls === 0 || compiled.phases[restartIndex]?.kind !== "agent" || isReviewPhase(compiled.phases[restartIndex]!))) {
      await persist("attempt.updated", { activeOperation: operationId }, { type: "resume-activation", operationId, quotaReadings: recovery.quotaReadings,
        ...(recovery.instruction == null ? {} : { ownerInstruction: recovery.instruction }),
        checkpointId: recovery.inspected.checkpoint.id, reason: recovery.reason, reservationId: null, phase: null });
      activationPending = false;
    }
    if (recovery !== undefined && reviewEvidence !== null && !acceptedEnvelopes.has(compiled.phases.find(isReviewPhase)?.id ?? "")) {
      const retained = reviewEvidence;
      const rebuilt = await composeReviewEvidence("recovery-review-evidence");
      if (recoveryDigest(rebuilt) !== recoveryDigest(retained)) throw new Error("stored review context changed during recovery");
    }
    for (const [index, phase] of compiled.phases.entries()) {
      if (isReviewPhase(phase)) reviewPhase = { phase: phase as CompiledAgentPhase, ordinal: index + 1 };
      if (index < restartIndex) continue;
      if (index > 0 && !(recovery !== undefined && index === restartIndex && (recovery.inspected.checkpoint.kind === "quota-pause" || savedResult !== undefined))) {
        const completed = compiled.phases[index - 1]!;
        if (phaseRecords.get(completed.id)?.status === "SUCCEEDED") {
          const stopped = await takePhaseBoundarySnapshot(completed, phase);
          if (stopped) return status;
        }
      }
      if (phase.kind === "engineer") {
        await persistPhase(phase.id, "RUNNING");
        // A shift brief carries its ticket's own compiled intent; every other
        // engineer phase restates the owner's request.
        const request = "intent" in phase ? (phase as unknown as ShiftBriefPhase).intent : requestOutput(status, options.config);
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
        if (agentOrdinal > 0 && savedResult?.phaseKey !== phase.id && await ceilingPauseBefore(phase, index)) return status;
        agentOrdinal += 1;
        const reservation = savedResult?.phaseKey === phase.id ? budget.restoreReservation(savedResult.reservation) : agentOrdinal === 1 && firstReservation !== null
          ? firstReservation
          : budget.reserve({ cost: 1, subject: `${compiled.id}:${phase.id}` });
        const protectedConsumption = !protectedState.grants.some(value => value.subject.phaseKey === phase.id) ? null
          : prepareProtectedConsumption(options.attemptDir, await protectedGrantSubject(options, status, phase.id), operationId, reservation.id);
        if (activationPending) {
          const started = { ...phaseRecords.get(phase.id)!, status: "RUNNING", startedAt: infra.now() };
          await persist("attempt.updated", { recovery: null, activeOperation: operationId, budget: budget.snapshot(),
            phase: { name: phase.id, state: "RUNNING", round: 0, maximumRounds: phase.maxCorrections } },
            { type: "resume-activation", operationId, quotaReadings: recovery!.quotaReadings,
              ...(recovery!.instruction == null ? {} : { ownerInstruction: recovery!.instruction }), checkpointId: recovery!.inspected.checkpoint.id,
              reason: recovery!.reason, reservationId: reservation.id, phase: started,
              ...(protectedConsumption === null ? {} : { protectedConsumption }) });
          phaseRecords.set(phase.id, started);
          activationPending = false;
        } else if (protectedConsumption !== null || (agentOrdinal > 1 && savedResult?.phaseKey !== phase.id)) {
          const started = { ...phaseRecords.get(phase.id)!, status: "RUNNING", startedAt: infra.now() };
          await persist("attempt.updated", { budget: budget.snapshot(), lastActivityAt: infra.now(), lastActivity: `held one call for ${phase.id}`,
            ...(protectedConsumption === null ? {} : { activeOperation: operationId, phase: { name: phase.id, state: "RUNNING", round: 0, maximumRounds: 0 } }) },
            protectedConsumption === null ? undefined : { type: "protected-activation", consumption: protectedConsumption, phase: started });
          if (protectedConsumption !== null) phaseRecords.set(phase.id, started);
        }
        const result = await runAgent(phase, index + 1, previous, reservation, recovery === undefined && agentOrdinal === 1, null);
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
    if (protectedState.grants.length > 0 && candidateSha !== null) inspectProtectedCandidate(options.attemptDir, candidateSha);
    const l7Evidence = readOnlyResult === null
      ? { requiredPhasesTerminalSuccess: true, hostCommitCreated: true, baseSha: status.baseSha!, candidateSha: candidateSha! }
      : { requiredPhasesTerminalSuccess: true, hostCommitCreated: false, baseSha: status.baseSha!, readOnlyResult };
    if (status.lifecycleState === "RUNNING") {
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
    }
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
    const recoveredReviewOutput = acceptedEnvelopes.get(reviewPhase.phase.id) as ReviewOutput | undefined;
    let reviewOutput: ReviewOutput;
    if (recoveredReviewOutput !== undefined) {
      if (status.lifecycleState !== "REVIEWING" || recoveredReviewOutput.reviewedSha !== reviewed) throw new Error("completed review binding changed");
      reviewOutput = recoveredReviewOutput;
    } else if (savedResult?.phaseKey === reviewPhase.phase.id) {
      if (status.lifecycleState !== "REVIEWING") throw new Error("saved review has lost its original lifecycle binding");
      const result = await runAgent(reviewPhase.phase, reviewPhase.ordinal, previous, budget.restoreReservation(savedResult.reservation), false,
        { candidateSha: reviewed, candidatePaths: candidatePathsBetween(status.worktree!, status.baseSha!, reviewed), evidence: reviewEvidence, expectation: reviewExpectation });
      reviewOutput = result.envelope as ReviewOutput;
    } else {
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
        // An uncertain amended submission cannot be sent again as a transport retry.
        const transport = instructionFor(reviewPhase!.phase.id) === null && isReviewTransportFailure(error);
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
    reviewOutput = reviewResult.envelope as ReviewOutput;
    }

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
    // Only positive local non-delegation permits a refund. A thrown broker call may have launched a process.
    for (const reservation of budget.outstanding()) {
      if (!brokerDelegatedReservations.has(reservation.id)) budget.releaseOnRegistrationFailure(reservation.id);
    }
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
  return withExecutionLease(options.attemptDir, async () => {
    const status = await readAttempt(options.attemptDir);
    if (status.recovery != null) throw new Error("saved phase result or quota anchor exists; use awsf resume");
  }, async operationId => persistReadableRunReport(options, await executeProductionCommand(options, operationId)));
}

async function preflightRecovery(options: ProductionRunOptions): Promise<RecoveryInspection> {
  await assertNoExecutionController(options.attemptDir);
  const inspected = await inspectPhaseRecovery(options.attemptDir);
  const { status, checkpoint } = inspected;
  if (!["RUNNING", "GATING", "REVIEWING"].includes(status.lifecycleState)) throw new Error("resume requires an unfinished, unsealed workflow");
  if (toConfigSnapshotJson(options.config) !== status.configSnapshotJson ||
      await productionRecoveryBinding(options, status) !== checkpoint.bindingDigest) throw new Error("resume refused: configuration, request, recipe or prompts changed");
  const recipe = (await attemptRecipe(options, status))!;
  for (const entry of checkpoint.prefix) {
    const phase = recipe.phases[entry.ordinal - 1];
    if (phase?.id !== entry.phaseKey || inspected.envelopes.get(entry.phaseKey)?.schema !== phase.schemaId) throw new Error("resume accepted prefix does not match the compiled recipe");
  }
  if (checkpoint.kind === "quota-pause" || checkpoint.kind === "ceiling-pause") {
    const next = recipe.phases[checkpoint.prefix.length];
    if (status.lifecycleState !== "RUNNING" || next?.kind !== "agent" || isReviewPhase(next)) throw new Error(`${checkpoint.kind === "quota-pause" ? "quota" : "ceiling"} anchor does not name an unstarted ordinary agent phase`);
  }
  await verifyRecoveryWorktree(status, checkpoint, await verifyCandidateLedgerVerdict(options.attemptDir, options.config, status, checkpoint));
  if (checkpoint.pending !== undefined) {
    const phase = recipe.phases[checkpoint.prefix.length];
    if (phase?.id !== checkpoint.pending.phaseKey || phase.schemaId !== inspected.pendingEnvelope?.schemaId) throw new Error("saved reply does not match the compiled phase");
  }
  const remaining = recipe.phases.slice(checkpoint.prefix.length).filter(phase => phase.kind === "agent" && phase.id !== checkpoint.pending?.phaseKey);
  const coldHeadroom = options.config.risk.correction_allowance.auto > 0 && remaining.some(phase =>
    phase.maxCorrections > 0 && options.config.agents.find(agent => agent.name === phase.owner)?.harness.continuity === "none") ? 1 : 0;
  const ledger = new CallBudget({ taskId: status.taskId, tier: status.tier, allowance: status.budget.allowance,
    ...(status.budget.ceiling === undefined ? {} : { ceiling: status.budget.ceiling }),
    carried: { attempt: status.attempt, callsSpent: status.budget.callsSpent } });
  try {
    ledger.admitWorkflow({ id: recipe.id, minimumCalls: remaining.length + coldHeadroom });
  } catch (error) {
    if (!(error instanceof CallCeilingExceeded)) throw error;
    // The same refusal, restated in the owner's units: the ticket the shift
    // stopped before, and whether any raise can fund the rest at all.
    const next = recipe.phases[checkpoint.prefix.length];
    const ticket = next === undefined ? null : shiftTicketOf(recipe.phases, next.id);
    const short = error.committed + error.requested - error.ceiling;
    const where = next === undefined ? "" : ` before ${ticket === null ? next.id : `ticket ${ticket} (${next.id})`}`;
    const remedy = error.ceiling + short > MAX_CALL_CEILING
      ? `no awsf raise can fund the rest, because ${String(error.ceiling + short)} exceeds MAX_CALL_CEILING (${String(MAX_CALL_CEILING)})`
      : `needs ${String(short)} more call(s) from the owner's \`awsf raise ${status.taskId}\` at a TTY before it can continue`;
    throw new CallCeilingExceeded({ from: null, to: null, subject: `resume of ${status.taskId}${where}: ${remedy}`,
      tier: error.tier, ceiling: error.ceiling, requested: error.requested, committed: error.committed });
  }
  await executeProductionCommand(options, "read-only-recovery-preflight", { inspected, reason: "preflight", quotaReadings: [] }, true);
  return inspected;
}

async function readRecoveryQuota(options: ProductionRunOptions, inspected: RecoveryInspection): Promise<BoundaryQuota | null> {
  const phase = (await attemptRecipe(options, inspected.status))!.phases.slice(inspected.checkpoint.prefix.length).find(phase => phase.kind === "agent" && phase.id !== inspected.checkpoint.pending?.phaseKey);
  if (phase === undefined) return null;
  const role = options.config.agents.find(agent => agent.name === phase.owner)!;
  const agent = requestedPhaseRoute(options.config, phase.id, role, inspected.status.routeOverrides).agent;
  const threshold = options.config.routing.quota_stop?.by_adapter?.[agent.harness.adapter] ?? options.config.routing.quota_stop?.default;
  if (threshold === undefined) return null;
  const route = mapConfiguredQuotaRoutes(options.config).find(route => route.adapterId === agent.harness.adapter);
  if (route === undefined) throw new Error("resume quota route is unavailable");
  const infra = { ...DEFAULT_INFRASTRUCTURE, ...options.infrastructure };
  const observedAt = infra.now();
  const probe = await probeQuota({ runCommand: infra.runCommand, resolveExecutable: infra.resolveExecutable,
    routes: configuredQuotaProbeRoutes([route]), purpose: "phase-boundary", now: observedAt,
    timeouts: { interactivePreflightMs: DEFAULT_QUOTA_PROBE_TIMEOUTS.interactivePreflightMs, phaseBoundaryMs: threshold.probe_timeout_ms },
    options: { cwd: inspected.status.worktree!, env: HOST.process.env, maxBuffer: options.config.runtime.max_output_bytes },
    journalFailure: () => {}, retainFailureBytes: async () => "discarded-before-authorization" });
  const rows = buildQuotaReadout({ routes: [route], probeResult: probe, defaultThreshold: threshold }).rows;
  const row = rows[0];
  if (rows.length !== 1 || row === undefined || row.verdict !== "above" || row.provider === null || row.scope === null || row.minutesToReset === null) {
    throw new Error("resume refused: selected quota is unknown, stale, ambiguous or below its threshold");
  }
  const old = inspected.checkpoint.quota;
  if (old !== null && (old.adapterId !== row.adapterId || old.provider !== row.provider || old.scope !== row.scope || old.threshold !== threshold.minutes)) {
    throw new Error("resume quota route, scope or threshold changed");
  }
  return { adapterId: row.adapterId, provider: row.provider, scope: row.scope, minutes: row.minutesToReset,
    threshold: threshold.minutes, observedAt, readoutDigest: recoveryDigest(row) };
}

async function prepareResumeInstruction(options: ProductionRunOptions, inspected: RecoveryInspection) {
  if (inspected.checkpoint.pending !== undefined) throw new Error("a saved reply cannot receive a new instruction before validation");
  const recipe = (await attemptRecipe(options, inspected.status))!;
  const ordinal = inspected.checkpoint.prefix.length + 1;
  const definition = recipe.phases[ordinal - 1];
  if (definition?.kind !== "agent") throw new Error("resume --instruction requires the next unstarted phase to be a model step; it cannot amend host code or a completed result");
  const role = options.config.agents.find(agent => agent.name === definition.owner)!;
  const agent = requestedPhaseRoute(options.config, definition.id, role, inspected.status.routeOverrides).agent;
  const bundle = await readProductionPromptPair(options.configPath, agent);
  const compiled = compileWorkflowStructure({ ...recipe, phases: recipe.phases.map(phase => phase.id === definition.id ? { ...phase, prompt: bundle.userPrompt } : phase) });
  const phase = compiled.phases[ordinal - 1] as CompiledAgentPhase;
  const previous = [...inspected.envelopes.values()].at(-1) ?? null;
  const design = [...inspected.envelopes.values()].find(value => value.schema === DESIGN_CONTEXT_SCHEMA_ID) as DesignContext | undefined;
  // A bound phase's launch appends its visual block, and the instruction's
  // digest has to be of the input that will actually launch. The paths are a
  // pure function of the launch, so they are named here before delivery.
  const bound = await recordedVisualBound(options.attemptDir);
  const visual = bound === null || !bound.phases.includes(phase.id) ? ""
    : visualReferencePrompt(plannedDelivery(bound, deliveryDirectory(options.attemptDir, `${inspected.status.sessionId}:${phase.id}:run`)));
  const originalPrompt = renderProductionRolePrompt(phase, previous, design ?? null, inspected.status.request, agent) +
    seedContext(inspected.status) + resumeInstructionContext(inspected.instructions) + protectedPromptContext(protectedGrantForPhase(options.attemptDir, phase.id)) + visual;
  const seedAmendment = inspected.status.seed?.builderPhaseKey === phase.id ? inspected.status.seed.ownerAmendment : null;
  return { phaseKey: phase.id, ordinal, bundleDigest: recoveryDigest(bundle), originalPrompt, seedAmendment };
}

/**
 * May this attempt still receive the durable binding this publication needs?
 *
 * Two questions, and both have to be asked again under the execution lease
 * rather than once before the owner was prompted. A sealed attempt takes no
 * further writes, so completing the publication would leave the repository
 * ahead of the journal for good — a cancellation racing the confirmation must
 * therefore leave every byte inert. And a status file that disagrees with its
 * own journal names no single lifecycle at all, so neither answer can be
 * trusted; that is the attempt-recovery path's business, not this one's.
 */
function assertReconcilableAttempt(state: ProtectedState, status: AttemptStatus, candidateSha: string): void {
  const journal = state.status;
  if (journal.revision !== status.revision || journal.lifecycleState !== status.lifecycleState ||
      journal.sessionId !== status.sessionId || journal.attempt !== status.attempt || journal.worktree !== status.worktree) {
    throw new Error("protected host-effect recovery refused: the attempt status file and its journal disagree, " +
      `so candidate ${candidateSha} has no single lifecycle to bind against; reconcile the attempt itself first`);
  }
  if ((SEALED_STATES as readonly TaskState[]).includes(status.lifecycleState)) {
    throw new Error(`protected host-effect recovery refused: this attempt is sealed in ${status.lifecycleState}, ` +
      `so candidate ${candidateSha} cannot receive its durable binding here; the retained worktree, index and evidence are unchanged`);
  }
}

/**
 * Finish an interrupted protected host effect, as its own owner act.
 *
 * It is deliberately NOT gated behind the phase checkpoint: `commitProtectedAsHost`
 * crashes frequently leave the phase FAILED, and an attempt whose HEAD, index
 * and journal disagree has to be reconcilable whatever became of the phase.
 *
 * Nothing is recreated. The commit object was written before the intent was
 * recorded, so at most this moves HEAD to that exact object under a
 * compare-and-swap, installs the exact pre-staged index the intent pinned by
 * digest, and appends the binding it had already computed. It spends no call,
 * runs no model, grants no further protected write and does not continue the
 * workflow — the generation is one-use and stays spent.
 */
async function reconcileRetainedProtectedEffect(
  options: ProductionRunOptions & { terminal: OwnerTerminal }, reason: string, current: AttemptStatus,
): Promise<{ confirmed: boolean; status: AttemptStatus } | null> {
  const state = readProtectedState(options.attemptDir);
  const retained = unfinishedProtectedEffect(state);
  if (retained === null) return null;
  await assertNoExecutionController(options.attemptDir);
  const publication = inspectProtectedPublication(state, retained);
  if (publication.outcome === "refused") throw new Error(`protected host-effect recovery refused: ${publication.reason}`);
  assertReconcilableAttempt(state, current, retained.binding.candidateSha);
  options.terminal.write(
    `An interrupted protected host effect is retained on ${current.taskId} attempt ${String(current.attempt)}.\n` +
    `Candidate ${retained.binding.candidateSha} over ${String(retained.binding.deltas.length)} granted file(s); publication is ${publication.outcome}.\n` +
    "Completing it creates no commit, repeats no model call, spends no call and authorizes no further protected write. " +
    `The one-use generation is spent, so the workflow is not continued. Reason: ${reason}`);
  if (!await options.terminal.confirm("Reconcile this interrupted protected host effect?")) return { confirmed: false, status: current };
  // Everything proved before the confirmation is proved again here, under the
  // lease, because the owner's answer took wall-clock time that a concurrent
  // `awsf cancel` could have used. `withExecutionLease` runs this inside its
  // claim lock and BEFORE it writes its own lease file, so a refusal from here
  // leaves the attempt directory, the journal, HEAD, the index and the retained
  // lock byte-for-byte as they were.
  // The intent AND the lock's creation record. A witness appended or replaced
  // while the owner was deciding would change which file this completion is
  // entitled to install, so it is part of what must not have moved.
  const fingerprint = (source: ProtectedState, effect: ProtectedCommitIntent): string =>
    recoveryDigest({ intent: effect, witness: retainedLockWitness(source, effect) });
  const anchor = fingerprint(state, retained);
  const revalidate = async () => {
    const again = readProtectedState(options.attemptDir);
    const still = unfinishedProtectedEffect(again);
    if (still === null || fingerprint(again, still) !== anchor) throw new Error("the retained protected host effect changed during confirmation");
    assertReconcilableAttempt(again, await readAttempt(options.attemptDir), still.binding.candidateSha);
    const verdict = inspectProtectedPublication(again, still);
    if (verdict.outcome === "refused") throw new Error(`protected host-effect recovery refused: ${verdict.reason}`);
    return { state: again, intent: still, verdict };
  };
  return withExecutionLease(options.attemptDir, async () => { await revalidate(); }, async () => {
    const { state: locked, intent, verdict } = await revalidate();
    let status = await readAttempt(options.attemptDir);
    const now = options.infrastructure?.now ?? DEFAULT_INFRASTRUCTURE.now;
    await completeProtectedPublication({ attemptDir: options.attemptDir, state: locked, intent, publication: verdict,
      now,
      persistWitness: async witness => {
        status = await persistAttempt(options.attemptDir, status.revision, { kind: "attempt.updated",
          next: nextRevision(status, { lastActivityAt: now(),
            lastActivity: `recorded the index lock this reconciliation created for candidate ${witness.candidateSha}` }),
          evidence: { type: "protected-lock-witness", witness } }, options.projectRecord);
      },
      persistBinding: async binding => {
        const detail = `reconciled the interrupted protected candidate ${binding.candidateSha} (${verdict.outcome})`;
        status = await persistAttempt(options.attemptDir, status.revision, { kind: "attempt.updated",
          next: nextRevision(status, { candidateSha: binding.candidateSha, lastActivityAt: now(),
            lastActivity: detail, nextAction: `inspect ${binding.candidateSha}, then land it or issue a fresh grant` }),
          evidence: { type: "protected-candidate", binding } }, options.projectRecord);
      } });
    return { confirmed: true, status };
  });
}

/** Owner entry for an unstarted boundary or an already host-validated, durable phase result. No native reconnect. */
export async function resumeProductionCommand(options: ProductionRunOptions & { reason: string; instruction?: string; terminal: OwnerTerminal }): Promise<{ confirmed: boolean; status: AttemptStatus }> {
  const reason = ownerText(options.reason);
  const instructionText = options.instruction === undefined ? null : ownerText(options.instruction);
  if (!options.terminal.interactive) throw new Error("resume requires owner confirmation at a TTY");
  const current = await readAttempt(options.attemptDir);
  const recipe = await attemptRecipe(options, current);
  if (current.lifecycleState === "AWAITING_OWNER" && current.recovery?.prefix.length === recipe?.phases.length) {
    const proved = await inspectPhaseRecovery(options.attemptDir);
    if (proved.status.revision !== current.revision) throw new Error("completed status is stale");
    if (instructionText !== null && proved.instructions.at(-1)?.amendment.text !== instructionText) throw new Error("completed workflow has no unstarted phase for a new instruction");
    return { confirmed: true, status: proved.status };
  }
  const reconciled = await reconcileRetainedProtectedEffect(options, reason, current);
  if (reconciled !== null) return reconciled;
  const first = await preflightRecovery(options);
  const instructionPlan = instructionText === null ? null : await prepareResumeInstruction(options, first);
  const firstQuota = await readRecoveryQuota(options, first);
  const quotaReadings: BoundaryQuota[] = firstQuota === null ? [] : [firstQuota];
  const remaining = recipe!.phases.slice(first.checkpoint.prefix.length).filter(phase => phase.kind === "agent" && phase.id !== first.checkpoint.pending?.phaseKey).length;
  if (first.checkpoint.pending !== undefined) options.terminal.write(`Validate saved ${first.checkpoint.pending.phaseKey} reply, round ${first.checkpoint.pending.round}, without repeating its model call. Host gates still must pass.`);
  options.terminal.write(`Resume ${current.taskId} attempt ${current.attempt}: preserve ${first.checkpoint.prefix.length} accepted phases; ${remaining} unstarted provider call(s), plus existing correction allowance. No completed model turn will be repeated. Reason: ${reason}`);
  if (instructionPlan !== null) options.terminal.write(`Supplement recipient: ${instructionPlan.phaseKey}, phase ${instructionPlan.ordinal}. Exact instruction (JSON string): ${JSON.stringify(instructionText)}\nThe original request stays unchanged. This grants no extra calls, tools, write access or review authority.`);
  if (!await options.terminal.confirm("Continue this exact saved workflow?")) return { confirmed: false, status: first.status };
  let validated = first;
  return withExecutionLease(options.attemptDir, async () => {
    validated = await preflightRecovery(options);
    if (recoveryDigest(validated.status) !== recoveryDigest(first.status)) throw new Error("resume anchor changed during confirmation");
    if (instructionPlan !== null && recoveryDigest(await prepareResumeInstruction(options, validated)) !== recoveryDigest(instructionPlan)) throw new Error("resume instruction input changed during confirmation");
    const secondQuota = await readRecoveryQuota(options, validated);
    if (secondQuota !== null) quotaReadings.push(secondQuota);
  }, async operationId => {
    let instruction: ResumeInstruction | null = null;
    if (instructionPlan !== null && instructionText !== null) {
      const binding: ResumeInstruction["amendment"]["binding"] = { entry: "resume", project: validated.status.project,
        taskId: validated.status.taskId, attempt: validated.status.attempt, sessionId: validated.status.sessionId,
        authorizationId: randomUUID(), operationId, phaseKey: instructionPlan.phaseKey, phaseOrdinal: instructionPlan.ordinal,
        anchorId: validated.checkpoint.id, anchorRevision: validated.status.revision, logicalTurnId: null, correctionRound: 0,
        originalRequestDigest: sha256(validated.status.request), originalPromptBundleDigest: instructionPlan.bundleDigest,
        priorAmendmentDigest: instructionPlan.seedAmendment?.digest ?? null, deliveryFrontier: "next-phase-input" };
      const amendment = createOwnerAmendment({ id: randomUUID(), text: instructionText, binding, confirmedAt: (options.infrastructure?.now ?? DEFAULT_INFRASTRUCTURE.now)() });
      const composed = composeOwnerAmendmentChain(instructionPlan.originalPrompt, [...(instructionPlan.seedAmendment === null ? [] : [instructionPlan.seedAmendment]), amendment]);
      instruction = Object.freeze({ amendment, originalInputDigest: composed.originalInputDigest, composedDigest: composed.composedDigest });
      assertResumeInstruction(instruction);
    }
    await reconcileRecoveryStatus(options.attemptDir, validated);
    // Replay the missed projection before any new authorization or provider GO.
    for (const record of validated.records.slice(validated.disk.revision)) await options.projectRecord?.(record, record.event.next);
    const status = await executeProductionCommand(options, operationId, { inspected: validated, reason, quotaReadings, instruction });
    return { confirmed: true, status: await persistReadableRunReport(options, status) };
  });
}
