// `awsf review` — one owner-authorized replacement review of an unchanged
// candidate, on scripted adapters, spending no quota.
//
// The fixture is a tier-2 attempt whose recorded review carries NO
// `review_evidence_present` row: the legacy class the edge exists to migrate,
// and the class the retained pilot attempt is in. Every refusal below is
// asserted to cost nothing and to leave AWAITING_OWNER exactly where it was.

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
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { PlanOutput } from "../../src/contracts/plan-output.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import type { TestOutput } from "../../src/contracts/test-output.ts";
import type { EnvelopeBase } from "../../src/contracts/envelope-base.ts";
import type { StoredEnvelope } from "../../src/contracts/stored-envelope.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../src/cli/commands/attempt.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { main } from "../../src/cli/main.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { CeilingRaiseNotInteractive, raiseCommand } from "../../src/cli/commands/raise.ts";
import {
  CANDIDATE_LOSS_WARNING,
  CONTRACT_RETRY_HEADING,
  ReviewCandidateMoved,
  ReviewHeadroomInsufficient,
  ReviewNotReplaceable,
  ReviewReasonRequired,
  ReviewRouteMismatch,
  reviewCommand,
  type ReviewInfrastructure,
} from "../../src/cli/commands/review.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import type { BrokerOptions } from "../../src/execution/transport-broker.ts";
import { CorrectionAllowanceExhausted, InteractiveOwnerRequired } from "../../src/state/errors.ts";
import { InvalidReviewInversion } from "../../src/workflow/review-routing.ts";
import { gatesForSession, getSession, transitionsForSession } from "../../src/observability/queries.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import type { AttemptEvidence } from "../../src/observability/attempt-evidence.ts";
import { callCeilingsOf } from "../../src/state/tiers.ts";
import { composePromptBundle } from "../../src/workflow/prompt-composition.ts";
import { PromptCompositionMismatch } from "../../src/cli/commands/review-record.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";

const AT = "2026-08-14T00:00:00.000Z";
const SOURCE = "core/src/generated.ts";
const REASON = "the recorded review saw no diff and states it inspected no source file";

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

