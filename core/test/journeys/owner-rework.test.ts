import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  Availability,
  BrokerProcessRegistration,
  HarnessAdapter,
  ModelInfo,
  ModelRequest,
  ProcessSpec,
  TransportBroker,
} from "../../src/adapters/interface.ts";
import { PiCodexAdapter } from "../../src/adapters/pi-codex.ts";
import { publicApiValue } from "../../src/api/responses.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { StoredEnvelope } from "../../src/contracts/stored-envelope.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../src/cli/commands/attempt.ts";
import { main } from "../../src/cli/main.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import {
  reworkCommand,
  OwnerReworkCredentialRejected,
  OwnerReworkDefectRequired,
  type ReworkInfrastructure,
} from "../../src/cli/commands/rework.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { loadConfig } from "../../src/config/load.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import { ProcessTransportBroker, type BrokerOptions } from "../../src/execution/transport-broker.ts";
import { InteractiveOwnerRequired, CallCeilingExceeded, CorrectionAllowanceExhausted } from "../../src/state/errors.ts";
import { agentsForSession, gatesForSession, getSession, processesForSession, transitionsForSession } from "../../src/observability/queries.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import type { AttemptEvidence } from "../../src/observability/attempt-evidence.ts";
import type { AwsfConfig } from "../../src/config/schema.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";

const PROVIDER = resolve("core/test/fixtures/providers/codex/production-runner-fixture.mjs");
const DEFECT = "remove the duplicate whitespace before const in core/src/generated.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function terminal(answer: boolean, interactive = true, lines: string[] = []): OwnerTerminal {
  return { interactive, write: (line) => { lines.push(line); }, confirm: async () => answer };
}

function filesUnder(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function configText(commandExit = 0): string {
  return readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", `test: { argv: [node, -e, process.exit(${commandExit})], timeout_seconds: 10 }`)
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "");
}

interface World {
  root: string;
  stateRoot: string;
  canonical: string;
  attemptDir: string;
  config: AwsfConfig;
  configPath: string;
  projection: ReturnType<typeof createDashboardProjection>;
  candidateA: string;
  status: AttemptStatus;
}

