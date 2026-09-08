import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  reservationIdOf,
  type BrokerProcessRegistration,
  type HarnessAdapter,
  type ModelInfo,
  type ModelRequest,
  type ProcessSpec,
  type ProcessTransport,
  type TransportBroker,
} from "../../src/adapters/interface.ts";
import { loadConfig } from "../../src/config/load.ts";
import type { AwsfConfig } from "../../src/config/schema.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import { TEST_OUTPUT_TAIL_MAX_CHARS } from "../../src/contracts/test-output.ts";
import type { BrokerOptions } from "../../src/execution/transport-broker.ts";
import { runGit, systemGitRunner } from "../../src/git/changes.ts";
import { adoptCommand } from "../../src/cli/commands/adopt.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../src/cli/commands/attempt.ts";
import { journeyCommand } from "../../src/cli/commands/journey.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { journalFilePath, statusFilePath } from "../../src/persistence/platform-paths.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";

const PROJECT = "agentic-workflow-software-factory";
const AT = "2026-09-08T00:00:00.000Z";

function git(repository: string, ...argv: string[]): string {
  return runGit(systemGitRunner(repository), argv).trim();
}

class MetadataOnlyAdapter implements HarnessAdapter {
  readonly id: string;
  readonly provider: string;
  launches = 0;
  constructor(id: string, provider: string) {
    this.id = id;
    this.provider = provider;
  }
  async isAvailable() { return { status: "available" as const }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return {
      adapter: this.id, provider: this.provider, requestedModel: model,
      contextWindow: null, supportsThinking: true, supportsTools: true, supportsImages: false,
      continuity: "none", usageAuthority: "none", costAuthority: "unavailable",
    };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return {
      executable: "/fixture/provider",
      argv: ["--append-system-prompt", request.systemPromptPath!],
      cwd: request.cwd,
      env: request.env,
      stdin: request.prompt,
      shell: false,
    };
  }
  async *parse(_transport: ProcessTransport, _signal?: AbortSignal): AsyncIterable<NormalizedEvent> {
    if (_signal?.aborted === true) yield {} as NormalizedEvent;
    throw new Error("gate failure must not parse provider output");
  }
  async *execute(
    _request: ModelRequest,
    _broker: TransportBroker,
    _registration: BrokerProcessRegistration,
    _signal: AbortSignal,
  ): AsyncIterable<NormalizedEvent> {
    if (_signal.aborted) yield {} as NormalizedEvent;
    this.launches += 1;
    throw new Error("gate failure must not launch a provider");
  }
}

class SuccessfulReviewAdapter extends MetadataOnlyAdapter {
  readonly #candidate: string;

  constructor(id: string, provider: string, candidate: string) {
    super(id, provider);
    this.#candidate = candidate;
  }

  async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: AbortSignal,
  ): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.launches += 1;
    const payload: ReviewOutput = {
      schema: "awsf.review-output/v1",
      producerStatus: "success",
      summary: "audited the exact adopted candidate",
      artifacts: [],
      notesForNextPhase: "owner runs the end-user journey",
      verdict: "accept",
      reviewedSha: this.#candidate,
      findings: [],
      limitations: ["scripted adoption review"],
    };
    const runId = registration.runId;
    yield { kind: "run.started", seq: 1, runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId, hostAt: AT, providerAt: null, adapter: this.id, provider: this.provider, requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId, hostAt: AT, providerAt: null, text: JSON.stringify(payload) };
    yield { kind: "run.completed", seq: 4, runId, hostAt: AT, providerAt: null, exitCode: 0 };
  }
}

function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec) {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" as const },
        runId: registration.runId,
        edge: "L11" as const,
        reservationId: reservationIdOf(registration),
        command: [spec.executable, ...spec.argv],
        cwd: spec.cwd,
      };
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

function terminal(lines: string[]): OwnerTerminal {
  return { interactive: true, write: (line) => { lines.push(line); }, confirm: async () => true };
}

