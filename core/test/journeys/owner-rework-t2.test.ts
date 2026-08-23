// `awsf rework` at tier 2 — the reviewer-to-builder loop the tier exists for,
// on scripted adapters, spending no quota.
//
// The fixture is a tier-2 `build-review` attempt at AWAITING_OWNER whose review
// is FULLY evidenced and returned `concern` with a real finding. That is the
// case the T2 rework exists for and the one `awsf review` explicitly refuses:
// the verdict stands, so the remedy is to fix the defect and buy a review of
// the fixed candidate — not to re-roll the opinion.
//
// Every assertion below is about the shape the lifecycle already demanded:
// L19 → L7 → L11 → L15, a review bound to the NEW candidate, and an attestation
// that does not survive a tree it never saw.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
import { AdapterError, reservationIdOf } from "../../src/adapters/interface.ts";
import type { AwsfConfig } from "../../src/config/schema.ts";
import { loadConfig } from "../../src/config/load.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { EnvelopeBase } from "../../src/contracts/envelope-base.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { PlanOutput } from "../../src/contracts/plan-output.ts";
import type { ReviewContext } from "../../src/contracts/review-context.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import type { StoredEnvelope } from "../../src/contracts/stored-envelope.ts";
import type { TestOutput } from "../../src/contracts/test-output.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../src/cli/commands/attempt.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import {
  ReworkHeadroomInsufficient,
  ReworkTierUnsupported,
  reworkCommand,
  type ReworkInfrastructure,
} from "../../src/cli/commands/rework.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import type { BrokerOptions } from "../../src/execution/transport-broker.ts";
import { agentsForSession, gatesForSession, getSession, transitionsForSession } from "../../src/observability/queries.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import type { AttemptEvidence } from "../../src/observability/attempt-evidence.ts";
import { callCeilingsOf } from "../../src/state/tiers.ts";
import { composePromptBundle } from "../../src/workflow/prompt-composition.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";

const AT = "2026-08-16T00:00:00.000Z";
const SOURCE = "core/src/generated.ts";
const DEFECT = "remove the duplicate whitespace before const in core/src/generated.ts";
const SUPERSEDED_SUMMARY = "the recorded review found the duplicate whitespace and returned concern";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function ownerCommit(repository: string, message: string): string {
  execFileSync("git", [
    "-C", repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-m", message,
  ], { stdio: "ignore" });
  return git(repository, "rev-parse", "HEAD");
}

function terminal(answer: boolean, interactive = true, lines: string[] = []): OwnerTerminal {
  return { interactive, write: (line) => { lines.push(line); }, confirm: async () => answer };
}

function configText(commandExit = 0): string {
  return readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", `test: { argv: [node, -e, process.exit(${commandExit})], timeout_seconds: 10 }`)
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "");
}

function plan(request: string): PlanOutput {
  return {
    schema: "awsf.plan-output/v1", producerStatus: "success", summary: request, artifacts: [],
    notesForNextPhase: "Implement only this owner-recorded request in the managed worktree.",
    goals: [request], nonGoals: ["Unrequested changes"],
    implementationSteps: [{ id: "owner-request", title: "Implement the owner-recorded request", files: [], acceptanceCriteria: ["The exact configured host gates pass against the host-created candidate"] }],
    testStrategy: ["test: [\"node\",\"-e\",\"process.exit(0)\"]"],
    risks: [{ risk: "Scope may be underspecified", mitigation: "Fail rather than infer a broader task" }],
    openQuestions: [],
  };
}

function tests(candidateSha: string): TestOutput {
  return {
    schema: "awsf.test-output/v1", producerStatus: "success", summary: "all configured commands passed",
    artifacts: [], notesForNextPhase: "await owner", passed: true, candidateSha,
    commands: [{ gateId: "test", argv: ["node", "-e", "process.exit(0)"], exitCode: 0, durationMs: 4, outputRef: "raw/command-tests-test-0.txt" }],
    failures: [], outputTail: "### test (exit 0)\n",
  };
}

