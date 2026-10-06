// `awsf preflight <task> --where <glob>... [--read <path>...] [--consulted <session-id>...] [--json]`
// (specs/awsf-v3-w01-driver-checks.html, task 9).
//
// The host measures what the driver used to check from memory. This command
// gathers every K1 fact itself (Git, the configuration, the journal and file
// modes read with stat), judges them with core/src/preflight/fields.ts, and
// appends one awsf.driver-preflight/v1 record to the DRAFT attempt whether or
// not every field passed: a refusal is evidence too. `--where`, `--read` and
// `--consulted` are the driver's inputs, recorded as given and checked by the
// fields; no flag can mark a field passed.
//
// It is not an owner act and takes no owner terminal. It moves no lifecycle
// edge and reserves no call. The suite is reused from a landed attempt whose
// candidate is the base, or from an earlier preflight record that measured the
// passing suite at the base, or run once in the project's baseline worktree,
// never in the owner's checkout and never in a tree created for this run alone.

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { toConfigSnapshotJson } from "../../config/effective-config.ts";
import { loadConfig } from "../../config/load.ts";
import type { AwsfConfig } from "../../config/schema.ts";
import { gatesConfigDigest } from "../../contracts/command-ledger.ts";
import {
  assertDriverPreflightRecord,
  requestPathsDigest,
  requestTextDigest,
  type DriverPreflightRecord,
  type RequestConfirmationRecord,
} from "../../contracts/driver-preflight.ts";
import { sha256 } from "../../contracts/owner-amendment.ts";
import { runGit, systemGitRunner } from "../../git/changes.ts";
import type { AttemptEvidence } from "../../observability/attempt-evidence.ts";
import {
  evaluatePreflightFields,
  normalizedRequestDigest,
  type DuplicateFacts,
  type StorageMode,
  type TaskRequestFact,
  type WritingPhase,
} from "../../preflight/fields.ts";
import {
  gatherSuite,
  type GateCommandRunner,
  type LandedMeasurement,
  type PreflightMeasurement,
  type SuiteGathering,
} from "../../preflight/suite.ts";
import { compiledWorkflow, CompiledWorkflowUnbound, workflowRecipe } from "../../workflow/catalog.ts";
import { verifiedTargetSeed } from "../../workflow/candidate-seed.ts";
import { bindProveRecipe } from "../../workflow/prove/bind.ts";
import { PROVE_WORKFLOW_ID } from "../../workflow/prove/compile.ts";
import { bindShiftRecipe } from "../../workflow/shift/bind.ts";
import { SHIFT_WORKFLOW_ID } from "../../workflow/shift/compile.ts";
import type { WorkflowRecipe } from "../../workflow/compiler.ts";
import {
  latestAttemptNumber,
  nextRevision,
  persistAttempt,
  readAttempt,
  taskRoot,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";
import { declaredContinuation } from "./relate.ts";
import { readAttemptEvidence } from "./review-record.ts";

/** The longest continuation chain walked; deeper declarations are not followed. */
const MAX_CHAIN = 100;

export class PreflightAttemptNotDraft extends Error {
  constructor(taskId: string, state: string) {
    super(`awsf preflight measures a DRAFT attempt; ${taskId}'s attempt is ${state}, which nothing here can prepare again`);
    this.name = "PreflightAttemptNotDraft";
  }
}

export interface PreflightCommandOptions {
  readonly attemptDir: string;
  readonly stateRoot: string;
  /** Outside both the repository and state root; the baseline worktree lives under it. */
  readonly worktreeRoot: string;
  readonly configPath?: string;
  readonly where: readonly string[];
  readonly read: readonly string[];
  readonly consulted: readonly string[];
  readonly projectRecord?: AttemptProjector;
  readonly now?: () => string;
  /** Test seam for the gate commands; production runs them through the transport broker. */
  readonly runCommand?: GateCommandRunner;
}

export interface PreflightCommandResult {
  readonly status: AttemptStatus;
  readonly record: DriverPreflightRecord;
  readonly suite: SuiteGathering;
  /** True when every measured field passed; the attested confirmation is the owner's later act. */
  readonly measuredPassed: boolean;
}

/** The configuration digest a preflight record binds to: the redacted effective snapshot, as a seed binds it. */
export function preflightConfigDigest(config: AwsfConfig): string {
  return sha256(toConfigSnapshotJson(config));
}

/** The recipe `awsf start` would compile for this attempt, resolved the same way and with the same refusals. */
async function attemptRecipe(status: AttemptStatus, config: AwsfConfig): Promise<WorkflowRecipe> {
  const shipped = workflowRecipe(status.workflow);
  if (shipped !== null) return shipped;
  const compiled = compiledWorkflow(status.workflow);
  if (compiled === null) throw new Error(`workflow ${JSON.stringify(status.workflow)} has no shipped recipe`);
  const prompts = { builder: "", reviewer: "" };
  if (compiled.id === PROVE_WORKFLOW_ID) {
    if (status.replay == null) throw new CompiledWorkflowUnbound(compiled.id, `task ${status.taskId}`);
    return bindProveRecipe(status, { prompts, gates: Object.keys(config.gates) });
  }
  if (status.shift == null) throw new CompiledWorkflowUnbound(compiled.id, `task ${status.taskId}`);
  return bindShiftRecipe(status.repository, status.shift, { prompts });
}

/** Each agent phase whose role writes the repository, keyed by phase id as `awsf grant` keys it. */
function writingPhases(recipe: WorkflowRecipe, config: AwsfConfig): WritingPhase[] {
  const agents = new Map(config.agents.map((agent) => [agent.name, agent]));
  return recipe.phases.flatMap((phase) => {
    const writes = phase.kind === "agent" ? agents.get(phase.owner)?.writes ?? [] : [];
    return writes.length === 0 ? [] : [{ phase: phase.id, writes: [...writes] }];
  });
}

/** The base L1 would pin, exactly as `awsf start` resolves it: a replay's, a seed's integration base, or HEAD. */
async function pinnedBase(attemptDir: string, status: AttemptStatus): Promise<string> {
  const seed = await verifiedTargetSeed(attemptDir, status);
  return status.replay?.baseSha ?? seed?.integrationBaseSha ?? runGit(systemGitRunner(status.repository), ["rev-parse", "HEAD"]).trim();
}

/** Mode bits read with stat and nothing else. A path not yet created is measured at its nearest existing parent. */
async function modeOf(path: string): Promise<StorageMode> {
  let cursor = resolve(path);
  for (;;) {
    try {
      return { path: cursor, mode: (await stat(cursor)).mode };
    } catch (error) {
      const parent = dirname(cursor);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === cursor) return { path: cursor, mode: null };
      cursor = parent;
    }
  }
}