async function sourceFixture(root: string): Promise<{
  readonly stateRoot: string;
  readonly sourceDir: string;
  readonly repository: string;
  readonly candidate: string;
  readonly source: AttemptStatus;
}> {
  const repository = join(root, "repository");
  const stateRoot = join(root, "state");
  git(root, "init", repository);
  writeFileSync(join(repository, "README.md"), "base\n");
  git(repository, "add", "README.md");
  git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "base");
  const base = git(repository, "rev-parse", "HEAD");
  mkdirSync(join(repository, "core", "src"), { recursive: true });
  writeFileSync(join(repository, "core", "src", "feature.ts"), "export const adopted = true;\n");
  git(repository, "add", "core/src/feature.ts");
  git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "feat: generic blocked candidate");
  const candidate = git(repository, "rev-parse", "HEAD");
  git(repository, "reset", "--hard", base);

  const sourceDir = join(stateRoot, "projects", PROJECT, "tasks", "generic-source", "1");
  const initial: AttemptStatus = {
    schema: "awsf/attempt-status/v1", sessionId: "source-session", project: PROJECT,
    taskId: "generic-source", continuesTask: null, attempt: 1, repository, worktree: null,
    workflow: "build-review", tier: 2, request: "adopt the generic candidate without rebuilding it",
    configSnapshotJson: "{}", lifecycleState: "GATING", baseSha: base, candidateSha: candidate,
    phase: null,
    budget: {
      attempt: 1, callsSpent: 1, callsReserved: 0,
      correctionsAuto: 0, correctionsOwner: 0, ownerReentries: 0,
      allowance: { auto: 1, owner: 1, ownerReentries: 1 }, ceiling: 5,
    },
    ceilingGrants: [], model: null, lastActivityAt: AT, lastActivity: "candidate completed",
    nextAction: "review", gatesPass: true, requiredReviewPresent: false, journeyApproved: false,
    protectedApprovalsValid: true, process: null, landingApproval: null, blocker: null,
    revision: 1, lastSourceSeq: 1,
  };
  let source = await persistAttempt(sourceDir, null, {
    kind: "attempt.created", next: initial,
    evidence: {
      type: "agent", phaseId: "source-session:builder", agent: "builder", adapterId: "codex",
      provider: "openai-codex", color: null, requestedModel: "source-builder", resolvedModel: "source-builder",
      modelProvenance: "route-attributed", contextWindow: null, usageAuthority: "none",
      usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, reasoningRelation: "unknown" },
      contextTokens: null, costUsd: null, costAuthority: "unavailable", purpose: "build", at: AT,
    },
  });
  source = await persistAttempt(sourceDir, source.revision, {
    kind: "attempt.transitioned",
    next: nextRevision(source, {
      lifecycleState: "BLOCKED",
      blocker: { code: "review-unavailable", detail: "generic retained candidate", ahead: null, behind: null },
      lastActivity: "generic review failure retained the candidate",
    }),
    evidence: {
      type: "transition", id: "source-l7", seq: 1, from: "RUNNING", to: "GATING", actor: "host",
      edgeId: "L7", reasonSource: "git", reasonCode: null, reasonDetail: null, spawnSite: false, at: AT,
    },
  });
  return { stateRoot, sourceDir, repository, candidate, source };
}

