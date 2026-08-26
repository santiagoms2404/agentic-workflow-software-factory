// Four completed stages, four quiet boundaries. Each case drives the real host
// command or workflow in a temporary directory, then observes that no session,
// attempt, or provider launch for the next stage appears without an owner act.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";

import { StubAdapter } from "../../../src/adapters/stub.ts";
import type {
  BrokerProcessRegistration,
  ModelRequest,
  ProcessTransport,
  TransportBroker,
} from "../../../src/adapters/interface.ts";
import { isTaskEdgeRegistration, reservationIdOf } from "../../../src/adapters/interface.ts";
import { initCommand } from "../../../src/cli/commands/init.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { registerProject } from "../../../src/cli/commands/project.ts";
import { runProductionCommand } from "../../../src/cli/commands/production-run.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import { readAttempt } from "../../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import type { ArchitectureReviewOutput } from "../../../src/contracts/architecture-review-output.ts";
import type { BuildOutput } from "../../../src/contracts/build-output.ts";
import type { DesignOutput } from "../../../src/contracts/design-output.ts";
import type { DesignPlanOutput } from "../../../src/contracts/design-plan-output.ts";
import type { EnvelopeBase } from "../../../src/contracts/envelope-base.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import type { PlanOutput } from "../../../src/contracts/plan-output.ts";
import type { BrokerOptions } from "../../../src/execution/transport-broker.ts";
import { listSessions } from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { writePlacement } from "../../../src/registry/placement.ts";
import { LEGAL_EDGES, TERMINAL_STATES, type TaskState } from "../../../src/state/task-machine.ts";
import { STAGES, type StageId } from "../../../src/stages/contract.ts";

const STUB_PROVIDER = resolve("core/test/fixtures/providers/stub/stub-provider.mjs");
const REQUEST = "Make design claims traceable into rendered tickets.";
const PLAN_STEM = "generated-plan";

interface Boundary {
  readonly earlierStage: StageId;
  readonly laterStage: StageId;
  readonly mechanism: "terminal-seal" | "awaiting-owner" | "no-path";
  readonly ownerAct: string;
  readonly confirmation: Record<string, unknown>;
}

const BOUNDARIES = (JSON.parse(readFileSync(
  resolve("core/test/fixtures/stages/boundaries.json"),
  "utf8",
)) as { boundaries: Boundary[] }).boundaries;

/** Records every provider actually contacted, so a quiet route is observed. */
class RouteLog {
  readonly providers: string[] = [];
  readonly launches: string[] = [];
}

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function design(): DesignOutput {
  return {
    schema: "awsf.design-output/v1",
    producerStatus: "success",
    summary: "Designed a traceable plan spine.",
    artifacts: [],
    notesForNextPhase: "Review every declared design claim.",
    answeredRequest: REQUEST,
    components: [{ name: "plan renderer", responsibility: "Render one synchronized plan and ticket set." }],
    decisions: [{ id: "D-1", statement: "Render plan documents from one validated envelope." }],
    invariants: [{ id: "INV-1", statement: "Every rendered ticket mirrors its plan task." }],
    acceptanceCriteria: [{
      id: "AC-1",
      statement: "The rendered plan and ticket set pass the ticket-plan-sync fence.",
      verifiedBy: "Run the ticket-plan-sync assertions.",
    }],
    openQuestions: [],
  };
}

function architectureReview(): ArchitectureReviewOutput {
  return {
    schema: "awsf.architecture-review-output/v1",
    producerStatus: "success",
    summary: "Reviewed the traceable plan spine.",
    artifacts: [],
    notesForNextPhase: "Carry the reviewed spine into planning.",
    reviewedDesign: design().summary,
    verdict: "accept",
    findings: [{
      id: "F1",
      severity: "medium",
      subject: "AC-1",
      title: "Keep coverage explicit",
      detail: "The rendered set must retain an explicit coverage assertion.",
      evidence: "ticket-plan-sync includes coverage and mirror checks",
    }],
    limitations: ["Scripted stub-route review."],
  };
}

