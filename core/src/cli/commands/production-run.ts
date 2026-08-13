import { existsSync, readFileSync, statSync, promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  AgentPhaseProcessRegistration,
  BrokerProcessRegistration,
  HarnessAdapter,
  ModelInfo,
  ModelRequest,
  ProcessRegistration,
  ProcessTransport,
  TransportBroker,
} from "../../adapters/interface.ts";
import { AdapterError } from "../../adapters/interface.ts";
import { registeredAdapter } from "../../adapters/registry.ts";
import { writeSystemPromptFile } from "../../adapters/system-prompt-file.ts";
import { toConfigSnapshotJson } from "../../config/effective-config.ts";
import type { AwsfConfig, AgentDefinition, AdapterEntry } from "../../config/schema.ts";
import type { BuildOutput } from "../../contracts/build-output.ts";
import type { EnvelopeBase } from "../../contracts/envelope-base.ts";
import { UNREPORTED_TOKEN_USAGE, isPersistableKind, type ModelResolutionProvenance, type NormalizedEvent, type TokenUsage } from "../../contracts/normalized-events.ts";
import { parseEnvelope } from "../../contracts/parse-envelope.ts";
import type { PlanOutput } from "../../contracts/plan-output.ts";
import { wrapEnvelope, type StoredEnvelope } from "../../contracts/stored-envelope.ts";
import type { TestOutput } from "../../contracts/test-output.ts";
import { CallBudget, type Reservation } from "../../execution/call-budget.ts";
import type { BarrierRecord } from "../../execution/launcher-barrier.ts";
import { ProcessTransportBroker, runSystemCommand, type BrokerOptions, type SystemCommandOptions } from "../../execution/transport-broker.ts";
import { artifactsExist, filesNonEmpty, jsonParses, type ArtifactObservation } from "../../gates/artifacts.ts";
import { candidateHygiene } from "../../gates/candidate-hygiene.ts";
import { commandsPass } from "../../gates/commands.ts";
import { envelopeValid } from "../../gates/envelope.ts";
import { diffMatchesClaims, headAdvanced, noProtectedPaths, writesWithinGlobs } from "../../gates/git-diff.ts";
import { GateReport, type GateId } from "../../gates/interface.ts";
import { verdictConsistent } from "../../gates/review.ts";
import { REVIEW_OUTPUT_SCHEMA_ID, type ReviewOutput } from "../../contracts/review-output.ts";
import {
  InvalidReviewInversion,
  MandatoryReviewUnavailable,
  oppositeProvider,
  providerPairFrom,
  runMandatoryReview,
} from "../../workflow/review-routing.ts";
import { assertClean, captureChangeSet, changedPaths, runGit, systemGitRunner } from "../../git/changes.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../observability/attempt-evidence.ts";
import { PermissionBreach } from "../../policy/path-policy.ts";
import { openPermissionSession, type PermissionSession, type SandboxProbe } from "../../policy/sandbox-broker.ts";
import { transition, type EdgeId, type TaskState } from "../../state/task-machine.ts";
import { createCompiledPhaseLaunchVerifier } from "../../workflow/phase-launch-authorization.ts";
import { compileWorkflow, type WorkflowRecipe } from "../../workflow/compiler.ts";
import type { CompiledAgentPhase } from "../../workflow/phase.ts";
import type { AgentTurn, CorrectionSession } from "../../workflow/corrections.ts";
import { EnvelopeValidationFailure, PhaseGateFailure, createHostPhaseGit, runAgentPhase } from "../../workflow/engine.ts";
import type { GateDefinition } from "../../workflow/phase.ts";
import type { PhaseState } from "../../state/phase-machine.ts";
import { buildWorkflow } from "../../workflow/recipes/build.ts";
import { buildReviewWorkflow } from "../../workflow/recipes/build-review.ts";
import { planBuildTestWorkflow } from "../../workflow/recipes/plan-build-test.ts";
import { simpleSdlcWorkflow } from "../../workflow/recipes/simple-sdlc.ts";
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

const { chmod, mkdir, readFile, realpath, writeFile } = fs;

const HOST = globalThis as unknown as {
  process: { env: Readonly<Record<string, string>> };
  AbortController: new () => { signal: Parameters<TransportBroker["startProcess"]>[2]; abort(reason?: unknown): void };
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(timer: unknown): void;
};

