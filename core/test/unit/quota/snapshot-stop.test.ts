import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setImmediate as waitImmediate } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { stringify } from "yaml";

import { StubAdapter } from "../../../src/adapters/stub.ts";
import type {
  BrokerProcessRegistration,
  ModelRequest,
  ProcessTransport,
  TransportBroker,
} from "../../../src/adapters/interface.ts";
import { isTaskEdgeRegistration, reservationIdOf } from "../../../src/adapters/interface.ts";
import { toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import { loadConfig } from "../../../src/config/load.ts";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import type { BuildOutput } from "../../../src/contracts/build-output.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import type { PlanOutput } from "../../../src/contracts/plan-output.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import {
  runProductionCommand,
  type ProductionInfrastructure,
} from "../../../src/cli/commands/production-run.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import type { BrokerOptions } from "../../../src/execution/transport-broker.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import {
  projectAttemptStatus,
  type AttemptStatusProjection,
  type SessionInit,
} from "../../../src/observability/projector.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { Journal, type JournalRecord } from "../../../src/persistence/journal.ts";
import { InsufficientEvidence } from "../../../src/state/errors.ts";
import {
  correctionAllowance,
  transition,
  type BudgetState,
} from "../../../src/state/task-machine.ts";
import type { AttemptEvent } from "../../../src/cli/commands/attempt.ts";

const STUB_PROVIDER = resolve("core/test/fixtures/providers/stub/stub-provider.mjs");
const NOMINAL_FIXTURE = resolve("core/test/fixtures/quota-axi/nominal.json");
const FIXED_NOW = "2026-08-24T20:26:39.429Z";
const FIVE_MINUTES = 5;
const LONG_ADVANCE_MS = 366 * 24 * 60 * 60 * 1_000;

interface FakeClock {
  readonly now: () => string;
  readonly advance: (milliseconds: number) => void;
}

function fakeClock(context: TestContext): FakeClock {
  context.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: new Date(FIXED_NOW) });
  return {
    now: () => new Date().toISOString(),
    advance: (milliseconds) => context.mock.timers.tick(milliseconds),
  };
}

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function plannerOutput(): PlanOutput {
  return {
    schema: "awsf.plan-output/v1",
    producerStatus: "success",
    summary: "Planned one bounded fixture change.",
    artifacts: [],
    notesForNextPhase: "Write the declared fixture source file.",
    goals: ["Create one host-committed fixture candidate."],
    nonGoals: ["Calling a provider process."],
    implementationSteps: [{
      id: "fixture-change",
      title: "Write the fixture candidate",
      files: ["core/src/quota-boundary-fixture.ts"],
      acceptanceCriteria: ["The host records the exact candidate before GATING."],
    }],
    testStrategy: ["Run the configured empty fixture gate set."],
    risks: [{ risk: "The fixture could launch a provider.", mitigation: "Use only the injected broker." }],
    openQuestions: [],
  };
}

function builderOutput(): BuildOutput {
  return {
    schema: "awsf.build-output/v1",
    producerStatus: "success",
    summary: "Wrote the fixture candidate.",
    artifacts: [{
      path: "core/src/quota-boundary-fixture.ts",
      kind: "source",
      description: "Fixture candidate used to reach host gating.",
    }],
    notesForNextPhase: "Run host gates against the committed candidate.",
    changedFiles: ["core/src/quota-boundary-fixture.ts"],
    implementationNotes: ["The fixture writes one inert exported constant."],
    commandsRun: [],
    proposedCommitMessage: "test: create quota boundary candidate",
  };
}

class CandidateWritingStubAdapter extends StubAdapter {
  launches = 0;

  constructor(sideEffectPath: string) {
    super({ providerPath: STUB_PROVIDER, sideEffectPath, now: () => FIXED_NOW });
  }