/** A real review of candidate A: evidenced, and it found the defect. */
function supersededReview(candidateSha: string): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: SUPERSEDED_SUMMARY,
    artifacts: [], notesForNextPhase: "owner decides",
    verdict: "concern", reviewedSha: candidateSha,
    findings: [{
      id: "f1", severity: "high", file: SOURCE, line: 1, title: "duplicate whitespace in a declaration",
      detail: "the declaration reads `export  const`, which the gates do not catch",
      evidence: "read from the supplied diff",
    }],
    limitations: ["scripted original review"],
  };
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
  sessionId: string;
  status: AttemptStatus;
}

async function append(world: World, evidence: AttemptEvidence | null, patch: Partial<AttemptStatus> = {}): Promise<void> {
  const current = await readAttempt(world.attemptDir);
  world.status = await persistAttempt(world.attemptDir, current.revision, {
    kind: "attempt.updated", next: nextRevision(current, patch),
    ...(evidence === null ? {} : { evidence }),
  }, world.projection.project);
}

async function world(options: {
  workflow?: "build-review" | "build";
  tier?: 1 | 2;
  callsSpent?: number;
  commandExit?: number;
} = {}): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "awsf-rework-t2-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", "README.md");
  ownerCommit(canonical, "test: seed tier-2 owner rework");

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
  const sharedPrompt = join(root, "prompts/shared/headless-role.md");
  mkdirSync(resolve(sharedPrompt, ".."), { recursive: true });
  writeFileSync(sharedPrompt, readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));

  const projection = createDashboardProjection(stateRoot);
  const workflow = options.workflow ?? "build-review";
  const request = "write one bounded generated source";
  const created = await newCommand({
    stateRoot, project: config.project.slug, taskId: `rework-t2-${workflow}`, repository: canonical,
    request, workflow, tier: options.tier ?? 2, configSnapshotJson: toConfigSnapshotJson(config),
    callCeilings: callCeilingsOf(config.risk.call_ceiling),
    allowance: config.risk.correction_allowance, projectRecord: projection.project,
  });
  const prepared = await startCommand({
    attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project,
  });
  mkdirSync(join(prepared.worktree!, "core", "src"), { recursive: true });
  // The defect the recorded review found, and the one the rework is asked to fix.
  writeFileSync(join(prepared.worktree!, SOURCE), "export  const generated = true;\n");
  git(prepared.worktree!, "add", SOURCE);
  const candidateA = ownerCommit(prepared.worktree!, "feat: add generated source");

  const sessionId = prepared.sessionId;
  const fixture: World = {
    root, stateRoot, canonical, attemptDir: created.attemptDir, config, configPath, projection,
    candidateA, sessionId, status: prepared,
  };
  const phaseId = (key: string): string => `${sessionId}:${key}`;
  const envelope = (key: string, schemaId: string, payload: unknown, raw: string): StoredEnvelope<EnvelopeBase> => ({
    schemaId, envelopeId: `${sessionId}:${key}:0`, sessionId, phaseId: phaseId(key), correctionRound: 0,
    agent: key === "reviewer" ? "reviewer" : key === "builder" ? "builder" : "host",
    valid: true, violations: [], payload, rawOutputPath: raw, createdAt: AT,
  } as unknown as StoredEnvelope<EnvelopeBase>);

  for (const [ordinal, key] of ["request", "builder", "tests", "review-context", "reviewer"].entries()) {
    await append(fixture, {
      type: "phase",
      phase: {
        phaseId: phaseId(key), ordinal: ordinal + 1, key, name: key,
        kind: key === "builder" || key === "reviewer" ? "agent" : key === "request" ? "engineer" : "code",
        owner: key === "builder" ? "builder" : key === "reviewer" ? "reviewer" : "host",
        description: `Retained ${key} evidence of the original run`, status: "SUCCEEDED",
        correctionCount: 0, maxCorrections: 0, errorCode: null, errorMessage: null,
        startedAt: AT, endedAt: AT, createdAt: AT,
      },
    });
  }
  for (const role of ["builder", "reviewer"] as const) {
    const agent = config.agents.find((candidate) => candidate.name === role)!;
    const prompts = await composePromptBundle({ configPath, agent });
    await append(fixture, {
      type: "compiled-prompt", phaseId: phaseId(role), name: "system", text: prompts.systemPrompt,
      lineCount: prompts.systemPrompt.split(/\r?\n/).length, at: AT,
    });
  }
  await append(fixture, { type: "envelope", phaseId: phaseId("request"), envelope: envelope("request", "awsf.plan-output/v1", plan(request), "raw/host-request.txt") });
  const build: BuildOutput = {
    schema: "awsf.build-output/v1", producerStatus: "success", summary: "wrote the bounded source with a duplicate whitespace defect",
    artifacts: [{ path: SOURCE, kind: "source", description: "bounded source" }],
    notesForNextPhase: "host gates", changedFiles: [SOURCE], implementationNotes: ["initial candidate"],
    commandsRun: [], proposedCommitMessage: "feat: add generated source",
  };
  await append(fixture, { type: "envelope", phaseId: phaseId("builder"), envelope: envelope("builder", "awsf.build-output/v1", build, "raw/builder.txt") });
  await append(fixture, { type: "envelope", phaseId: phaseId("tests"), envelope: envelope("tests", "awsf.test-output/v1", tests(candidateA), "raw/host-tests.txt") });
  for (const gateId of ["candidate_hygiene", "commands_pass"] as const) {
    await append(fixture, {
      type: "gate", id: `${phaseId("tests")}:0:${gateId}`, phaseId: phaseId("tests"), round: 0, gateId,
      kind: gateId === "commands_pass" ? "subprocess" : "git", candidateSha: candidateA, passed: true,
      exitCode: 0, checks: [{ item: gateId, ok: true, note: "retained original evidence" }], violations: [],
      outputPath: null, startedAt: AT, endedAt: AT,
    });
  }
  await append(fixture, {
    type: "agent", phaseId: phaseId("builder"), agent: "builder", adapterId: "codex", provider: "openai-codex",
    color: null, requestedModel: "codex:gpt-5.6-sol", resolvedModel: "codex:gpt-5.6-sol", modelProvenance: "route-attributed",
    contextWindow: null, usageAuthority: "provider", usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" },
    contextTokens: 30, costUsd: null, costAuthority: "unavailable", purpose: "worker", at: AT,
  });
  await append(fixture, {
    type: "agent", phaseId: phaseId("reviewer"), agent: "reviewer", adapterId: "claude", provider: "anthropic",
    color: null, requestedModel: "claude:opus", resolvedModel: "claude:opus", modelProvenance: "route-attributed",
    contextWindow: null, usageAuthority: "provider", usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" },
    contextTokens: 10, costUsd: null, costAuthority: "unavailable", purpose: "review", at: AT,
  });
  await append(fixture, { type: "envelope", phaseId: phaseId("reviewer"), envelope: envelope("reviewer", "awsf.review-output/v1", supersededReview(candidateA), "raw/reviewer.txt") });
  // PASSING, deliberately: this review saw the diff, so it is not replaceable
  // by `awsf review` at all. Fixing what it found is the only remedy left, and
  // that is what this command is for.
  await append(fixture, {
    type: "gate", id: `${phaseId("reviewer")}:0:review_evidence_present`, phaseId: phaseId("reviewer"), round: 0,
    gateId: "review_evidence_present", kind: "pure", candidateSha: candidateA, passed: true, exitCode: null,
    checks: [{ item: "review context composed", ok: true, note: "retained original evidence" }],
    violations: [], outputPath: null, startedAt: AT, endedAt: AT,
  });
  await append(fixture, {
    type: "review", phaseId: phaseId("reviewer"), adapterId: "claude", provider: "anthropic",
    verdict: "concern", reviewedSha: candidateA, findingCount: 1, at: AT,
  }, {
    lifecycleState: "AWAITING_OWNER", candidateSha: candidateA,
    budget: { ...prepared.budget, callsSpent: options.callsSpent ?? 2 },
    gatesPass: true, requiredReviewPresent: true, journeyApproved: true, protectedApprovalsValid: true,
    phase: null, lastActivity: "the original review returned concern with one finding",
    nextAction: `run \`awsf rework ${prepared.taskId} "<concrete defect>"\``,
  });

  // The retained artefacts of the original run, written where the runner would
  // have written them so a rework can be proved not to touch them.
  mkdirSync(join(created.attemptDir, "envelopes"), { recursive: true });
  mkdirSync(join(created.attemptDir, "raw"), { recursive: true });
  mkdirSync(join(created.attemptDir, "private", "reviewer"), { recursive: true, mode: 0o700 });
  writeFileSync(join(created.attemptDir, "envelopes", "reviewer-0.json"), JSON.stringify(envelope("reviewer", "awsf.review-output/v1", supersededReview(candidateA), "raw/reviewer.txt")));
  writeFileSync(join(created.attemptDir, "raw", "reviewer.txt"), JSON.stringify(supersededReview(candidateA)), { mode: 0o600 });
  writeFileSync(join(created.attemptDir, "raw", `review-context-${candidateA}.diff`), "the original run's retained diff\n", { mode: 0o600 });
  writeFileSync(join(created.attemptDir, "private", "reviewer", "system-prompt.md"), "original system prompt\n", { mode: 0o600 });
  return fixture;
}