const SUPPORTED = new Map<string, WorkflowRecipe>([
  [buildWorkflow.id, buildWorkflow],
  [planBuildTestWorkflow.id, planBuildTestWorkflow],
  [buildReviewWorkflow.id, buildReviewWorkflow],
  [simpleSdlcWorkflow.id, simpleSdlcWorkflow],
]);

const SUPPORTED_NAMES = [...SUPPORTED.keys()].join(", ");

/** A review phase is one that produces a review envelope; the id is not the evidence. */
function isReviewPhase(phase: { readonly kind: string; readonly schemaId?: string }): boolean {
  return phase.kind === "agent" && phase.schemaId === REVIEW_OUTPUT_SCHEMA_ID;
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
  writeSystemPrompt(text: string, directory: string): Promise<string>;
  now(): string;
  sandboxProbe?: SandboxProbe;
}

const DEFAULT_INFRASTRUCTURE: ProductionInfrastructure = {
  adapterFor: (_entry, adapterId, config) => registeredAdapter(config.adapters, adapterId, config.runtime),
  createBroker: (options) => new ProcessTransportBroker(options),
  runCommand: (executable, argv, options) => runSystemCommand(executable, argv, options),
  writeSystemPrompt: writeSystemPromptFile,
  now: () => new Date().toISOString(),
};

export interface ProductionRunOptions {
  readonly attemptDir: string;
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly projectRecord?: AttemptProjector;
  readonly assertAdvancement?: AttemptAdvancementGuard;
  /** The barrier calls this after process registration and before GO. */
  readonly assertLaunchProjection?: (sessionId: string) => void;
  readonly infrastructure?: Partial<ProductionInfrastructure>;
}

interface Route {
  readonly agent: AgentDefinition;
  readonly adapterId: string;
  readonly adapter: HarnessAdapter;
  readonly model: ModelInfo;
  readonly userPrompt: string;
  readonly systemPrompt: string;
}

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

async function readCommittedPrompt(configPath: string, relativePath: string): Promise<string> {
  if (isAbsolute(relativePath)) throw new Error(`prompt path must be relative: ${relativePath}`);
  const root = await realpath(dirname(resolve(configPath)));
  const candidate = resolve(root, relativePath);
  const fromRoot = relative(root, candidate);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`prompt path escapes the config context: ${relativePath}`);
  }
  const physical = await realpath(candidate);
  const physicalFromRoot = relative(root, physical);
  if (physicalFromRoot.startsWith("..") || isAbsolute(physicalFromRoot)) {
    throw new Error(`prompt symlink escapes the config context: ${relativePath}`);
  }
  return readFile(physical, "utf8");
}