function designPlan(): DesignPlanOutput {
  return {
    schema: "awsf.design-plan-output/v1",
    producerStatus: "success",
    summary: "Plan the synchronized rendered set.",
    artifacts: [],
    notesForNextPhase: "Render the plan, prompt, and ticket from this envelope.",
    milestones: [{ id: "M1", title: "Synchronized output" }],
    steps: [{
      id: "T01",
      title: "Render the synchronized plan set",
      milestone: "M1",
      files: ["specs/generated-plan.html", "specs/tickets/generated-plan/T01.md"],
      serves: ["INV-1", "AC-1"],
      dependsOn: [],
      buildPrompt: "Render the plan and verify its ticket-plan synchronization.",
    }],
    testStrategy: ["Run the ticket-plan-sync assertions against the rendered set."],
    risks: [{ risk: "A renderer copy can drift.", mitigation: "Render every copy from the same envelope." }],
    openQuestions: [],
  };
}

function buildPlan(): PlanOutput {
  return {
    schema: "awsf.plan-output/v1",
    producerStatus: "success",
    summary: "Write one bounded source.",
    artifacts: [],
    notesForNextPhase: "Write core/src/generated.ts.",
    goals: ["Write one source."],
    nonGoals: ["Touch anything else."],
    implementationSteps: [{
      id: "one",
      title: "Write the source file",
      files: ["core/src/generated.ts"],
      acceptanceCriteria: ["The host gate passes."],
    }],
    testStrategy: ["Run the configured host gate."],
    risks: [],
    openQuestions: [],
  };
}

function buildOutput(): BuildOutput {
  return {
    schema: "awsf.build-output/v1",
    producerStatus: "success",
    summary: "Wrote one bounded source.",
    artifacts: [{ path: "core/src/generated.ts", kind: "source", description: "Bounded source." }],
    notesForNextPhase: "Run host gates.",
    changedFiles: ["core/src/generated.ts"],
    implementationNotes: ["Scripted fixture implementation."],
    commandsRun: [],
    proposedCommitMessage: "feat: add generated source",
  };
}

class CannedStubAdapter extends StubAdapter {
  readonly #responses: EnvelopeBase[];
  readonly #worktree: string;
  readonly #log: RouteLog;

  constructor(worktree: string, responses: readonly EnvelopeBase[], log: RouteLog, sideEffectPath: string) {
    super({ providerPath: STUB_PROVIDER, sideEffectPath });
    this.#responses = [...responses];
    this.#worktree = worktree;
    this.#log = log;
  }

  get responsesRemaining(): number {
    return this.#responses.length;
  }

  override async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    this.#log.providers.push("stub");
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.#log.launches.push("stub");
    const response = this.#responses.shift();
    if (response === undefined) throw new Error("the route requested an unplanned fixture call");
    if (response.schema === "awsf.build-output/v1") {
      mkdirSync(join(this.#worktree, "core", "src"), { recursive: true });
      writeFileSync(join(this.#worktree, "core", "src", "generated.ts"), "export const generated = true;\n");
    }
    const at = "2026-08-24T00:00:00.000Z";
    yield {
      kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null,
      adapter: this.id, requestedModel: request.model,
    };
    yield {
      kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null,
      adapter: this.id, provider: "stub", requestedModel: request.model,
      resolvedModel: "stub-model-1", provenance: "stream-authoritative",
    };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: JSON.stringify(response) };
    yield { kind: "run.completed", seq: 4, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec): Promise<ProcessTransport> {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" as const },
        runId: registration.runId,
        edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
        ...(registration.kind === "agent-phase" ? {
          phase: {
            taskSessionId: registration.taskSessionId,
            workflowId: registration.workflowId,
            phaseId: registration.phaseId,
            phaseOrdinal: registration.phaseOrdinal,
            adapterId: registration.adapterId,
            role: registration.role,
          },
        } : {}),
        reservationId: reservationIdOf(registration),
        command: [spec.executable, ...spec.argv],
        cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
      await options.register(record);
      const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
      await options.onSpent?.(record, reservation);
      return {
        runId: registration.runId,
        identity: record.identity,
        stdout: (async function* () {})(),
        stderr: (async function* () {})(),
        exit: Promise.resolve({ code: 0, signal: null }),
        cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }),
      };
    },
  };
}

