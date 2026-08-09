import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AwsfConfig, AdapterEntry } from "../../src/config/schema.ts";
import { loadConfig } from "../../src/config/load.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { PlanOutput } from "../../src/contracts/plan-output.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type {
  Availability,
  BrokerProcessRegistration,
  HarnessAdapter,
  ModelInfo,
  ModelRequest,
  ProcessSpec,
  ProcessTransport,
  TransportBroker,
} from "../../src/adapters/interface.ts";
import type { BrokerOptions } from "../../src/execution/transport-broker.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { runProductionCommand, ProductionWorkflowUnsupported } from "../../src/cli/commands/production-run.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { agentsForSession, gatesForSession, getSession, phasesForSession, pollEvents } from "../../src/observability/queries.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function plan(): PlanOutput {
  return {
    schema: "awsf.plan-output/v1", producerStatus: "success", summary: "write the bounded source",
    artifacts: [], notesForNextPhase: "write core/src/generated.ts", goals: ["write one source"],
    nonGoals: ["touch anything else"], implementationSteps: [{ id: "one", title: "write source", files: ["core/src/generated.ts"], acceptanceCriteria: ["configured command passes"] }],
    testStrategy: ["run configured command"], risks: [], openQuestions: [],
  };
}

function build(): BuildOutput {
  return {
    schema: "awsf.build-output/v1", producerStatus: "success", summary: "wrote one source",
    artifacts: [{ path: "core/src/generated.ts", kind: "source", description: "bounded source" }],
    notesForNextPhase: "run host commands", changedFiles: ["core/src/generated.ts"],
    implementationNotes: ["fixture implementation"], commandsRun: [], proposedCommitMessage: "feat: add generated source",
  };
}

type Scenario = "success" | "malformed" | "permission" | "gate";