function requestOutput(status: AttemptStatus, config: AwsfConfig): PlanOutput {
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

function phaseGates(
  phaseId: string,
  permission: PermissionSession,
  worktree: string,
  config: AwsfConfig,
  review: { readonly candidateSha: string | null; readonly candidatePaths: readonly string[] } | null,
): readonly GateDefinition[] {
  const observe = (): readonly string[] => changedPaths(permission.before, captureChangeSet(worktree));
  const read = artifactReader(worktree);
  const common: GateDefinition[] = [
    {
      id: "envelope_valid",
      run: ({ envelope }) => {
        const report = envelopeValid(parseEnvelope(JSON.stringify(envelope), envelope.schema));
        if (phaseId === "planner") {
          const plan = envelope as PlanOutput;
          report.check("goals non-empty", plan.goals.length > 0, `${plan.goals.length} goal(s)`);
          report.check("steps have acceptance", plan.implementationSteps.length > 0 && plan.implementationSteps.every((step) => step.acceptanceCriteria.length > 0), `${plan.implementationSteps.length} step(s)`);
          report.check("no blocking open questions", plan.openQuestions.length === 0, `${plan.openQuestions.length} open question(s)`);
        }
        return report;
      },
    },
    { id: "artifacts_exist", run: ({ envelope }) => artifactsExist(envelope.artifacts, read) },
    { id: "json_parses", run: ({ envelope }) => jsonParses(envelope.artifacts, read) },
    { id: "no_protected_paths", run: () => noProtectedPaths(observe(), config.policy.protected_paths) },
  ];
  if (phaseId === "planner") {
    common.push({ id: "files_non_empty", run: ({ envelope }) => filesNonEmpty(envelope.artifacts, read) });
  }
  if (phaseId === "builder") {
    common.push(
      { id: "diff_matches_claims", run: ({ envelope }) => diffMatchesClaims(observe(), (envelope as BuildOutput).changedFiles) },
      { id: "writes_within_globs", run: () => writesWithinGlobs(observe(), permission.profile.writes) },
    );
  }
  if (review !== null) {
    // A review of a different tree is not a review of this change, so the gate
    // is given the candidate the host actually built rather than the SHA the
    // reviewer says it read.
    common.push({
      id: "verdict_consistent",
      run: ({ envelope }) => review.candidateSha === null
        ? new GateReport("verdict_consistent").check("candidate exists to review", false, "no host candidate was created before the review phase")
        : verdictConsistent(envelope as ReviewOutput, { candidateSha: review.candidateSha, candidatePaths: review.candidatePaths }),
    });
    // A reviewer that edits is not a reviewer. `writes: []` makes any observed
    // path a breach, and this states it as a gate rather than leaving it to the
    // permission session alone.
    common.push({ id: "writes_within_globs", run: () => writesWithinGlobs(observe(), permission.profile.writes) });
  }
  return Object.freeze(common);
}

/**
 * The paths the candidate actually changed, read from Git rather than from the
 * builder's claims — `verdict_consistent` uses this to reject a finding about a
 * file outside the change under review, so a claimed set would let a reviewer
 * and a builder agree with each other about a file neither touched. `-z` keeps
 * unusual bytes in a filename intact, and `--no-renames` makes both sides of a
 * rename explicit.
 */
function candidatePathsBetween(worktree: string, baseSha: string, candidateSha: string): readonly string[] {
  const output = runGit(systemGitRunner(worktree), ["diff", "--name-only", "--no-renames", "-z", `${baseSha}..${candidateSha}`]);
  return Object.freeze([...new Set(output.split("\0").filter((path) => path.length > 0))].sort());
}

/** Transport faults earn the one retry; a refusal, a breach, or exhausted quota never does. */
function isReviewTransportFailure(error: unknown): boolean {
  if (error instanceof ProductionRouteUnavailable) return true;
  if (!(error instanceof AdapterError)) return false;
  // Quota is structurally never a retry, and a permission or contract failure
  // would fail identically the second time at the cost of another call.
  return ["E_TERMINAL_MISSING", "E_BACKEND_FAILURE", "E_TRANSPORT"].includes(error.code);
}

function gateKind(gateId: GateId): "pure" | "filesystem" | "git" | "subprocess" | "journey" {
  if (gateId === "commands_pass") return "subprocess";
  if (gateId === "head_advanced" || gateId === "diff_matches_claims" || gateId === "candidate_hygiene") return "git";
  if (["artifacts_exist", "files_non_empty", "json_parses", "no_protected_paths", "writes_within_globs"].includes(gateId)) return "filesystem";
  if (gateId === "journey_passes") return "journey";
  return "pure";
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
  if (error instanceof EnvelopeValidationFailure || error instanceof PhaseGateFailure || error instanceof CommandPhaseFailure) {
    return { code: "phase-abort", detail };
  }
  if (/ceiling|budget/i.test(detail)) return { code: "budget-exhausted", detail };
  if (/silence|timeout/i.test(detail)) return { code: "silence", detail };
  return { code: "phase-abort", detail };
}

/** Real T1 production runner. The fixture-only run command remains separate. */
export async function runProductionCommand(options: ProductionRunOptions): Promise<AttemptStatus> {
  const infra: ProductionInfrastructure = { ...DEFAULT_INFRASTRUCTURE, ...options.infrastructure };
  let status = await readAttempt(options.attemptDir);
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
  const routePrompts = new Map<string, { user: string; system: string }>();
  for (const phase of recipe.phases) {
    if (phase.kind !== "agent") continue;
    const agent = agents.get(phase.owner);
    if (agent === undefined) throw new ProductionRouteUnavailable(phase.owner, "no explicit agent definition exists");
    routePrompts.set(phase.id, {
      user: await readCommittedPrompt(options.configPath, agent.prompt.user),
      system: await readCommittedPrompt(options.configPath, agent.prompt.system),
    });
  }
  const configuredRecipe: WorkflowRecipe = {
    ...recipe,
    phases: recipe.phases.map((phase) => phase.kind === "agent"
      ? { ...phase, prompt: routePrompts.get(phase.id)!.user }
      : phase),
  };
  // Compilation, route shape, prompts, and minimum-call admission all finish before any process.
  const compiled = compileWorkflow(configuredRecipe, status.tier, status.budget.callsSpent);
  const routes = new Map<string, Route>();
  let inversion: {
    readonly workerProvider: string;
    readonly reviewProvider: string;
    readonly pair: readonly [string, string];
    readonly reviewPhaseId: string;
  } | null = null;
  try {
    for (const phase of compiled.phases) {
      if (phase.kind !== "agent") continue;
      const agent = agents.get(phase.owner)!;
      const entry = options.config.adapters[agent.harness.adapter];
      if (entry === undefined || entry.enabled === false) throw new ProductionRouteUnavailable(agent.harness.adapter, "route is disabled or undeclared");
      const adapter = infra.adapterFor(entry, agent.harness.adapter, options.config);
      if (adapter === null) throw new ProductionRouteUnavailable(agent.harness.adapter, "adapter kind has no production binding");
      const available = await adapter.isAvailable();
      if (available.status !== "available") throw new ProductionRouteUnavailable(agent.harness.adapter, available.detail ?? available.code ?? "blocked");
      const model = await adapter.getModelInfo(agent.model);
      const configuredContinuity = agent.harness.continuity;
      const supportedContinuity = model.continuity === "same-session-correction" ? "same-session" : "none";
      if (configuredContinuity !== supportedContinuity) {
        throw new ProductionContinuityMismatch(agent.harness.adapter, configuredContinuity, model.continuity);
      }
      if (configuredContinuity !== "none") {
        throw new ProductionRouteUnavailable(agent.harness.adapter, "the production runner has no verified same-session correction transport");
      }
      // Pure descriptor construction validates model/thinking/profile/tools before lifecycle mutation.
      adapter.buildSpec({
        model: agent.model,
        prompt: "preflight",
        cwd: status.worktree,
        env: HOST.process.env,
        effort: agent.thinking,
        profile: agent.tools.profile,
        tools: agent.tools.allow,
      });
      routes.set(phase.id, {
        agent,
        adapterId: agent.harness.adapter,
        adapter,
        model,
        userPrompt: routePrompts.get(phase.id)!.user,
        systemPrompt: routePrompts.get(phase.id)!.system,
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
      const workerPhase = compiled.phases.find((phase) => phase.kind === "agent" && !isReviewPhase(phase));
      if (workerPhase === undefined) throw new ProductionRouteUnavailable(reviewPhase.id, "a review phase has no worker phase to invert against");
      const workerProvider = routes.get(workerPhase.id)!.model.provider;
      const pair = providerPairFrom([...routes.values()].map((route) => route.model.provider));
      const required = oppositeProvider(workerProvider, pair);
      const configured = routes.get(reviewPhase.id)!.model.provider;
      if (configured !== required) {
        throw new InvalidReviewInversion(
          `worker runs on ${JSON.stringify(workerProvider)}, so the review must run on ${JSON.stringify(required)}; ` +
            `the configured reviewer route resolves to ${JSON.stringify(configured)}`,
        );
      }
      inversion = { workerProvider, reviewProvider: required, pair, reviewPhaseId: reviewPhase.id };
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
      kind: phase.kind, owner: phase.owner, description: phase.description, status: "QUEUED",
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

  const verifier = createCompiledPhaseLaunchVerifier({
    statusFor: (taskSessionId) => taskSessionId === status.sessionId
      ? { taskSessionId, lifecycleState: status.lifecycleState, workflowId: status.workflow }
      : null,
    compiledWorkflowFor: (taskSessionId) => taskSessionId === status.sessionId ? compiled : null,
    configuredRouteFor: ({ taskSessionId, phaseId }) => {
      const route = routes.get(phaseId);
      return taskSessionId === status.sessionId && route !== undefined
        ? { adapterId: route.adapterId, role: route.agent.name, launchAuthorization: "agent-phase" }
        : null;
    },
  });

  const broker = infra.createBroker({
    ledger: budget,
    phaseLaunchVerifier: verifier,
    register: async (record) => {
      const launch = launches.get(record.runId);
      if (launch === undefined) throw new Error(`unregistered host launch ${record.runId}`);
      launch.record = record;
      await persist("attempt.updated", { process: record.identity, budget: budget.snapshot(), lastActivityAt: infra.now(), lastActivity: `process ${record.runId} registered before GO` }, {
        type: "process", phaseId: launch.phaseId, adapterId: launch.adapterId, role: launch.role,
        record, status: "REGISTERED", registeredAt: launch.registeredAt, releasedAt: null,
        endedAt: null, exitCode: null, exitSignal: null,
      });
      options.assertLaunchProjection?.(status.sessionId);
    },
    onSpent: async (record, _reservation) => {
      const launch = launches.get(record.runId)!;
      launch.releasedAt = infra.now();
      await persist("attempt.updated", { budget: budget.snapshot(), lastActivityAt: launch.releasedAt, lastActivity: `call ${record.reservationId} spent immediately before GO` }, {
        type: "process", phaseId: launch.phaseId, adapterId: launch.adapterId, role: launch.role,
        record, status: "RUNNING", registeredAt: launch.registeredAt, releasedAt: launch.releasedAt,
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

  const runAgent = async (
    phase: CompiledAgentPhase,
    ordinal: number,
    previous: EnvelopeBase | null,
    reservation: Reservation,
    first: boolean,
    reviewContext: { readonly candidateSha: string | null; readonly candidatePaths: readonly string[] } | null,
    attempt = 1,
  ): Promise<{ envelope: EnvelopeBase; candidateSha: string | null }> => {
    const route = routes.get(phase.id)!;
    const purpose = reviewContext === null ? "worker" : "review";
    // A retried review is a distinct process and a distinct spent call, so it
    // needs its own run id; reusing one would collide with the retained raw
    // output and envelope of the attempt that failed.
    const runId = `${status.sessionId}:${phase.id}:run${attempt === 1 ? "" : `-${attempt}`}`;
    const phaseDb = dbPhaseId(status.sessionId, phase.id);
    const registeredAt = infra.now();
    const launch: LaunchRecord = { phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name, registeredAt };
    launches.set(runId, launch);
    const runtimeDir = join(options.attemptDir, "private", phase.id);
    await mkdir(runtimeDir, { recursive: true });
    const systemPromptPath = await infra.writeSystemPrompt(route.systemPrompt, runtimeDir);
    const permission = openPermissionSession({
      canonicalRepository: status.repository,
      worktree: status.worktree!,
      sessionRuntime: runtimeDir,
      profile: route.agent.tools.profile,
      tools: route.agent.tools.allow,
      writes: route.agent.writes,
      protectedPaths: options.config.policy.protected_paths,
      ...(infra.sandboxProbe === undefined ? {} : { sandboxProbe: infra.sandboxProbe }),
    });
    const hostGit = createHostPhaseGit<EnvelopeBase>({
      repository: status.worktree!,
      commitMessage: (envelope) => phase.id === "builder"
        ? (envelope as BuildOutput).proposedCommitMessage
        : `chore: record ${phase.id} output`,
    });
    const renderedPrompt = phase.renderPrompt(previous);
    for (const [name, text] of [["system", route.systemPrompt], ["user", renderedPrompt]] as const) {
      await persist("attempt.updated", {}, {
        type: "compiled-prompt", phaseId: phaseDb, name, text,
        lineCount: text.split(/\r?\n/).length, at: infra.now(),
      });
    }
    const gatedPhase = { ...phase, gates: phaseGates(phase.id, permission, status.worktree!, options.config, reviewContext) };
    let phaseQueue = Promise.resolve();
    const onPhaseState = (next: PhaseState): void => {
      phaseQueue = phaseQueue.then(() => persistPhase(phase.id, next));
    };
    const realRegistration = registrationFor(phase, ordinal, route, reservation, runId, first, reviewContext !== null);
    let sent = false;
    const session: CorrectionSession = {
      identity: { adapter: route.adapter.id, provider: route.model.provider, model: route.model.requestedModel, sessionId: `none:${runId}` },
      send: async (prompt): Promise<AgentTurn> => {
        if (sent) throw new Error("configured and verified continuity is none; a second turn is not authorized");
        sent = true;
        await phaseQueue;
        const controller = new HOST.AbortController();
        let idle: unknown | null = null;
        const arm = (): void => {
          if (idle !== null) HOST.clearTimeout(idle);
          idle = HOST.setTimeout(() => {
            controller.abort(new Error("configured silence timeout elapsed"));
            void launch.transport?.cancel("configured silence timeout elapsed");
          }, options.config.runtime.silence_timeout_seconds * 1_000);
          (idle as { unref?: () => void }).unref?.();
        };
        const sandboxingBroker: TransportBroker = {
          startProcess: async (registration, spec, signal) => {
            const grant = permission.sandbox(spec);
            const launchAt = infra.now();
            await persist("attempt.updated", { lastActivityAt: launchAt, lastActivity: `${phase.id}: route and sandbox grant recorded before GO` }, {
              type: "agent-start", phaseId: phaseDb, agent: route.agent.name, adapterId: route.adapterId,
              provider: route.model.provider, color: route.agent.color, requestedModel: route.agent.model,
              sandboxBadge: grant.badge, sandboxMechanism: grant.mechanism, purpose, at: launchAt,
            });
            const transport = await broker.startProcess(registration, grant.spec, signal);
            launch.transport = transport;
            return transport;
          },
        };
        const request: ModelRequest = {
          model: route.agent.model, prompt, systemPromptPath, cwd: status.worktree!,
          env: HOST.process.env, effort: route.agent.thinking,
          profile: route.agent.tools.profile, tools: route.agent.tools.allow,
        };
        const events: NormalizedEvent[] = [];
        let output = "";
        let resolved: { model: string; provenance: ModelResolutionProvenance } | null = null;
        let terminal: NormalizedEvent | null = null;
        arm();
        try {
          for await (const event of route.adapter.execute(request, sandboxingBroker, realRegistration, controller.signal)) {
            arm();
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
          await launch.transport?.cancel("canonical provider-event persistence or transport failed").catch(() => undefined);
          throw error;
        } finally {
          if (idle !== null) HOST.clearTimeout(idle);
        }
        const endedAt = infra.now();
        const exitCode = terminal?.kind === "run.completed" ? terminal.exitCode : null;
        if (launch.record !== undefined) {
          await persist("attempt.updated", { process: null, lastActivityAt: endedAt }, {
            type: "process", phaseId: phaseDb, adapterId: route.adapterId, role: route.agent.name,
            record: launch.record, status: terminal?.kind === "run.completed" && exitCode === 0 ? "EXITED" : "FAILED",
            registeredAt, releasedAt: launch.releasedAt ?? registeredAt, endedAt, exitCode, exitSignal: null,
          });
        }
        if (terminal?.kind === "run.failed") throw new AdapterError(route.adapter.id, terminal.errorCode, terminal.message);
        if (terminal?.kind === "run.cancelled") throw new AdapterError(route.adapter.id, "E_CANCELLED", terminal.reason);
        if (terminal?.kind !== "run.completed") throw new AdapterError(route.adapter.id, "E_TERMINAL_MISSING", "adapter event stream ended without a terminal");
        if (terminal.exitCode !== 0) throw new AdapterError(route.adapter.id, "E_BACKEND_FAILURE", `provider exited ${String(terminal.exitCode)}`);
        if (resolved === null) throw new AdapterError(route.adapter.id, "E_MODEL_UNRESOLVED", "adapter emitted no resolved model evidence");
        const usage = events.some((event) => event.kind === "usage") ? sumUsage(events) : UNREPORTED_TOKEN_USAGE;
        await persist("attempt.updated", { model: { resolved: resolved.model, provenance: resolved.provenance }, lastActivityAt: endedAt }, {
          type: "agent", phaseId: phaseDb, agent: route.agent.name, adapterId: route.adapterId,
          provider: route.model.provider, color: route.agent.color, requestedModel: route.agent.model,
          resolvedModel: resolved.model, modelProvenance: resolved.provenance, contextWindow: route.model.contextWindow,
          usageAuthority: route.model.usageAuthority, usage, contextTokens: contextTokens(usage), costUsd: null, costAuthority: route.model.costAuthority, purpose, at: endedAt,
        });
        return {
          identity: session.identity,
          rawOutput: output,
          usage,
          costUsd: null,
        };
      },
    };
    try {
      const result = await runAgentPhase({
        workflowId: compiled.id,
        phase: gatedPhase,
        worktree: status.worktree!,
        previousEnvelope: previous,
        session,
        budget,
        permissions: permission,
        hostGit,
        persistence: { persist: (envelope, raw) => persistEnvelope(phase.id, runId, envelope, raw) },
        agentSessionId: status.sessionId,
        onPhaseState,
        // Preflight proved durable config and adapter capability both say none.
        // Invalid schema or a failed gate therefore blocks on turn one.
        authorizeCorrection: () => null,
      });
      await phaseQueue;
      const gatedSha = reviewContext === null ? result.candidateSha : reviewContext.candidateSha;
      for (const report of result.gateReports) await persistGate(phase.id, report, gatedSha);
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
        for (const report of error.reports) await persistGate(phase.id, report, null);
        // Path gates retain their full evidence, but a real policy breach is the
        // terminal classification and remains non-correctable.
        try { permission.enforce(); } catch (permissionError) { failure = permissionError; }
      }
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

  let previous: EnvelopeBase | null = null;
  let candidateSha: string | null = null;
  let agentOrdinal = 0;
  let reviewPhase: { readonly phase: CompiledAgentPhase; readonly ordinal: number } | null = null;
  let reviewTransportRetries = 0;
  try {
    for (const [index, phase] of compiled.phases.entries()) {
      if (phase.kind === "engineer") {
        await persistPhase(phase.id, "RUNNING");
        previous = requestOutput(status, options.config);
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
      if (candidateSha === null) throw new Error("code phase requires a host-created candidate SHA");
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
      await persistGate(phase.id, hygiene, candidateSha, 0, hygieneResult.status ?? -1);
      if (!hygiene.passed) {
        const failure = new PhaseGateFailure(phase.id, [hygiene]);
        await persistPhase(phase.id, "FAILED", failure);
        throw failure;
      }

      assertClean(status.worktree!, "before");
      const observedHead = runGit(gitRunner, ["rev-parse", "HEAD"]).trim();
      if (observedHead !== candidateSha) throw new Error(`candidate moved before commands: ${observedHead} != ${candidateSha}`);
      const commands: TestOutput["commands"] = [];
      const failures: string[] = [];
      let combinedTail = "";
      for (const [gateId, configured] of Object.entries(options.config.gates)) {
        const started = Date.now();
        const [executable, ...argv] = configured.argv;
        const result = infra.runCommand(executable!, argv, {
          timeoutMs: configured.timeout_seconds * 1_000,
          cwd: status.worktree!,
          maxBuffer: options.config.runtime.max_output_bytes,
        });
        const output = safeTail(`${result.stdout}${result.stderr}${result.error === null ? "" : `\n${result.error}`}`);
        const outputRelative = join("raw", `command-${phase.id}-${gateId}.txt`);
        const outputAbsolute = join(options.attemptDir, outputRelative);
        await mkdir(dirname(outputAbsolute), { recursive: true });
        await writeFile(outputAbsolute, output, { mode: 0o600 });
        const exitCode = result.status ?? -1;
        commands.push({ gateId, argv: [...configured.argv], exitCode, durationMs: Date.now() - started, outputRef: outputRelative });
        if (exitCode !== 0) failures.push(`${gateId} exited ${exitCode}`);
        combinedTail = safeTail(`${combinedTail}\n${output}`);
        assertClean(status.worktree!, "after");
        const afterHead = runGit(systemGitRunner(status.worktree!), ["rev-parse", "HEAD"]).trim();
        if (afterHead !== candidateSha) throw new Error(`candidate moved during ${gateId}`);
      }
      const testOutput: TestOutput = {
        schema: "awsf.test-output/v1", producerStatus: failures.length === 0 ? "success" : "failure",
        summary: failures.length === 0 ? "all configured commands passed" : "configured commands failed",
        artifacts: [], notesForNextPhase: failures.length === 0 ? "await owner" : "inspect command evidence",
        passed: failures.length === 0, candidateSha, commands, failures, outputTail: combinedTail,
      };
      await persistHostEnvelope(phase.id, testOutput);
      const aggregate = new GateReport("commands_pass");
      for (const [gateId, configured] of Object.entries(options.config.gates)) {
        const report = commandsPass(testOutput, { gateId, argv: configured.argv }, { candidateSha, cleanBefore: true, cleanAfter: true });
        reportWith(aggregate, report.checks.map((check) => ({ ...check, item: `${gateId}:${check.item}` })));
      }
      if (Object.keys(options.config.gates).length === 0) aggregate.check("configured commands", true, "no commands configured");
      await persistGate(phase.id, aggregate, candidateSha, 0, failures.length === 0 ? 0 : -1);
      if (!aggregate.passed || failures.length > 0) {
        await persistPhase(phase.id, "FAILED", new CommandPhaseFailure(testOutput));
        throw new CommandPhaseFailure(testOutput);
      }
      previous = testOutput;
      await persistPhase(phase.id, "SUCCEEDED");
    }

    if (candidateSha === null) throw new Error("workflow completed without a host candidate");
    const l7 = transition({
      from: "RUNNING", to: "GATING", actor: "host", tier: status.tier, reason: { source: "git" }, interactive: false,
      budget: budget.snapshot(), evidence: { requiredPhasesTerminalSuccess: true, hostCommitCreated: true, baseSha: status.baseSha!, candidateSha },
    });
    await persistTransition("RUNNING", "GATING", l7.edge, "git", null, "all required phases and exact candidate gates succeeded", false, {
      candidateSha, budget: budget.snapshot(), phase: null, lastActivity: "L7 entered host gating on the exact candidate",
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
      const l12 = transition({
        from: "GATING", to: "AWAITING_OWNER", actor: "host", tier: status.tier, reason: { source: "gate" }, interactive: false,
        budget: budget.snapshot(), evidence: { gatesPass: true, candidateSha },
      });
      await persistTransition("GATING", "AWAITING_OWNER", l12.edge, "gate", null, `all required T${status.tier} gates passed`, false, {
        candidateSha, budget: budget.snapshot(), gatesPass: true,
        requiredReviewPresent: false, journeyApproved: true, protectedApprovalsValid: true, blocker: null,
        lastActivity: `all T${status.tier} production phases and gates passed; awaiting owner`,
      });
      return status;
    }

    // L11 is a spawn site: the review call is held here, on the exact candidate
    // the host gates just cleared, and the provider is the one the preflight
    // derived by exclusion.
    const reviewed = candidateSha;
    const reviewRoute = routes.get(reviewPhase.phase.id)!;
    const l11 = budget.authorize({
      from: "GATING", to: "REVIEWING", actor: "host", reason: { source: "gate" }, interactive: false,
      evidence: { gatesPass: true, candidateSha: reviewed }, spawn: { cost: 1 },
    });
    await persistTransition("GATING", "REVIEWING", l11.result.edge, "gate", null, `held one call for the ${inversion!.reviewProvider} review`, true, {
      candidateSha: reviewed, budget: budget.snapshot(),
      lastActivity: `L11 held one call for the mandatory ${inversion!.reviewProvider} review of ${reviewed}`,
    });

    const reviewContext = { candidateSha: reviewed, candidatePaths: candidatePathsBetween(status.worktree!, status.baseSha!, reviewed) };
    // One fixed-route attempt plus one transport retry, then BLOCKED. The route
    // is never widened, and a retry holds its own call because the first one was
    // genuinely spent.
    const reviewResult = await runMandatoryReview({
      workerProvider: inversion!.workerProvider,
      providers: inversion!.pair,
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
        return runAgent(reviewPhase!.phase, reviewPhase!.ordinal, previous, held, false, reviewContext, attempt);
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
    await persistTransition("REVIEWING", "AWAITING_OWNER", l15.edge, "gate", null, `${inversion!.reviewProvider} review returned ${reviewOutput.verdict}`, false, {
      candidateSha: reviewed, budget: budget.snapshot(), gatesPass: true,
      requiredReviewPresent: true, journeyApproved: false, protectedApprovalsValid: true, blocker: null,
      phase: null,
      lastActivity: `opposite-provider review on ${inversion!.reviewProvider} returned ${reviewOutput.verdict} with ${reviewOutput.findings.length} finding(s)`,
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
    // L17 is the only REVIEWING → BLOCKED edge and its vocabulary is one word,
    // `review-unavailable`, guarded by a retry count. That is deliberate: the
    // reviewer being unreachable is the one review failure the contract lets the
    // host declare terminal. A review that DID answer but answered
    // inconsistently is refused by L15's own guard instead, and the attempt is
    // left in REVIEWING with its failed gate recorded, because inventing a
    // terminal state for it would mean the host deciding what a bad review means.
    // The owner's exits from there are L18 cancel and L16 rework.
    if (failedFrom === "REVIEWING") {
      if (!(error instanceof MandatoryReviewUnavailable)) throw error;
      const detail = `${error.name}: ${error.message}`;
      const decision = transition({
        from: "REVIEWING", to: "BLOCKED", actor: "host", tier: status.tier,
        reason: { source: "process", code: "review-unavailable", detail },
        interactive: false, budget: budget.snapshot(),
        evidence: { reviewTransportRetries },
      });
      await persistTransition("REVIEWING", "BLOCKED", decision.edge, "process", "review-unavailable", detail, false, {
        budget: budget.snapshot(), process: null,
        blocker: { code: "review-unavailable", detail, ahead: null, behind: null },
        lastActivity: detail,
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
