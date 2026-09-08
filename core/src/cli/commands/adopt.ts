// Adopt one completed candidate from a sealed attempt into a new continuation.
//
// The source is read-only throughout. The target is a different task and a new
// managed worktree materialized directly from the recorded commit object. No
// source envelope, gate row, approval, provider locator, or attempt-private
// byte is copied. The target runs current gates, buys a cold opposite-provider
// review, then requires a fresh owner journey and landing authorization.

import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { registeredAdapter } from "../../adapters/registry.ts";
import { writeSystemPromptFile } from "../../adapters/system-prompt-file.ts";
import type { AwsfConfig } from "../../config/schema.ts";
import { toConfigSnapshotJson } from "../../config/effective-config.ts";
import type { EnvelopeBase } from "../../contracts/envelope-base.ts";
import type { CandidateAdoptionEvidence } from "../../contracts/candidate-adoption.ts";
import { parseEnvelope } from "../../contracts/parse-envelope.ts";
import { TEST_OUTPUT_TAIL_MAX_CHARS, type TestOutput } from "../../contracts/test-output.ts";
import { wrapEnvelope } from "../../contracts/stored-envelope.ts";
import { CallBudget } from "../../execution/call-budget.ts";
import type { BarrierRecord, TerminationReport } from "../../execution/launcher-barrier.ts";
import { ProcessTransportBroker, runSystemCommand } from "../../execution/transport-broker.ts";
import { candidateHygiene } from "../../gates/candidate-hygiene.ts";
import { commandsPass } from "../../gates/commands.ts";
import { noProtectedPaths, writesWithinGlobs } from "../../gates/git-diff.ts";
import { GateReport, type GateId } from "../../gates/interface.ts";
import { assertClean, runGit, systemGitRunner, type GitResult } from "../../git/changes.ts";
import { HOST_AUTHOR } from "../../git/commit.ts";
import { createWorktree, seedWorktreePaths } from "../../git/worktrees.ts";
import { scrubCredentialString } from "../../policy/redaction.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../observability/attempt-evidence.ts";
import { diagnoseRecovery } from "../../observability/recovery-diagnostics.ts";
import { writeRunReport } from "../../observability/run-report.ts";
import { attemptDir as attemptDirectory } from "../../persistence/platform-paths.ts";
import { transition, type EdgeId, type TaskState } from "../../state/task-machine.ts";
import { ceilingFor, callCeilingsOf } from "../../state/tiers.ts";
import type { WorkflowRecipe } from "../../workflow/compiler.ts";
import { buildReviewWorkflow } from "../../workflow/recipes/build-review.ts";
import { simpleSdlcWorkflow } from "../../workflow/recipes/simple-sdlc.ts";
import type { OwnerTerminal } from "../tty.ts";
import {
  latestAttemptNumber,
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  taskRoot,
  type AttemptAdvancementGuard,
  type AttemptEvent,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";
import { requestOutput } from "./production-run.ts";
import { readAttemptEvidence, recordedReviews, recordedRoutes } from "./review-record.ts";
import {
  REVIEW_HEADROOM_CALLS,
  ReviewRecordMissing,
  createReviewRunState,
  prepareReview,
  resolveReviewRoute,
  reviewFailureBlocker,
  reviewPhasesOf,
  type ReviewPhaseInfrastructure,
} from "./review-phase.ts";
import { candidatePathsBetween } from "../../workflow/review-evidence.ts";

const { chmod, mkdir, writeFile } = fs;
const SUPPORTED = new Map<string, WorkflowRecipe>([
  [buildReviewWorkflow.id, buildReviewWorkflow],
  [simpleSdlcWorkflow.id, simpleSdlcWorkflow],
]);

export class CandidateAdoptionRejected extends Error {
  constructor(detail: string) {
    super(`candidate adoption rejected: ${detail}`);
    this.name = "CandidateAdoptionRejected";
  }
}

export interface AdoptionCommandInfrastructure extends ReviewPhaseInfrastructure {
  runCommand(executable: string, argv: readonly string[], options: {
    readonly timeoutMs: number;
    readonly cwd: string;
    readonly maxBuffer: number;
  }): GitResult;
  sessionId(): string;
  pidIsLive(pid: number): boolean;
}

export interface AdoptCommandOptions {
  readonly sourceAttemptDir: string;
  readonly stateRoot: string;
  readonly targetTaskId: string;
  readonly worktreeRoot: string;
  readonly terminal: OwnerTerminal;
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly projectRecord?: AttemptProjector;
  readonly assertAdvancement?: AttemptAdvancementGuard;
  readonly assertLaunchProjection?: (sessionId: string) => void;
  readonly infrastructure?: Partial<AdoptionCommandInfrastructure>;
}

export interface AdoptCommandResult {
  readonly source: AttemptStatus;
  readonly status: AttemptStatus | null;
  readonly attemptDir: string | null;
  readonly confirmed: boolean;
}

interface SealedCandidate {
  readonly source: AttemptStatus;
  readonly evidence: readonly AttemptEvidence[];
  readonly recipe: WorkflowRecipe;
  readonly baseSha: string;
  readonly candidateSha: string;
  readonly workerProvider: string;
  readonly summary: string;
}

const DEFAULT_INFRASTRUCTURE: AdoptionCommandInfrastructure = {
  adapterFor: (_entry, adapterId, config) => registeredAdapter(config.adapters, adapterId, config.runtime),
  createBroker: (options) => new ProcessTransportBroker(options),
  writeSystemPrompt: writeSystemPromptFile,
  runCommand: (executable, argv, options) => runSystemCommand(executable, argv, options),
  now: () => new Date().toISOString(),
  sessionId: randomUUID,
  pidIsLive: (pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  },
};

function gateKind(gateId: GateId): "pure" | "filesystem" | "git" | "subprocess" | "journey" {
  if (gateId === "commands_pass") return "subprocess";
  if (["head_advanced", "diff_matches_claims", "candidate_hygiene"].includes(gateId)) return "git";
  if (["artifacts_exist", "files_non_empty", "json_parses", "no_protected_paths", "writes_within_globs"].includes(gateId)) return "filesystem";
  return gateId === "journey_passes" ? "journey" : "pure";
}

function bounded(value: string, maximum = 2_000): string {
  if (value.length <= maximum) return value;
  if (maximum <= 0) return "";
  return `${value.slice(0, maximum - 1)}…`;
}

function credentialSafeGateOutput(value: string): string {
  if (scrubCredentialString(value) !== value) {
    throw new CandidateAdoptionRejected(
      "configured gate output contains credential-shaped data and cannot be retained or reviewed",
    );
  }
  return value;
}

function safeFailure(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Read-only eligibility check. In particular, this never opens the cancelled
 * attempt's worktree: the status/journal prove completion and Git objects in
 * the canonical repository prove identity.
 */
export async function inspectSealedCandidate(
  sourceAttemptDir: string,
  config: AwsfConfig,
  pidIsLive: (pid: number) => boolean,
): Promise<SealedCandidate> {
  const source = await readAttempt(sourceAttemptDir);
  const evidence = await readAttemptEvidence(sourceAttemptDir);
  if (source.lifecycleState !== "BLOCKED" && source.lifecycleState !== "CANCELLED") {
    throw new CandidateAdoptionRejected(`source attempt is ${source.lifecycleState}, not sealed BLOCKED or CANCELLED`);
  }
  if (source.budget.callsReserved !== 0) {
    throw new CandidateAdoptionRejected("source attempt retains an unsettled call reservation");
  }
  const diagnostic = diagnoseRecovery(source, evidence, pidIsLive);
  if (diagnostic.controller === "cancelled-live-survivor") {
    throw new CandidateAdoptionRejected(`source attempt still has live survivor pid ${String(diagnostic.pid)}`);
  }
  if (diagnostic.candidateSha === null || source.baseSha === null) {
    throw new CandidateAdoptionRejected("source records no completed candidate; partial work is never adopted");
  }
  const recipe = SUPPORTED.get(source.workflow);
  if (recipe === undefined || recipe.tier !== 2) {
    throw new CandidateAdoptionRejected(`source workflow ${JSON.stringify(source.workflow)} is not a tier-2 review workflow`);
  }
  if (config.project.slug !== source.project) throw new CandidateAdoptionRejected("source project and current config do not match");
  if (!config.workflows.enabled.includes(recipe.id)) {
    throw new CandidateAdoptionRejected(`source workflow ${JSON.stringify(recipe.id)} is not enabled by the current config`);
  }

  const git = systemGitRunner(source.repository);
  assertClean(source.repository, "before", git);
  const canonicalHead = runGit(git, ["rev-parse", "HEAD"]).trim();
  const baseSha = runGit(git, ["rev-parse", `${source.baseSha}^{commit}`]).trim();
  const candidateSha = runGit(git, ["rev-parse", `${diagnostic.candidateSha}^{commit}`]).trim();
  if (baseSha !== source.baseSha || candidateSha !== diagnostic.candidateSha) {
    throw new CandidateAdoptionRejected("recorded base or candidate does not resolve to its exact 40-hex commit");
  }
  if (canonicalHead !== baseSha) {
    throw new CandidateAdoptionRejected(`canonical HEAD is ${canonicalHead}, not the source base ${baseSha}`);
  }
  if (git(["merge-base", "--is-ancestor", baseSha, candidateSha]).status !== 0 || baseSha === candidateSha) {
    throw new CandidateAdoptionRejected("candidate is not a non-empty descendant of its recorded base");
  }
  const identities = runGit(git, ["show", "-s", "--format=%an <%ae>|%cn <%ce>", candidateSha]).trim();
  if (identities !== `${HOST_AUTHOR}|${HOST_AUTHOR}`) {
    throw new CandidateAdoptionRejected(`candidate was not created under the owner identity: ${identities}`);
  }
  const paths = candidatePathsBetween(source.repository, baseSha, candidateSha);
  if (paths.length === 0) throw new CandidateAdoptionRejected("candidate changes no tracked path");

  const reviews = recordedReviews(evidence, source.sessionId);
  const routes = recordedRoutes(evidence, new Set(reviews.map((review) => review.phaseId)));
  if (routes.worker === null) {
    throw new ReviewRecordMissing("source carries no candidate-producing worker provider for cross-provider inversion");
  }
  return Object.freeze({
    source,
    evidence,
    recipe,
    baseSha,
    candidateSha,
    workerProvider: routes.worker.provider,
    summary: bounded(runGit(git, ["show", "--stat", "--oneline", "--format=%s", candidateSha]).trim()),
  });
}

function assertCandidatePinned(candidate: SealedCandidate, worktree: string, when: string): void {
  const canonical = systemGitRunner(candidate.source.repository);
  const adopted = systemGitRunner(worktree);
  assertClean(candidate.source.repository, "before", canonical);
  assertClean(worktree, "before", adopted);
  const canonicalHead = runGit(canonical, ["rev-parse", "HEAD"]).trim();
  const targetHead = runGit(adopted, ["rev-parse", "HEAD"]).trim();
  if (canonicalHead !== candidate.baseSha || targetHead !== candidate.candidateSha) {
    throw new CandidateAdoptionRejected(
      `candidate moved ${when}: canonical/worktree are ${canonicalHead}/${targetHead}, expected ${candidate.baseSha}/${candidate.candidateSha}`,
    );
  }
}

function adoptionBudget(config: AwsfConfig): AttemptStatus["budget"] {
  return {
    attempt: 1,
    callsSpent: 0,
    callsReserved: 0,
    correctionsAuto: 0,
    correctionsOwner: 0,
    ownerReentries: 0,
    // A candidate-adoption target is deliberately narrower than an ordinary
    // configured build: it has no builder phase and therefore no correction or
    // re-entry path that could change the adopted object. Zero is an honest
    // unavailable allowance; marking configured remedies as spent would invent
    // work the target never performed. L11 itself draws no correction tranche.
    allowance: { auto: 0, owner: 0, ownerReentries: 0 },
    ceiling: ceilingFor(2, callCeilingsOf(config.risk.call_ceiling)),
  };
}

async function createTarget(
  options: AdoptCommandOptions,
  candidate: SealedCandidate,
  infra: AdoptionCommandInfrastructure,
): Promise<{ attemptDir: string; status: AttemptStatus }> {
  if (options.targetTaskId === candidate.source.taskId) {
    throw new CandidateAdoptionRejected("the adoption target must be a distinct task");
  }
  const root = taskRoot(options.stateRoot, candidate.source.project, options.targetTaskId);
  if (await latestAttemptNumber(root) !== null) {
    throw new CandidateAdoptionRejected(`target ${candidate.source.project}/${options.targetTaskId} already exists`);
  }
  const sessionId = infra.sessionId();
  const worktree = createWorktree({
    repository: candidate.source.repository,
    root: options.worktreeRoot,
    attemptId: sessionId,
    baseSha: candidate.candidateSha,
  });
  await seedWorktreePaths({
    repository: candidate.source.repository,
    worktree: worktree.path,
    seedPaths: options.config.runtime.seed_paths,
    protectedPaths: options.config.policy.protected_paths,
  });
  const now = infra.now();
  const dir = attemptDirectory(options.stateRoot, candidate.source.project, options.targetTaskId, "1");
  const budget = adoptionBudget(options.config);
  const status: AttemptStatus = {
    schema: "awsf/attempt-status/v1",
    sessionId,
    project: candidate.source.project,
    taskId: options.targetTaskId,
    continuesTask: candidate.source.taskId,
    attempt: 1,
    repository: candidate.source.repository,
    worktree: worktree.path,
    workflow: candidate.recipe.id,
    tier: 2,
    request: candidate.source.request,
    configSnapshotJson: toConfigSnapshotJson(options.config),
    lifecycleState: "GATING",
    baseSha: candidate.baseSha,
    candidateSha: candidate.candidateSha,
    phase: null,
    budget,
    ceilingGrants: [],
    model: null,
    lastActivityAt: now,
    lastActivity: `created immutable continuation from sealed ${candidate.source.taskId} attempt ${String(candidate.source.attempt)} candidate ${candidate.candidateSha}`,
    nextAction: `wait for fresh gates and opposite-provider review of ${candidate.candidateSha}`,
    gatesPass: false,
    requiredReviewPresent: false,
    journeyApproved: false,
    protectedApprovalsValid: false,
    process: null,
    landingApproval: null,
    blocker: null,
    revision: 1,
    lastSourceSeq: 1,
  };
  const adoption: CandidateAdoptionEvidence = {
    sourceProject: candidate.source.project,
    sourceTaskId: candidate.source.taskId,
    sourceAttempt: candidate.source.attempt,
    sourceSessionId: candidate.source.sessionId,
    sourceRevision: candidate.source.revision,
    sourceLifecycle: candidate.source.lifecycleState as "BLOCKED" | "CANCELLED",
    baseSha: candidate.baseSha,
    candidateSha: candidate.candidateSha,
    workerProvider: candidate.workerProvider,
    targetTaskId: options.targetTaskId,
    verifiedAt: now,
    sourceEvidenceCopied: false,
    sourceApprovalsCopied: false,
  };
  return {
    attemptDir: dir,
    status: await persistAttempt(dir, null, {
      kind: "attempt.created",
      next: status,
      evidence: { type: "candidate-adoption", adoption },
    }, options.projectRecord),
  };
}

interface Measurement {
  readonly testOutput: TestOutput;
  readonly reports: readonly GateReport[];
  readonly passed: boolean;
}

async function executeAdoption(options: AdoptCommandOptions): Promise<AdoptCommandResult> {
  if (!options.terminal.interactive) {
    throw new CandidateAdoptionRejected("adoption requires an interactive owner terminal");
  }
  const infra: AdoptionCommandInfrastructure = { ...DEFAULT_INFRASTRUCTURE, ...options.infrastructure };
  const candidate = await inspectSealedCandidate(options.sourceAttemptDir, options.config, infra.pidIsLive);
  if (options.targetTaskId === candidate.source.taskId) {
    throw new CandidateAdoptionRejected("the adoption target must be a distinct continuing task");
  }
  const targetRoot = taskRoot(options.stateRoot, candidate.source.project, options.targetTaskId);
  if (await latestAttemptNumber(targetRoot) !== null) {
    throw new CandidateAdoptionRejected(`target ${candidate.source.project}/${options.targetTaskId} already exists`);
  }

  const phases = reviewPhasesOf(candidate.recipe);
  const route = await resolveReviewRoute({
    config: options.config,
    configPath: options.configPath,
    infra,
    recipe: candidate.recipe,
    reviewPhaseId: phases.review,
    workerProvider: candidate.workerProvider,
  });
  const budgetShape = adoptionBudget(options.config);
  const remaining = ceilingFor(2, budgetShape.ceiling) - budgetShape.callsSpent;
  if (remaining < REVIEW_HEADROOM_CALLS) {
    throw new CandidateAdoptionRejected(`target has ${String(remaining)} call(s), but review plus its fixed-route retry require ${String(REVIEW_HEADROOM_CALLS)}`);
  }

  options.terminal.write(`Sealed source: ${candidate.source.project}/${candidate.source.taskId} attempt ${String(candidate.source.attempt)} (${candidate.source.lifecycleState})`);
  options.terminal.write(`Exact candidate: ${candidate.candidateSha} (base ${candidate.baseSha})`);
  options.terminal.write(`Summary: ${candidate.summary}`);
  options.terminal.write(`Distinct target: ${candidate.source.project}/${options.targetTaskId}, continuing ${candidate.source.taskId}`);
  options.terminal.write(`Fresh route: ${route.adapterId} / ${route.model.provider}, opposite source builder provider ${candidate.workerProvider}`);
  options.terminal.write("No source attempt bytes, calls, gates, reviews, journeys, protected approvals, landing approval, or provider session transfer.");
  options.terminal.write("The target gets a new managed worktree at the exact commit, reruns current configured gates, and requires a fresh review, journey, and landing confirmation.");
  const confirmed = await options.terminal.confirm(`Adopt exact candidate ${candidate.candidateSha} into new task ${options.targetTaskId}?`);
  if (!confirmed) return { source: candidate.source, status: null, attemptDir: null, confirmed: false };

  // Re-read every source fact after the human answer. No target exists until
  // this second exact validation succeeds.
  const repeated = await inspectSealedCandidate(options.sourceAttemptDir, options.config, infra.pidIsLive);
  if (
    repeated.source.revision !== candidate.source.revision ||
    repeated.baseSha !== candidate.baseSha ||
    repeated.candidateSha !== candidate.candidateSha ||
    repeated.workerProvider !== candidate.workerProvider
  ) {
    throw new CandidateAdoptionRejected("sealed source evidence changed after confirmation");
  }
  const available = await route.adapter.isAvailable();
  if (available.status !== "available") {
    throw new CandidateAdoptionRejected(`review route became unavailable: ${available.detail ?? available.code ?? "blocked"}`);
  }
  const routeAgain = await route.adapter.getModelInfo(route.agent.model);
  if (
    routeAgain.adapter !== route.model.adapter ||
    routeAgain.provider !== route.model.provider ||
    routeAgain.requestedModel !== route.model.requestedModel
  ) {
    throw new CandidateAdoptionRejected("review adapter/provider/model changed after confirmation");
  }

  const created = await createTarget(options, candidate, infra);
  let status = created.status;
  const attemptDir = created.attemptDir;
  let writeQueue: Promise<void> = Promise.resolve();
  let transitionSeq = 0;
  const persist = async (kind: AttemptEvent["kind"], update: Partial<AttemptStatus>, evidence?: AttemptEvidence): Promise<void> => {
    const operation = writeQueue.then(async () => {
      status = await persistAttempt(attemptDir, status.revision, {
        kind,
        next: nextRevision(status, update),
        ...(evidence === undefined ? {} : { evidence }),
      }, options.projectRecord);
    });
    writeQueue = operation.catch(() => undefined);
    await operation;
  };
  const persistTransition = async (
    from: TaskState,
    to: TaskState,
    edgeId: EdgeId,
    source: string,
    code: string | null,
    detail: string,
    spawnSite: boolean,
    update: Partial<AttemptStatus>,
  ): Promise<void> => {
    const at = infra.now();
    transitionSeq += 1;
    await persist("attempt.transitioned", {
      lifecycleState: to,
      lastActivityAt: at,
      nextAction: nextActionFor(to, status.taskId),
      ...update,
    }, {
      type: "transition",
      id: `${status.sessionId}:${edgeId}:${String(transitionSeq)}`,
      seq: transitionSeq,
      from,
      to,
      actor: "host",
      edgeId,
      reasonSource: source,
      reasonCode: code,
      reasonDetail: detail,
      spawnSite,
      at,
    });
  };
  const persistGate = async (phaseId: string, report: GateReport, exitCode: number | null = null, outputPath: string | null = null): Promise<void> => {
    const at = infra.now();
    await persist("attempt.updated", {}, {
      type: "gate",
      id: `${phaseId}:0:${report.gateId}`,
      phaseId,
      round: 0,
      gateId: report.gateId,
      kind: gateKind(report.gateId),
      candidateSha: candidate.candidateSha,
      passed: report.passed,
      exitCode,
      checks: report.checks,
      violations: report.checks.filter((check) => !check.ok).map((check) => `${check.item}: ${check.note}`),
      outputPath,
      startedAt: at,
      endedAt: at,
    });
  };

  const phaseId = `${status.sessionId}:adoption-tests`;
  const phaseAt = infra.now();
  const phase = (state: string, error: Error | null = null): PhaseEvidenceRecord => ({
    phaseId,
    ordinal: 1,
    key: "adoption-tests",
    name: "adoption tests",
    kind: "code",
    owner: "host",
    description: `Run current configured gates against adopted candidate ${candidate.candidateSha}`,
    status: state,
    correctionCount: 0,
    maxCorrections: 0,
    errorCode: error?.name ?? null,
    errorMessage: error?.message ?? null,
    startedAt: state === "QUEUED" ? null : phaseAt,
    endedAt: ["SUCCEEDED", "FAILED"].includes(state) ? infra.now() : null,
    createdAt: phaseAt,
  });
  await persist("attempt.updated", {}, { type: "phase", phase: phase("QUEUED") });
  await persist("attempt.updated", {
    phase: { name: "adoption tests", state: "RUNNING", round: 0, maximumRounds: 0 },
    lastActivityAt: phaseAt,
    lastActivity: `running fresh configured gates against ${candidate.candidateSha}`,
  }, { type: "phase", phase: phase("RUNNING") });

  const measure = async (): Promise<Measurement> => {
    assertCandidatePinned(candidate, status.worktree!, "before fresh gates");
    const git = systemGitRunner(status.worktree!);
    const hygieneResult = git(["diff", "--check", `${candidate.baseSha}..${candidate.candidateSha}`, "--"]);
    const hygiene = candidateHygiene({
      expectedBaseSha: candidate.baseSha,
      observedBaseSha: runGit(git, ["rev-parse", `${candidate.baseSha}^{commit}`]).trim(),
      expectedCandidateSha: candidate.candidateSha,
      headBefore: runGit(git, ["rev-parse", "HEAD"]).trim(),
      headAfter: runGit(git, ["rev-parse", "HEAD"]).trim(),
      cleanBefore: runGit(git, ["status", "--porcelain"]).trim().length === 0,
      cleanAfter: runGit(git, ["status", "--porcelain"]).trim().length === 0,
      exitCode: hygieneResult.status ?? -1,
      output: `${hygieneResult.stdout}${hygieneResult.stderr}${hygieneResult.error ?? ""}`,
    });
    await persistGate(phaseId, hygiene, hygieneResult.status ?? -1);
    const changed = candidatePathsBetween(status.worktree!, candidate.baseSha, candidate.candidateSha);
    const protectedReport = noProtectedPaths(changed, options.config.policy.protected_paths);
    await persistGate(phaseId, protectedReport);
    const workerId = phases.worker;
    const workerOwner = candidate.recipe.phases.find((item) => item.id === workerId)!.owner;
    const worker = options.config.agents.find((agent) => agent.name === workerOwner);
    if (worker === undefined) throw new CandidateAdoptionRejected(`current config has no ${workerOwner} route whose write boundary can be revalidated`);
    const writesReport = writesWithinGlobs(changed, worker.writes);
    await persistGate(phaseId, writesReport);

    const commands: TestOutput["commands"] = [];
    const failures: string[] = [];
    const sections: string[] = [];
    for (const [gateId, configured] of Object.entries(options.config.gates)) {
      assertCandidatePinned(candidate, status.worktree!, `before ${gateId}`);
      const started = Date.now();
      const [executable, ...argv] = configured.argv;
      const result = infra.runCommand(executable!, argv, {
        timeoutMs: configured.timeout_seconds * 1_000,
        cwd: status.worktree!,
        maxBuffer: options.config.runtime.max_output_bytes,
      });
      const output = credentialSafeGateOutput(
        `${result.stdout}${result.stderr}${result.error === null ? "" : `\n${result.error}`}`,
      );
      const relative = join("raw", `command-adoption-tests-${gateId}-0.txt`);
      const absolute = join(attemptDir, relative);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, output, { mode: 0o600 });
      await chmod(absolute, 0o600);
      const exitCode = result.status ?? -1;
      commands.push({ gateId, argv: [...configured.argv], exitCode, durationMs: Date.now() - started, outputRef: relative });
      sections.push(`### ${gateId} (exit ${String(exitCode)})\n${bounded(output, TEST_OUTPUT_TAIL_MAX_CHARS)}`);
      if (exitCode !== 0) failures.push(`${gateId} exited ${String(exitCode)}`);
      try { assertCandidatePinned(candidate, status.worktree!, `after ${gateId}`); }
      catch (error) { failures.push(`${gateId} moved or dirtied the candidate: ${safeFailure(error).message}`); }
    }
    const testOutput: TestOutput = {
      schema: "awsf.test-output/v1",
      producerStatus: failures.length === 0 ? "success" : "failure",
      summary: failures.length === 0 ? "all current configured commands passed" : "current configured commands failed",
      artifacts: [],
      notesForNextPhase: failures.length === 0 ? "compose fresh review evidence" : "adopted candidate retained blocked",
      passed: failures.length === 0,
      candidateSha: candidate.candidateSha,
      commands,
      failures,
      outputTail: bounded(sections.join("\n\n"), TEST_OUTPUT_TAIL_MAX_CHARS),
    };
    const aggregate = new GateReport("commands_pass");
    for (const [gateId, configured] of Object.entries(options.config.gates)) {
      const report = commandsPass(testOutput, { gateId, argv: configured.argv }, {
        candidateSha: candidate.candidateSha,
        cleanBefore: true,
        cleanAfter: failures.every((failure) => !failure.startsWith(`${gateId} moved or dirtied`)),
      });
      for (const check of report.checks) aggregate.check(`${gateId}:${check.item}`, check.ok, check.note);
    }
    if (Object.keys(options.config.gates).length === 0) aggregate.check("configured commands", true, "no commands configured");
    await persistGate(phaseId, aggregate, failures.length === 0 ? 0 : -1);
    const reports = Object.freeze([hygiene, protectedReport, writesReport, aggregate]);
    return { testOutput, reports, passed: reports.every((report) => report.passed) && testOutput.passed };
  };

  let measurement: Measurement;
  try {
    measurement = await measure();
  } catch (error) {
    const failure = safeFailure(error);
    measurement = {
      testOutput: {
        schema: "awsf.test-output/v1",
        producerStatus: "failure",
        summary: "fresh adoption gates aborted",
        artifacts: [],
        notesForNextPhase: "adopted candidate retained blocked",
        passed: false,
        candidateSha: candidate.candidateSha,
        commands: [],
        failures: [failure.message],
        outputTail: "",
      },
      reports: [],
      passed: false,
    };
  }

  const rawRelative = join("raw", "host-adoption-tests.txt");
  await mkdir(dirname(join(attemptDir, rawRelative)), { recursive: true });
  await writeFile(join(attemptDir, rawRelative), JSON.stringify(measurement.testOutput), { mode: 0o600 });
  const parsedTests = parseEnvelope(JSON.stringify(measurement.testOutput), "awsf.test-output/v1");
  const storedTests = wrapEnvelope({
    envelopeId: `${status.sessionId}:adoption-tests:0`,
    sessionId: status.sessionId,
    phaseId: "adoption-tests",
    correctionRound: 0,
    agent: "host",
    schemaId: "awsf.test-output/v1",
    createdAt: infra.now(),
    rawOutputPath: rawRelative,
  }, parsedTests);
  const envelopePath = join(attemptDir, "envelopes", "adoption-tests-0.json");
  await mkdir(dirname(envelopePath), { recursive: true });
  if (existsSync(envelopePath)) throw new CandidateAdoptionRejected("immutable adoption test envelope already exists");
  await writeFile(envelopePath, JSON.stringify(storedTests), { mode: 0o600 });
  await persist("attempt.updated", {}, { type: "envelope", phaseId, envelope: storedTests as typeof storedTests & { payload: EnvelopeBase | null } });

  if (!measurement.passed) {
    const failure = new Error(measurement.testOutput.failures.join("; ") || "fresh candidate gates failed");
    await persist("attempt.updated", {
      phase: { name: "adoption tests", state: "FAILED", round: 0, maximumRounds: 0 },
      lastActivityAt: infra.now(),
      lastActivity: "fresh adoption gates failed; exact candidate retained",
    }, { type: "phase", phase: phase("FAILED", failure) });
    const detail = `immutable adopted candidate failed fresh gates: ${failure.message}`;
    const l13 = transition({
      from: "GATING",
      to: "BLOCKED",
      actor: "host",
      tier: 2,
      reason: { source: "gate", code: "correction-budget-exhausted", detail },
      interactive: false,
      budget: status.budget,
      evidence: { gatesPass: false },
    });
    await persistTransition("GATING", "BLOCKED", l13.edge, "gate", "correction-budget-exhausted", detail, false, {
      gatesPass: false,
      blocker: { code: "correction-budget-exhausted", detail, ahead: null, behind: null },
      phase: null,
      lastActivity: detail,
    });
    await writeRunReport(attemptDir, status, await readAttemptEvidence(attemptDir));
    return { source: candidate.source, status, attemptDir, confirmed: true };
  }

  await persist("attempt.updated", {
    gatesPass: true,
    phase: null,
    protectedApprovalsValid: true,
    lastActivityAt: infra.now(),
    lastActivity: `fresh current gates passed against adopted candidate ${candidate.candidateSha}`,
  }, { type: "phase", phase: phase("SUCCEEDED") });

  let prepared;
  try {
    const intent = requestOutput(status, options.config);
    prepared = await prepareReview({
      subject: {
        attemptDir,
        stateRoot: options.stateRoot,
        sessionId: status.sessionId,
        repository: status.repository,
        worktree: status.worktree!,
        baseSha: candidate.baseSha,
        candidateSha: candidate.candidateSha,
      },
      config: options.config,
      infra,
      recipe: candidate.recipe,
      reviewPhaseId: phases.review,
      route,
      generation: "ad1",
      intent: {
        request: status.request,
        goals: intent.goals,
        nonGoals: intent.nonGoals,
        acceptanceCriteria: intent.implementationSteps.flatMap((step) => step.acceptanceCriteria),
        testStrategy: intent.testStrategy,
      },
      testOutput: measurement.testOutput,
      workerProvider: candidate.workerProvider,
    });
  } catch (error) {
    const detail = `fresh review preflight failed before provider spend: ${safeFailure(error).message}`;
    const l13 = transition({
      from: "GATING",
      to: "BLOCKED",
      actor: "host",
      tier: 2,
      reason: { source: "gate", code: "correction-budget-exhausted", detail },
      interactive: false,
      budget: status.budget,
      evidence: { gatesPass: false },
    });
    await persistTransition("GATING", "BLOCKED", l13.edge, "gate", "correction-budget-exhausted", detail, false, {
      gatesPass: false,
      blocker: { code: "correction-budget-exhausted", detail, ahead: null, behind: null },
      phase: null,
      lastActivity: detail,
    });
    await writeRunReport(attemptDir, status, await readAttemptEvidence(attemptDir));
    return { source: candidate.source, status, attemptDir, confirmed: true };
  }

  const budget = new CallBudget({
    taskId: status.taskId,
    tier: 2,
    allowance: status.budget.allowance,
    ...(status.budget.ceiling === undefined ? {} : { ceiling: status.budget.ceiling }),
    carried: {
      attempt: 1,
      correctionsAuto: status.budget.correctionsAuto,
      correctionsOwner: status.budget.correctionsOwner,
      ownerReentries: status.budget.ownerReentries,
    },
  });
  const l11 = budget.authorize({
    from: "GATING",
    to: "REVIEWING",
    actor: "host",
    reason: { source: "gate" },
    interactive: false,
    evidence: { gatesPass: true, candidateSha: candidate.candidateSha },
    spawn: { cost: 1 },
  });
  const reviewState = createReviewRunState();
  const reviewPhaseId = `${status.sessionId}:${prepared.phaseKey}`;
  await persistTransition("GATING", "REVIEWING", l11.result.edge, "gate", null, `held fresh opposite-provider review of adopted candidate ${candidate.candidateSha}`, true, {
    budget: budget.snapshot(),
    requiredReviewPresent: false,
    journeyApproved: false,
    landingApproval: null,
    lastActivity: `L11 held one call for fresh ${route.model.provider} review of adopted candidate ${candidate.candidateSha}`,
  });

  try {
    const output = await prepared.run({
      budget,
      reservation: l11.reservation!,
      retrySubject: `${candidate.recipe.id}:${prepared.phaseKey}:retry`,
      registration: { from: "GATING", to: "REVIEWING", edge: "L11" },
      ordinal: 2,
      state: reviewState,
      persist,
      assertBeforeGo: () => { assertCandidatePinned(candidate, status.worktree!, "between adoption validation and GO"); },
      assertAfterAnswer: () => { assertCandidatePinned(candidate, status.worktree!, "between review answer and L15"); },
      ...(options.assertLaunchProjection === undefined ? {} : { assertLaunchProjection: options.assertLaunchProjection }),
    });
    options.assertAdvancement?.(status.sessionId, "AWAITING_OWNER");
    const l15 = transition({
      from: "REVIEWING",
      to: "AWAITING_OWNER",
      actor: "host",
      tier: 2,
      reason: { source: "gate" },
      interactive: false,
      budget: budget.snapshot(),
      evidence: {
        gatesPass: true,
        candidateSha: candidate.candidateSha,
        review: { verdict: output.verdict, reviewedSha: output.reviewedSha, findings: output.findings },
      },
    });
    await persistTransition("REVIEWING", "AWAITING_OWNER", l15.edge, "gate", null, `fresh adopted-candidate review returned ${output.verdict}`, false, {
      candidateSha: candidate.candidateSha,
      budget: budget.snapshot(),
      gatesPass: true,
      requiredReviewPresent: true,
      journeyApproved: false,
      protectedApprovalsValid: true,
      landingApproval: null,
      process: null,
      phase: null,
      blocker: null,
      lastActivity: `fresh opposite-provider review on ${route.model.provider} returned ${output.verdict} with ${String(output.findings.length)} finding(s)`,
      nextAction: `run \`awsf journey ${status.taskId}\` at a TTY, then \`awsf land ${status.taskId}\` for fresh owner authorization`,
    });
  } catch (error) {
    await writeQueue;
    const failure = safeFailure(error);
    let termination: TerminationReport | null = null;
    if (reviewState.activeTransport !== null && reviewState.observed?.settled !== true) {
      try { termination = await reviewState.activeTransport.cancel("candidate adoption review failed closed"); }
      catch { termination = null; }
    }
    for (const held of budget.outstanding()) budget.releaseOnRegistrationFailure(held.id);
    status = await readAttempt(attemptDir);
    if (status.lifecycleState !== "REVIEWING") throw failure;
    const registered = reviewState.processRecord as BarrierRecord | null;
    if (registered !== null && !reviewState.processSettled) {
      const at = infra.now();
      await persist("attempt.updated", { process: null, budget: budget.snapshot(), lastActivityAt: at }, {
        type: "process",
        phaseId: reviewPhaseId,
        adapterId: route.adapterId,
        role: route.agent.name,
        record: registered,
        status: termination?.terminated === true ? "CANCELLED" : "FAILED",
        registeredAt: reviewState.releasedAt ?? at,
        releasedAt: reviewState.releasedAt,
        endedAt: at,
        exitCode: reviewState.observed?.exitCode ?? null,
        exitSignal: null,
      });
    }
    const classified = failure instanceof CandidateAdoptionRejected
      ? { code: "review-evidence-invalid", detail: failure.message }
      : reviewFailureBlocker(failure, `${failure.name}: ${failure.message}`) ?? { code: "phase-abort", detail: `${failure.name}: ${failure.message}` };
    const detail = termination !== null && !termination.terminated
      ? `${classified.detail}; surviving processes [${termination.survivors.join(", ")}]`
      : classified.detail;
    const l17 = transition({
      from: "REVIEWING",
      to: "BLOCKED",
      actor: "host",
      tier: 2,
      reason: { source: "process", code: classified.code, detail },
      interactive: false,
      budget: budget.snapshot(),
      evidence: { reviewTransportRetries: reviewState.transportRetries, reviewFailure: classified.code },
    });
    await persistTransition("REVIEWING", "BLOCKED", l17.edge, "process", classified.code, detail, false, {
      budget: budget.snapshot(),
      process: null,
      phase: null,
      requiredReviewPresent: false,
      journeyApproved: false,
      landingApproval: null,
      blocker: { code: classified.code, detail, ahead: null, behind: null },
      lastActivity: detail,
    });
  }

  await writeRunReport(attemptDir, status, await readAttemptEvidence(attemptDir));
  return { source: candidate.source, status, attemptDir, confirmed: true };
}

export async function adoptCommand(options: AdoptCommandOptions): Promise<AdoptCommandResult> {
  return executeAdoption(options);
}