  override async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.launches += 1;
    const output = this.launches === 1 ? plannerOutput() : builderOutput();
    if (output.schema === "awsf.build-output/v1") {
      const path = join(request.cwd, output.changedFiles[0]!);
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, "export const quotaBoundaryFixture = true;\n");
    }
    yield {
      kind: "run.started",
      seq: 1,
      runId: registration.runId,
      hostAt: FIXED_NOW,
      providerAt: null,
      adapter: this.id,
      requestedModel: request.model,
    };
    yield {
      kind: "model.resolved",
      seq: 2,
      runId: registration.runId,
      hostAt: FIXED_NOW,
      providerAt: null,
      adapter: this.id,
      provider: "stub",
      requestedModel: request.model,
      resolvedModel: "stub-model-1",
      provenance: "stream-authoritative",
    };
    yield {
      kind: "text.delta",
      seq: 3,
      runId: registration.runId,
      hostAt: FIXED_NOW,
      providerAt: null,
      text: JSON.stringify(output),
    };
    yield {
      kind: "run.completed",
      seq: 4,
      runId: registration.runId,
      hostAt: FIXED_NOW,
      providerAt: null,
      exitCode: 0,
    };
  }
}

function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec): Promise<ProcessTransport> {
      const record = {
        identity: {
          pid: 4242,
          pgid: 4242,
          startIdentity: "fixture:4242",
          startIdentitySource: "fixture" as const,
        },
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
        cancel: async () => ({
          termSent: false,
          killSent: false,
          survivors: [],
          terminated: true,
          skipped: null,
        }),
      };
    },
  };
}

function fixtureConfig(thresholdMinutes: number): AwsfConfig {
  const loaded = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  return {
    ...loaded,
    runtime: { ...loaded.runtime, seed_paths: [] },
    routing: {
      ...loaded.routing,
      quota_stop: {
        default: { minutes: thresholdMinutes, probe_timeout_ms: 2_500 },
      },
    },
    agents: loaded.agents.map((agent) => ["planner", "builder"].includes(agent.name)
      ? {
          ...agent,
          model: "stub/success",
          thinking: "none" as const,
          harness: { adapter: "claude", continuity: "none" as const },
        }
      : agent),
    gates: {},
  };
}

function quotaPayload(minutesToReset: number): string {
  const payload = JSON.parse(readFileSync(NOMINAL_FIXTURE, "utf8")) as {
    generatedAt: string;
    providers: Array<{
      provider: string;
      windows: Array<{ id: string; resetsAt: string }>;
    }>;
  };
  payload.generatedAt = FIXED_NOW;
  const claude = payload.providers.find((provider) => provider.provider === "claude");
  const binding = claude?.windows.find((window) => window.id === "seven_day");
  assert.ok(binding, "nominal fixture must retain Claude's binding window");
  binding.resetsAt = new Date(Date.parse(FIXED_NOW) + minutesToReset * 60_000).toISOString();
  return JSON.stringify(payload);
}

function quotaCommands(payload: string): {
  readonly runCommand: ProductionInfrastructure["runCommand"];
  readonly calls: Array<{ argv: readonly string[]; timeoutMs: number }>;
} {
  const calls: Array<{ argv: readonly string[]; timeoutMs: number }> = [];
  return {
    calls,
    runCommand: (_executable, argv, options) => {
      calls.push({ argv: [...argv], timeoutMs: options.timeoutMs });
      return argv[0] === "--version"
        ? { status: 0, stdout: "quota-axi 0.1.29\n", stderr: "", error: null }
        : { status: 0, stdout: payload, stderr: "", error: null };
    },
  };
}

interface World {
  readonly root: string;
  readonly stateRoot: string;
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly attemptDir: string;
  readonly worktree: string;
  readonly sideEffectPath: string;
}