class ScriptedAdapter implements HarnessAdapter {
  readonly id: string;
  readonly #worktree: string;
  readonly #onReleased: () => void;
  readonly #scenario: Scenario;
  constructor(id: string, worktree: string, onReleased: () => void, scenario: Scenario = "success") { this.id = id; this.#worktree = worktree; this.#onReleased = onReleased; this.#scenario = scenario; }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return { adapter: this.id, provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: model, contextWindow: null, supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none", usageAuthority: "provider", costAuthority: "unavailable" };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return { executable: "node", argv: ["-e", ""], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false };
  }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration, signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.#onReleased();
    const at = "2026-08-11T00:00:00.000Z";
    const model = request.model;
    let payload: PlanOutput | BuildOutput = model.startsWith("claude:") ? plan() : build();
    if (!model.startsWith("claude:")) {
      mkdirSync(join(this.#worktree, "core", "src"), { recursive: true });
      writeFileSync(join(this.#worktree, "core", "src", "generated.ts"), "export const generated = true;\n");
      if (this.#scenario === "permission") writeFileSync(join(this.#worktree, "outside.ts"), "breach\n");
      if (this.#scenario === "gate") payload = { ...build(), changedFiles: ["core/src/invented.ts"] };
    }
    yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel: model };
    yield { kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: model, resolvedModel: `${model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: this.#scenario === "malformed" ? "not-json" : JSON.stringify(payload) };
    yield { kind: "usage", seq: 4, runId: registration.runId, hostAt: at, providerAt: null, usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { kind: "run.completed", seq: 5, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec) {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
        runId: registration.runId, edge: registration.kind === "agent-phase" ? null : registration.edge,
        ...(registration.kind === "agent-phase" ? { phase: { taskSessionId: registration.taskSessionId, workflowId: registration.workflowId, phaseId: registration.phaseId, phaseOrdinal: registration.phaseOrdinal, adapterId: registration.adapterId, role: registration.role } } : {}),
        reservationId: registration.reservationId, command: [spec.executable, ...spec.argv], cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
      await options.register(record);
      const reservation = options.ledger.spendOnGo(registration.reservationId);
      await options.onSpent?.(record, reservation);
      return {
        runId: registration.runId, identity: record.identity,
        stdout: (async function* () {})(), stderr: (async function* () {})(),
        exit: Promise.resolve({ code: 0, signal: null }),
        cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }),
      };
    },
  };
}

function configWithCommand(exitCode = 0): AwsfConfig {
  const text = readFileSync(resolve("awsf.config.yaml"), "utf8").replace(
    "test: { argv: [npm, run, test:unit], timeout_seconds: 600 }",
    `test: { argv: [node, -e, process.exit(${exitCode})], timeout_seconds: 10 }`,
  ).replace("typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "");
  return loadConfig(text);
}

async function fixture(workflow: "build" | "plan-build-test" | "simple-sdlc", commandExit = 0) {
  const root = mkdtempSync(join(tmpdir(), "awsf-production-runner-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", "README.md");
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed production runner");
  const config = configWithCommand(commandExit);
  const projection = createDashboardProjection(stateRoot);
  const created = await newCommand({ stateRoot, project: config.project.slug, taskId: `fixture-${workflow}`, repository: canonical, request: "write one bounded source", workflow, tier: 1, configSnapshotJson: JSON.stringify(config), projectRecord: projection.project });
  await startCommand({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath: resolve("awsf.config.yaml"), preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project });
  return { root, canonical, stateRoot, config, projection, created };
}

for (const [workflow, expectedCalls] of [["build", 1], ["plan-build-test", 2]] as const) {
  test(`production ${workflow} uses ${expectedCalls} configured call(s), exact host gates, and no fallback`, async () => {
    const world = await fixture(workflow);
    let launches = 0;
    let sawRunning = false;
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      const status = await runProductionCommand({
        attemptDir: world.created.attemptDir, config: world.config, configPath: resolve("awsf.config.yaml"),
        projectRecord: world.projection.project, assertAdvancement: world.projection.assertAdvancement,
        assertLaunchProjection: world.projection.assertLaunchPermitted,
        infrastructure: {
          adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {
            launches += 1;
            const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
            try { sawRunning ||= getSession(db, world.created.status.sessionId)?.lifecycle_state === "RUNNING"; }
            finally { db.close(); }
          }),
          createBroker: fakeBroker,
          sandboxProbe: () => false,
        },
      });
      assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
      assert.equal(status.budget.callsSpent, expectedCalls);
      assert.equal(status.budget.callsReserved, 0);
      assert.equal(launches, expectedCalls);
      assert.equal(sawRunning, true, "dashboard projection must see RUNNING before provider completion");
      assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
      assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), status.candidateSha);
      assert.match(git(prepared.worktree!, "show", "-s", "--format=%an <%ae>", "HEAD"), /Santiago Marin <santiagomarinsuarez@me.com>/);
      const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
      try {
        assert.equal(phasesForSession(db, status.sessionId).at(-1)?.status, "SUCCEEDED");
        assert.ok(gatesForSession(db, status.sessionId).every((gate) => gate.passed === 1));
        const agents = agentsForSession(db, status.sessionId);
        assert.equal(agents.length, expectedCalls);
        assert.ok(agents.every((agent) => agent.input_tokens === 10 && agent.output_tokens === 20));
        assert.ok(agents.every((agent) => agent.model_provenance === "route-attributed"));
        assert.equal(getSession(db, status.sessionId)?.input_tokens, expectedCalls * 10);
        assert.equal(getSession(db, status.sessionId)?.output_tokens, expectedCalls * 20);
        assert.ok(pollEvents(db, status.sessionId, 0).some((event) => event.type === "usage"));
      } finally { db.close(); }
      assert.doesNotMatch(readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8"), /substituteAttempted/);
    } finally {
      world.projection.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

class UnavailableAdapter extends ScriptedAdapter {
  override async isAvailable(): Promise<Availability> { return { status: "blocked", code: "E_INVALID_REQUEST", detail: "fixture unavailable" }; }
}

function registrationFailingBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration) {
      options.ledger.releaseOnRegistrationFailure(registration.reservationId);
      throw new Error("fixture registration failure before GO");
    },
  };
}

for (const scenario of ["malformed", "permission", "gate"] as const) {
  test(`${scenario} production evidence blocks on the first turn with no held reservation`, async () => {
    const world = await fixture("build");
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      const status = await runProductionCommand({
        attemptDir: world.created.attemptDir, config: world.config, configPath: resolve("awsf.config.yaml"),
        projectRecord: world.projection.project, assertLaunchProjection: world.projection.assertLaunchPermitted,
        infrastructure: {
          adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {}, scenario),
          createBroker: fakeBroker, sandboxProbe: () => false,
        },
      });
      assert.equal(status.lifecycleState, "BLOCKED");
      assert.equal(status.budget.callsSpent, 1);
      assert.equal(status.budget.callsReserved, 0);
      if (scenario === "malformed") assert.match(status.blocker?.detail ?? "", /EnvelopeValidationFailure/);
      if (scenario === "permission") assert.equal(status.blocker?.code, "permission-breach");
      if (scenario === "gate") assert.match(status.blocker?.detail ?? "", /PhaseGateFailure/);
    } finally {
      world.projection.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

test("unavailable configured adapter blocks before provider launch", async () => {
  const world = await fixture("build");
  let launches = 0;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, config: world.config, configPath: resolve("awsf.config.yaml"),
      projectRecord: world.projection.project,
      infrastructure: { adapterFor: (_entry: AdapterEntry, id: string) => new UnavailableAdapter(id, prepared.worktree!, () => { launches += 1; }) },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(launches, 0);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("registration failure refunds the held call and blocks without provider execution", async () => {
  const world = await fixture("build");
  let providerRan = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, config: world.config, configPath: resolve("awsf.config.yaml"),
      projectRecord: world.projection.project,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => { providerRan = true; }),
        createBroker: registrationFailingBroker, sandboxProbe: () => false,
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(providerRan, false);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("configured command failure retains exact evidence and blocks", async () => {
  const world = await fixture("build", 7);
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, config: world.config, configPath: resolve("awsf.config.yaml"),
      projectRecord: world.projection.project, assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {}),
        createBroker: fakeBroker, sandboxProbe: () => false,
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.match(status.blocker?.detail ?? "", /configured command phase failed/);
    assert.equal(status.budget.callsReserved, 0);
    const journal = readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8");
    assert.match(journal, /process\.exit\(7\)/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("projector degradation holds successful work at GATING rather than killing its provider", async () => {
  const world = await fixture("build");
  let providerCompleted = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, config: world.config, configPath: resolve("awsf.config.yaml"),
      projectRecord: world.projection.project, assertLaunchProjection: world.projection.assertLaunchPermitted,
      assertAdvancement: (_sessionId, to) => { if (to === "AWAITING_OWNER") throw new Error("fixture degraded projection hold"); },
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => { providerCompleted = true; }),
        createBroker: fakeBroker, sandboxProbe: () => false,
      },
    });
    assert.equal(providerCompleted, true);
    assert.equal(status.lifecycleState, "GATING");
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(status.blocker?.code, "sqlite-projection-failed");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("unsupported production workflow fails before lifecycle mutation", async () => {
  const world = await fixture("simple-sdlc");
  try {
    const before = readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8");
    await assert.rejects(runProductionCommand({ attemptDir: world.created.attemptDir, config: world.config, configPath: resolve("awsf.config.yaml") }), ProductionWorkflowUnsupported);
    assert.equal(readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8"), before);
    assert.equal((await readAttempt(world.created.attemptDir)).lifecycleState, "PREPARED");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});