function configText(): string {
  return readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", "test: { argv: [node, -e, process.exit(0)], timeout_seconds: 10 }")
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

function unevidencedReview(candidateSha: string): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success",
    summary: "accepted without inspecting the candidate", artifacts: [],
    notesForNextPhase: "owner decides", verdict: "accept", reviewedSha: candidateSha, findings: [],
    limitations: ["No diff, patch, or changed-file list was supplied to this phase; I inspected no source file"],
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
  candidate: string;
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

/**
 * A tier-2 attempt at AWAITING_OWNER whose review is structurally unevidenced.
 *
 * The retained review artefacts are written to disk exactly as the runner would
 * have written them, so a replacement can be proved not to have touched them.
 */
async function world(options: {
  workflow?: "build-review" | "simple-sdlc";
  callsSpent?: number;
  evidenceGate?: "absent" | "passed" | "failed";
  configure?: (config: AwsfConfig) => AwsfConfig;
  /** Drift the route the SUPERSEDED review is recorded as having run on. */
  recordedReviewRoute?: { adapterId?: string; requestedModel?: string };
} = {}): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "awsf-replacement-review-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", "README.md");
  ownerCommit(canonical, "test: seed replacement review");

  const text = configText();
  const config = (options.configure ?? ((value: AwsfConfig) => value))(loadConfig(text));
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
    stateRoot, project: config.project.slug, taskId: `replacement-${workflow}`, repository: canonical,
    request, workflow, tier: 2, configSnapshotJson: toConfigSnapshotJson(config),
    callCeilings: callCeilingsOf(config.risk.call_ceiling),
    allowance: config.risk.correction_allowance, projectRecord: projection.project,
  });
  const prepared = await startCommand({
    attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project,
  });
  mkdirSync(join(prepared.worktree!, "core", "src"), { recursive: true });
  writeFileSync(join(prepared.worktree!, SOURCE), "export const generated = true;\n");
  git(prepared.worktree!, "add", SOURCE);
  const candidate = ownerCommit(prepared.worktree!, "feat: add generated source");

  const sessionId = prepared.sessionId;
  const world: World = {
    root, stateRoot, canonical, attemptDir: created.attemptDir, config, configPath, projection,
    candidate, sessionId, status: prepared,
  };
  const phaseId = (key: string): string => `${sessionId}:${key}`;
  const envelope = (key: string, schemaId: string, payload: unknown, raw: string): StoredEnvelope<EnvelopeBase> => ({
    schemaId, envelopeId: `${sessionId}:${key}:0`, sessionId, phaseId: phaseId(key), correctionRound: 0,
    agent: key === "reviewer" ? "reviewer" : "host", valid: true, violations: [], payload,
    rawOutputPath: raw, createdAt: AT,
  } as unknown as StoredEnvelope<EnvelopeBase>);

  for (const [ordinal, key] of ["request", "builder", "tests", "review-context", "reviewer"].entries()) {
    await append(world, {
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
    await append(world, {
      type: "compiled-prompt", phaseId: phaseId(role), name: "system", text: prompts.systemPrompt,
      lineCount: prompts.systemPrompt.split(/\r?\n/).length, at: AT,
    });
  }
  await append(world, { type: "envelope", phaseId: phaseId("request"), envelope: envelope("request", "awsf.plan-output/v1", plan(request), "raw/host-request.txt") });
  await append(world, { type: "envelope", phaseId: phaseId("tests"), envelope: envelope("tests", "awsf.test-output/v1", tests(candidate), "raw/host-tests.txt") });
  for (const gateId of ["candidate_hygiene", "commands_pass"] as const) {
    await append(world, {
      type: "gate", id: `${phaseId("tests")}:0:${gateId}`, phaseId: phaseId("tests"), round: 0, gateId,
      kind: gateId === "commands_pass" ? "subprocess" : "git", candidateSha: candidate, passed: true,
      exitCode: 0, checks: [{ item: gateId, ok: true, note: "retained original evidence" }], violations: [],
      outputPath: null, startedAt: AT, endedAt: AT,
    });
  }
  await append(world, {
    type: "agent", phaseId: phaseId("builder"), agent: "builder", adapterId: "codex", provider: "openai-codex",
    color: null, requestedModel: "codex:gpt-5.6-sol", resolvedModel: "codex:gpt-5.6-sol", modelProvenance: "route-attributed",
    contextWindow: null, usageAuthority: "provider", usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" },
    contextTokens: 30, costUsd: null, costAuthority: "unavailable", purpose: "worker", at: AT,
  });
  await append(world, {
    type: "agent", phaseId: phaseId("reviewer"), agent: "reviewer",
    adapterId: options.recordedReviewRoute?.adapterId ?? "claude", provider: "anthropic", color: null,
    requestedModel: options.recordedReviewRoute?.requestedModel ?? "claude:opus",
    resolvedModel: "claude:opus", modelProvenance: "route-attributed",
    contextWindow: null, usageAuthority: "provider", usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" },
    contextTokens: 10, costUsd: null, costAuthority: "unavailable", purpose: "review", at: AT,
  });
  await append(world, { type: "envelope", phaseId: phaseId("reviewer"), envelope: envelope("reviewer", "awsf.review-output/v1", unevidencedReview(candidate), "raw/reviewer.txt") });
  if ((options.evidenceGate ?? "absent") !== "absent") {
    const passed = options.evidenceGate === "passed";
    await append(world, {
      type: "gate", id: `${phaseId("reviewer")}:0:review_evidence_present`, phaseId: phaseId("reviewer"), round: 0,
      gateId: "review_evidence_present", kind: "pure", candidateSha: candidate, passed, exitCode: null,
      checks: [{ item: "review context composed", ok: passed, note: "retained original evidence" }],
      violations: passed ? [] : ["review context composed: absent"], outputPath: null, startedAt: AT, endedAt: AT,
    });
  }
  await append(world, {
    type: "review", phaseId: phaseId("reviewer"), adapterId: "claude", provider: "anthropic",
    verdict: "accept", reviewedSha: candidate, findingCount: 0, at: AT,
  }, {
    lifecycleState: "AWAITING_OWNER", candidateSha: candidate,
    budget: { ...prepared.budget, callsSpent: options.callsSpent ?? 2 },
    gatesPass: true, requiredReviewPresent: true, journeyApproved: false, protectedApprovalsValid: true,
    phase: null, lastActivity: "the original review returned accept with no evidence",
    nextAction: `run \`awsf land ${prepared.taskId}\``,
  });

  // The retained artefacts of the original review, written where the runner
  // would have written them so a replacement can be proved not to touch them.
  mkdirSync(join(created.attemptDir, "envelopes"), { recursive: true });
  mkdirSync(join(created.attemptDir, "raw"), { recursive: true });
  mkdirSync(join(created.attemptDir, "private", "reviewer"), { recursive: true, mode: 0o700 });
  writeFileSync(join(created.attemptDir, "envelopes", "reviewer-0.json"), JSON.stringify(envelope("reviewer", "awsf.review-output/v1", unevidencedReview(candidate), "raw/reviewer.txt")));
  writeFileSync(join(created.attemptDir, "raw", "reviewer.txt"), JSON.stringify(unevidencedReview(candidate)), { mode: 0o600 });
  writeFileSync(join(created.attemptDir, "raw", "host-review-context.txt"), "{}", { mode: 0o600 });
  writeFileSync(join(created.attemptDir, "raw", `review-context-${candidate}.diff`), "the original run's retained diff\n", { mode: 0o600 });
  writeFileSync(join(created.attemptDir, "private", "reviewer", "system-prompt.md"), "original system prompt\n", { mode: 0o600 });
  return world;
}

const RETAINED = (attemptDir: string, candidate: string): readonly string[] => Object.freeze([
  join(attemptDir, "envelopes", "reviewer-0.json"),
  join(attemptDir, "raw", "reviewer.txt"),
  join(attemptDir, "raw", "host-review-context.txt"),
  join(attemptDir, "raw", `review-context-${candidate}.diff`),
  join(attemptDir, "private", "reviewer", "system-prompt.md"),
]);

function snapshot(paths: readonly string[]): Map<string, string> {
  return new Map(paths.map((path) => [path, readFileSync(path, "base64")]));
}

async function cleanup(world: World): Promise<void> {
  world.projection.close();
  rmSync(world.root, { recursive: true, force: true });
}

type Behaviour =
  | "accept"
  | "concern"
  | "malformed"
  /**
   * The shape the retained pilot actually failed in: a review whose substance
   * validated except for one redundant key per finding. The first turn emits
   * `level` alongside `severity`; the retry, recognised by the contract
   * correction in its own prompt, emits the same review without it.
   */
  | "malformed-then-valid"
  | "stale-sha"
  | "missing-artifact"
  | "writes"
  | "transport-failure"
  | "quota-exhausted"
  | "move-before-go"
  | "move-after-answer";

class ScriptedReviewAdapter implements HarnessAdapter {
  readonly id: string;
  readonly launches: string[];
  readonly #behaviour: Behaviour;
  readonly #worktree: string;
  readonly #base: () => string;
  readonly #candidate: string;

  constructor(id: string, worktree: string, candidate: string, base: () => string, behaviour: Behaviour, launches: string[]) {
    this.id = id;
    this.#worktree = worktree;
    this.#candidate = candidate;
    this.#base = base;
    this.#behaviour = behaviour;
    this.launches = launches;
  }

  async isAvailable(): Promise<Availability> { return { status: "available" }; }

  async getModelInfo(model: string): Promise<ModelInfo> {
    return {
      adapter: this.id, provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: model,
      contextWindow: null, supportsThinking: true, supportsTools: true, supportsImages: false,
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
    // Before GO, so the pre-GO revalidation is what observes it.
    if (this.#behaviour === "move-before-go") git(this.#worktree, "reset", "--hard", this.#base());
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.launches.push(this.id);
    if (this.#behaviour === "transport-failure") throw new AdapterError(this.id, "E_BACKEND_FAILURE", "scripted transport failure");
    if (this.#behaviour === "quota-exhausted") throw new AdapterError(this.id, "E_QUOTA_EXHAUSTED", "scripted exhaustion; resets later");
    if (this.#behaviour === "writes") writeFileSync(join(this.#worktree, "reviewer-wrote-this.txt"), "not allowed\n");

    const contractRetry = this.#behaviour === "malformed-then-valid";
    // The retry is recognised by the correction in its own prompt, which proves
    // the block actually reached the provider rather than only being composed.
    const correctedTurn = request.prompt.includes(CONTRACT_RETRY_HEADING);
    const findings: ReviewOutput["findings"] = this.#behaviour === "concern" || contractRetry
      ? [{
          id: "f1", severity: "high", file: SOURCE, line: 1,
          title: "generated flag bypasses the configured branch",
          detail: "The gates would accept a path that always returns the generated value.",
          evidence: "`generated` is assigned `true` before the configured branch is checked.",
        }]
      : [];
    const payload: ReviewOutput = {
      schema: "awsf.review-output/v1", producerStatus: "success", summary: "audited the exact candidate on disk",
      artifacts: this.#behaviour === "missing-artifact" ? [{ path: "core/src/never-written.json", kind: "report", description: "a report this review never wrote" }] : [],
      notesForNextPhase: "owner decides",
      verdict: findings.length === 0 ? "accept" : "concern",
      reviewedSha: this.#behaviour === "stale-sha" ? "b".repeat(40) : this.#candidate,
      findings, limitations: ["scripted replacement review"],
    };
    const runId = registration.runId;
    yield { kind: "run.started", seq: 1, runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId, hostAt: AT, providerAt: null, adapter: this.id, provider: "anthropic", requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
    const serialized = contractRetry && !correctedTurn
      ? JSON.stringify({ ...payload, findings: payload.findings.map((finding) => ({ ...finding, level: finding.severity })) })
      : JSON.stringify(payload);
    yield { kind: "text.delta", seq: 3, runId, hostAt: AT, providerAt: null, text: this.#behaviour === "malformed" ? "not-json at all" : serialized };
    yield { kind: "usage", seq: 4, runId, hostAt: AT, providerAt: null, usage: { inputTokens: 40, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { kind: "run.completed", seq: 5, runId, hostAt: AT, providerAt: null, exitCode: 0 };
    // After the answer and after the gates, so only the third revalidation can
    // see it. The tree is CLEAN at a different commit, which is exactly the
    // shape `captureChangeSet` and `assertClean` are both blind to.
    if (this.#behaviour === "move-after-answer") git(this.#worktree, "reset", "--hard", this.#base());
  }
}

function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec) {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
        runId: registration.runId, edge: "L25" as const, reservationId: reservationIdOf(registration),
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

function infra(
  fixture: World,
  behaviour: Behaviour,
  launches: string[] = [],
  createBroker: (options: BrokerOptions) => TransportBroker = fakeBroker,
): Partial<ReviewInfrastructure> {
  return {
    adapterFor: (_entry, id) => new ScriptedReviewAdapter(
      id, fixture.status.worktree!, fixture.candidate,
      () => fixture.status.baseSha!, behaviour, launches,
    ),
    createBroker,
    sandboxProbe: () => false,
  };
}

async function run(fixture: World, behaviour: Behaviour, options: {
  lines?: string[];
  answer?: boolean;
  interactive?: boolean;
  launches?: string[];
  reason?: string;
  config?: AwsfConfig;
  createBroker?: (options: BrokerOptions) => TransportBroker;
} = {}) {
  return reviewCommand({
    attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot,
    reason: options.reason ?? REASON,
    terminal: terminal(options.answer ?? true, options.interactive ?? true, options.lines ?? []),
    config: options.config ?? fixture.config, configPath: fixture.configPath,
    projectRecord: fixture.projection.project,
    assertAdvancement: fixture.projection.assertAdvancement,
    assertLaunchProjection: fixture.projection.assertLaunchPermitted,
    infrastructure: infra(fixture, behaviour, options.launches ?? [], options.createBroker ?? fakeBroker),
  });
}

// ---------------------------------------------------------------------------

test("a replacement review spends exactly one call, runs no builder, and returns the same candidate to the owner", async () => {
  const fixture = await world();
  const launches: string[] = [];
  const lines: string[] = [];
  const retained = snapshot(RETAINED(fixture.attemptDir, fixture.candidate));
  try {
    const before = await readAttempt(fixture.attemptDir);
    const result = await run(fixture, "accept", { launches, lines });
    const status = result.status;
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, before.budget.callsSpent + 1, "exactly one call");
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(status.budget.ownerReentries, 1, "the owner tranche is spent by the authorization");
    assert.deepEqual(launches, ["claude"], "only the reviewer launched; no builder ran and nothing was rebuilt");
    assert.equal(status.candidateSha, fixture.candidate, "the candidate is reused, never rebuilt");
    assert.equal(git(status.worktree!, "rev-parse", "HEAD"), fixture.candidate);
    assert.equal(status.requiredReviewPresent, true);
    assert.equal(status.journeyApproved, false, "the attestation is never touched by a review that changed no tree");

    // Generation-qualified persistence: six identities, none of them the
    // superseded review's.
    for (const path of [
      join(fixture.attemptDir, "envelopes", "reviewer-re1-0.json"),
      join(fixture.attemptDir, "raw", "reviewer-re1.txt"),
      join(fixture.attemptDir, "raw", "host-review-context-re1.txt"),
      join(fixture.attemptDir, "envelopes", "review-context-re1-0.json"),
      join(fixture.attemptDir, "raw", `review-context-${fixture.candidate}-re1.diff`),
      join(fixture.attemptDir, "private", "reviewer-re1", "system-prompt.md"),
    ]) {
      assert.equal(existsSync(path), true, `replacement artefact missing: ${path}`);
    }
    for (const [path, bytes] of retained) {
      assert.equal(readFileSync(path, "base64"), bytes, `the superseded review's ${path} was rewritten`);
    }

    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.equal(getSession(db, status.sessionId)?.review_verdict, "accept");
      assert.deepEqual(transitionsForSession(db, status.sessionId).slice(-2).map((row) => row.edge_id), ["L25", "L15"]);
      const fresh = gatesForSession(db, status.sessionId).filter((gate) => gate.phase_id.endsWith(":reviewer-re1"));
      const evidence = fresh.find((gate) => gate.gate_id === "review_evidence_present");
      assert.equal(evidence?.passed, 1, "the replacement carries the evidence gate the original lacked");
      assert.equal(evidence?.candidate_sha, fixture.candidate);
      assert.ok(fresh.some((gate) => gate.gate_id === "verdict_consistent" && gate.passed === 1));
      const original = gatesForSession(db, status.sessionId).filter((gate) => gate.phase_id.endsWith(":reviewer"));
      assert.equal(original.length, 0, "the superseded review's gate rows are untouched");
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

test("the confirmation prompt states the superseded verdict, its defect, the remaining calls, and what a failure costs", async () => {
  const fixture = await world();
  const lines: string[] = [];
  try {
    const result = await run(fixture, "accept", { lines, answer: false });
    assert.equal(result.confirmed, false);
    const shown = lines.join("\n");
    assert.match(shown, /Superseded review: reviewer returned accept/);
    assert.match(shown, /Evidence defect: evidence-gate-absent/);
    assert.match(shown, /Calls: 2\/5 spent — 3 remain/);
    assert.equal(CANDIDATE_LOSS_WARNING, "if this review fails, the candidate is lost", "D5 fixed the wording, not only the meaning");
    assert.ok(shown.includes(CANDIDATE_LOSS_WARNING), "and it is displayed verbatim");
    assert.match(shown, /leaves AWAITING_OWNER, where it could land, for REVIEWING, where it cannot/);
    assert.match(shown, /L16 and L19 are gone/);
    assert.match(shown, new RegExp(fixture.candidate));

    const status = await readAttempt(fixture.attemptDir);
    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    assert.equal(status.budget.callsSpent, 2, "a decline spends nothing");
    assert.equal(status.budget.ownerReentries, 0);
    assert.equal(status.revision, fixture.status.revision);
  } finally { await cleanup(fixture); }
});

test("a fully evidenced review is not replaceable, and the refusal costs nothing", async () => {
  const fixture = await world({ evidenceGate: "passed" });
  const launches: string[] = [];
  try {
    await assert.rejects(run(fixture, "accept", { launches }), ReviewNotReplaceable);
    const status = await readAttempt(fixture.attemptDir);
    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    assert.equal(status.budget.callsSpent, 2);
    assert.equal(status.budget.ownerReentries, 0);
    assert.equal(status.revision, fixture.status.revision);
    assert.deepEqual(launches, []);
  } finally { await cleanup(fixture); }
});

test("a failed evidence row is replaceable, which is the other half of the two-member enum", async () => {
  const fixture = await world({ evidenceGate: "failed" });
  const lines: string[] = [];
  try {
    const result = await run(fixture, "accept", { lines });
    assert.equal(result.status.lifecycleState, "AWAITING_OWNER", result.status.blocker?.detail);
    assert.match(lines.join("\n"), /Evidence defect: evidence-gate-failed/);
  } finally { await cleanup(fixture); }
});

test("role and shared prompt drift refuse replacement review before confirmation, reservation, or call spend", async () => {
  for (const scenario of ["role", "shared"] as const) {
    const fixture = await world();
    const launches: string[] = [];
    let confirmations = 0;
    try {
      const path = scenario === "role"
        ? join(fixture.root, "prompts/reviewer/system.md")
        : join(fixture.root, "prompts/shared/headless-role.md");
      writeFileSync(path, `${readFileSync(path, "utf8")}induced ${scenario} drift\n`);
      const before = await readAttempt(fixture.attemptDir);
      await assert.rejects(reviewCommand({
        attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, reason: REASON,
        terminal: {
          interactive: true, write: () => {},
          confirm: async () => { confirmations += 1; return true; },
        },
        config: fixture.config, configPath: fixture.configPath,
        projectRecord: fixture.projection.project,
        infrastructure: infra(fixture, "accept", launches, fakeBroker),
      }), PromptCompositionMismatch);
      const after = await readAttempt(fixture.attemptDir);
      assert.equal(after.revision, before.revision, `${scenario}: path-only snapshot equality did not authorize drift`);
      assert.equal(after.budget.callsSpent, before.budget.callsSpent);
      assert.equal(after.budget.callsReserved, 0);
      assert.equal(confirmations, 0);
      assert.deepEqual(launches, []);
    } finally { await cleanup(fixture); }
  }
});

test("every zero-cost refusal leaves AWAITING_OWNER exactly as it was", async () => {
  const scenarios = [
    "blank-reason", "non-tty", "allowance", "config-drift", "model-drift", "adapter-drift",
    "same-provider", "moved-candidate", "dirty-worktree",
  ] as const;
  for (const scenario of scenarios) {
    const fixture = scenario === "same-provider"
      ? await world({ configure: (config) => ({
          ...config,
          agents: config.agents.map((agent) => agent.name === "reviewer"
            ? { ...agent, model: "codex:gpt-5.6-sol", harness: { ...agent.harness, adapter: "codex" } }
            : agent),
        }) })
      : scenario === "model-drift"
        ? await world({ recordedReviewRoute: { requestedModel: "claude:sonnet" } })
        : scenario === "adapter-drift"
          ? await world({ recordedReviewRoute: { adapterId: "antigravity" } })
          : await world();
    const launches: string[] = [];
    try {
      if (scenario === "allowance") {
        await append(fixture, null, { budget: { ...fixture.status.budget, ownerReentries: fixture.status.budget.allowance.ownerReentries } });
      }
      if (scenario === "moved-candidate") git(fixture.status.worktree!, "reset", "--hard", fixture.status.baseSha!);
      if (scenario === "dirty-worktree") writeFileSync(join(fixture.status.worktree!, "dirty.txt"), "dirty\n");
      const before = await readAttempt(fixture.attemptDir);
      const config = scenario === "config-drift"
        ? { ...fixture.config, risk: { ...fixture.config.risk, default: "T2" as const } }
        : fixture.config;
      const action = run(fixture, "accept", {
        launches, config,
        ...(scenario === "blank-reason" ? { reason: "   " } : {}),
        ...(scenario === "non-tty" ? { interactive: false } : {}),
      });
      if (scenario === "blank-reason") await assert.rejects(action, ReviewReasonRequired);
      else if (scenario === "non-tty") await assert.rejects(action, InteractiveOwnerRequired);
      else if (scenario === "allowance") await assert.rejects(action, CorrectionAllowanceExhausted);
      else if (scenario === "config-drift") await assert.rejects(action, /ProductionConfigSnapshotMismatch/);
      else if (scenario === "adapter-drift" || scenario === "model-drift") await assert.rejects(action, ReviewRouteMismatch);
      else if (scenario === "same-provider") await assert.rejects(action, InvalidReviewInversion);
      else if (scenario === "dirty-worktree") await assert.rejects(action, /worktree is not clean/);
      else await assert.rejects(action, ReviewCandidateMoved);

      const after = await readAttempt(fixture.attemptDir);
      assert.equal(after.lifecycleState, "AWAITING_OWNER", scenario);
      assert.equal(after.revision, before.revision, scenario);
      assert.equal(after.budget.callsSpent, 2, scenario);
      assert.equal(after.budget.callsReserved, 0, scenario);
      assert.equal(after.budget.ownerReentries, before.budget.ownerReentries, scenario);
      assert.deepEqual(launches, [], scenario);
    } finally { await cleanup(fixture); }
  }
});

test("a completed simple-sdlc at four spent calls is refused for insufficient headroom", async () => {
  // The ceiling is a T30 experimental control and is not raised to buy this
  // workflow a replacement review. One call of headroom would let the review
  // spend the last one and then strand the attempt when its permitted retry
  // could not be reserved, so the refusal happens before anything is held.
  const fixture = await world({ workflow: "simple-sdlc", callsSpent: 4 });
  const launches: string[] = [];
  try {
    await assert.rejects(run(fixture, "accept", { launches }), (error: Error) =>
      error instanceof ReviewHeadroomInsufficient && /insufficient headroom/.test(error.message));
    const status = await readAttempt(fixture.attemptDir);
    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    assert.equal(status.budget.callsSpent, 4);
    assert.equal(status.budget.ownerReentries, 0);
    assert.deepEqual(launches, []);
  } finally { await cleanup(fixture); }
});

test("an attempt halted at its ceiling resumes after an owner raise, with no configuration-snapshot mismatch", async () => {
  // The pilot's own arithmetic, end to end, and the reason the raise had to be
  // a COMMAND rather than a configuration edit.
  //
  // simple-sdlc at T2: a ceiling of five, four spent, one left — and a
  // replacement review needs two, so the command above refuses and the attempt
  // is stranded holding a candidate it cannot re-review. Raising the ceiling by
  // editing `awsf.config.yaml` would move `toConfigSnapshotJson(config)` away
  // from the snapshot this attempt recorded, and `validateAttempt` compares
  // those two before anything else — so the edit would lock the owner out of
  // the very act it was made to enable. The grant goes on the attempt instead:
  // the config file is byte-identical before and after, the snapshot still
  // matches, and the same command that refused now runs to completion.
  const fixture = await world({ workflow: "simple-sdlc", callsSpent: 4 });
  const launches: string[] = [];
  const raiseLines: string[] = [];
  const RAISE_REASON = "the replacement review needs two calls and one remained";
  try {
    const configBefore = readFileSync(fixture.configPath, "utf8");
    await assert.rejects(run(fixture, "accept", { launches }), ReviewHeadroomInsufficient);
    const halted = await readAttempt(fixture.attemptDir);
    assert.equal(halted.budget.ceiling, 5, "the attempt records the configured T2 ceiling");
    assert.deepEqual(launches, [], "the halt cost nothing");

    // A piped caller cannot take the owner out of a halt.
    await assert.rejects(
      raiseCommand({
        attemptDir: fixture.attemptDir, calls: 2, reason: RAISE_REASON,
        terminal: terminal(true, false), projectRecord: fixture.projection.project,
      }),
      CeilingRaiseNotInteractive,
    );

    const raised = await raiseCommand({
      attemptDir: fixture.attemptDir, calls: 2, reason: RAISE_REASON,
      terminal: terminal(true, true, raiseLines), projectRecord: fixture.projection.project,
    });
    assert.equal(raised.ceiling, 7);
    assert.equal(raised.status.lifecycleState, "AWAITING_OWNER", "the raise moved no lifecycle edge");
    assert.equal(raised.status.budget.callsSpent, 4, "and bought no call");
    assert.deepEqual(raised.status.ceilingGrants.map((grant) => [grant.calls, grant.ceiling, grant.reason]),
      [[2, 7, RAISE_REASON]]);

    // The same command, the same config object, the same file on disk.
    const result = await run(fixture, "accept", { launches });
    assert.equal(result.status.lifecycleState, "AWAITING_OWNER", result.status.blocker?.detail);
    assert.equal(result.status.budget.callsSpent, 5, "the fifth call a ceiling of five could not have paid for");
    assert.equal(result.status.budget.callsReserved, 0);
    assert.equal(result.status.budget.ceiling, 7, "the grant survived the review that spent against it");
    assert.equal(result.status.requiredReviewPresent, true);
    assert.deepEqual(launches, ["claude"], "the reviewer ran exactly once");

    assert.equal(readFileSync(fixture.configPath, "utf8"), configBefore, "no configuration file was edited");
    assert.equal(
      result.status.configSnapshotJson,
      toConfigSnapshotJson(fixture.config),
      "the attempt's recorded snapshot still equals the live effective configuration",
    );

    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      const session = getSession(db, result.status.sessionId);
      assert.equal(session?.call_ceiling, 7, "the projection follows the raise rather than the creation-time number");
      assert.equal(session?.calls_spent, 5);
      const events = db.prepare(
        "SELECT payload_json FROM events WHERE session_id = ? AND type = 'ceiling_grant'",
      ).all(result.status.sessionId) as { payload_json: string }[];
      assert.equal(events.length, 1, "the grant is one auditable row, not a silently changed column");
      assert.deepEqual(JSON.parse(events[0]!.payload_json), {
        calls: 2, from: 5, to: 7, reason: RAISE_REASON, attempt: 1,
      });
      assert.deepEqual(transitionsForSession(db, result.status.sessionId).slice(-2).map((row) => row.edge_id), ["L25", "L15"]);
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

test("a candidate moved between preflight and GO is refused with the call released", async () => {
  const fixture = await world();
  const launches: string[] = [];
  try {
    const result = await run(fixture, "move-before-go", { launches });
    assert.equal(result.status.lifecycleState, "REVIEWING", "durably REVIEWING, nothing spent");
    assert.equal(result.status.budget.callsSpent, 2, "the reservation never reached GO");
    assert.equal(result.status.budget.callsReserved, 0);
    assert.equal(result.status.budget.ownerReentries, 0, "an authorization that bought nothing gives the allowance back");
    assert.equal(result.status.blocker?.code, "candidate-moved");
    assert.match(result.status.blocker?.detail ?? "", /moved between preflight and GO/);
    assert.deepEqual(launches, [], "the child was never started");
  } finally { await cleanup(fixture); }
});

test("a candidate moved between the review and L15 blocks on L17 rather than landing a review of another tree", async () => {
  const fixture = await world();
  try {
    const result = await run(fixture, "move-after-answer");
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.blocker?.code, "review-evidence-invalid");
    assert.match(result.status.blocker?.detail ?? "", /moved between the review and L15/);
    assert.equal(result.status.budget.callsSpent, 3, "the call was genuinely spent");
    assert.equal(result.status.budget.callsReserved, 0);
    assert.equal(result.status.budget.ownerReentries, 1, "a spent call keeps its charge");
  } finally { await cleanup(fixture); }
});

test("a transport failure is retried once on the same route and then blocks with no substitute", async () => {
  const fixture = await world();
  const launches: string[] = [];
  try {
    const result = await run(fixture, "transport-failure", { launches });
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.blocker?.code, "review-unavailable");
    assert.match(result.status.blocker?.detail ?? "", /no substitute was attempted/);
    assert.deepEqual(launches, ["claude", "claude"], "one fixed route, one retry, never the worker's provider");
    assert.equal(result.status.budget.callsSpent, 4, "both attempts genuinely launched, so both are billed");
    assert.equal(result.status.budget.callsReserved, 0);
  } finally { await cleanup(fixture); }
});

test("a malformed replacement spends the held retry, and blocks on L17 only when the retry is malformed too", async () => {
  const fixture = await world();
  const launches: string[] = [];
  try {
    const result = await run(fixture, "malformed", { launches });
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.blocker?.code, "review-malformed");
    // The retry is spent rather than held back: a cold reviewer that failed to
    // speak the contract is exactly what the second call was reserved for, and
    // blocking with it unspent forfeited the candidate for nothing.
    assert.deepEqual(launches, ["claude", "claude"], "one fixed route, one contract retry, never the worker's provider");
    assert.equal(result.status.budget.callsSpent, 4, "both turns genuinely launched, so both are billed");
    assert.equal(result.status.budget.callsReserved, 0);
    // A transport exhaustion says the review was unavailable; this one answered
    // twice and neither answer validated, so it stays classified as malformed.
    assert.doesNotMatch(result.status.blocker?.detail ?? "", /no substitute was attempted/);
    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      const rows = gatesForSession(db, result.status.sessionId)
        .filter((gate) => gate.phase_id.endsWith(":reviewer-re1") && gate.gate_id === "envelope_valid");
      assert.equal(rows.length, 2, "both turns are on the record; the retry does not overwrite the first");
      assert.deepEqual(rows.map((gate) => gate.correction_round).sort(), [0, 1], "gate rows are round-scoped");
      for (const row of rows) assert.equal(row.passed, 0, "the failure is on the record, not only in the blocker");
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

test("a replacement that only broke the envelope contract is recovered by the held retry", async () => {
  const fixture = await world();
  const launches: string[] = [];
  try {
    const before = await readAttempt(fixture.attemptDir);
    const result = await run(fixture, "malformed-then-valid", { launches });
    const status = result.status;
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.blocker, null);
    assert.deepEqual(launches, ["claude", "claude"], "the retry is the same cold route, never a substitute");
    assert.equal(status.budget.callsSpent, before.budget.callsSpent + 2, "the review and its one permitted retry");
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(status.candidateSha, fixture.candidate, "nothing was rebuilt; this is the same tree throughout");
    assert.equal(status.requiredReviewPresent, true);
    assert.equal(status.journeyApproved, false, "a review that changed no tree never touches the attestation");

    // Both turns are retained and distinguishable. The first is the evidence of
    // why a retry happened at all, and an identity collision would have
    // destroyed it silently — the projection writes gate rows
    // `INSERT OR REPLACE` and envelopes `INSERT OR IGNORE`.
    assert.ok(existsSync(join(fixture.attemptDir, "envelopes", "reviewer-re1-0.json")), "the rejected turn is retained");
    assert.ok(existsSync(join(fixture.attemptDir, "envelopes", "reviewer-re1-1.json")), "the accepted turn is its own round");
    const rejected = JSON.parse(readFileSync(join(fixture.attemptDir, "envelopes", "reviewer-re1-0.json"), "utf8")) as StoredEnvelope<EnvelopeBase>;
    const accepted = JSON.parse(readFileSync(join(fixture.attemptDir, "envelopes", "reviewer-re1-1.json"), "utf8")) as StoredEnvelope<EnvelopeBase>;
    assert.equal(rejected.valid, false);
    assert.equal(accepted.valid, true);
    assert.match(JSON.stringify(rejected.violations), /level/, "the redundant key is what the first turn was rejected for");

    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      const envelopeGates = gatesForSession(db, status.sessionId)
        .filter((gate) => gate.phase_id.endsWith(":reviewer-re1") && gate.gate_id === "envelope_valid");
      assert.deepEqual(envelopeGates.map((gate) => [gate.correction_round, gate.passed]).sort(), [[0, 0], [1, 1]]);
      const evidence = gatesForSession(db, status.sessionId)
        .filter((gate) => gate.phase_id.endsWith(":reviewer-re1") && gate.gate_id === "review_evidence_present");
      assert.ok(evidence.length > 0 && evidence.every((gate) => gate.passed === 1),
        "appending the correction does not break the evidence the reviewer had to read");
      assert.equal(getSession(db, status.sessionId)?.review_verdict, "concern");
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

test("a replacement whose declared evidence does not exist blocks on L17 with review-evidence-invalid", async () => {
  const fixture = await world();
  try {
    const result = await run(fixture, "missing-artifact");
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.blocker?.code, "review-evidence-invalid");
    assert.match(result.status.blocker?.detail ?? "", /artifacts_exist/);
    assert.equal(result.status.budget.callsSpent, 3);
  } finally { await cleanup(fixture); }
});

test("an inconsistent verdict does not block: it is content, and the host does not decide what a bad review means", async () => {
  // The one residual named by the design rather than fixed. `verdict_consistent`
  // is deliberately outside L17's vocabulary, so the attempt stays in REVIEWING
  // with its failed gate on the record and the owner decides.
  const fixture = await world();
  try {
    const result = await run(fixture, "stale-sha");
    assert.equal(result.status.lifecycleState, "REVIEWING");
    assert.equal(result.status.blocker?.code, "review-inconsistent");
    assert.match(result.status.nextAction, /awsf cancel/);
    assert.equal(result.status.budget.callsSpent, 3);
    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      const verdict = gatesForSession(db, result.status.sessionId).find((gate) => gate.phase_id.endsWith(":reviewer-re1") && gate.gate_id === "verdict_consistent");
      assert.equal(verdict?.passed, 0);
      assert.match(String(verdict?.violations_json), /reviewed SHA exact/);
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

test("a permission breach by the readonly reviewer is classified explicitly rather than rethrown", async () => {
  const fixture = await world();
  try {
    const result = await run(fixture, "writes");
    assert.equal(result.status.lifecycleState, "REVIEWING", "a policy breach is not a review vocabulary word");
    assert.equal(result.status.blocker?.code, "permission-breach");
    assert.match(result.status.blocker?.detail ?? "", /PermissionBreach/);
    assert.match(result.status.nextAction, /awsf cancel/);
    assert.equal(result.status.budget.callsSpent, 3);
    assert.equal(result.status.budget.callsReserved, 0);
    assert.equal(result.status.process, null);
  } finally { await cleanup(fixture); }
});

test("a crash between L25 and GO releases the call and rewinds the owner re-entry it charged", async () => {
  const fixture = await world();
  const launches: string[] = [];
  let observedDuringLaunch: AttemptStatus | null = null;
  try {
    const result = await run(fixture, "accept", {
      launches,
      createBroker: (options) => ({
        async startProcess(registration, spec) {
          observedDuringLaunch = await readAttempt(fixture.attemptDir);
          await options.register({
            identity: { pid: 4343, pgid: 4343, startIdentity: "fixture:4343", startIdentitySource: "fixture" },
            runId: registration.runId, edge: "L25" as const, reservationId: reservationIdOf(registration),
            command: [spec.executable, ...spec.argv], cwd: spec.cwd,
          });
          throw new Error("fixture host crash before GO");
        },
      }),
    });
    const held = observedDuringLaunch as AttemptStatus | null;
    assert.equal(held?.lifecycleState, "REVIEWING", "L25 is durable before a child can exist");
    assert.equal(held?.budget.callsReserved, 1);
    assert.equal(held?.budget.ownerReentries, 1);

    assert.equal(result.status.lifecycleState, "REVIEWING", "rerunnable rather than blocked");
    assert.equal(result.status.budget.callsSpent, 2, "a provider that never executed never costs a call");
    assert.equal(result.status.budget.callsReserved, 0);
    assert.equal(result.status.budget.ownerReentries, 0, "the tranche charge is rewound");
    assert.equal(result.status.process, null);
    assert.deepEqual(launches, []);
  } finally { await cleanup(fixture); }
});

test("re-running awsf review on a stale reservation reconciles it first, then refuses on the reconciled state", async () => {
  // The cross-process half: a host that died holding the reservation leaves a
  // durable REVIEWING with `callsReserved > 0`, which `awsf retry` refuses to
  // touch. Recovery runs first, and only then does the command refuse.
  const fixture = await world();
  try {
    await append(fixture, {
      type: "transition", id: `${fixture.sessionId}:L25:1`, seq: 1, from: "AWAITING_OWNER", to: "REVIEWING",
      actor: "human", edgeId: "L25", reasonSource: "human", reasonCode: null, reasonDetail: REASON,
      spawnSite: true, at: AT,
    }, {
      lifecycleState: "REVIEWING",
      budget: { ...fixture.status.budget, callsSpent: 2, callsReserved: 1, ownerReentries: 1 },
    });
    await assert.rejects(run(fixture, "accept"), /AlreadyInState|REVIEWING/);
    const status = await readAttempt(fixture.attemptDir);
    assert.equal(status.lifecycleState, "REVIEWING");
    assert.equal(status.budget.callsReserved, 0, "the stale reservation is released");
    assert.equal(status.budget.ownerReentries, 0, "and the charge for a launch that never happened is rewound");
    assert.match(status.lastActivity, /stale L25 reservation/);
  } finally { await cleanup(fixture); }
});

test("the landing screen shows the superseded verdict beside the replacement", async () => {
  const fixture = await world();
  const lines: string[] = [];
  try {
    const replaced = await run(fixture, "accept");
    assert.equal(replaced.status.lifecycleState, "AWAITING_OWNER", replaced.status.blocker?.detail);
    // The journey is deliberately not attested here: L20 must refuse, and the
    // display happens before the refusal, which is the point.
    await assert.rejects(
      landCommand({ attemptDir: fixture.attemptDir, terminal: terminal(true, true, lines), projectRecord: fixture.projection.project }),
      (error: Error) => /end-user journey was not approved/.test(error.message),
    );
    const shown = lines.join("\n");
    assert.match(shown, /Superseded review \(reviewer\): accept — replaceable because evidence-gate-absent/);
    assert.match(shown, /Replacement review \(reviewer-re1\): accept with 0 finding\(s\)/);
  } finally { await cleanup(fixture); }
});

test("the CLI routes awsf review, requires --reason, and reports the declined case", async () => {
  const fixture = await world();
  const errors: string[] = [];
  const out: string[] = [];
  try {
    fixture.projection.close();
    const missing = await main({
      argv: ["review", fixture.status.taskId, "--attempt", "1", "--config", fixture.configPath, "--state-root", fixture.stateRoot],
      cwd: fixture.canonical, terminal: terminal(true), writeOut: (line) => out.push(line), writeError: (line) => errors.push(line),
    });
    assert.equal(missing, 1);
    assert.match(errors.join("\n"), /usage: awsf review <task> --reason/);

    const declined = await main({
      argv: ["review", fixture.status.taskId, "--attempt", "1", "--reason", REASON, "--config", fixture.configPath, "--state-root", fixture.stateRoot],
      cwd: fixture.canonical, terminal: terminal(false), writeOut: (line) => out.push(line), writeError: (line) => errors.push(line),
    });
    assert.equal(declined, 1);
    assert.match(out.join("\n"), /Replacement review declined; state remains AWAITING_OWNER and no call was spent/);
    assert.equal((await readAttempt(fixture.attemptDir)).revision, fixture.status.revision);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a replacement review and an owner rework share the one attempt-scoped allowance", async () => {
  const fixture = await world();
  try {
    const replaced = await run(fixture, "accept");
    assert.equal(replaced.status.budget.ownerReentries, 1);
    // D3's accepted consequence, in the direction this command creates: after a
    // replacement review, an owner re-entry of either kind is exhausted.
    await assert.rejects(run(fixture, "accept"), CorrectionAllowanceExhausted);
  } finally { await cleanup(fixture); }
});
