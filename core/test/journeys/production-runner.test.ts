import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AwsfConfig, AdapterEntry } from "../../src/config/schema.ts";
import { loadConfig } from "../../src/config/load.ts";
import { PiCodexAdapter } from "../../src/adapters/pi-codex.ts";
import { createApiRouter } from "../../src/api/routes.ts";
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
import { ProcessTransportBroker, type BrokerOptions } from "../../src/execution/transport-broker.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { runProductionCommand, ProductionWorkflowUnsupported } from "../../src/cli/commands/production-run.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { agentsForSession, gatesForSession, getSession, phasesForSession, pollEvents, processesForSession } from "../../src/observability/queries.ts";
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

class CapturedPiAdapter extends PiCodexAdapter {
  readonly #fixtureMode: "success" | "parser-failure";
  constructor(fixtureMode: "success" | "parser-failure" = "success") {
    super({ executable: "production-runner-fixture" });
    this.#fixtureMode = fixtureMode;
  }
  override async isAvailable(): Promise<Availability> { return { status: "available" }; }
  override buildSpec(request: ModelRequest): ProcessSpec {
    const spec = super.buildSpec(request);
    return {
      ...spec,
      executable: CAPTURED_PROVIDER,
      argv: [...spec.argv, "--awsf-fixture-mode", this.#fixtureMode],
    };
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

const CAPTURED_PROVIDER = resolve("core/test/fixtures/providers/codex/production-runner-fixture.mjs");
const SYSTEM_PROMPT_SENTINEL = "SYSTEM_PROMPT_CONTENT_MUST_NOT_RIDE_ARGV";

function configTextWithCommand(exitCode = 0): string {
  return readFileSync(resolve("awsf.config.yaml"), "utf8").replace(
    "test: { argv: [npm, run, test:unit], timeout_seconds: 600 }",
    `test: { argv: [node, -e, process.exit(${exitCode})], timeout_seconds: 10 }`,
  ).replace("typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "");
}

async function fixture(workflow: "build" | "plan-build-test" | "simple-sdlc", commandExit = 0) {
  const root = mkdtempSync(join(tmpdir(), "awsf-production-runner-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", "README.md");
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed production runner");
  const configText = configTextWithCommand(commandExit);
  const config = loadConfig(configText);
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText);
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      const destination = join(root, promptPath);
      mkdirSync(resolve(destination, ".."), { recursive: true });
      const marker = promptPath === "prompts/builder/system.md" ? `\n${SYSTEM_PROMPT_SENTINEL}\n` : "";
      writeFileSync(destination, `${readFileSync(resolve(promptPath), "utf8")}${marker}`);
    }
  }
  const projection = createDashboardProjection(stateRoot);
  const created = await newCommand({ stateRoot, project: config.project.slug, taskId: `fixture-${workflow}`, repository: canonical, request: "write one bounded source", workflow, tier: 1, configSnapshotJson: JSON.stringify(config), projectRecord: projection.project });
  await startCommand({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath, preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project });
  return { root, canonical, stateRoot, config, configPath, projection, created };
}

for (const [workflow, expectedCalls] of [["build", 1], ["plan-build-test", 2]] as const) {
  test(`production ${workflow} uses ${expectedCalls} configured call(s), exact host gates, and no fallback`, async () => {
    const world = await fixture(workflow);
    let launches = 0;
    let sawRunning = false;
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      const status = await runProductionCommand({
        attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath,
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

test("process-backed production build crosses the real barrier, parser, audit, and API privacy boundaries", async () => {
  const world = await fixture("build");
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      assertLaunchProjection: world.projection.assertLaunchPermitted,
      assertAdvancement: world.projection.assertAdvancement,
      infrastructure: {
        adapterFor: () => new CapturedPiAdapter(),
        createBroker: (options) => new ProcessTransportBroker(options),
        sandboxProbe: () => false,
      },
    });
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, 1);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
    assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), status.candidateSha);

    const systemPromptPath = join(world.created.attemptDir, "private", "builder", "system-prompt.md");
    const probe = JSON.parse(readFileSync(join(world.created.attemptDir, "private", "builder", "provider-probe.json"), "utf8")) as {
      argv: string[];
      promptContentInArgv: boolean;
      systemPromptContentInArgv: boolean;
      registeredBeforeProviderStart: boolean;
      spentBeforeProviderStart: boolean;
      journalSourceSeqsAtProviderStart: number[];
    };
    assert.equal(probe.registeredBeforeProviderStart, true, "the provider observed durable registration before it began");
    assert.equal(probe.spentBeforeProviderStart, true, "the provider observed durable spend before GO");
    assert.equal(probe.promptContentInArgv, false);
    assert.equal(probe.systemPromptContentInArgv, false);
    assert.equal(probe.argv.includes(SYSTEM_PROMPT_SENTINEL), false);
    assert.deepEqual(probe.journalSourceSeqsAtProviderStart, probe.journalSourceSeqsAtProviderStart.map((_value, index) => index + 1));

    const journal: string = readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8");
    const records: { source_seq: number }[] = journal.split("\n").filter(Boolean).map((line: string) => JSON.parse(line) as { source_seq: number });
    assert.deepEqual(records.map((record: { source_seq: number }) => record.source_seq), records.map((_record: { source_seq: number }, index: number) => index + 1), "register, spend, and events must serialize without a status revision race");

    const dbPath = join(world.stateRoot, "awsf.db");
    const db = openDatabase(dbPath, { readonly: true });
    try {
      const audit = db.prepare("SELECT command_json, cwd_display FROM processes WHERE session_id = ?").get(status.sessionId) as { command_json: string; cwd_display: string };
      const exactCommand = JSON.parse(audit.command_json) as string[];
      assert.equal(exactCommand.includes(systemPromptPath), true, "machine-local audit retains exact system-prompt path evidence");
      assert.equal(exactCommand.includes(SYSTEM_PROMPT_SENTINEL), false, "system-prompt content never rides argv");
      assert.equal(audit.cwd_display, prepared.worktree);
      const publicProcesses = processesForSession(db, status.sessionId);
      assert.equal(JSON.stringify(publicProcesses).includes(systemPromptPath), false);
      assert.equal(JSON.stringify(publicProcesses).includes(prepared.worktree!), false);
      assert.equal(publicProcesses[0]?.status, "EXITED");
      const usageEvents = pollEvents(db, status.sessionId, 0).filter((event) => event.type === "usage");
      assert.equal(usageEvents.length, 1);
      assert.equal(agentsForSession(db, status.sessionId)[0]?.input_tokens, 7);
      assert.equal(agentsForSession(db, status.sessionId)[0]?.output_tokens, 11);
      assert.equal(getSession(db, status.sessionId)?.input_tokens, 7, "one provider usage report is counted once");
      assert.equal(getSession(db, status.sessionId)?.output_tokens, 11, "one provider usage report is counted once");
      assert.ok(gatesForSession(db, status.sessionId).every((gate) => gate.passed === 1));
      const envelopeRefs = db.prepare("SELECT file_path FROM envelopes WHERE session_id = ?").all(status.sessionId) as unknown as { file_path: string }[];
      assert.ok(envelopeRefs.every((row) => !isAbsolute(row.file_path) && !row.file_path.includes(world.created.attemptDir)));
      const outputRefs = db.prepare("SELECT output_path FROM gate_results WHERE session_id = ? AND output_path IS NOT NULL").all(status.sessionId) as unknown as { output_path: string }[];
      assert.ok(outputRefs.every((row) => !isAbsolute(row.output_path) && !row.output_path.includes(world.created.attemptDir)));
    } finally {
      db.close();
    }

    const router = createApiRouter({ dbPath, config: world.config });
    try {
      const response = await router.dispatch({ method: "GET", url: `/api/v1/sessions/${status.sessionId}`, headers: { host: "127.0.0.1:4600" } });
      assert.equal(response.status, 200);
      const publicJson = JSON.stringify(response.body);
      for (const privatePath of [world.root, world.created.attemptDir, prepared.worktree!, systemPromptPath, CAPTURED_PROVIDER]) {
        assert.equal(publicJson.includes(privatePath), false, `API leaked private path ${privatePath}`);
      }
      assert.equal(publicJson.includes("command_json"), false);
      assert.equal(publicJson.includes("cwd_display"), false);
    } finally {
      router.close();
    }

    const processList = execFileSync("ps", ["-eo", "args="], { encoding: "utf8" });
    assert.equal(processList.includes(systemPromptPath), false, "the provider process must leave no residue");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("process-backed parser failure bills the spent call but leaves no held reservation", async () => {
  const world = await fixture("build");
  try {
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: () => new CapturedPiAdapter("parser-failure"),
        createBroker: (options) => new ProcessTransportBroker(options),
        sandboxProbe: () => false,
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 1);
    assert.equal(status.budget.callsReserved, 0);
    const probe = JSON.parse(readFileSync(join(world.created.attemptDir, "private", "builder", "provider-probe.json"), "utf8")) as { registeredBeforeProviderStart: boolean; spentBeforeProviderStart: boolean };
    assert.equal(probe.registeredBeforeProviderStart, true);
    assert.equal(probe.spentBeforeProviderStart, true);
    const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
    try { assert.equal(processesForSession(db, status.sessionId)[0]?.status, "FAILED"); }
    finally { db.close(); }
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

class UnavailableAdapter extends ScriptedAdapter {
  override async isAvailable(): Promise<Availability> { return { status: "blocked", code: "E_INVALID_REQUEST", detail: "fixture unavailable" }; }
}

class SameSessionAdapter extends ScriptedAdapter {
  override async getModelInfo(model: string): Promise<ModelInfo> {
    return { ...(await super.getModelInfo(model)), continuity: "same-session-correction" };
  }
}

function withBuilderContinuity(config: AwsfConfig, continuity: "same-session" | "none"): AwsfConfig {
  return {
    ...config,
    agents: config.agents.map((agent) => agent.name === "builder"
      ? { ...agent, harness: { ...agent.harness, continuity } }
      : agent),
  };
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
        attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath,
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
      attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath,
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

test("configured continuity mismatch fails closed before broker creation or provider launch", async () => {
  const world = await fixture("build");
  let brokerCreated = false;
  const mismatchConfig = withBuilderContinuity(world.config, "same-session");
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir,
      config: mismatchConfig,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => assert.fail("provider launched")),
        createBroker: (options) => { brokerCreated = true; return new ProcessTransportBroker(options); },
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(brokerCreated, false);
    assert.match(status.blocker?.detail ?? "", /ProductionContinuityMismatch/);
    assert.match(status.blocker?.detail ?? "", /same-session.*none/);
    const journal = readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8");
    assert.equal(journal.includes('"type":"process"'), false);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("adapter continuity above configured none is also a pre-launch mismatch", async () => {
  const world = await fixture("build");
  let brokerCreated = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new SameSessionAdapter(id, prepared.worktree!, () => assert.fail("provider launched")),
        createBroker: (options) => { brokerCreated = true; return new ProcessTransportBroker(options); },
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(brokerCreated, false);
    assert.match(status.blocker?.detail ?? "", /ProductionContinuityMismatch/);
    assert.match(status.blocker?.detail ?? "", /none.*same-session-correction/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("matching same-session declarations remain blocked until a real correction transport exists", async () => {
  const world = await fixture("build");
  let brokerCreated = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir,
      config: withBuilderContinuity(world.config, "same-session"),
      configPath: world.configPath,
      projectRecord: world.projection.project,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new SameSessionAdapter(id, prepared.worktree!, () => assert.fail("provider launched")),
        createBroker: (options) => { brokerCreated = true; return new ProcessTransportBroker(options); },
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(brokerCreated, false);
    assert.match(status.blocker?.detail ?? "", /no verified same-session correction transport/);
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
      attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath,
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
      attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath,
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
      attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath,
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
    await assert.rejects(runProductionCommand({ attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath }), ProductionWorkflowUnsupported);
    assert.equal(readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8"), before);
    assert.equal((await readAttempt(world.created.attemptDir)).lifecycleState, "PREPARED");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});