const RETAINED = (attemptDir: string, candidateA: string): readonly string[] => Object.freeze([
  join(attemptDir, "envelopes", "reviewer-0.json"),
  join(attemptDir, "raw", "reviewer.txt"),
  join(attemptDir, "raw", `review-context-${candidateA}.diff`),
  join(attemptDir, "private", "reviewer", "system-prompt.md"),
]);

function snapshot(paths: readonly string[]): Map<string, string> {
  return new Map(paths.map((path) => [path, readFileSync(path, "base64")]));
}

async function cleanup(fixture: World): Promise<void> {
  fixture.projection.close();
  rmSync(fixture.root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Scripted routes. The builder repairs the defect; the reviewer audits whatever
// the host actually committed.
// ---------------------------------------------------------------------------

type ReviewBehaviour = "accept" | "concern" | "stale-sha" | "transport-failure";

class ScriptedBuilder implements HarnessAdapter {
  readonly id = "codex";
  readonly launches: string[];
  readonly prompts: string[];
  constructor(launches: string[], prompts: string[]) {
    this.launches = launches;
    this.prompts = prompts;
  }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return {
      adapter: this.id, provider: "openai-codex", requestedModel: model, contextWindow: null,
      supportsThinking: true, supportsTools: true, supportsImages: false,
      continuity: "none", usageAuthority: "provider", costAuthority: "unavailable",
    };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return {
      executable: "node", argv: ["-e", "", "--append-system-prompt", request.systemPromptPath!],
      cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false,
    };
  }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.launches.push(this.id);
    this.prompts.push(request.prompt);
    writeFileSync(join(request.cwd, SOURCE), "export const generated = true;\n");
    const payload: BuildOutput = {
      schema: "awsf.build-output/v1", producerStatus: "success", summary: "removed the duplicate whitespace",
      artifacts: [{ path: SOURCE, kind: "source", description: "bounded source" }],
      notesForNextPhase: "host gates", changedFiles: [SOURCE], implementationNotes: ["owner defect repaired"],
      commandsRun: [], proposedCommitMessage: "fix: whitespace",
    };
    const runId = registration.runId;
    yield { kind: "run.started", seq: 1, runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId, hostAt: AT, providerAt: null, adapter: this.id, provider: "openai-codex", requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId, hostAt: AT, providerAt: null, text: JSON.stringify(payload) };
    yield { kind: "run.completed", seq: 4, runId, hostAt: AT, providerAt: null, exitCode: 0 };
  }
}