function fixtureConfig(): AwsfConfig {
  const loaded = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  return {
    ...loaded,
    runtime: { ...loaded.runtime, seed_paths: [] },
    agents: loaded.agents.map((agent) => ({
      ...agent,
      model: "stub/success",
      thinking: "none" as const,
      harness: { adapter: "stub", continuity: "none" as const },
    })),
    gates: {},
  };
}

interface TestWorld {
  readonly root: string;
  readonly canonical: string;
  readonly stateRoot: string;
  readonly projection: ReturnType<typeof createDashboardProjection>;
  readonly log: RouteLog;
}

interface WorkflowWorld extends TestWorld {
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly attemptDir: string;
  readonly sessionId: string;
  readonly worktree: string;
}

function testWorld(prefix: string): TestWorld {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const stateRoot = join(root, "state");
  mkdirSync(stateRoot, { recursive: true });
  const emptyProjection = openDatabase(join(stateRoot, "awsf.db"));
  emptyProjection.close();
  return {
    root,
    canonical: join(root, "canonical"),
    stateRoot,
    projection: createDashboardProjection(stateRoot),
    log: new RouteLog(),
  };
}

async function workflowWorld(
  workflow: "design-to-plan" | "plan-build-test",
): Promise<WorkflowWorld> {
  const world = testWorld(`awsf-stage-stop-${workflow}-`);
  mkdirSync(world.canonical, { recursive: true });
  execFileSync("git", ["init", "-b", "main", world.canonical], { stdio: "ignore" });
  writeFileSync(join(world.canonical, "README.md"), "fixture stage repository\n");
  writeFileSync(join(world.canonical, "awsf.project.yaml"), [
    "version: awsf.project/v1",
    "",
    "project:",
    "  slug: agentic-workflow-software-factory",
    "",
    "repositories:",
    "  fixture:",
    "    role: plan",
    "    default_branch: main",
    "    gates: {}",
    "",
    "plans:",
    "  root: specs",
    "  format: awsf-plan-html/v1",
    `  default: ${PLAN_STEM}`,
    "",
  ].join("\n"));
  git(world.canonical, "add", "README.md", "awsf.project.yaml");
  git(
    world.canonical,
    "-c", "user.name=Santiago Marin",
    "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-m", "test: seed stage stop",
  );

  const config = fixtureConfig();
  const configPath = join(world.root, "awsf.config.yaml");
  writeFileSync(configPath, stringify(config));
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      const destination = join(world.root, promptPath);
      mkdirSync(resolve(destination, ".."), { recursive: true });
      writeFileSync(destination, readFileSync(resolve(promptPath), "utf8"));
    }
  }
  const sharedPrompt = join(world.root, "prompts", "shared", "headless-role.md");
  mkdirSync(resolve(sharedPrompt, ".."), { recursive: true });
  writeFileSync(sharedPrompt, readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));
  await writePlacement(world.stateRoot, config.project.slug, {
    version: "awsf.placement/v1",
    project: config.project.slug,
    repositories: { fixture: { path: world.canonical } },
    worktree_root: join(world.root, "worktrees"),
  });
  const created = await newCommand({
    stateRoot: world.stateRoot,
    project: config.project.slug,
    taskId: workflow === "design-to-plan" ? PLAN_STEM : "generated-build",
    repository: world.canonical,
    request: REQUEST,
    workflow,
    tier: 1,
    configSnapshotJson: toConfigSnapshotJson(config),
    projectRecord: world.projection.project,
  });
  const prepared = await startCommand({
    attemptDir: created.attemptDir,
    worktreeRoot: join(world.root, "worktrees"),
    configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }),
    projectRecord: world.projection.project,
  });
  assert.notEqual(prepared.worktree, null);
  return {
    ...world,
    config,
    configPath,
    attemptDir: created.attemptDir,
    sessionId: created.status.sessionId,
    worktree: prepared.worktree!,
  };
}