test("a generic blocked candidate enters only a distinct continuation, fails fresh gates without provider spend, and leaves source bytes untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-adoption-"));
  try {
    const fixture = await sourceFixture(root);
    const before = {
      journal: readFileSync(journalFilePath(fixture.sourceDir)),
      status: readFileSync(statusFilePath(fixture.sourceDir)),
    };
    const loaded = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
    const config: AwsfConfig = {
      ...loaded,
      runtime: { ...loaded.runtime, seed_paths: [] },
      gates: { test: { argv: ["fixture-test"], timeout_seconds: 1 } },
    };
    const adapters = new Map<string, MetadataOnlyAdapter>();
    const adapterFor = (_entry: unknown, id: string): MetadataOnlyAdapter => {
      const existing = adapters.get(id);
      if (existing !== undefined) return existing;
      const created = new MetadataOnlyAdapter(id, id === "claude" ? "anthropic" : "openai-codex");
      adapters.set(id, created);
      return created;
    };
    const lines: string[] = [];
    const result = await adoptCommand({
      sourceAttemptDir: fixture.sourceDir,
      stateRoot: fixture.stateRoot,
      targetTaskId: "generic-continuation",
      worktreeRoot: join(root, "worktrees"),
      terminal: terminal(lines),
      config,
      configPath: resolve("awsf.config.yaml"),
      infrastructure: {
        adapterFor,
        now: () => AT,
        sessionId: () => "target-session",
        pidIsLive: () => false,
        runCommand: () => ({ status: 1, stdout: `generic gate failed\n${"x".repeat(5_000)}`, stderr: "", error: null }),
      },
    });

    assert.equal(result.confirmed, true);
    assert.equal(result.status?.lifecycleState, "BLOCKED");
    assert.equal(result.status?.candidateSha, fixture.candidate, "the exact immutable candidate is retained");
    assert.equal(result.status?.continuesTask, fixture.source.taskId);
    assert.equal(result.status?.taskId, "generic-continuation");
    assert.equal(result.status?.budget.callsSpent, 0, "fresh gates fail before provider spend");
    assert.equal(result.status?.requiredReviewPresent, false);
    assert.equal(result.status?.journeyApproved, false);
    assert.equal(result.status?.landingApproval, null);
    assert.equal(git(result.status!.worktree!, "rev-parse", "HEAD"), fixture.candidate);
    assert.equal([...adapters.values()].reduce((sum, adapter) => sum + adapter.launches, 0), 0);
    assert.deepEqual(readFileSync(journalFilePath(fixture.sourceDir)), before.journal);
    assert.deepEqual(readFileSync(statusFilePath(fixture.sourceDir)), before.status);
    assert.match(lines.join("\n"), /No source attempt bytes, calls, gates, reviews, journeys, protected approvals, landing approval, or provider session transfer/);

    const targetEvidence = readFileSync(journalFilePath(result.attemptDir!), "utf8");
    assert.match(targetEvidence, /"type":"candidate-adoption"/);
    assert.match(targetEvidence, /"sourceEvidenceCopied":false/);
    assert.match(targetEvidence, /"sourceApprovalsCopied":false/);
    assert.equal(targetEvidence.includes("generic gate failed"), true);
    const testEnvelope = JSON.parse(
      readFileSync(join(result.attemptDir!, "envelopes", "adoption-tests-0.json"), "utf8"),
    ) as { payload: { outputTail: string } };
    assert.equal(testEnvelope.payload.outputTail.length, TEST_OUTPUT_TAIL_MAX_CHARS);
    assert.equal(testEnvelope.payload.outputTail.endsWith("…"), true, "the ellipsis is inside the schema ceiling");
    assert.equal((await readAttempt(result.attemptDir!)).lifecycleState, "BLOCKED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("credential-shaped fresh gate output is rejected before retention, journaling, or review", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-adoption-credential-"));
  try {
    const fixture = await sourceFixture(root);
    const loaded = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
    const config: AwsfConfig = {
      ...loaded,
      runtime: { ...loaded.runtime, seed_paths: [] },
      gates: { test: { argv: ["fixture-test"], timeout_seconds: 1 } },
    };
    const secret = "sk-adoption-secret-123456";
    const adapters = new Map<string, MetadataOnlyAdapter>();
    const result = await adoptCommand({
      sourceAttemptDir: fixture.sourceDir,
      stateRoot: fixture.stateRoot,
      targetTaskId: "credential-continuation",
      worktreeRoot: join(root, "worktrees"),
      terminal: terminal([]),
      config,
      configPath: resolve("awsf.config.yaml"),
      infrastructure: {
        adapterFor: (_entry, id) => {
          const existing = adapters.get(id);
          if (existing !== undefined) return existing;
          const created = new MetadataOnlyAdapter(id, id === "claude" ? "anthropic" : "openai-codex");
          adapters.set(id, created);
          return created;
        },
        now: () => AT,
        sessionId: () => "credential-target-session",
        pidIsLive: () => false,
        runCommand: () => ({ status: 0, stdout: `gate accidentally printed ${secret}\n`, stderr: "", error: null }),
      },
    });

    assert.equal(result.status?.lifecycleState, "BLOCKED");
    assert.equal(result.status?.budget.callsSpent, 0);
    assert.equal(result.status?.requiredReviewPresent, false);
    assert.equal([...adapters.values()].reduce((sum, adapter) => sum + adapter.launches, 0), 0);
    assert.equal(existsSync(join(result.attemptDir!, "raw", "command-adoption-tests-test-0.txt")), false);
    const retained = [
      readFileSync(journalFilePath(result.attemptDir!), "utf8"),
      readFileSync(statusFilePath(result.attemptDir!), "utf8"),
      readFileSync(join(result.attemptDir!, "raw", "host-adoption-tests.txt"), "utf8"),
      readFileSync(join(result.attemptDir!, "envelopes", "adoption-tests-0.json"), "utf8"),
    ].join("\n");
    assert.equal(retained.includes(secret), false);
    assert.match(retained, /configured gate output contains credential-shaped data/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a gates-pass adoption buys a fresh opposite-provider review, then requires a fresh journey and landing authorization", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-adoption-success-"));
  try {
    const fixture = await sourceFixture(root);
    const sourceBefore = {
      journal: readFileSync(journalFilePath(fixture.sourceDir)),
      status: readFileSync(statusFilePath(fixture.sourceDir)),
    };
    const loaded = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
    const config: AwsfConfig = {
      ...loaded,
      runtime: { ...loaded.runtime, seed_paths: [] },
      gates: { test: { argv: ["fixture-test"], timeout_seconds: 1 } },
    };
    const adapters = new Map<string, SuccessfulReviewAdapter>();
    const adopted = await adoptCommand({
      sourceAttemptDir: fixture.sourceDir,
      stateRoot: fixture.stateRoot,
      targetTaskId: "successful-continuation",
      worktreeRoot: join(root, "worktrees"),
      terminal: terminal([]),
      config,
      configPath: resolve("awsf.config.yaml"),
      infrastructure: {
        adapterFor: (_entry, id) => {
          const existing = adapters.get(id);
          if (existing !== undefined) return existing;
          const created = new SuccessfulReviewAdapter(
            id,
            id === "claude" ? "anthropic" : "openai-codex",
            fixture.candidate,
          );
          adapters.set(id, created);
          return created;
        },
        createBroker: fakeBroker,
        sandboxProbe: () => false,
        now: () => AT,
        sessionId: () => "successful-target-session",
        pidIsLive: () => false,
        runCommand: () => ({ status: 0, stdout: "fresh gate passed\n", stderr: "", error: null }),
      },
    });

    assert.equal(adopted.status?.lifecycleState, "AWAITING_OWNER", adopted.status?.blocker?.detail);
    assert.equal(adopted.status?.candidateSha, fixture.candidate);
    assert.equal(adopted.status?.continuesTask, fixture.source.taskId);
    assert.equal(adopted.status?.gatesPass, true);
    assert.equal(adopted.status?.requiredReviewPresent, true);
    assert.equal(adopted.status?.journeyApproved, false, "source journey evidence was not transferred");
    assert.equal(adopted.status?.landingApproval, null, "source landing approval was not transferred");
    assert.equal(adopted.status?.budget.callsSpent, 1, "only the fresh review spends a provider call");
    assert.equal([...adapters.values()].reduce((sum, adapter) => sum + adapter.launches, 0), 1);
    assert.deepEqual(readFileSync(journalFilePath(fixture.sourceDir)), sourceBefore.journal);
    assert.deepEqual(readFileSync(statusFilePath(fixture.sourceDir)), sourceBefore.status);

    const journey = await journeyCommand({
      attemptDir: adopted.attemptDir!,
      terminal: terminal([]),
      journeyId: "adopted-candidate-smoke",
      observedSha: fixture.candidate,
      now: () => AT,
    });
    assert.equal(journey.confirmed, true);
    assert.equal(journey.status.journeyApproved, true);

    const landed = await landCommand({
      attemptDir: adopted.attemptDir!,
      terminal: terminal([]),
      now: () => AT,
    });
    assert.equal(landed.confirmed, true);
    assert.equal(landed.status.lifecycleState, "LANDED");
    assert.equal(landed.status.landingApproval?.candidateSha, fixture.candidate);
    assert.equal(git(fixture.repository, "rev-parse", "HEAD"), fixture.candidate);
    assert.deepEqual(readFileSync(journalFilePath(fixture.sourceDir)), sourceBefore.journal);
    assert.deepEqual(readFileSync(statusFilePath(fixture.sourceDir)), sourceBefore.status);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