async function world(options: { commandExit?: number; workflow?: "build" | "plan-build-test"; request?: string } = {}): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "awsf-owner-rework-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", "README.md");
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed owner rework");
  const text = configText(options.commandExit ?? 0);
  const config = loadConfig(text);
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, text);
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      const target = join(root, promptPath);
      mkdirSync(resolve(target, ".."), { recursive: true });
      writeFileSync(target, readFileSync(resolve(promptPath), "utf8"));
    }
  }
  const projection = createDashboardProjection(stateRoot);
  const created = await newCommand({
    stateRoot, project: config.project.slug, taskId: `rework-${options.workflow ?? "build"}`,
    repository: canonical, request: options.request ?? "write the bounded generated source", workflow: options.workflow ?? "build", tier: 1,
    configSnapshotJson: toConfigSnapshotJson(config), allowance: config.risk.correction_allowance,
    projectRecord: projection.project,
  });
  const prepared = await startCommand({
    attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project,
  });
  mkdirSync(join(prepared.worktree!, "core", "src"), { recursive: true });
  writeFileSync(join(prepared.worktree!, "core", "src", "generated.ts"), "export  const generated = true;\n");
  git(prepared.worktree!, "add", "core/src/generated.ts");
  git(prepared.worktree!, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "feat: add generated source");
  const candidateA = git(prepared.worktree!, "rev-parse", "HEAD");
  const builderPhaseId = `${prepared.sessionId}:builder`;
  const seededPhase = nextRevision(prepared, {});
  const withPhase = await persistAttempt(created.attemptDir, prepared.revision, {
    kind: "attempt.updated", next: seededPhase,
    evidence: {
      type: "phase",
      phase: {
        phaseId: builderPhaseId, ordinal: 2, key: "builder", name: "builder", kind: "agent", owner: "builder",
        description: "Produce the retained candidate A for owner inspection", status: "SUCCEEDED",
        correctionCount: 0, maxCorrections: 1, errorCode: null, errorMessage: null,
        startedAt: "2026-08-12T00:00:00.000Z", endedAt: "2026-08-12T00:00:00.000Z", createdAt: "2026-08-12T00:00:00.000Z",
      },
    },
  }, projection.project);
  const buildEnvelope: StoredEnvelope<BuildOutput> = {
    schemaId: "awsf.build-output/v1", envelopeId: `${prepared.sessionId}:builder:0`, sessionId: prepared.sessionId,
    phaseId: builderPhaseId, correctionRound: 0, agent: "builder", valid: true, violations: [],
    payload: {
      schema: "awsf.build-output/v1", producerStatus: "success", summary: "wrote the bounded source with a duplicate whitespace defect",
      artifacts: [{ path: "core/src/generated.ts", kind: "source", description: "bounded source" }],
      notesForNextPhase: "owner inspection", changedFiles: ["core/src/generated.ts"], implementationNotes: ["initial candidate"],
      commandsRun: [], proposedCommitMessage: "feat: add generated source",
    },
    rawOutputPath: "raw/builder.txt", createdAt: "2026-08-12T00:00:00.000Z",
  };
  let awaiting = nextRevision(withPhase, {
    lifecycleState: "AWAITING_OWNER", candidateSha: candidateA,
    budget: { ...prepared.budget, callsSpent: 1 }, gatesPass: true, requiredReviewPresent: false,
    journeyApproved: true, protectedApprovalsValid: true, phase: null,
    lastActivity: "candidate A passed its original gates", nextAction: `run \`awsf rework ${prepared.taskId} "<concrete defect>"\``,
  });
  awaiting = await persistAttempt(created.attemptDir, withPhase.revision, {
    kind: "attempt.updated", next: awaiting,
    evidence: { type: "envelope", phaseId: builderPhaseId, envelope: buildEnvelope },
  }, projection.project);
  const oldGate: AttemptEvidence = {
    type: "gate", id: `${prepared.sessionId}:builder:old-gate`, phaseId: builderPhaseId, round: 0,
    gateId: "candidate_hygiene", kind: "git", candidateSha: candidateA, passed: true, exitCode: 0,
    checks: [{ item: "candidate A", ok: true, note: "original evidence remains immutable" }], violations: [],
    outputPath: null, startedAt: "2026-08-12T00:00:00.000Z", endedAt: "2026-08-12T00:00:00.000Z",
  };
  const withGate = nextRevision(awaiting, {});
  const status = await persistAttempt(created.attemptDir, awaiting.revision, { kind: "attempt.updated", next: withGate, evidence: oldGate }, projection.project);
  return { root, stateRoot, canonical, attemptDir: created.attemptDir, config, configPath, projection, candidateA, status };
}

async function update(world: World, patch: Partial<AttemptStatus>): Promise<void> {
  const current = await readAttempt(world.attemptDir);
  world.status = await persistAttempt(world.attemptDir, current.revision, { kind: "attempt.updated", next: nextRevision(current, patch) }, world.projection.project);
}

class AvailableAdapter implements HarnessAdapter {
  readonly id = "pi-codex";
  launches = 0;
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return { adapter: this.id, provider: "openai-codex", requestedModel: model.replace(/^codex:/, ""), contextWindow: null, supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none", usageAuthority: "provider", costAuthority: "unavailable" };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return {
      executable: "node",
      argv: ["-e", "", "--append-system-prompt", request.systemPromptPath!],
      cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false,
    };
  }
  async *parse(): AsyncIterable<never> { yield* []; }
  async *execute(
    _request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(_request), signal);
    this.launches += 1;
    yield* [];
  }
}

class CapturedPiAdapter extends PiCodexAdapter {
  constructor() { super({ executable: "owner-rework-fixture" }); }
  override async isAvailable(): Promise<Availability> { return { status: "available" }; }
  override buildSpec(request: ModelRequest): ProcessSpec {
    return { ...super.buildSpec(request), executable: PROVIDER };
  }
}

function infra(adapter: HarnessAdapter, createBroker?: (options: BrokerOptions) => TransportBroker): Partial<ReworkInfrastructure> {
  return {
    adapterFor: () => adapter,
    ...(createBroker === undefined ? {} : { createBroker }),
    sandboxProbe: () => false,
  };
}