class ScriptedReviewer implements HarnessAdapter {
  readonly id = "claude";
  readonly launches: string[];
  readonly prompts: string[];
  readonly #behaviour: ReviewBehaviour;
  readonly #superseded: string;
  constructor(behaviour: ReviewBehaviour, superseded: string, launches: string[], prompts: string[]) {
    this.#behaviour = behaviour;
    this.#superseded = superseded;
    this.launches = launches;
    this.prompts = prompts;
  }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return {
      adapter: this.id, provider: "anthropic", requestedModel: model, contextWindow: null,
      supportsThinking: true, supportsTools: true, supportsImages: false,
      continuity: "none", usageAuthority: "provider", costAuthority: "unavailable",
    };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return {
      executable: "node", argv: ["-e", "", "--append-system-prompt", request.systemPromptPath!],
      cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false,
    };
  }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.launches.push(this.id);
    this.prompts.push(request.prompt);
    if (this.#behaviour === "transport-failure") throw new AdapterError(this.id, "E_BACKEND_FAILURE", "scripted transport failure");
    // Whatever the host actually committed, read from the tree the reviewer was
    // pointed at rather than from anything the test remembered.
    const reviewed = this.#behaviour === "stale-sha" ? this.#superseded : git(request.cwd, "rev-parse", "HEAD");
    const findings: ReviewOutput["findings"] = this.#behaviour === "concern"
      ? [{
          id: "f2", severity: "medium", file: SOURCE, line: 1,
          title: "generated flag remains unconditional",
          detail: "Callers would still receive the generated path when the feature is disabled.",
          evidence: "`generated` remains assigned `true` without a feature-condition branch.",
        }]
      : [];
    const payload: ReviewOutput = {
      schema: "awsf.review-output/v1", producerStatus: "success", summary: "audited the reworked candidate on disk",
      artifacts: [], notesForNextPhase: "owner decides",
      verdict: findings.length === 0 ? "accept" : "concern", reviewedSha: reviewed,
      findings, limitations: ["scripted rework review"],
    };
    const runId = registration.runId;
    yield { kind: "run.started", seq: 1, runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId, hostAt: AT, providerAt: null, adapter: this.id, provider: "anthropic", requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId, hostAt: AT, providerAt: null, text: JSON.stringify(payload) };
    yield { kind: "usage", seq: 4, runId, hostAt: AT, providerAt: null, usage: { inputTokens: 40, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { kind: "run.completed", seq: 5, runId, hostAt: AT, providerAt: null, exitCode: 0 };
  }
}

function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec) {
      const record = {
        identity: { pid: 4545, pgid: 4545, startIdentity: "fixture:4545", startIdentitySource: "fixture" },
        runId: registration.runId,
        edge: ("edge" in registration ? registration.edge : "L19") as "L19",
        reservationId: reservationIdOf(registration),
        command: [spec.executable, ...spec.argv], cwd: spec.cwd,
      };
      await options.register(record);
      const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
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

interface Scripted {
  readonly launches: string[];
  readonly builderPrompts: string[];
  readonly reviewerPrompts: string[];
  readonly infrastructure: Partial<ReworkInfrastructure>;
}

function scripted(fixture: World, behaviour: ReviewBehaviour = "accept"): Scripted {
  const launches: string[] = [];
  const builderPrompts: string[] = [];
  const reviewerPrompts: string[] = [];
  return {
    launches, builderPrompts, reviewerPrompts,
    infrastructure: {
      adapterFor: (_entry, id) => id === "claude"
        ? new ScriptedReviewer(behaviour, fixture.candidateA, launches, reviewerPrompts)
        : new ScriptedBuilder(launches, builderPrompts),
      createBroker: fakeBroker,
      sandboxProbe: () => false,
    },
  };
}

async function rework(fixture: World, script: Scripted, options: {
  lines?: string[];
  answer?: boolean;
  defect?: string;
  assertAdvancement?: (sessionId: string, to: string) => void;
} = {}) {
  return reworkCommand({
    attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot,
    defect: options.defect ?? DEFECT,
    terminal: terminal(options.answer ?? true, true, options.lines ?? []),
    config: fixture.config, configPath: fixture.configPath,
    projectRecord: fixture.projection.project,
    assertAdvancement: options.assertAdvancement ?? fixture.projection.assertAdvancement,
    assertLaunchProjection: fixture.projection.assertLaunchPermitted,
    infrastructure: script.infrastructure,
  });
}

// ---------------------------------------------------------------------------

test("a T2 rework spends builder plus review and returns to AWAITING_OWNER with a review bound to the new candidate", async () => {
  const fixture = await world();
  const script = scripted(fixture);
  const lines: string[] = [];
  const retained = snapshot(RETAINED(fixture.attemptDir, fixture.candidateA));
  try {
    const before = await readAttempt(fixture.attemptDir);
    const result = await rework(fixture, script, { lines });
    const status = result.status;
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.deepEqual(script.launches, ["codex", "claude"], "one builder call and one review call, in that order");
    assert.equal(status.budget.callsSpent, before.budget.callsSpent + 2, "exactly two calls");
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(status.budget.ownerReentries, 1);

    // The candidate is new, is a child of the superseded one, and is the host's.
    const candidateB = status.candidateSha!;
    assert.notEqual(candidateB, fixture.candidateA);
    assert.equal(git(status.worktree!, "rev-parse", `${candidateB}^`), fixture.candidateA);
    assert.equal(readFileSync(join(status.worktree!, SOURCE), "utf8"), "export const generated = true;\n");
    assert.equal(git(status.worktree!, "status", "--porcelain"), "");

    assert.equal(status.gatesPass, true);
    assert.equal(status.requiredReviewPresent, true, "the reworked candidate carries a review of its own");
    assert.equal(status.journeyApproved, false, "the attestation does not survive a tree the owner never saw");
    assert.match(status.nextAction, /awsf journey /);

    // The review on record is of candidate B, not of the candidate it replaced.
    const reviewEnvelope = JSON.parse(readFileSync(join(fixture.attemptDir, "envelopes", "reviewer-rw1-0.json"), "utf8")) as StoredEnvelope<ReviewOutput>;
    assert.equal(reviewEnvelope.payload?.reviewedSha, candidateB);
    assert.equal(reviewEnvelope.valid, true);

    // The evidence the reviewer was judged against names candidate B, and the
    // measurement nested inside it is of candidate B too — which is what the
    // persisted `TestOutput` envelope exists for.
    const contextEnvelope = JSON.parse(readFileSync(join(fixture.attemptDir, "envelopes", "review-context-rw1-0.json"), "utf8")) as StoredEnvelope<ReviewContext>;
    assert.equal(contextEnvelope.payload?.candidateSha, candidateB);
    assert.equal(contextEnvelope.payload?.baseSha, status.baseSha);
    assert.deepEqual(contextEnvelope.payload?.changedFiles, [SOURCE]);
    assert.equal(contextEnvelope.payload?.testOutput.candidateSha, candidateB);
    assert.equal(contextEnvelope.payload?.testOutput.passed, true);
    const persistedTests = JSON.parse(readFileSync(join(fixture.attemptDir, "envelopes", "owner-rework-1-tests-0.json"), "utf8")) as StoredEnvelope<TestOutput>;
    assert.equal(persistedTests.payload?.candidateSha, candidateB, "the host measurement of the new candidate is retained, not only held in memory");

    // Generation-qualified identities, none of them the superseded review's.
    for (const path of [
      join(fixture.attemptDir, "envelopes", "reviewer-rw1-0.json"),
      join(fixture.attemptDir, "raw", "reviewer-rw1.txt"),
      join(fixture.attemptDir, "raw", "host-review-context-rw1.txt"),
      join(fixture.attemptDir, "raw", `review-context-${candidateB}-rw1.diff`),
      join(fixture.attemptDir, "private", "reviewer-rw1", "system-prompt.md"),
      join(fixture.attemptDir, "private", "owner-rework-1", "system-prompt.md"),
    ]) {
      assert.equal(existsSync(path), true, `rework artefact missing: ${path}`);
    }
    for (const [path, bytes] of retained) {
      assert.equal(readFileSync(path, "base64"), bytes, `the superseded run's ${path} was rewritten`);
    }

    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      const session = getSession(db, status.sessionId);
      assert.equal(session?.lifecycle_state, "AWAITING_OWNER");
      assert.equal(session?.candidate_sha, candidateB);
      assert.equal(session?.review_verdict, "accept");
      // The inversion, read off the projection the pilot's acceptance row reads.
      assert.equal(session?.worker_provider, "openai-codex");
      assert.equal(session?.review_provider, "anthropic");
      assert.deepEqual(
        transitionsForSession(db, status.sessionId).slice(-4).map((row) => row.edge_id),
        ["L19", "L7", "L11", "L15"],
        "the lifecycle's own tier-2 fork, taken end to end",
      );
      const fresh = gatesForSession(db, status.sessionId).filter((gate) => gate.phase_id.endsWith(":reviewer-rw1"));
      const evidence = fresh.find((gate) => gate.gate_id === "review_evidence_present");
      assert.equal(evidence?.passed, 1, "the reviewer was proved to have been given the new candidate's evidence");
      assert.equal(evidence?.candidate_sha, candidateB);
      assert.ok(fresh.some((gate) => gate.gate_id === "verdict_consistent" && gate.passed === 1));
      // The superseded review's own rows are untouched by the replacement's.
      const original = gatesForSession(db, status.sessionId).filter((gate) => gate.phase_id.endsWith(":reviewer"));
      assert.equal(original.length, 1, "one row, still the original's");
      assert.equal(original[0]?.candidate_sha, fixture.candidateA);
      const agents = agentsForSession(db, status.sessionId);
      assert.equal(agents.find((row) => row.agent === "builder")?.call_count, 2, "the original builder call and the rework's");
    } finally { db.close(); }

    assert.ok(lines.some((line) => line.includes("mandatory opposite-provider review")));
  } finally { await cleanup(fixture); }
});