async function completeWorkflow(
  world: WorkflowWorld,
  responses: readonly EnvelopeBase[],
): Promise<TaskState> {
  const prepared = await readAttempt(world.attemptDir);
  const adapter = new CannedStubAdapter(
    world.worktree,
    responses,
    world.log,
    join(world.root, "provider-process-ran.json"),
  );
  const status = await runProductionCommand({
    attemptDir: world.attemptDir,
    stateRoot: world.stateRoot,
    config: world.config,
    configPath: world.configPath,
    projectRecord: world.projection.project,
    assertAdvancement: world.projection.assertAdvancement,
    assertLaunchProjection: world.projection.assertLaunchPermitted,
    infrastructure: {
      adapterFor: () => adapter,
      createBroker: fakeBroker,
      resolveExecutable: () => { throw new Error("quota probe unavailable in this offline unit test"); },
      sandboxProbe: () => false,
    },
  });
  assert.equal(adapter.responsesRemaining, 0);
  assert.equal(existsSync(join(world.root, "provider-process-ran.json")), false);
  assert.equal(prepared.worktree, world.worktree);
  return status.lifecycleState;
}

function boundary(earlierStage: StageId): Boundary {
  assert.equal(BOUNDARIES.length, 4, "boundaries.json must hold exactly four rows");
  const row = BOUNDARIES.find((candidate) => candidate.earlierStage === earlierStage);
  assert.notEqual(row, undefined, `missing boundary after ${earlierStage}`);
  const stageIndex = STAGES.findIndex((stage) => stage.id === earlierStage);
  assert.equal(row!.laterStage, STAGES[stageIndex + 1]?.id, "boundary must join adjacent captured stages");
  return row!;
}

