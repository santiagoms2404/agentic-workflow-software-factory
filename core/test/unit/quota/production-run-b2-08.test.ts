// Regression test for B2-08:
// The resume-time quota probe passes an empty journalFailure, so an unavailable probe
// is never journalled, although probe.ts makes journalling mandatory for every unavailable result.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  resumeProductionCommand,
  type ProductionInfrastructure,
} from "../../../src/cli/commands/production-run.ts";
import { k1Request, startUnderK1 } from "../../fixtures/k1-preflight.ts";
import type { BrokerOptions } from "../../../src/execution/transport-broker.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import type { JournalRecord } from "../../../src/persistence/journal.ts";
import type { AttemptEvent } from "../../../src/cli/commands/attempt.ts";

const STUB_PROVIDER = resolve("core/test/fixtures/providers/stub/stub-provider.mjs");
const NOMINAL_FIXTURE = resolve("core/test/fixtures/quota-axi/nominal.json");
const FIXED_NOW = "2026-08-24T20:26:39.429Z";
const FIVE_MINUTES = 5;

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
    gates: { test: { argv: ["node", "-e", "process.exit(0)"], timeout_seconds: 10 } },
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
  const root = mkdtempSync(join(tmpdir(), "awsf-quota-b208-"));
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
    request: k1Request("Prove the phase-boundary quota stop offline.", "core/src/quota-boundary.ts"),
    workflow: "plan-build-test",
    tier: 1,
    configSnapshotJson: toConfigSnapshotJson(config),
    now: clock.now,
    sessionId: () => "00000000-0000-4000-8000-000000000017",
  });
  const prepared = await startUnderK1({
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

test("B2-08: unavailable resume quota probe (nonzero-exit) journals QuotaProbeFailure details", { skip: process.platform === "win32" }, async (context) => {
  const clock = fakeClock(context);
  const fixture = await world(clock);
  const adapter = new CandidateWritingStubAdapter(fixture.sideEffectPath);
  let probes = 0;
  const initialCommands: ProductionInfrastructure["runCommand"] = (_executable, argv) => {
    if (argv[0] === "--version") return { status: 0, stdout: "quota-axi 0.1.29\n", stderr: "", error: null };
    probes += 1;
    return { status: 0, stdout: probes <= 2 ? quotaPayload(10) : quotaPayload(4), stderr: "", error: null };
  };

  try {
    const status = await runProductionCommand({
      attemptDir: fixture.attemptDir,
      stateRoot: fixture.stateRoot,
      config: fixture.config,
      configPath: fixture.configPath,
      infrastructure: {
        adapterFor: () => adapter,
        createBroker: fakeBroker,
        runCommand: initialCommands,
        resolveExecutable: () => "/fixture/quota-axi",
        now: clock.now,
        sandboxProbe: () => false,
      },
    });

    assert.equal(status.recovery?.kind, "quota-pause");

    const resumeCommand: ProductionInfrastructure["runCommand"] = (_executable, argv) => {
      if (argv[0] === "--version") return { status: 0, stdout: "quota-axi 0.1.29\n", stderr: "", error: null };
      return { status: 1, stdout: "", stderr: "quota-axi: network timeout", error: null };
    };

    const terminal = {
      interactive: true,
      write: () => {},
      confirm: async () => true,
    };

    await assert.rejects(
      resumeProductionCommand({
        attemptDir: fixture.attemptDir,
        stateRoot: fixture.stateRoot,
        config: fixture.config,
        configPath: fixture.configPath,
        reason: "quota recovered",
        terminal,
        infrastructure: {
          adapterFor: () => adapter,
          createBroker: fakeBroker,
          runCommand: resumeCommand,
          resolveExecutable: () => "/fixture/quota-axi",
          now: clock.now,
          sandboxProbe: () => false,
        },
      }),
      /resume refused: selected quota is unknown, stale, ambiguous or below its threshold/,
    );

    const records = journalRecords(fixture.attemptDir);
    const snapshots = evidenceOfType(records, "quota-snapshot");
    const failedSnapshot = snapshots.find((s) => s.completedPhaseKey === "recovery-preflight");
    assert.ok(failedSnapshot, "an unavailable resume quota probe must be journalled");
    assert.equal(failedSnapshot.reasonCode, "nonzero-exit");
    assert.ok(failedSnapshot.failure, "QuotaProbeFailure details must be attached to the snapshot evidence");
    assert.equal(failedSnapshot.failure?.reasonCode, "nonzero-exit");
    if (failedSnapshot.failure?.reasonCode !== "nonzero-exit") throw new Error("expected nonzero-exit");
    assert.equal(failedSnapshot.failure.exitCode, 1);
    assert.equal(failedSnapshot.failure.command, "probe");
    assert.ok(failedSnapshot.failure.retainedPath, "the failing payload is retained and its path recorded");
    const retained = readFileSync(join(fixture.attemptDir, failedSnapshot.failure.retainedPath), "utf8");
    assert.match(retained, /network timeout/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("B2-08 triangulation: unavailable resume quota probe (unparseable) journals QuotaProbeFailure details", { skip: process.platform === "win32" }, async (context) => {
  const clock = fakeClock(context);
  const fixture = await world(clock);
  const adapter = new CandidateWritingStubAdapter(fixture.sideEffectPath);
  let probes = 0;
  const initialCommands: ProductionInfrastructure["runCommand"] = (_executable, argv) => {
    if (argv[0] === "--version") return { status: 0, stdout: "quota-axi 0.1.29\n", stderr: "", error: null };
    probes += 1;
    return { status: 0, stdout: probes <= 2 ? quotaPayload(10) : quotaPayload(4), stderr: "", error: null };
  };

  try {
    const status = await runProductionCommand({
      attemptDir: fixture.attemptDir,
      stateRoot: fixture.stateRoot,
      config: fixture.config,
      configPath: fixture.configPath,
      infrastructure: {
        adapterFor: () => adapter,
        createBroker: fakeBroker,
        runCommand: initialCommands,
        resolveExecutable: () => "/fixture/quota-axi",
        now: clock.now,
        sandboxProbe: () => false,
      },
    });

    assert.equal(status.recovery?.kind, "quota-pause");

    const resumeCommand: ProductionInfrastructure["runCommand"] = (_executable, argv) => {
      if (argv[0] === "--version") return { status: 0, stdout: "quota-axi 0.1.29\n", stderr: "", error: null };
      return { status: 0, stdout: "{ malformed json", stderr: "", error: null };
    };

    const terminal = {
      interactive: true,
      write: () => {},
      confirm: async () => true,
    };

    await assert.rejects(
      resumeProductionCommand({
        attemptDir: fixture.attemptDir,
        stateRoot: fixture.stateRoot,
        config: fixture.config,
        configPath: fixture.configPath,
        reason: "quota recovered",
        terminal,
        infrastructure: {
          adapterFor: () => adapter,
          createBroker: fakeBroker,
          runCommand: resumeCommand,
          resolveExecutable: () => "/fixture/quota-axi",
          now: clock.now,
          sandboxProbe: () => false,
        },
      }),
      /resume refused: selected quota is unknown, stale, ambiguous or below its threshold/,
    );

    const records = journalRecords(fixture.attemptDir);
    const snapshots = evidenceOfType(records, "quota-snapshot");
    const failedSnapshot = snapshots.find((s) => s.completedPhaseKey === "recovery-preflight");
    assert.ok(failedSnapshot, "an unavailable resume quota probe must be journalled");
    assert.equal(failedSnapshot.reasonCode, "unparseable");
    assert.ok(failedSnapshot.failure, "QuotaProbeFailure details must be attached to the snapshot evidence");
    assert.equal(failedSnapshot.failure?.reasonCode, "unparseable");
    if (failedSnapshot.failure?.reasonCode !== "unparseable") throw new Error("expected unparseable");
    assert.equal(failedSnapshot.failure.command, "probe");
    assert.ok(failedSnapshot.failure.retainedPath, "the failing payload is retained and its path recorded");
    const retained = readFileSync(join(fixture.attemptDir, failedSnapshot.failure.retainedPath), "utf8");
    assert.match(retained, /malformed json/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
