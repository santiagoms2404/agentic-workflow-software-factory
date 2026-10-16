// H17 (B8-03, B8-01): owner rework and the reviewer loop bound a silent
// provider the way the builder loop in production-run.ts always has.
//
// A provider that stays alive and writes nothing used to hold `awsf rework` in
// RUNNING (its builder) or REVIEWING (its T2 review) forever: nothing armed a
// timer and the AbortController each loop made was never aborted, so the
// execution lease and the registered process record stayed held with no
// BLOCKED write. The fixture here is a tier-2 `build-review` attempt at
// AWAITING_OWNER on scripted adapters, spending no quota, with the configured
// silence window cut to its 1 s floor. A silent provider keeps its stdout open
// until the host cancels its transport, which is how a real live child behaves.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  Availability,
  BrokerProcessRegistration,
  HarnessAdapter,
  ModelInfo,
  ModelRequest,
  ProcessSpec,
  ProcessTransport,
  TransportBroker,
} from "../../../src/adapters/interface.ts";
import { reservationIdOf } from "../../../src/adapters/interface.ts";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import type { BuildOutput } from "../../../src/contracts/build-output.ts";
import type { EnvelopeBase } from "../../../src/contracts/envelope-base.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import type { PlanOutput } from "../../../src/contracts/plan-output.ts";
import type { ReviewOutput } from "../../../src/contracts/review-output.ts";
import type { StoredEnvelope } from "../../../src/contracts/stored-envelope.ts";
import type { TestOutput } from "../../../src/contracts/test-output.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { reworkCommand, type ReworkCommandResult, type ReworkInfrastructure } from "../../../src/cli/commands/rework.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import type { BrokerOptions } from "../../../src/execution/transport-broker.ts";
import { callCeilingsOf } from "../../../src/state/tiers.ts";
import { composePromptBundle } from "../../../src/workflow/prompt-composition.ts";
import { k1Request, startUnderK1 } from "../../fixtures/k1-preflight.ts";

const AT = "2026-08-16T00:00:00.000Z";
const SOURCE = "core/src/generated.ts";
const DEFECT = "remove the duplicate whitespace before const in core/src/generated.ts";
/** Far past the 1 s window plus the rest of the act; still RUNNING at this point means unbounded. */
const SETTLE_BOUND_MS = 20_000;

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

function configText(): string {
  // The configured silence window at its schema floor, in the file and the
  // snapshot alike, so the timer is the configured one and not a test knob.
  return readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replace(/silence_timeout_seconds: \d+/u, "silence_timeout_seconds: 1")
    .replaceAll("interrupted_turn: true", "interrupted_turn: false")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", "test: { argv: [node, -e, process.exit(0)], timeout_seconds: 10 }")
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "")
    .replace("  journeys: { argv: [npm, run, test:journeys], timeout_seconds: 2400 }\n", "")
    .replace(/^ {2}traps:.*\n/gmu, "");
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

function testOutput(candidateSha: string): TestOutput {
  return {
    schema: "awsf.test-output/v1", producerStatus: "success", summary: "all configured commands passed",
    artifacts: [], notesForNextPhase: "await owner", passed: true, candidateSha,
    commands: [{ gateId: "test", argv: ["node", "-e", "process.exit(0)"], exitCode: 0, durationMs: 4, outputRef: "raw/command-tests-test-0.txt" }],
    failures: [], outputTail: "### test (exit 0)\n",
  };
}

function concernReview(candidateSha: string): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: "the recorded review found the duplicate whitespace",
    artifacts: [], notesForNextPhase: "owner decides", verdict: "concern", reviewedSha: candidateSha,
    findings: [{
      id: "f1", severity: "high", file: SOURCE, line: 1, title: "duplicate whitespace in a declaration",
      detail: "the declaration reads `export  const`, which the gates do not catch",
      consequence: "a reader of the landed source sees a malformed declaration the gates reported clean",
      evidence: "read from the supplied diff",
    }],
    limitations: [{ detail: "scripted original review", affectedFiles: [] }],
  };
}

interface World {
  root: string;
  stateRoot: string;
  attemptDir: string;
  config: AwsfConfig;
  configPath: string;
  projection: ReturnType<typeof createDashboardProjection>;
}