function isTerminal(state: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

function assertMechanism(row: Boundary, observedState: TaskState | null): void {
  const stage = STAGES.find((candidate) => candidate.id === row.earlierStage);
  assert.notEqual(stage, undefined);

  if (row.mechanism === "no-path") {
    assert.equal(observedState, null, `${row.earlierStage} cannot claim no-path after creating a task state`);
    assert.equal(row.confirmation.hostCommandThatReturns, stage!.producer);
    assert.equal(row.confirmation.observedTaskState, null);
    return;
  }

  assert.notEqual(observedState, null, `${row.mechanism} requires an observed task state`);
  if (row.mechanism === "terminal-seal") {
    assert.equal(isTerminal(observedState!), true, `${observedState} is not terminal`);
    assert.equal(
      LEGAL_EDGES.some((edge) => edge.from === observedState && edge.spawnSite),
      false,
      `${observedState} has a spawning edge`,
    );
    return;
  }

  assert.equal(observedState, "AWAITING_OWNER", "an awaiting-owner row must end in AWAITING_OWNER");
  assert.equal(row.confirmation.observedEndState, observedState);
  const stoppingEdge = LEGAL_EDGES.find((edge) => edge.id === row.confirmation.stoppingEdge);
  assert.equal(stoppingEdge?.to, "AWAITING_OWNER");
  assert.equal(stoppingEdge?.spawnSite, false);
  const outgoing = LEGAL_EDGES.filter((edge) => edge.from === "AWAITING_OWNER");
  const hostEdges = outgoing.filter((edge) => edge.actors.includes("host"));
  assert.ok(hostEdges.every((edge) => !edge.spawnSite && isTerminal(edge.to)), "a host edge may only seal the attempt");
  const advancing = outgoing.filter((edge) => edge.spawnSite || edge.to === "LANDING");
  assert.ok(
    advancing.every((edge) => edge.actors.every((actor) => actor === "human" || actor === "owner")),
    "every advancing edge requires a human or owner",
  );
}

function attemptDirectories(stateRoot: string): string[] {
  const projectsRoot = join(stateRoot, "projects");
  if (!existsSync(projectsRoot)) return [];
  const found: string[] = [];
  for (const project of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const tasksRoot = join(projectsRoot, project.name, "tasks");
    if (!existsSync(tasksRoot)) continue;
    for (const task of readdirSync(tasksRoot, { withFileTypes: true })) {
      if (!task.isDirectory()) continue;
      const taskRoot = join(tasksRoot, task.name);
      for (const attempt of readdirSync(taskRoot, { withFileTypes: true })) {
        if (attempt.isDirectory() && /^[1-9][0-9]*$/u.test(attempt.name)) {
          found.push(relative(stateRoot, join(taskRoot, attempt.name)));
        }
      }
    }
  }
  return found.sort();
}

interface AllowedStageArtifacts {
  readonly sessions: readonly string[];
  readonly attempts: readonly string[];
  readonly launches: readonly string[];
}

function assertAbsenceTriple(world: TestWorld, allowed: AllowedStageArtifacts): void {
  const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
  try {
    assert.deepEqual(
      listSessions(db).map((session) => session.session_id).sort(),
      [...allowed.sessions].sort(),
      "no session beyond the ones the earlier stage created",
    );
  } finally {
    db.close();
  }
  assert.deepEqual(attemptDirectories(world.stateRoot), [...allowed.attempts].sort(), "no next-stage attempt directory");
  assert.deepEqual(world.log.launches, allowed.launches, "the route log recorded no provider launch after stage completion");
}

function closeWorld(world: TestWorld): void {
  world.projection.close();
  rmSync(world.root, { recursive: true, force: true });
}

test("init returns at the no-path boundary without starting project registration", async () => {
  const world = testWorld("awsf-stage-stop-init-");
  try {
    await initCommand({ path: world.canonical, slug: "ladder-stops" });
    const row = boundary("init");
    assertMechanism(row, null);
    assertAbsenceTriple(world, { sessions: [], attempts: [], launches: [] });
  } finally {
    closeWorld(world);
  }
});

test("project register returns at the no-path boundary without starting design-to-plan", async () => {
  const world = testWorld("awsf-stage-stop-project-");
  try {
    await initCommand({ path: world.canonical, slug: "ladder-stops" });
    const catalogPath = join(world.canonical, "awsf.project.yaml");
    writeFileSync(catalogPath, [
      "version: awsf.project/v1",
      "",
      "project:",
      "  slug: ladder-stops",
      "",
      "repositories:",
      "  canonical:",
      "    role: plan",
      "    default_branch: master",
      "    gates: {}",
      "",
      "plans:",
      "  root: specs",
      "  format: awsf-plan-html/v1",
      "  default: generated-plan",
      "",
    ].join("\n"));
    git(world.canonical, "add", "awsf.project.yaml");
    git(
      world.canonical,
      "-c", "user.name=Santiago Marin",
      "-c", "user.email=santiagomarinsuarez@me.com",
      "commit", "-m", "test: add fixture catalog",
    );
    await registerProject({
      stateRoot: world.stateRoot,
      catalogPath,
      repositories: [`canonical=${world.canonical}`],
    });
    const row = boundary("project-register");
    assertMechanism(row, null);
    assertAbsenceTriple(world, { sessions: [], attempts: [], launches: [] });
  } finally {
    closeWorld(world);
  }
});

test("design-to-plan stays at AWAITING_OWNER without starting build", async () => {
  const world = await workflowWorld("design-to-plan");
  try {
    const state = await completeWorkflow(world, [design(), architectureReview(), designPlan()]);
    const row = boundary("design-to-plan");
    assertMechanism(row, state);
    const allowed = {
      sessions: [world.sessionId],
      attempts: [relative(world.stateRoot, world.attemptDir)],
      launches: ["stub", "stub", "stub"],
    } as const;
    assertAbsenceTriple(world, allowed);

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
    assertAbsenceTriple(world, allowed);
  } finally {
    closeWorld(world);
  }
});

test("build stays at AWAITING_OWNER without starting publish", async () => {
  const world = await workflowWorld("plan-build-test");
  try {
    const state = await completeWorkflow(world, [buildPlan(), buildOutput()]);
    const row = boundary("build");
    assertMechanism(row, state);
    assertAbsenceTriple(world, {
      sessions: [world.sessionId],
      attempts: [relative(world.stateRoot, world.attemptDir)],
      launches: ["stub", "stub"],
    });
  } finally {
    closeWorld(world);
  }
});