/** The Git common directory's HEAD and config, and the worktree root. Nothing is written to measure them. */
export async function measureGitStorage(repository: string, worktreeRoot: string): Promise<readonly StorageMode[]> {
  const common = runGit(systemGitRunner(repository), ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  return Promise.all([modeOf(join(common, "HEAD")), modeOf(join(common, "config")), modeOf(worktreeRoot)]);
}

async function taskIds(stateRoot: string, project: string): Promise<string[]> {
  try {
    return (await readdir(join(stateRoot, "projects", project, "tasks"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** The tasks a task continues, nearest first, by `awsf relate` or `awsf new --continues`. */
async function ancestors(stateRoot: string, project: string, taskId: string): Promise<string[]> {
  const chain: string[] = [];
  let cursor: string | null = taskId;
  while (chain.length < MAX_CHAIN) {
    try {
      cursor = await declaredContinuation(stateRoot, project, cursor);
    } catch {
      break;
    }
    if (cursor === null || cursor === taskId || chain.includes(cursor)) break;
    chain.push(cursor);
  }
  return chain;
}

async function attemptStatuses(stateRoot: string, project: string, taskId: string, below?: number): Promise<AttemptStatus[]> {
  const root = taskRoot(stateRoot, project, taskId);
  const latest = await latestAttemptNumber(root);
  const statuses: AttemptStatus[] = [];
  for (let attempt = 1; attempt <= (below === undefined ? latest ?? 0 : below - 1); attempt += 1) {
    try {
      statuses.push(await readAttempt(join(root, String(attempt))));
    } catch {
      // An attempt directory without a status holds no session to cite.
    }
  }
  return statuses;
}

/** This task's earlier attempts and every attempt of the tasks it continues: the attempts `--consulted` must name. */
export async function priorAttemptStatuses(stateRoot: string, status: AttemptStatus): Promise<AttemptStatus[]> {
  const continued = await ancestors(stateRoot, status.project, status.taskId);
  return [
    ...(await attemptStatuses(stateRoot, status.project, status.taskId, status.attempt)),
    ...(await Promise.all(continued.map((taskId) => attemptStatuses(stateRoot, status.project, taskId)))).flat(),
  ];
}

interface JournalFacts {
  readonly duplicate: DuplicateFacts;
  readonly priorSessions: readonly string[];
  readonly landed: readonly LandedMeasurement[];
  /** Every driver-preflight record of any task in the project, this one included, newest first. */
  readonly earlier: readonly PreflightMeasurement[];
}

/**
 * What the journal says about the other tasks: their requests and plan refs
 * for `duplicate`, the sessions of earlier attempts and continued tasks for
 * `prior-attempts`, and for `suite` the landed attempts whose candidate is the
 * base and every earlier preflight record in the project, this task's own too.
 */
async function journalFacts(stateRoot: string, status: AttemptStatus, baseSha: string): Promise<JournalFacts> {
  const project = status.project;
  const continued = await ancestors(stateRoot, project, status.taskId);
  const chain = new Set(continued);
  const others: TaskRequestFact[] = [];
  const landed: LandedMeasurement[] = [];
  const earlier: PreflightMeasurement[] = [];
  for (const taskId of await taskIds(stateRoot, project)) {
    const statuses = await attemptStatuses(stateRoot, project, taskId);
    for (const attempt of statuses) {
      const label = `${taskId} attempt ${String(attempt.attempt)}`;
      const atBase = (attempt.lifecycleState === "LANDED" || attempt.lifecycleState === "PUBLISHED") && attempt.candidateSha === baseSha;
      const dir = join(taskRoot(stateRoot, project, taskId), String(attempt.attempt));
      let evidence: readonly AttemptEvidence[];
      try {
        evidence = await readAttemptEvidence(dir);
      } catch (error) {
        // A journal that cannot be read offers no preflight record to reuse,
        // so the suite runs; a landed attempt at the base is refused as before.
        if (atBase) throw error;
        evidence = [];
      }
      if (atBase) landed.push({ label, candidateSha: baseSha, evidence });
      for (const entry of evidence) {
        if (entry.type === "driver-preflight") earlier.push({ label: `${label}'s driver preflight at ${entry.record.at}`, record: entry.record });
      }
    }
    if (taskId === status.taskId) continue;
    const latest = statuses.at(-1);
    if (latest === undefined) continue;
    if ((await ancestors(stateRoot, project, taskId)).includes(status.taskId)) chain.add(taskId);
    others.push({ taskId, requestDigest: normalizedRequestDigest(latest.request), planRef: latest.planRef, latestState: latest.lifecycleState });
  }
  const priorSessions = (await priorAttemptStatuses(stateRoot, status)).map((attempt) => attempt.sessionId);
  return {
    duplicate: {
      taskId: status.taskId, chain: [...chain].sort(), requestDigest: normalizedRequestDigest(status.request),
      planRef: status.planRef, others,
    },
    priorSessions: [...new Set(priorSessions)].sort(),
    landed,
    earlier: earlier.sort((left, right) => left.record.at < right.record.at ? 1 : left.record.at > right.record.at ? -1 : 0),
  };
}

/** This attempt's request-confirmation records, oldest first, as its journal holds them. */
async function attemptConfirmations(attemptDir: string): Promise<RequestConfirmationRecord[]> {
  return (await readAttemptEvidence(attemptDir)).flatMap((evidence) => evidence.type === "request-confirmation" ? [evidence.record] : []);
}

/** One line per K1 field, the suite's source, where a failed gate's output is kept, and the rendered next action. */
export function renderPreflightLines(result: PreflightCommandResult): readonly string[] {
  const { record, suite } = result;
  const measured = record.fields.filter((field) => field.kind === "measured");
  const lines = [
    `Preflight of ${record.taskId} attempt ${String(record.attempt)} at ${record.baseSha}: ` +
      `${String(measured.filter((field) => field.passed).length)} of ${String(measured.length)} measured field(s) passed; the record is journalled.`,
  ];
  if (suite.reusedFrom === "landed-attempt") lines.push(`Suite: reused the gate rows of ${suite.reused ?? ""}, whose landed candidate is this base; no gate ran.`);
  if (suite.reusedFrom === "driver-preflight") {
    lines.push(`Suite: reused the passing gate rows of ${suite.reused ?? ""}, measured at this base under the current gate configuration; no gate ran.`);
  }
  if (suite.baseline !== null) {
    const seconds = suite.runs.reduce((total, run) => total + run.durationMs, 0) / 1_000;
    lines.push(`Suite: ran ${String(suite.runs.length)} gate(s) in ${seconds.toFixed(1)} s in the baseline worktree ${suite.baseline.path} ` +
      `(${suite.baseline.created ? "created" : "re-pointed"} at the base).`);
  }
  for (const field of record.fields) lines.push(field.passed ? `${field.id}: pass` : `${field.id}: refused — ${field.reason}`);
  for (const run of suite.runs.filter((entry) => entry.exitCode !== 0)) lines.push(`Gate ${run.gateId} output: ${run.outputPath}`);
  lines.push(result.status.nextAction);
  return lines;
}

export async function preflightCommand(options: PreflightCommandOptions): Promise<PreflightCommandResult> {
  const current = await readAttempt(options.attemptDir);
  if (current.lifecycleState !== "DRAFT") throw new PreflightAttemptNotDraft(current.taskId, current.lifecycleState);
  const configPath = resolve(options.configPath ?? join(current.repository, "awsf.config.yaml"));
  const config = loadConfig(await readFile(configPath, "utf8"));
  if (config.project.slug !== current.project) {
    throw new Error(`config project ${config.project.slug} does not match attempt project ${current.project}`);
  }
  const recipe = await attemptRecipe(current, config);
  const writers = writingPhases(recipe, config);
  const shift = current.workflow === SHIFT_WORKFLOW_ID ? { builderWrites: [...new Set(writers.flatMap((writer) => writer.writes))] } : null;
  const baseSha = await pinnedBase(options.attemptDir, current);
  const journal = await journalFacts(options.stateRoot, current, baseSha);
  const suite = await gatherSuite(journal.landed, journal.earlier, {
    repository: current.repository, worktreeRoot: resolve(options.worktreeRoot), project: current.project, baseSha, config,
    outputDir: join(options.attemptDir, "raw"), ...(options.runCommand === undefined ? {} : { runCommand: options.runCommand }),
  });
  const requestDigest = requestTextDigest(current.request);
  const evaluation = evaluatePreflightFields({
    request: current.request, where: options.where, read: options.read,
    suite: {
      baseSha, configuredGateIds: Object.keys(config.gates), gatesConfigDigest: gatesConfigDigest(config.gates),
      suite: suite.suite, unavailable: suite.unavailable,
    },
    writers, shift, protectedPaths: config.policy.protected_paths,
    gitStorage: { entries: await measureGitStorage(current.repository, options.worktreeRoot) },
    duplicate: journal.duplicate,
    priorAttempts: { consulted: options.consulted, journal: journal.priorSessions },
    // The owner's confirmation is a separate act, so this field reports what the
    // attempt's journal holds now; the freshness rule reads confirmations again
    // rather than trusting this result.
    confirmation: {
      project: current.project, taskId: current.taskId, attempt: current.attempt, requestDigest,
      pathsDigest: requestPathsDigest(options.where, options.read), confirmations: await attemptConfirmations(options.attemptDir),
    },
  });
  const at = (options.now ?? ((): string => new Date().toISOString()))();
  const record: DriverPreflightRecord = {
    schema: "awsf.driver-preflight/v1",
    project: current.project, taskId: current.taskId, attempt: current.attempt, sessionId: current.sessionId,
    baseSha, configDigest: preflightConfigDigest(config), requestDigest,
    where: [...options.where], read: [...options.read], consulted: [...options.consulted],
    fields: [...evaluation.fields], suite: suite.suite, protectedPlan: [...evaluation.protectedPlan], at,
  };
  assertDriverPreflightRecord(record);
  const measured = record.fields.filter((field) => field.kind === "measured");
  const passed = measured.filter((field) => field.passed).length;
  const status = await persistAttempt(options.attemptDir, current.revision, {
    kind: "attempt.updated",
    next: nextRevision(current, {
      lastActivityAt: at,
      lastActivity: `driver preflight recorded at ${baseSha}: ${String(passed)} of ${String(measured.length)} measured field(s) passed`,
    }),
    evidence: { type: "driver-preflight", record },
  }, options.projectRecord);
  return { status, record, suite, measuredPassed: passed === measured.length };
}