test("the builder gets the defect and the reviewer gets the candidate; neither the defect nor the superseded verdict reaches the reviewer", async () => {
  const fixture = await world();
  const script = scripted(fixture);
  try {
    const result = await rework(fixture, script);
    assert.equal(result.status.lifecycleState, "AWAITING_OWNER", result.status.blocker?.detail);
    const builderPrompt = script.builderPrompts.join("\n");
    const reviewerPrompt = script.reviewerPrompts.join("\n");
    assert.equal(script.builderPrompts.length, 1);
    assert.equal(script.reviewerPrompts.length, 1);
    assert.ok(builderPrompt.includes(DEFECT), "the builder is told exactly what to fix");
    assert.equal(reviewerPrompt.includes(DEFECT), false, "a reviewer told what to find is not a reviewer");
    assert.equal(reviewerPrompt.includes(SUPERSEDED_SUMMARY), false, "the superseded verdict never reaches this review");
    assert.equal(reviewerPrompt.includes("duplicate whitespace in a declaration"), false, "nor does what it found");
    assert.equal(reviewerPrompt.includes(fixture.candidateA), false, "nor the revision it was about");
    assert.ok(reviewerPrompt.includes(result.status.candidateSha!), "the reviewer is given the candidate it must judge");
    assert.ok(reviewerPrompt.includes("write one bounded generated source"), "and the owner's own recorded request");
  } finally { await cleanup(fixture); }
});