function releasedBroker(options: BrokerOptions, survivors: readonly number[] = []): TransportBroker {
  return {
    async startProcess(registration, spec) {
      const record = {
        identity: { pid: 4343, pgid: 4343, startIdentity: "fixture:4343", startIdentitySource: "fixture" },
        runId: registration.runId, edge: "L19" as const, reservationId: registration.reservationId,
        command: [spec.executable, ...spec.argv], cwd: spec.cwd,
      };
      await options.register(record);
      const spent = options.ledger.spendOnGo(registration.reservationId);
      await options.onSpent?.(record, spent);
      return {
        runId: registration.runId, identity: record.identity,
        stdout: (async function* () {})(), stderr: (async function* () {})(), exit: Promise.resolve({ code: 0, signal: null }),
        cancel: async () => ({
          termSent: survivors.length > 0, killSent: survivors.length > 0, survivors,
          terminated: survivors.length === 0, skipped: null,
        }),
      };
    },
  };
}

type EvidenceScenario = "malformed" | "permission" | "route" | "cancelled";

class EvidenceAdapter extends AvailableAdapter {
  readonly scenario: EvidenceScenario;
  constructor(scenario: EvidenceScenario) { super(); this.scenario = scenario; }
  override async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.launches += 1;
    const at = "2026-08-12T01:00:00.000Z";
    const requestedModel = request.model.replace(/^codex:/, "");
    yield { kind: "run.started" as const, seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.scenario === "route" ? "different-adapter" : this.id, requestedModel };
    if (this.scenario === "route") return;
    yield { kind: "model.resolved" as const, seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, provider: "openai-codex", requestedModel, resolvedModel: requestedModel, provenance: "route-attributed" as const };
    if (this.scenario === "cancelled") {
      yield { kind: "run.cancelled" as const, seq: 3, runId: registration.runId, hostAt: at, providerAt: null, reason: "fixture cancellation" };
      return;
    }
    mkdirSync(join(request.cwd, "core", "src"), { recursive: true });
    writeFileSync(join(request.cwd, "core", "src", "generated.ts"), "export const generated = true;\n");
    if (this.scenario === "permission") writeFileSync(join(request.cwd, "outside.ts"), "not allowed\n");
    const payload = this.scenario === "malformed" ? "not-json" : JSON.stringify({
      schema: "awsf.build-output/v1", producerStatus: "success", summary: "repaired whitespace",
      artifacts: [{ path: "core/src/generated.ts", kind: "source", description: "bounded source" }],
      notesForNextPhase: "host gates", changedFiles: ["core/src/generated.ts"], implementationNotes: ["owner defect repaired"],
      commandsRun: [], proposedCommitMessage: "fix: whitespace",
    });
    yield { kind: "text.delta" as const, seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: payload };
    yield { kind: "run.completed" as const, seq: 4, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

class CredentialOutputAdapter extends AvailableAdapter {
  readonly credential: string;
  constructor(credential: string) { super(); this.credential = credential; }
  override async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.launches += 1;
    const at = "2026-08-12T01:00:00.000Z";
    const requestedModel = request.model.replace(/^codex:/, "");
    yield { kind: "run.started" as const, seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel };
    yield { kind: "model.resolved" as const, seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, provider: "openai-codex", requestedModel, resolvedModel: requestedModel, provenance: "route-attributed" as const };
    const middle = Math.floor(this.credential.length / 2);
    yield { kind: "text.delta" as const, seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: this.credential.slice(0, middle) };
    yield { kind: "text.delta" as const, seq: 4, runId: registration.runId, hostAt: at, providerAt: null, text: this.credential.slice(middle) };
    yield { kind: "run.completed" as const, seq: 5, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

async function cleanup(world: World): Promise<void> {
  world.projection.close();
  rmSync(world.root, { recursive: true, force: true });
}

test("owner rework rejects non-TTY, decline, blank defect, and wrong state without transition or process", async () => {
  const cases = ["non-tty", "decline", "blank", "generic", "wrong-state"] as const;
  for (const scenario of cases) {
    const fixture = await world();
    const adapter = new AvailableAdapter();
    try {
      if (scenario === "wrong-state") await update(fixture, { lifecycleState: "GATING" });
      const before = (await readAttempt(fixture.attemptDir)).revision;
      const action = reworkCommand({
        attemptDir: fixture.attemptDir, defect: scenario === "blank" ? "   " : scenario === "generic" ? "try again" : DEFECT,
        terminal: terminal(scenario !== "decline", scenario !== "non-tty"), config: fixture.config, configPath: fixture.configPath,
        projectRecord: fixture.projection.project, infrastructure: infra(adapter),
      });
      if (scenario === "non-tty") await assert.rejects(action, InteractiveOwnerRequired);
      else if (scenario === "blank" || scenario === "generic") await assert.rejects(action, OwnerReworkDefectRequired);
      else if (scenario === "wrong-state") await assert.rejects(action, /GATING -> RUNNING/);
      else assert.equal((await action).confirmed, false);
      const after = await readAttempt(fixture.attemptDir);
      assert.equal(after.revision, before);
      assert.equal(after.budget.callsSpent, 1);
      assert.equal(after.budget.callsReserved, 0);
      assert.equal(adapter.launches, 0);
    } finally { await cleanup(fixture); }
  }
});

test("credential-shaped owner and retained inputs fail before confirmation with no byte crossing any boundary", async () => {
  const credential = ["sk", "owner-rework-verifier-12345678"].join("-");
  for (const source of ["defect", "request"] as const) {
    const fixture = await world(source === "request" ? { request: `write source using ${credential}` } : {});
    const adapter = new AvailableAdapter();
    const lines: string[] = [];
    const argv: string[][] = [];
    let confirmations = 0;
    let promptWrites = 0;
    let failure: unknown;
    try {
      const action = reworkCommand({
        attemptDir: fixture.attemptDir,
        defect: source === "defect" ? `${DEFECT}; observed ${credential}` : DEFECT,
        terminal: {
          interactive: true,
          write: (line) => { lines.push(line); },
          confirm: async () => { confirmations += 1; return true; },
        },
        config: fixture.config, configPath: fixture.configPath,
        projectRecord: fixture.projection.project,
        infrastructure: {
          ...infra(adapter, () => ({
            async startProcess(_registration, spec) {
              argv.push([...spec.argv]);
              throw new Error("provider must not start");
            },
          })),
          writeSystemPrompt: async () => { promptWrites += 1; throw new Error("prompt must not be materialized"); },
        },
      });
      try { await action; } catch (error) { failure = error; }
      assert.ok(failure instanceof OwnerReworkCredentialRejected);
      assert.equal(String(failure).includes(credential), false);
      assert.equal(lines.join("\n").includes(credential), false);
      assert.equal(confirmations, 0);
      assert.equal(promptWrites, 0);
      assert.deepEqual(argv, []);
      assert.equal(adapter.launches, 0);

      const status = await readAttempt(fixture.attemptDir);
      assert.equal(status.lifecycleState, "AWAITING_OWNER");
      assert.equal(status.budget.callsSpent, 1);
      assert.equal(status.budget.callsReserved, 0);
      assert.equal(status.revision, fixture.status.revision);
      assert.equal(existsSync(join(fixture.attemptDir, "private", "owner-rework-1")), false);
      assert.equal(existsSync(join(fixture.attemptDir, "raw", "owner-rework-1.txt")), false);
      for (const file of filesUnder(fixture.attemptDir)) {
        assert.equal(readFileSync(file).includes(credential), false, `credential reached ${file}`);
      }

      const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
      try {
        const api = publicApiValue({
          session: getSession(db, status.sessionId),
          transitions: transitionsForSession(db, status.sessionId),
          processes: processesForSession(db, status.sessionId),
          gates: gatesForSession(db, status.sessionId),
          agents: agentsForSession(db, status.sessionId),
        });
        assert.equal(JSON.stringify(api).includes(credential), false);
      } finally { db.close(); }
    } finally { await cleanup(fixture); }
  }
});

test("credential-shaped provider output split across deltas reaches no raw, journal, error, argv, or API boundary", async () => {
  const credential = ["ghp", "ProviderOutputVerifier123456789"].join("_");
  const fixture = await world();
  const adapter = new CredentialOutputAdapter(credential);
  try {
    const result = await reworkCommand({
      attemptDir: fixture.attemptDir, defect: DEFECT, terminal: terminal(true),
      config: fixture.config, configPath: fixture.configPath,
      projectRecord: fixture.projection.project,
      infrastructure: infra(adapter, (options) => releasedBroker(options)),
    });
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.budget.callsSpent, 2);
    assert.equal(result.status.budget.callsReserved, 0);
    assert.equal(result.status.blocker?.detail.includes(credential), false);
    assert.match(result.status.blocker?.detail ?? "", /OwnerReworkCredentialRejected/);
    assert.equal(existsSync(join(fixture.attemptDir, "raw", "owner-rework-1.txt")), false);
    for (const file of filesUnder(fixture.attemptDir)) {
      assert.equal(readFileSync(file).includes(credential), false, `credential reached ${file}`);
    }
    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      const api = publicApiValue({
        session: getSession(db, result.status.sessionId),
        transitions: transitionsForSession(db, result.status.sessionId),
        processes: processesForSession(db, result.status.sessionId),
      });
      assert.equal(JSON.stringify(api).includes(credential), false);
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

test("the CLI accepts ordinary attempt/config/state-root handling and rejects generic defect text before mutation", async () => {
  const fixture = await world();
  const errors: string[] = [];
  try {
    fixture.projection.close();
    const code = await main({
      argv: [
        "rework", fixture.status.taskId, "try again", "--attempt", "1",
        "--config", fixture.configPath, "--state-root", fixture.stateRoot,
      ],
      cwd: fixture.canonical, terminal: terminal(true), writeOut: () => {}, writeError: (line) => errors.push(line),
    });
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /OwnerReworkDefectRequired/);
    assert.equal((await readAttempt(fixture.attemptDir)).revision, fixture.status.revision);
  } finally { await cleanup(fixture); }
});

test("exhausted owner allowance and exhausted call ceiling are refused before process creation", async () => {
  for (const scenario of ["allowance", "ceiling"] as const) {
    const fixture = await world();
    const adapter = new AvailableAdapter();
    try {
      await update(fixture, { budget: scenario === "allowance"
        ? { ...fixture.status.budget, correctionsOwner: fixture.status.budget.allowance.owner }
        : { ...fixture.status.budget, callsSpent: 3 } });
      const action = reworkCommand({
        attemptDir: fixture.attemptDir, defect: DEFECT, terminal: terminal(true),
        config: fixture.config, configPath: fixture.configPath, infrastructure: infra(adapter),
      });
      if (scenario === "allowance") await assert.rejects(action, CorrectionAllowanceExhausted);
      else await assert.rejects(action, CallCeilingExceeded);
      assert.equal(adapter.launches, 0);
      assert.equal((await readAttempt(fixture.attemptDir)).lifecycleState, "AWAITING_OWNER");
    } finally { await cleanup(fixture); }
  }
});

test("dirty or mismatched candidate and unavailable fixed route refuse before L19", async () => {
  for (const scenario of ["dirty", "mismatch", "unavailable"] as const) {
    const fixture = await world();
    let routeCalls = 0;
    const adapter = new AvailableAdapter();
    try {
      if (scenario === "dirty") writeFileSync(join(fixture.status.worktree!, "dirty.txt"), "dirty\n");
      if (scenario === "mismatch") await update(fixture, { candidateSha: "a".repeat(40) });
      if (scenario === "unavailable") adapter.isAvailable = async () => ({ status: "blocked", detail: "selected route unavailable" });
      await assert.rejects(reworkCommand({
        attemptDir: fixture.attemptDir, defect: DEFECT, terminal: terminal(true), config: fixture.config, configPath: fixture.configPath,
        infrastructure: { ...infra(adapter), createBroker: () => { routeCalls += 1; throw new Error("must not create broker"); } },
      }));
      const status = await readAttempt(fixture.attemptDir);
      assert.equal(status.lifecycleState, "AWAITING_OWNER");
      assert.equal(status.budget.callsSpent, 1);
      assert.equal(status.budget.callsReserved, 0);
      assert.equal(routeCalls, 0);
    } finally { await cleanup(fixture); }
  }
});

test("the actual private prompt descriptor rejects invalid, unreadable, and insecure paths before L19", async () => {
  for (const scenario of ["relative", "missing", "insecure"] as const) {
    const fixture = await world();
    const adapter = new AvailableAdapter();
    let brokers = 0;
    try {
      const before = await readAttempt(fixture.attemptDir);
      const promptPath = scenario === "relative"
        ? "relative-system-prompt.md"
        : join(fixture.root, `${scenario}-system-prompt.md`);
      await assert.rejects(reworkCommand({
        attemptDir: fixture.attemptDir, defect: DEFECT, terminal: terminal(true),
        config: fixture.config, configPath: fixture.configPath,
        projectRecord: fixture.projection.project,
        infrastructure: {
          ...infra(adapter, () => { brokers += 1; throw new Error("broker must not be constructed"); }),
          writeSystemPrompt: async (text) => {
            if (scenario === "insecure") {
              writeFileSync(promptPath, text, { mode: 0o644 });
              chmodSync(promptPath, 0o644);
            }
            return promptPath;
          },
        },
      }), /system prompt/);
      const status = await readAttempt(fixture.attemptDir);
      assert.equal(status.revision, before.revision);
      assert.equal(status.lifecycleState, "AWAITING_OWNER");
      assert.equal(status.budget.callsSpent, 1);
      assert.equal(status.budget.callsReserved, 0);
      assert.equal(status.process, null);
      assert.equal(adapter.launches, 0);
      assert.equal(brokers, 0);
      const journal = readFileSync(join(fixture.attemptDir, "journal.jsonl"), "utf8");
      assert.equal(journal.includes('"edgeId":"L19"'), false);
    } finally { await cleanup(fixture); }
  }
});

test("L19 reservation is durable before registration and a pre-GO registration refusal spends no call", async () => {
  const fixture = await world();
  const adapter = new AvailableAdapter();
  let checkedBeforeRegister = false;
  let checkedAfterRegister = false;
  try {
    const result = await reworkCommand({
      attemptDir: fixture.attemptDir, defect: DEFECT, terminal: terminal(true), config: fixture.config, configPath: fixture.configPath,
      projectRecord: fixture.projection.project, assertLaunchProjection: fixture.projection.assertLaunchPermitted,
      infrastructure: infra(adapter, (options) => ({
        async startProcess(registration, spec) {
          const before = await readAttempt(fixture.attemptDir);
          checkedBeforeRegister = before.lifecycleState === "RUNNING" && before.budget.callsReserved === 1 && before.budget.callsSpent === 1 && before.process === null;
          const record = {
            identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
            runId: registration.runId, edge: "L19" as const, reservationId: registration.reservationId,
            command: [spec.executable, ...spec.argv], cwd: spec.cwd,
          };
          await options.register(record);
          const registered = await readAttempt(fixture.attemptDir);
          checkedAfterRegister = registered.process?.pid === 4242 && registered.budget.callsReserved === 1 && registered.budget.callsSpent === 1;
          options.ledger.releaseOnRegistrationFailure(registration.reservationId);
          throw new Error("fixture registration failure before GO");
        },
      })),
    });
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.budget.callsSpent, 1, "refusal before GO spends no new call");
    assert.equal(result.status.budget.callsReserved, 0);
    assert.equal(checkedBeforeRegister, true);
    assert.equal(checkedAfterRegister, true);
    assert.equal(adapter.launches, 0);
    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      const process = processesForSession(db, result.status.sessionId).at(-1);
      assert.equal(process?.status, "FAILED");
      assert.notEqual(process?.ended_at, null);
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

test("every post-L19 setup boundary settles the reservation and reaches a legal process-free halt", async () => {
  const scenarios = [
    { name: "l19-projection", failProjectionAt: 1 },
    { name: "queued-phase-projection", failProjectionAt: 2 },
    { name: "broker-constructor", failProjectionAt: 0 },
    { name: "running-phase-projection", failProjectionAt: 3 },
    { name: "broker-setup", failProjectionAt: 0 },
  ] as const;
  for (const scenario of scenarios) {
    const fixture = await world();
    const adapter = new AvailableAdapter();
    let projections = 0;
    let brokerStarts = 0;
    let registrations = 0;
    try {
      const result = await reworkCommand({
        attemptDir: fixture.attemptDir, defect: DEFECT, terminal: terminal(true),
        config: fixture.config, configPath: fixture.configPath,
        projectRecord: async (record, status) => {
          projections += 1;
          await fixture.projection.project(record, status);
          if (projections === scenario.failProjectionAt) throw new Error(`injected ${scenario.name}`);
        },
        infrastructure: infra(adapter, () => {
          if (scenario.name === "broker-constructor") throw new Error("injected broker constructor failure");
          return {
            async startProcess(registration) {
              brokerStarts += 1;
              if (scenario.name === "broker-setup") throw new Error("injected broker setup failure");
              registrations += 1;
              throw new Error(`unexpected process boundary ${registration.runId}`);
            },
          };
        }),
      });
      assert.equal(result.status.lifecycleState, "BLOCKED", scenario.name);
      assert.equal(result.status.budget.callsSpent, 1, scenario.name);
      assert.equal(result.status.budget.callsReserved, 0, scenario.name);
      assert.equal(result.status.budget.correctionsOwner, 1, scenario.name);
      assert.equal(result.status.process, null, scenario.name);
      assert.equal(adapter.launches, 0, scenario.name);
      assert.equal(registrations, 0, scenario.name);
      assert.equal(brokerStarts, scenario.name === "broker-setup" ? 1 : 0, scenario.name);
      type TransitionEvidence = { type?: string; edgeId?: string };
      type TransitionRecord = { event?: { evidence?: TransitionEvidence } };
      const transitions = readFileSync(join(fixture.attemptDir, "journal.jsonl"), "utf8")
        .split("\n").filter(Boolean)
        .map((line: string): TransitionRecord => JSON.parse(line) as TransitionRecord)
        .map((record: TransitionRecord) => record.event?.evidence)
        .filter((evidence: TransitionEvidence | undefined) => evidence?.type === "transition")
        .map((evidence: TransitionEvidence | undefined) => evidence?.edgeId);
      assert.deepEqual(transitions.slice(-2), ["L19", "L8"], scenario.name);
      assert.equal(readFileSync(join(fixture.attemptDir, "status.json"), "utf8").includes('"callsReserved":1'), false);
    } finally { await cleanup(fixture); }
  }
});

test("malformed output, permission breach, route mismatch, cancellation, and survivors block after GO without fallback", async () => {
  for (const scenario of ["malformed", "permission", "route", "cancelled"] as const) {
    const fixture = await world();
    const adapter = new EvidenceAdapter(scenario);
    try {
      const result = await reworkCommand({
        attemptDir: fixture.attemptDir, defect: DEFECT, terminal: terminal(true), config: fixture.config, configPath: fixture.configPath,
        projectRecord: fixture.projection.project, assertLaunchProjection: fixture.projection.assertLaunchPermitted,
        infrastructure: infra(adapter, (options) => releasedBroker(options, scenario === "cancelled" ? [9001] : [])),
      });
      assert.equal(result.status.lifecycleState, "BLOCKED");
      assert.equal(result.status.budget.callsSpent, 2, `${scenario} happens after GO and remains spent`);
      assert.equal(result.status.budget.callsReserved, 0);
      assert.equal(adapter.launches, 1);
      if (scenario === "permission") assert.equal(result.status.blocker?.code, "permission-breach");
      if (scenario === "route") assert.match(result.status.blocker?.detail ?? "", /route mismatch/);
      if (scenario === "cancelled") assert.match(result.status.blocker?.detail ?? "", /surviving processes \[9001\]/);
    } finally { await cleanup(fixture); }
  }
});

test("process-backed L19 repairs candidate A, commits B on top, projects fresh evidence, and spends exactly one call", async () => {
  const fixture = await world({ workflow: "build" });
  const lines: string[] = [];
  try {
    const result = await reworkCommand({
      attemptDir: fixture.attemptDir, defect: DEFECT, terminal: terminal(true, true, lines),
      config: fixture.config, configPath: fixture.configPath, projectRecord: fixture.projection.project,
      assertAdvancement: fixture.projection.assertAdvancement, assertLaunchProjection: fixture.projection.assertLaunchPermitted,
      infrastructure: infra(new CapturedPiAdapter(), (options) => new ProcessTransportBroker(options)),
    });
    const status = result.status;
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, 2);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(status.budget.correctionsOwner, 1);
    assert.match(status.nextAction, /awsf rework .*<concrete defect>/);
    assert.notEqual(status.candidateSha, fixture.candidateA);
    assert.equal(git(status.worktree!, "rev-parse", `${status.candidateSha}^`), fixture.candidateA);
    assert.equal(readFileSync(join(status.worktree!, "core", "src", "generated.ts"), "utf8"), "export const generated = true;\n");
    assert.equal(git(status.worktree!, "status", "--porcelain"), "");
    assert.equal(git(status.worktree!, "show", "-s", "--format=%an <%ae>|%cn <%ce>", status.candidateSha!), "Santiago Marin <santiagomarinsuarez@me.com>|Santiago Marin <santiagomarinsuarez@me.com>");
    assert.ok(lines.includes(`Candidate SHA: ${fixture.candidateA}`));
    assert.ok(lines.some((line) => line.includes("openai-codex")));

    const probe = JSON.parse(readFileSync(join(fixture.attemptDir, "private", "owner-rework-1", "provider-probe.json"), "utf8")) as {
      promptContentInArgv: boolean; systemPromptContentInArgv: boolean;
      registeredBeforeProviderStart: boolean; spentBeforeProviderStart: boolean;
    };
    assert.equal(probe.promptContentInArgv, false);
    assert.equal(probe.systemPromptContentInArgv, false);
    assert.equal(probe.registeredBeforeProviderStart, true);
    assert.equal(probe.spentBeforeProviderStart, true);

    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.equal(getSession(db, status.sessionId)?.candidate_sha, status.candidateSha);
      assert.equal(getSession(db, status.sessionId)?.lifecycle_state, "AWAITING_OWNER");
      assert.deepEqual(transitionsForSession(db, status.sessionId).slice(-3).map((row) => row.edge_id), ["L19", "L7", "L12"]);
      assert.ok(processesForSession(db, status.sessionId).some((row) => row.run_id.includes("owner-rework-1")));
      assert.equal(agentsForSession(db, status.sessionId).find((row) => row.agent === "builder")?.call_count, 1);
      const fresh = gatesForSession(db, status.sessionId).filter((gate) => gate.phase_id.includes("owner-rework-1"));
      assert.ok(fresh.length >= 10);
      assert.ok(fresh.every((gate) => gate.candidate_sha === status.candidateSha && gate.passed === 1));
    } finally { db.close(); }
    const journal = readFileSync(join(fixture.attemptDir, "journal.jsonl"), "utf8");
    assert.match(journal, new RegExp(fixture.candidateA));
    assert.match(journal, new RegExp(status.candidateSha!));
  } finally { await cleanup(fixture); }
});

test("projection hold retains the freshly gated candidate at GATING instead of returning invisibly to owner", async () => {
  const fixture = await world();
  try {
    const result = await reworkCommand({
      attemptDir: fixture.attemptDir, defect: DEFECT, terminal: terminal(true), config: fixture.config, configPath: fixture.configPath,
      projectRecord: fixture.projection.project, assertLaunchProjection: fixture.projection.assertLaunchPermitted,
      assertAdvancement: (_sessionId, to) => { if (to === "AWAITING_OWNER") throw new Error("fixture projection hold"); },
      infrastructure: infra(new CapturedPiAdapter(), (options) => new ProcessTransportBroker(options)),
    });
    assert.equal(result.status.lifecycleState, "GATING");
    assert.notEqual(result.status.candidateSha, fixture.candidateA);
    assert.equal(result.status.blocker?.code, "sqlite-projection-failed");
    assert.equal(result.status.budget.callsSpent, 2);
  } finally { await cleanup(fixture); }
});

test("configured gate failure retains candidate B and preserves candidate A gate history without reuse", async () => {
  const fixture = await world({ commandExit: 7 });
  try {
    const result = await reworkCommand({
      attemptDir: fixture.attemptDir, defect: DEFECT, terminal: terminal(true), config: fixture.config, configPath: fixture.configPath,
      projectRecord: fixture.projection.project, assertLaunchProjection: fixture.projection.assertLaunchPermitted,
      infrastructure: infra(new CapturedPiAdapter(), (options) => new ProcessTransportBroker(options)),
    });
    const status = result.status;
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.notEqual(status.candidateSha, fixture.candidateA);
    assert.equal(git(status.worktree!, "rev-parse", `${status.candidateSha}^`), fixture.candidateA);
    assert.equal(git(status.worktree!, "rev-parse", "HEAD"), status.candidateSha);
    assert.equal(status.gatesPass, false);
    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      const gates = gatesForSession(db, status.sessionId);
      assert.ok(gates.some((gate) => gate.phase_id.endsWith(":builder") && gate.candidate_sha === fixture.candidateA && gate.passed === 1));
      assert.ok(gates.some((gate) => gate.phase_id.includes("owner-rework-1") && gate.candidate_sha === status.candidateSha && gate.passed === 0));
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});