async function world(clock: FakeClock, thresholdMinutes = FIVE_MINUTES): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "awsf-quota-snapshot-stop-"));
  const repository = join(root, "canonical");
  const stateRoot = join(root, "state");
  mkdirSync(repository, { recursive: true });
  execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
  writeFileSync(join(repository, "README.md"), "fixture repository\n");
  git(repository, "add", "README.md");
  git(
    repository,
    "-c", "user.name=Santiago Marin",
    "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-m", "test: seed quota boundary fixture",
  );

  const config = fixtureConfig(thresholdMinutes);
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, stringify(config));
  for (const role of ["planner", "builder"]) {
    for (const kind of ["system", "user"] as const) {
      const destination = join(root, "prompts", role, `${kind}.md`);
      mkdirSync(join(root, "prompts", role), { recursive: true });
      writeFileSync(destination, readFileSync(resolve(`prompts/${role}/${kind}.md`), "utf8"));
    }
  }
  mkdirSync(join(root, "prompts", "shared"), { recursive: true });
  writeFileSync(
    join(root, "prompts", "shared", "headless-role.md"),
    readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"),
  );

  const created = await newCommand({
    stateRoot,
    project: config.project.slug,
    taskId: "quota-boundary",
    repository,
    request: "Prove the phase-boundary quota stop offline.",
    workflow: "plan-build-test",
    tier: 1,
    configSnapshotJson: toConfigSnapshotJson(config),
    now: clock.now,
    sessionId: () => "00000000-0000-4000-8000-000000000017",
  });
  const prepared = await startCommand({
    attemptDir: created.attemptDir,
    worktreeRoot: join(root, "worktrees"),
    configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }),
    now: clock.now,
  });
  assert.ok(prepared.worktree);
  return {
    root,
    stateRoot,
    config,
    configPath,
    attemptDir: created.attemptDir,
    worktree: prepared.worktree,
    sideEffectPath: join(root, "provider-ran.json"),
  };
}

function journalRecords(attemptDir: string): readonly JournalRecord<AttemptEvent>[] {
  return readFileSync(join(attemptDir, "journal.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalRecord<AttemptEvent>);
}

function evidenceOfType<T extends AttemptEvidence["type"]>(
  records: readonly JournalRecord<AttemptEvent>[],
  type: T,
): Array<Extract<AttemptEvidence, { type: T }>> {
  return records.flatMap((record) => record.event.evidence?.type === type
    ? [record.event.evidence as Extract<AttemptEvidence, { type: T }>]
    : []);
}

const BUDGET: BudgetState = {
  attempt: 1,
  callsSpent: 0,
  callsReserved: 0,
  correctionsAuto: 0,
  correctionsOwner: 0,
  ownerReentries: 0,
  allowance: correctionAllowance({ auto: 1, owner: 1 }),
};

function assertGuardViolation(
  action: () => unknown,
  expected: readonly RegExp[],
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof InsufficientEvidence);
    for (const pattern of expected) assert.match(error.message, pattern);
    return true;
  });
}