/** A tier-2 build-review attempt at AWAITING_OWNER whose fully evidenced review returned concern. */
async function world(): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "awsf-silence-b8-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", "README.md");
  ownerCommit(canonical, "test: seed silent-provider rework");

  const text = configText();
  const config = loadConfig(text);
  assert.equal(config.runtime.silence_timeout_seconds, 1, "the fixture runs on a 1 s configured silence window");
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
  const request = k1Request("write one bounded generated source", SOURCE);
  const created = await newCommand({
    stateRoot, project: config.project.slug, taskId: "silence-b8", repository: canonical,
    request, workflow: "build-review", tier: 2, configSnapshotJson: toConfigSnapshotJson(config),
    callCeilings: callCeilingsOf(config.risk.call_ceiling),
    allowance: config.risk.correction_allowance, projectRecord: projection.project,
  });
  const prepared = await startUnderK1({
    attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project,
  });
  mkdirSync(join(prepared.worktree!, "core", "src"), { recursive: true });
  writeFileSync(join(prepared.worktree!, SOURCE), "export  const generated = true;\n");
  git(prepared.worktree!, "add", SOURCE);
  const candidateA = ownerCommit(prepared.worktree!, "feat: add generated source");

  const sessionId = prepared.sessionId;
  const reviewerRole = config.agents.find((agent) => agent.name === "reviewer")!;
  const reviewerOverride = config.routing.phase_routes?.reviewer;
  const reviewAdapter = reviewerOverride?.adapter ?? reviewerRole.harness.adapter;
  const reviewProvider = reviewerOverride?.provider ?? (reviewAdapter === "codex" ? "openai-codex" : "anthropic");
  const reviewModel = reviewerOverride?.model ?? reviewerRole.model;
  const fixture: World = { root, stateRoot, attemptDir: created.attemptDir, config, configPath, projection };
  const append = async (evidence: AttemptEvidence, patch: Partial<AttemptStatus> = {}): Promise<void> => {
    const current = await readAttempt(fixture.attemptDir);
    await persistAttempt(fixture.attemptDir, current.revision, { kind: "attempt.updated", next: nextRevision(current, patch), evidence }, projection.project);
  };
  const phaseId = (key: string): string => `${sessionId}:${key}`;
  const envelope = (key: string, schemaId: string, payload: unknown, raw: string): StoredEnvelope<EnvelopeBase> => ({
    schemaId, envelopeId: `${sessionId}:${key}:0`, sessionId, phaseId: phaseId(key), correctionRound: 0,
    agent: key === "reviewer" ? "reviewer" : key === "builder" ? "builder" : "host",
    valid: true, violations: [], payload, rawOutputPath: raw, createdAt: AT,
  } as unknown as StoredEnvelope<EnvelopeBase>);

  for (const [ordinal, key] of ["request", "builder", "tests", "review-context", "reviewer"].entries()) {
    await append({
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
    await append({
      type: "compiled-prompt", phaseId: phaseId(role), name: "system", text: prompts.systemPrompt,
      lineCount: prompts.systemPrompt.split(/\r?\n/).length, at: AT,
    });
  }
  await append({ type: "envelope", phaseId: phaseId("request"), envelope: envelope("request", "awsf.plan-output/v1", plan(request), "raw/host-request.txt") });
  const build: BuildOutput = {
    schema: "awsf.build-output/v1", producerStatus: "success", summary: "wrote the bounded source with a duplicate whitespace defect",
    artifacts: [{ path: SOURCE, kind: "source", description: "bounded source" }],
    notesForNextPhase: "host gates", changedFiles: [SOURCE], implementationNotes: ["initial candidate"],
    commandsRun: [], proposedCommitMessage: "feat: add generated source",
  };
  await append({ type: "envelope", phaseId: phaseId("builder"), envelope: envelope("builder", "awsf.build-output/v1", build, "raw/builder.txt") });
  await append({ type: "envelope", phaseId: phaseId("tests"), envelope: envelope("tests", "awsf.test-output/v1", testOutput(candidateA), "raw/host-tests.txt") });
  for (const gateId of ["candidate_hygiene", "commands_pass"] as const) {
    await append({
      type: "gate", id: `${phaseId("tests")}:0:${gateId}`, phaseId: phaseId("tests"), round: 0, gateId,
      kind: gateId === "commands_pass" ? "subprocess" : "git", candidateSha: candidateA, passed: true,
      exitCode: 0, checks: [{ item: gateId, ok: true, note: "retained original evidence" }], violations: [],
      outputPath: null, startedAt: AT, endedAt: AT,
    });
  }
  const usage = { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" as const };
  await append({
    type: "agent", phaseId: phaseId("builder"), agent: "builder", adapterId: "codex", provider: "openai-codex",
    color: null, requestedModel: "codex:gpt-5.6-sol", resolvedModel: "codex:gpt-5.6-sol", modelProvenance: "route-attributed",
    contextWindow: null, usageAuthority: "provider", usage, contextTokens: 10, costUsd: null, costAuthority: "unavailable", purpose: "worker", at: AT,
  });
  await append({
    type: "agent", phaseId: phaseId("reviewer"), agent: "reviewer", adapterId: reviewAdapter, provider: reviewProvider,
    color: null, requestedModel: reviewModel, resolvedModel: reviewModel, modelProvenance: "route-attributed",
    contextWindow: null, usageAuthority: "provider", usage, contextTokens: 10, costUsd: null, costAuthority: "unavailable", purpose: "review", at: AT,
  });
  await append({ type: "envelope", phaseId: phaseId("reviewer"), envelope: envelope("reviewer", "awsf.review-output/v1", concernReview(candidateA), "raw/reviewer.txt") });
  await append({
    type: "gate", id: `${phaseId("reviewer")}:0:review_evidence_present`, phaseId: phaseId("reviewer"), round: 0,
    gateId: "review_evidence_present", kind: "pure", candidateSha: candidateA, passed: true, exitCode: null,
    checks: [{ item: "review context composed", ok: true, note: "retained original evidence" }],
    violations: [], outputPath: null, startedAt: AT, endedAt: AT,
  });
  await append({
    type: "review", phaseId: phaseId("reviewer"), adapterId: reviewAdapter, provider: reviewProvider,
    verdict: "concern", reviewedSha: candidateA, findingCount: 1, at: AT,
  }, {
    lifecycleState: "AWAITING_OWNER", candidateSha: candidateA,
    budget: { ...prepared.budget, callsSpent: 2 },
    gatesPass: true, requiredReviewPresent: true, journeyApproved: true, protectedApprovalsValid: true,
    phase: null, lastActivity: "the original review returned concern with one finding",
  });
  return fixture;
}

// ---------------------------------------------------------------------------
// Scripted routes. A silent role launches, then reads a stdout that stays open
// until the host cancels its transport, as a live child that stopped writing
// does. A ref'd interval stands in for that child's open pipe, so the event
// loop stays alive exactly as long as the provider would.
// ---------------------------------------------------------------------------

type Role = "builder" | "reviewer";

interface Script {
  /** Every transport.cancel reason, in order. */
  readonly cancels: string[];
  /** Whether the silent provider saw its signal aborted once its stdout closed. */
  readonly abortedSeen: boolean[];
  /** The lease file, observed while the provider was silent. */
  readonly leaseWhileSilent: boolean[];
  /** Close every still-open fake stdout, so a RED run can finish and clean up. */
  readonly release: () => void;
  readonly infrastructure: Partial<ReworkInfrastructure>;
}

function scripted(fixture: World, silent: Role | null, builderPauseMs = 0): Script {
  const cancels: string[] = [];
  const abortedSeen: boolean[] = [];
  const leaseWhileSilent: boolean[] = [];
  const open = new Set<() => void>();
  // Once released, a later launch (a transport retry) starts already closed.
  let released = false;
  // Deleting the entry being visited does not disturb a Set iteration, so no copy is needed.
  const release = (): void => { released = true; for (const close of open) close(); };

  const fakeBroker = (options: BrokerOptions): TransportBroker => ({
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
      let close!: () => void;
      const closed = new Promise<void>((resolveClosed) => {
        const pipe = setInterval(() => undefined, 1_000);
        close = () => { clearInterval(pipe); open.delete(close); resolveClosed(); };
      });
      open.add(close);
      if (released) close();
      return {
        runId: registration.runId, identity: record.identity,
        stdout: (async function* () { await closed; yield* []; })(), stderr: (async function* () {})(),
        exit: closed.then(() => ({ code: null, signal: "SIGTERM" })),
        cancel: async (reason: string) => {
          cancels.push(reason);
          close();
          return { termSent: true, killSent: false, survivors: [], terminated: true, skipped: null };
        },
      };
    },
  });

  class Scripted implements HarnessAdapter {
    readonly id: "codex" | "claude";
    readonly #provider: string;
    constructor(id: "codex" | "claude") {
      this.id = id;
      this.#provider = id === "codex" ? "openai-codex" : "anthropic";
    }
    async isAvailable(): Promise<Availability> { return { status: "available" }; }
    async getModelInfo(model: string): Promise<ModelInfo> {
      return {
        adapter: this.id, provider: this.#provider, requestedModel: model, contextWindow: null,
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
      const transport = await broker.startProcess(registration, this.buildSpec(request), signal);
      const role: Role = request.prompt.includes('"const": "awsf.review-output/v1"') ? "reviewer" : "builder";
      const runId = registration.runId;
      if (role === silent) {
        leaseWhileSilent.push(existsSync(join(fixture.attemptDir, "execution-lease.json")));
        // Alive and saying nothing: this read ends only when the transport is cancelled.
        for await (const _chunk of transport.stdout) { /* never written */ }
        abortedSeen.push(signal.aborted);
        return;
      }
      let text: string;
      if (role === "builder") {
        writeFileSync(join(request.cwd, SOURCE), "export const generated = true;\n");
        const payload: BuildOutput = {
          schema: "awsf.build-output/v1", producerStatus: "success", summary: "removed the duplicate whitespace",
          artifacts: [{ path: SOURCE, kind: "source", description: "bounded source" }],
          notesForNextPhase: "host gates", changedFiles: [SOURCE], implementationNotes: ["owner defect repaired"],
          commandsRun: [], proposedCommitMessage: "fix: whitespace",
        };
        text = JSON.stringify(payload);
      } else {
        const payload: ReviewOutput = {
          schema: "awsf.review-output/v1", producerStatus: "success", summary: "audited the reworked candidate on disk",
          artifacts: [], notesForNextPhase: "owner decides", verdict: "accept", reviewedSha: git(request.cwd, "rev-parse", "HEAD"),
          findings: [], limitations: [{ detail: "scripted rework review", affectedFiles: [] }],
        };
        text = JSON.stringify(payload);
      }
      // A slow builder pauses under the window between events, and longer than it in total.
      const pause = async (): Promise<void> => { if (role === "builder" && builderPauseMs > 0) await delay(builderPauseMs); };
      yield { kind: "run.started", seq: 1, runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
      await pause();
      yield { kind: "model.resolved", seq: 2, runId, hostAt: AT, providerAt: null, adapter: this.id, provider: this.#provider, requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
      await pause();
      yield { kind: "text.delta", seq: 3, runId, hostAt: AT, providerAt: null, text };
      await pause();
      yield { kind: "run.completed", seq: 4, runId, hostAt: AT, providerAt: null, exitCode: 0 };
    }
  }

  return {
    cancels, abortedSeen, leaseWhileSilent, release,
    infrastructure: {
      adapterFor: (_entry, id) => new Scripted(id === "claude" ? "claude" : "codex"),
      createBroker: fakeBroker,
      sandboxProbe: () => false,
    },
  };
}

/** Run the rework; `null` when it is still running SETTLE_BOUND_MS later (it is then released and drained). */
async function reworkWithin(fixture: World, script: Script): Promise<ReworkCommandResult | null> {
  const pending = reworkCommand({
    attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, defect: DEFECT,
    terminal: { interactive: true, write: () => undefined, confirm: async () => true },
    config: fixture.config, configPath: fixture.configPath,
    projectRecord: fixture.projection.project,
    assertAdvancement: fixture.projection.assertAdvancement,
    assertLaunchProjection: fixture.projection.assertLaunchPermitted,
    infrastructure: script.infrastructure,
  });
  const bound = new AbortController();
  const expired = delay(SETTLE_BOUND_MS, null, { signal: bound.signal }).catch(() => null);
  const settled = await Promise.race([pending, expired]);
  bound.abort();
  if (settled === null) {
    script.release();
    await pending.catch(() => undefined);
  }
  return settled;
}

function transitionEdges(evidence: readonly AttemptEvidence[]): string[] {
  return evidence.flatMap((record) => record.type === "transition" ? [record.edgeId] : []);
}

function cleanup(fixture: World, script: Script): void {
  // A provider that answered is never cancelled, so its stand-in pipe is closed here.
  script.release();
  fixture.projection.close();
  rmSync(fixture.root, { recursive: true, force: true });
}

test("owner rework: a builder that never emits is aborted after the silence window and the attempt takes L8 to BLOCKED", async () => {
  const fixture = await world();
  const script = scripted(fixture, "builder");
  try {
    const result = await reworkWithin(fixture, script);
    assert.notEqual(result, null, `awsf rework was still RUNNING ${String(SETTLE_BOUND_MS)} ms after its builder went silent under a 1 s window`);
    const status = result!.status;
    assert.equal(status.lifecycleState, "BLOCKED", status.blocker?.detail);
    assert.equal(status.blocker?.code, "silence", status.blocker?.detail);
    assert.match(status.blocker!.detail, /configured silence timeout elapsed/u);
    assert.equal(script.cancels[0], "configured silence timeout elapsed", "the timer itself cancels the silent transport");
    assert.deepEqual(script.abortedSeen, [true], "the adapter's signal is aborted, not just its pipe closed");
    const evidence = await readAttemptEvidence(fixture.attemptDir);
    assert.deepEqual(transitionEdges(evidence).slice(-2), ["L19", "L8"]);
  } finally { cleanup(fixture, script); }
});

test("owner rework: the silent builder's lease and process record are released once BLOCKED is written", async () => {
  const fixture = await world();
  const script = scripted(fixture, "builder");
  try {
    const result = await reworkWithin(fixture, script);
    assert.notEqual(result, null, "awsf rework never returned from a silent builder");
    assert.deepEqual(script.leaseWhileSilent, [true], "the lease was held while the builder was silent");
    assert.equal(existsSync(join(fixture.attemptDir, "execution-lease.json")), false, "the execution lease is released");
    const status = await readAttempt(fixture.attemptDir);
    assert.equal(status.process, null, "no process record is left open");
    assert.equal(status.budget.callsReserved, 0, "the spent builder call holds no reservation");
    const evidence = await readAttemptEvidence(fixture.attemptDir);
    const settled = evidence.filter((record) => record.type === "process" && record.phaseId.endsWith(":owner-rework-1"))
      .map((record) => record.type === "process" ? record.status : null);
    assert.equal(settled[0], "REGISTERED");
    assert.ok(settled.length >= 3, `the process record is settled after RUNNING, not left open: ${settled.join(", ")}`);
    assert.notEqual(settled.at(-1), "RUNNING");
  } finally { cleanup(fixture, script); }
});

test("owner rework: a slow builder that keeps emitting inside the window is never cut off, though its turn outlasts the window", async () => {
  const fixture = await world();
  const script = scripted(fixture, null, 600);
  try {
    const result = await reworkWithin(fixture, script);
    assert.notEqual(result, null, "awsf rework never returned");
    const status = result!.status;
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.blocker, null);
    assert.equal(script.cancels.includes("configured silence timeout elapsed"), false, "every event re-arms the window");
    const evidence = await readAttemptEvidence(fixture.attemptDir);
    assert.deepEqual(transitionEdges(evidence).slice(-4), ["L19", "L7", "L11", "L15"]);
  } finally { cleanup(fixture, script); }
});

test("reviewer loop: a T2 rework reviewer that never emits is aborted after the silence window and takes L17 to BLOCKED with its process released", async () => {
  const fixture = await world();
  const script = scripted(fixture, "reviewer");
  try {
    const result = await reworkWithin(fixture, script);
    assert.notEqual(result, null, `awsf rework was still REVIEWING ${String(SETTLE_BOUND_MS)} ms after its reviewer went silent under a 1 s window`);
    const status = result!.status;
    assert.equal(status.lifecycleState, "BLOCKED", status.blocker?.detail);
    assert.equal(status.blocker?.code, "silence", status.blocker?.detail);
    assert.match(status.blocker!.detail, /configured silence timeout elapsed/u);
    assert.equal(script.cancels[0], "configured silence timeout elapsed");
    assert.deepEqual(script.abortedSeen, [true], "one silent turn, aborted; silence earns no transport retry");
    assert.equal(status.process, null);
    assert.equal(status.budget.callsReserved, 0, "no call is left reserved behind the halt");
    assert.equal(existsSync(join(fixture.attemptDir, "execution-lease.json")), false, "the execution lease is released");
    const evidence = await readAttemptEvidence(fixture.attemptDir);
    assert.deepEqual(transitionEdges(evidence).slice(-2), ["L11", "L17"]);
  } finally { cleanup(fixture, script); }
});