test("insufficient headroom for builder plus review plus retry is refused before anything is spent", async () => {
  // Five calls, three spent: two remain, and this rework needs three. Refusing
  // first is what keeps the builder's call from being spent on a candidate the
  // attempt could not afford to have reviewed.
  const fixture = await world({ callsSpent: 3 });
  const script = scripted(fixture);
  try {
    const before = await readAttempt(fixture.attemptDir);
    await assert.rejects(rework(fixture, script), (error: Error) =>
      error instanceof ReworkHeadroomInsufficient && /insufficient headroom/.test(error.message) && /awsf raise /.test(error.message));
    const status = await readAttempt(fixture.attemptDir);
    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    assert.equal(status.revision, before.revision, "nothing was written");
    assert.equal(status.budget.callsSpent, 3);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(status.budget.ownerReentries, 0);
    assert.equal(status.candidateSha, fixture.candidateA);
    assert.deepEqual(script.launches, [], "no provider ran");
  } finally { await cleanup(fixture); }
});

test("a review that names the superseded revision never reaches the owner, so the reworked candidate cannot land", async () => {
  const fixture = await world();
  const script = scripted(fixture, "stale-sha");
  try {
    const result = await rework(fixture, script);
    const status = result.status;
    assert.equal(status.lifecycleState, "REVIEWING", "an inconsistent verdict is content; the host invents no terminal state for it");
    assert.equal(status.blocker?.code, "review-inconsistent");
    assert.equal(status.requiredReviewPresent, false, "and the landing guard is never handed a review of another tree");
    assert.notEqual(status.candidateSha, fixture.candidateA, "the reworked candidate is retained");
    assert.equal(status.budget.callsSpent, 4);
    assert.equal(status.budget.callsReserved, 0);
    assert.match(status.nextAction, /awsf cancel /);
    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      const rows = gatesForSession(db, status.sessionId).filter((gate) => gate.phase_id.endsWith(":reviewer-rw1"));
      assert.ok(rows.some((gate) => gate.gate_id === "verdict_consistent" && gate.passed === 0), "the failed gate is on record");
      assert.equal(transitionsForSession(db, status.sessionId).slice(-1)[0]?.edge_id, "L11");
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

test("a review whose transport fails twice blocks on L17 with the reworked candidate retained", async () => {
  const fixture = await world();
  const script = scripted(fixture, "transport-failure");
  try {
    const result = await rework(fixture, script);
    const status = result.status;
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.blocker?.code, "review-unavailable");
    assert.deepEqual(script.launches, ["codex", "claude", "claude"], "one fixed-route attempt and one retry, never a substitute");
    assert.equal(status.budget.callsSpent, 5, "the two already on record, the builder's, and the review's two");
    assert.equal(status.budget.callsReserved, 0);
    assert.notEqual(status.candidateSha, fixture.candidateA);
    assert.equal(status.process, null);
    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.deepEqual(transitionsForSession(db, status.sessionId).slice(-2).map((row) => row.edge_id), ["L11", "L17"]);
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

test("a concern verdict on the reworked candidate still returns to the owner, who decides", async () => {
  const fixture = await world();
  const script = scripted(fixture, "concern");
  try {
    const result = await rework(fixture, script);
    assert.equal(result.status.lifecycleState, "AWAITING_OWNER", result.status.blocker?.detail);
    assert.equal(result.status.requiredReviewPresent, true);
    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.equal(getSession(db, result.status.sessionId)?.review_verdict, "concern");
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

test("a declined tier-2 rework spends nothing and a tier that its workflow does not declare is still refused", async () => {
  const declined = await world();
  const declinedScript = scripted(declined);
  try {
    const before = await readAttempt(declined.attemptDir);
    const result = await rework(declined, declinedScript, { answer: false });
    assert.equal(result.confirmed, false);
    const status = await readAttempt(declined.attemptDir);
    assert.equal(status.revision, before.revision);
    assert.equal(status.budget.callsSpent, 2);
    assert.deepEqual(declinedScript.launches, []);
  } finally { await cleanup(declined); }

  // A tier-1 recipe recorded against a tier-2 attempt: neither branch is the
  // one this attempt bought, and the fork is not relaxed to guess.
  const mismatched = await world({ workflow: "build", tier: 2 });
  const mismatchedScript = scripted(mismatched);
  try {
    await assert.rejects(rework(mismatched, mismatchedScript), ReworkTierUnsupported);
    assert.equal((await readAttempt(mismatched.attemptDir)).lifecycleState, "AWAITING_OWNER");
    assert.deepEqual(mismatchedScript.launches, []);
  } finally { await cleanup(mismatched); }
});