test("a quota snapshot round-trips through a parsed journal line with explicit non-attribution", async (context) => {
  fakeClock(context);
  const root = mkdtempSync(join(tmpdir(), "awsf-quota-journal-roundtrip-"));
  const journal = new Journal<AttemptEvidence>(join(root, "journal.jsonl"));
  try {
    await journal.append({
      type: "quota-snapshot",
      attribution: "none",
      scope: "account-window",
      completedPhaseKey: "planner",
      nextPhaseKey: "builder",
      effectivePercentRemaining: 42,
      minutesToReset: 10,
      reasonCode: null,
      resolvedVersion: "0.1.29",
    });
    await journal.close();
    const [line] = readFileSync(journal.path, "utf8").trim().split("\n");
    const parsed = JSON.parse(line!) as JournalRecord<AttemptEvidence>;
    assert.equal(parsed.event.type, "quota-snapshot");
    assert.equal(parsed.event.attribution, "none");
  } finally {
    await journal.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an uncrossed fixture run records every boundary snapshot, reaches GATING, and never records L26", async (context) => {
  const clock = fakeClock(context);
  const fixture = await world(clock);
  const adapter = new CandidateWritingStubAdapter(fixture.sideEffectPath);
  const commands = quotaCommands(quotaPayload(10));
  try {
    const status = await runProductionCommand({
      attemptDir: fixture.attemptDir,
      stateRoot: fixture.stateRoot,
      config: fixture.config,
      configPath: fixture.configPath,
      infrastructure: {
        adapterFor: () => adapter,
        createBroker: fakeBroker,
        runCommand: commands.runCommand,
        resolveExecutable: () => "/fixture/quota-axi",
        now: clock.now,
        sandboxProbe: () => false,
      },
    });

    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    const records = journalRecords(fixture.attemptDir);
    const snapshots = evidenceOfType(records, "quota-snapshot");
    const transitions = evidenceOfType(records, "transition");
    assert.equal(snapshots.length, 3, "four compiled phases have exactly three boundaries");
    assert.deepEqual(
      snapshots.map((snapshot) => [snapshot.completedPhaseKey, snapshot.nextPhaseKey]),
      [
        ["request", "planner"],
        ["planner", "builder"],
        ["builder", "tests"],
      ],
    );
    assert.ok(snapshots.every((snapshot) => snapshot.attribution === "none"));
    assert.ok(transitions.some((entry) => entry.edgeId === "L7" && entry.to === "GATING"));
    assert.equal(transitions.some((entry) => entry.edgeId === "L26"), false);
    assert.equal(adapter.launches, 2);
    assert.equal(existsSync(fixture.sideEffectPath), false, "the stub provider executable never runs");
    assert.deepEqual(commands.calls.map((call) => call.argv), [
      ["--version"],
      ["--provider", "claude", "--json"],
      ["--version"],
      ["--provider", "claude", "--json"],
      ["--version"],
      ["--provider", "claude", "--json"],
    ]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a crossed boundary records L26 and advancing the injected clock cannot resume it", async (context) => {
  const clock = fakeClock(context);
  const fixture = await world(clock);
  const adapter = new CandidateWritingStubAdapter(fixture.sideEffectPath);
  const commands = quotaCommands(quotaPayload(4));
  try {
    const status = await runProductionCommand({
      attemptDir: fixture.attemptDir,
      stateRoot: fixture.stateRoot,
      config: fixture.config,
      configPath: fixture.configPath,
      infrastructure: {
        adapterFor: () => adapter,
        createBroker: fakeBroker,
        runCommand: commands.runCommand,
        resolveExecutable: () => "/fixture/quota-axi",
        now: clock.now,
        sandboxProbe: () => false,
      },
    });

    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    const before = evidenceOfType(journalRecords(fixture.attemptDir), "transition");
    const stop = before.find((entry) => entry.edgeId === "L26");
    assert.ok(stop);
    assert.equal(stop.actor, "host");
    assert.equal(stop.spawnSite, false);
    assert.equal(Number(stop.spawnSite), 0);
    assert.equal(stop.from, "RUNNING");
    assert.equal(stop.to, "AWAITING_OWNER");
    assert.match(stop.reasonDetail ?? "", /threshold 5 minutes/u);
    assert.match(stop.reasonDetail ?? "", /observed 4 minutes/u);
    assert.equal(adapter.launches, 0, "the next fixture phase is stopped before registration");
    assert.equal(existsSync(fixture.sideEffectPath), false, "no provider process is spawned");

    clock.advance(LONG_ADVANCE_MS);
    await waitImmediate();
    const after = evidenceOfType(journalRecords(fixture.attemptDir), "transition");
    assert.deepEqual(after, before, "a year past every timeout records no automatic transition");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("L26 refuses unavailable evidence and L20 refuses a quota-suspended task with no gates or candidate", () => {
  assertGuardViolation(() => transition({
    from: "RUNNING",
    to: "AWAITING_OWNER",
    actor: "host",
    tier: 0,
    reason: { source: "process", detail: "quota probe unavailable" },
    interactive: false,
    budget: BUDGET,
    evidence: {
      quotaStop: { route: "claude", thresholdMinutes: FIVE_MINUTES },
    },
  }), [/L26/u, /minutesToReset \(absent\)/u, /unavailable, stale or unknown/u]);

  assertGuardViolation(() => transition({
    from: "AWAITING_OWNER",
    to: "LANDING",
    actor: "human",
    tier: 0,
    reason: { source: "human", detail: "attempt to bypass gating after L26" },
    interactive: true,
    budget: BUDGET,
    evidence: {},
  }), [/L20/u, /candidate SHA \(absent\)/u, /gates did not pass/u]);
});

const SESSION: SessionInit = {
  sessionId: "quota-projection-session",
  projectSlug: "fixture",
  taskId: "T17",
  continuesTask: null,
  groupId: null,
  planRef: null,
  attempt: 1,
  workflowId: "intake",
  riskTier: 0,
  isProtected: false,
  requestText: "project quota evidence",
  callCeiling: 1,
  configSnapshotJson: "{}",
  journalPath: "/fixture/journal.jsonl",
  startedAt: FIXED_NOW,
};

function projectionStatus(
  evidence: AttemptEvidence,
  revision: number,
  lifecycleState: AttemptStatusProjection["lifecycleState"],
): AttemptStatusProjection {
  return {
    ...SESSION,
    lifecycleState,
    baseSha: null,
    candidateSha: null,
    callsSpent: 0,
    callsReserved: 0,
    correctionsAuto: 0,
    correctionsOwner: 0,
    ownerReentries: 0,
    workerModelResolved: null,
    updatedAt: FIXED_NOW,
    endedAt: null,
    stateRevision: revision,
    evidence,
  };
}

test("a journal containing a quota snapshot and L26 projects only the transition on the unchanged schema", async (context) => {
  fakeClock(context);
  const root = mkdtempSync(join(tmpdir(), "awsf-quota-projection-"));
  const journal = new Journal<AttemptEvidence>(join(root, "journal.jsonl"));
  const db = openDatabase(":memory:");
  try {
    await journal.append({
      type: "quota-snapshot",
      attribution: "none",
      scope: "account-window",
      completedPhaseKey: "request",
      nextPhaseKey: "intake",
      effectivePercentRemaining: 3,
      minutesToReset: 4,
      reasonCode: null,
      resolvedVersion: "0.1.29",
    });
    await journal.append({
      type: "transition",
      id: "transition-l26",
      seq: 1,
      from: "RUNNING",
      to: "AWAITING_OWNER",
      actor: "host",
      edgeId: "L26",
      reasonSource: "process",
      reasonCode: null,
      reasonDetail: "configured threshold 5 minutes, observed 4 minutes",
      spawnSite: false,
      at: FIXED_NOW,
    });
    await journal.close();

    const records = readFileSync(journal.path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as JournalRecord<AttemptEvidence>);
    assert.equal(records.length, 2);
    const schemaVersion = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

    const snapshot = projectAttemptStatus(
      db,
      projectionStatus(records[0]!.event, 1, "RUNNING"),
      records[0]!.source_seq,
    );
    assert.equal(snapshot.ok, true);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM transitions").get() as { n: number }).n, 0);
    for (const table of ["phases", "events", "envelopes", "gate_results", "processes", "agent_sessions"]) {
      const count = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      assert.equal(count, 0, `quota snapshot must write no ${table} row`);
    }

    const stopped = projectAttemptStatus(
      db,
      projectionStatus(records[1]!.event, 2, "AWAITING_OWNER"),
      records[1]!.source_seq,
    );
    assert.equal(stopped.ok, true);
    const row = db.prepare(
      "SELECT edge_id, actor, spawn_site, from_state, to_state FROM transitions",
    ).get();
    assert.deepEqual({ ...row as object }, {
      edge_id: "L26",
      actor: "host",
      spawn_site: 0,
      from_state: "RUNNING",
      to_state: "AWAITING_OWNER",
    });
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      schemaVersion,
    );
  } finally {
    await journal.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
