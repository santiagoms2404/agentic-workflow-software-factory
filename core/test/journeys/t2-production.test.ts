// The live tier-2 path: a real recipe reaching a provider, the review provider
// chosen by exclusion rather than by configuration, and the two landing facts
// L20 asks for at T2 sourced from evidence instead of constants. Every case here
// runs on scripted adapters and spends no quota.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AwsfConfig, AdapterEntry } from "../../src/config/schema.ts";
import { loadConfig } from "../../src/config/load.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import { AdapterError, isTaskEdgeRegistration, reservationIdOf } from "../../src/adapters/interface.ts";
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
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { journeyCommand, JourneyEvidenceRejected, JourneyNotApplicable } from "../../src/cli/commands/journey.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { compiledPromptEvents, gatesForSession, getSession } from "../../src/observability/queries.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";

const AT = "2026-08-13T00:00:00.000Z";
const SOURCE = "core/src/generated.ts";
const REMOVABLE = "core/src/removable.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function build(): BuildOutput {
  return {
    schema: "awsf.build-output/v1", producerStatus: "success", summary: "wrote one source",
    artifacts: [{ path: SOURCE, kind: "source", description: "bounded source" }],
    notesForNextPhase: "run host commands", changedFiles: [SOURCE],
    implementationNotes: ["fixture implementation"], commandsRun: [], proposedCommitMessage: "feat: add generated source",
  };
}

function review(reviewedSha: string, findings: ReviewOutput["findings"] = []): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: "audited the exact candidate",
    artifacts: [], notesForNextPhase: "owner decides", verdict: findings.length === 0 ? "accept" : "concern",
    reviewedSha, findings, limitations: ["scripted fixture review"],
  };
}

type ReviewBehaviour =
  | { readonly kind: "accept" }
  | { readonly kind: "concern" }
  | { readonly kind: "stale-sha" }
  | { readonly kind: "finding-outside" }
  | { readonly kind: "missing-consequence-once" }
  | { readonly kind: "transport-failure" }
  | { readonly kind: "quota-exhausted" };

/** Records every provider actually contacted, so "no substitute" is observed and not assumed. */
class RouteLog {
  readonly providers: string[] = [];
  readonly launches: string[] = [];
  readonly prompts: string[] = [];
}

/** What the scripted builder does to the tree — an addition, or a removal only. */
type BuilderBehaviour = "adds-a-file" | "deletes-a-file";

class ScriptedT2Adapter implements HarnessAdapter {
  readonly id: string;
  readonly #worktree: string;
  readonly #log: RouteLog;
  readonly #behaviour: ReviewBehaviour;
  readonly #candidateSha: () => string | null;
  readonly #builds: BuilderBehaviour;
  #reviewTurns = 0;

  constructor(
    id: string,
    worktree: string,
    log: RouteLog,
    behaviour: ReviewBehaviour,
    candidateSha: () => string | null,
    builds: BuilderBehaviour = "adds-a-file",
  ) {
    this.id = id;
    this.#worktree = worktree;
    this.#log = log;
    this.#behaviour = behaviour;
    this.#candidateSha = candidateSha;
    this.#builds = builds;
  }

  async isAvailable(): Promise<Availability> { return { status: "available" }; }

  async getModelInfo(model: string): Promise<ModelInfo> {
    return {
      adapter: this.id, provider: this.#provider(), requestedModel: model, contextWindow: null,
      supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none",
      usageAuthority: "provider", costAuthority: "unavailable",
    };
  }

  #provider(): string {
    return this.id === "claude" ? "anthropic" : "openai-codex";
  }

  buildSpec(request: ModelRequest): ProcessSpec {
    return { executable: "node", argv: ["-e", ""], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false };
  }

  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }

  async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    const reviewing = this.id === "claude";
    this.#log.providers.push(this.#provider());
    this.#log.prompts.push(request.prompt);
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.#log.launches.push(this.#provider());

    if (reviewing && this.#behaviour.kind === "transport-failure") {
      throw new AdapterError(this.id, "E_BACKEND_FAILURE", "scripted transport failure");
    }
    if (reviewing && this.#behaviour.kind === "quota-exhausted") {
      throw new AdapterError(this.id, "E_QUOTA_EXHAUSTED", "scripted exhaustion; resets later");
    }

    let payload: BuildOutput | ReviewOutput;
    if (reviewing) {
      const candidate = this.#candidateSha() ?? "0".repeat(40);
      const reviewTurn = this.#reviewTurns++;
      if (this.#behaviour.kind === "stale-sha") payload = review("b".repeat(40));
      else if (this.#behaviour.kind === "finding-outside") {
        payload = review(candidate, [{ id: "f1", severity: "medium", file: "README.md", line: null, title: "unrelated", detail: "about a file this change never touched", evidence: "fixture" }]);
      } else if (this.#behaviour.kind === "concern") {
        payload = review(candidate, [{
          id: "f1", severity: "high", file: SOURCE, line: 1,
          title: "generated flag bypasses the configured branch",
          detail: "The gates would accept a path that always returns the generated value.",
          evidence: "`generated` is assigned `true` before the configured branch is checked.",
        }]);
      } else if (this.#behaviour.kind === "missing-consequence-once") {
        const findings: ReviewOutput["findings"] = Array.from({ length: 6 }, (_, index) => ({
          id: `advisory-${String(index + 1)}`,
          severity: index === 0 ? "medium" as const : "low" as const,
          file: SOURCE,
          line: 1,
          title: index < 2 ? "Polling branch observation" : "Polling branch can slow dashboard requests",
          detail: index < 2 && reviewTurn === 0
            ? "The route reads the ticket set during each configured poll."
            : "The route reads the ticket set during each configured poll, which causes dashboard requests to slow as the set grows.",
          evidence: "`loadTickets` calls `readFile` inside the polling request handler.",
        }));
        payload = { ...review(candidate, findings), verdict: "accept" };
      } else payload = review(candidate);
    } else if (this.#builds === "deletes-a-file") {
      rmSync(join(this.#worktree, REMOVABLE));
      payload = { ...build(), summary: "removed one source", artifacts: [], changedFiles: [REMOVABLE], proposedCommitMessage: "refactor: drop the unused module" };
    } else {
      mkdirSync(join(this.#worktree, "core", "src"), { recursive: true });
      writeFileSync(join(this.#worktree, "core", "src", "generated.ts"), "export const generated = true;\n");
      payload = build();
    }

    const runId = registration.runId;
    yield { kind: "run.started", seq: 1, runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId, hostAt: AT, providerAt: null, adapter: this.id, provider: this.#provider(), requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId, hostAt: AT, providerAt: null, text: JSON.stringify(payload) };
    yield { kind: "usage", seq: 4, runId, hostAt: AT, providerAt: null, usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { kind: "run.completed", seq: 5, runId, hostAt: AT, providerAt: null, exitCode: 0 };
  }
}

function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec) {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
        runId: registration.runId, edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
        ...(registration.kind === "agent-phase" ? { phase: { taskSessionId: registration.taskSessionId, workflowId: registration.workflowId, phaseId: registration.phaseId, phaseOrdinal: registration.phaseOrdinal, adapterId: registration.adapterId, role: registration.role } } : {}),
        reservationId: reservationIdOf(registration), command: [spec.executable, ...spec.argv], cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
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

function configText(): string {
  return readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", "test: { argv: [node, -e, process.exit(0)], timeout_seconds: 10 }")
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "");
}

async function fixture(tier: 1 | 2 = 2, configure: (config: AwsfConfig) => AwsfConfig = (config) => config) {
  const root = mkdtempSync(join(tmpdir(), "awsf-t2-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  // A second seeded file exists so a scripted builder can produce a candidate
  // that only REMOVES lines — the shape a bounded diff is most tempted to lose.
  mkdirSync(join(canonical, "core", "src"), { recursive: true });
  writeFileSync(join(canonical, REMOVABLE), "export const removable = 1;\nexport const alsoRemovable = 2;\n");
  git(canonical, "add", "README.md", REMOVABLE);
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed t2 runner");
  const text = configText();
  const config = configure(loadConfig(text));
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, text);
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      const destination = join(root, promptPath);
      mkdirSync(resolve(destination, ".."), { recursive: true });
      writeFileSync(destination, readFileSync(resolve(promptPath), "utf8"));
    }
  }
  const sharedPrompt = join(root, "prompts/shared/headless-role.md");
  mkdirSync(resolve(sharedPrompt, ".."), { recursive: true });
  writeFileSync(sharedPrompt, readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));
  const projection = createDashboardProjection(stateRoot);
  const created = await newCommand({
    stateRoot, project: config.project.slug, taskId: `fixture-t2-${tier}`, repository: canonical,
    request: "write one bounded source", workflow: "build-review", tier,
    configSnapshotJson: JSON.stringify(config), projectRecord: projection.project,
  });
  await startCommand({
    attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }),
    projectRecord: projection.project,
  });
  return { root, canonical, stateRoot, config, configPath, projection, created };
}

async function runT2(world: Awaited<ReturnType<typeof fixture>>, behaviour: ReviewBehaviour, log = new RouteLog()) {
  const prepared = await readAttempt(world.created.attemptDir);
  let candidate: string | null = null;
  const status = await runProductionCommand({
    attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
    projectRecord: world.projection.project, assertAdvancement: world.projection.assertAdvancement,
    assertLaunchProjection: world.projection.assertLaunchPermitted,
    infrastructure: {
      adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedT2Adapter(id, prepared.worktree!, log, behaviour, () => candidate),
      createBroker: fakeBroker,
      sandboxProbe: () => false,
    },
  });
  candidate = status.candidateSha;
  return { status, prepared, log };
}

/** Re-reads the candidate from the worktree, since the review sees it before the status does. */
function withLiveCandidate(
  world: Awaited<ReturnType<typeof fixture>>,
  behaviour: ReviewBehaviour,
  builds: BuilderBehaviour = "adds-a-file",
) {
  return async () => {
    const prepared = await readAttempt(world.created.attemptDir);
    const log = new RouteLog();
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
      projectRecord: world.projection.project, assertAdvancement: world.projection.assertAdvancement,
      assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedT2Adapter(id, prepared.worktree!, log, behaviour,
          () => { try { return git(prepared.worktree!, "rev-parse", "HEAD"); } catch { return null; } }, builds),
        createBroker: fakeBroker,
        sandboxProbe: () => false,
      },
    });
    return { status, prepared, log };
  };
}

/** The exact user prompt the reviewer phase was compiled with, read back from the projection. */
function reviewerPrompt(stateRoot: string, sessionId: string): string {
  const db = openDatabase(join(stateRoot, "awsf.db"), { readonly: true });
  try {
    const events = compiledPromptEvents(db, `${sessionId}:reviewer`);
    const user = events.find((event) => event.name === "user");
    if (user === undefined) throw new Error("the reviewer phase recorded no compiled user prompt");
    return (JSON.parse(user.payload_json) as { text: string }).text;
  } finally { db.close(); }
}

function terminal(answer: boolean, lines: string[] = []): OwnerTerminal {
  return {
    interactive: true,
    write: (line) => { lines.push(line); },
    confirm: async () => answer,
  };
}

test("a tier-2 build-review reaches the owner with the review provider inverse of the worker", async () => {
  const world = await fixture(2);
  try {
    const { status, log } = await withLiveCandidate(world, { kind: "accept" })();
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, 2, "one builder call plus one review call");
    assert.equal(status.budget.callsReserved, 0);
    assert.deepEqual(log.providers, ["openai-codex", "anthropic"], "the worker builds and the opposite provider reviews");

    assert.equal(status.requiredReviewPresent, true, "the review ran, so the landing guard may see it");
    assert.equal(status.journeyApproved, false, "the owner journey has not happened yet and is never assumed");

    const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
    try {
      const session = getSession(db, status.sessionId);
      assert.equal(session?.worker_provider, "openai-codex", "a review call must not overwrite the worker columns");
      assert.equal(session?.review_provider, "anthropic");
      assert.notEqual(session?.review_provider, session?.worker_provider, "the inversion is provable from one row");
      assert.equal(session?.review_verdict, "accept");
      assert.equal(session?.input_tokens, 20, "usage still accumulates across both sides");

      const verdict = gatesForSession(db, status.sessionId).find((gate) => gate.gate_id === "verdict_consistent");
      assert.ok(verdict, "verdict_consistent must be applied to the review envelope");
      assert.equal(verdict?.passed, 1);
      assert.equal(verdict?.candidate_sha, status.candidateSha, "the review is gated against the exact candidate");
    } finally { db.close(); }
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("an accept review with two incomplete findings is cold-corrected and retains all six findings", async () => {
  const world = await fixture(2);
  try {
    const { status, log } = await withLiveCandidate(world, { kind: "missing-consequence-once" })();
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.requiredReviewPresent, true);
    assert.equal(status.budget.callsSpent, 3, "builder, initial review, and one paid cold correction");
    assert.equal(status.budget.correctionsAuto, 1);
    assert.deepEqual(log.providers, ["openai-codex", "anthropic", "anthropic"]);
    const correctionPrompt = log.prompts.at(-1) ?? "";
    assert.match(correctionPrompt, /Previous response whose substance must be preserved:/);
    assert.match(correctionPrompt, new RegExp(status.candidateSha!));
    for (let index = 1; index <= 6; index += 1) {
      assert.match(correctionPrompt, new RegExp(`advisory-${String(index)}`));
    }
    assert.match(correctionPrompt, /findings state a concrete consequence: missing consequence: advisory-1, advisory-2/);

    const first = JSON.parse(readFileSync(join(world.created.attemptDir, "envelopes", "reviewer-0.json"), "utf8")) as {
      payload: ReviewOutput;
    };
    const corrected = JSON.parse(readFileSync(join(world.created.attemptDir, "envelopes", "reviewer-1.json"), "utf8")) as {
      payload: ReviewOutput;
    };
    assert.equal(first.payload.findings.length, 6);
    assert.equal(corrected.payload.findings.length, 6);
    assert.deepEqual(
      corrected.payload.findings.map((finding) => finding.id),
      first.payload.findings.map((finding) => finding.id),
      "the correction completes the same review rather than replacing its substance",
    );

    const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
    try {
      const rows = gatesForSession(db, status.sessionId, `${status.sessionId}:reviewer`);
      const induced = rows.find((gate) => gate.correction_round === 0 && gate.gate_id === "envelope_valid");
      assert.equal(induced?.passed, 0);
      assert.match(induced?.violations_json ?? "", /missing consequence: advisory-1, advisory-2/);
      const removed = rows.find((gate) => gate.correction_round === 1 && gate.gate_id === "envelope_valid");
      assert.equal(removed?.passed, 1);
      const verdict = rows.find((gate) => gate.correction_round === 1 && gate.gate_id === "verdict_consistent");
      assert.equal(verdict?.passed, 1);
    } finally { db.close(); }
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("the reviewer's compiled prompt carries the request, the changed files, and the diff", async () => {
  // The plan promised a diff-scoped reviewer and the implementation supplied a
  // test-command exit code and a truncated tail: no diff, no file list, no
  // statement of what was asked for. This is that promise, asserted against the
  // exact text the provider was given rather than against the host's intention.
  const world = await fixture(2);
  try {
    const { status } = await withLiveCandidate(world, { kind: "accept" })();
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, 2, "composing evidence is host work and buys no call");

    const prompt = reviewerPrompt(world.stateRoot, status.sessionId);
    assert.ok(prompt.includes("write one bounded source"), "the owner's own request reached the reviewer");
    assert.ok(prompt.includes(SOURCE), "the host-observed changed-file list reached the reviewer");
    assert.ok(prompt.includes(status.candidateSha!), "the candidate under review is named");
    assert.ok(prompt.includes(status.baseSha!), "so is the base it is measured from");
    assert.match(prompt, /@@ -0,0 \+1 @@/, "real diff hunks reached the reviewer");
    assert.ok(prompt.includes("+export const generated = true;"), "and the added line itself");
    assert.ok(prompt.includes("The exact configured host gates pass"), "the acceptance criteria reached it too");

    const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
    try {
      const evidence = gatesForSession(db, status.sessionId).find((gate) => gate.gate_id === "review_evidence_present");
      assert.ok(evidence, "the review phase carries an evidence gate row");
      assert.equal(evidence?.passed, 1);
      assert.equal(evidence?.candidate_sha, status.candidateSha, "bound to the exact candidate");
      assert.match(String(evidence?.checks_json), /serialized into the compiled prompt/);
    } finally { db.close(); }
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("a candidate that only deletes lines shows the reviewer what it removed", async () => {
  // Removal is where the defects hide, and it is what a bounded diff or a
  // changed-file list alone would silently render invisible.
  const world = await fixture(2);
  try {
    const { status } = await withLiveCandidate(world, { kind: "accept" }, "deletes-a-file")();
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);

    const prompt = reviewerPrompt(world.stateRoot, status.sessionId);
    assert.ok(prompt.includes(REMOVABLE), "the removed file is named");
    assert.ok(prompt.includes("-export const removable = 1;"), "and its removed lines are shown");
    assert.equal(prompt.includes("+export const removable = 1;"), false, "a removal is not rendered as an addition");
    assert.match(prompt, /"deletions": 2/, "the host counted what was removed");
    assert.match(prompt, /"insertions": 0/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("the full diff is retained host-private at 0600 and is never handed to the reviewer", async () => {
  const world = await fixture(2);
  try {
    const { status } = await withLiveCandidate(world, { kind: "accept" })();
    const relative = join("raw", `review-context-${status.candidateSha!}.diff`);
    const absolute = join(world.created.attemptDir, relative);
    assert.equal(existsSync(absolute), true, "the complete diff is retained");
    assert.equal(statSync(absolute).mode & 0o777, 0o600, "host-private, like every other raw capture");
    // The digest is what ties the bounded rendering to this file. The PATH is
    // provenance for the host: it resolves against the attempt directory, which
    // the reviewer's own namespace masks, so an absolute one would be both
    // unopenable and a hole in that mask.
    const prompt = reviewerPrompt(world.stateRoot, status.sessionId);
    assert.ok(prompt.includes(relative.split("\\").join("/")), "the reference is recorded as attempt-relative");
    assert.equal(prompt.includes(world.created.attemptDir), false, "no absolute path into the attempt directory");
    assert.ok(prompt.includes(createHash("sha256").update(readFileSync(absolute, "utf8"), "utf8").digest("hex")));
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("a reviewer configured on the worker's own provider blocks before any call is spent", async () => {
  // The reviewer is moved onto the builder's adapter, which is exactly the
  // "soften a routing failure into a same-provider review" D10 forbids.
  const world = await fixture(2, (config) => ({
    ...config,
    agents: config.agents.map((agent) => agent.name === "reviewer"
      ? { ...agent, model: "codex:gpt-5.6-sol", harness: { ...agent.harness, adapter: "codex" } }
      : agent),
  }));
  try {
    const { status, log } = await runT2(world, { kind: "accept" });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.blocker?.code, "phase-abort");
    assert.match(status.blocker?.detail ?? "", /InvalidReviewInversion/);
    assert.equal(status.budget.callsSpent, 0, "a review that cannot happen is never paid for");
    assert.equal(status.budget.callsReserved, 0);
    assert.deepEqual(log.launches, [], "nothing launched");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("an unreachable reviewer blocks after exactly one transport retry, with no substitute", async () => {
  const world = await fixture(2);
  try {
    const { status, log } = await withLiveCandidate(world, { kind: "transport-failure" })();
    assert.equal(status.lifecycleState, "BLOCKED");
    // L17 is the only REVIEWING -> BLOCKED edge. Transport unavailability
    // earns its dedicated code only after the fixed route has failed twice.
    assert.equal(status.blocker?.code, "review-unavailable");
    assert.match(status.blocker?.detail ?? "", /no substitute was attempted/);
    assert.deepEqual(log.providers, ["openai-codex", "anthropic", "anthropic"], "one fixed route, one retry, never the worker's provider again");
    assert.equal(status.budget.callsSpent, 3, "both review attempts genuinely launched, so both are billed");
    assert.equal(status.budget.callsReserved, 0, "a blocked run holds no reservation");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("an exhausted reviewer quota is never retried and settles to a named blocker", async () => {
  const world = await fixture(2);
  try {
    // Quota is structurally not a transport fault, so it earns no retry. The
    // exited review process now settles on L17 instead of leaving a dead
    // REVIEWING status with no process.
    const { status } = await withLiveCandidate(world, { kind: "quota-exhausted" })();
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.blocker?.code, "quota-exhausted");
    assert.match(status.blocker?.detail ?? "", /E_QUOTA_EXHAUSTED/);
    assert.equal(status.budget.callsSpent, 2, "one worker call and one review call; no retry");
    assert.match(status.nextAction, /awsf retry/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

for (const [label, behaviour, violation] of [
  ["names a different tree", { kind: "stale-sha" } as ReviewBehaviour, /reviewed SHA exact/],
  ["finds a defect outside the candidate", { kind: "finding-outside" } as ReviewBehaviour, /finding paths inside candidate context/],
] as const) {
  test(`a review that ${label} fails verdict_consistent and reaches a terminal blocker`, async () => {
    const world = await fixture(2);
    try {
      const { status } = await withLiveCandidate(world, behaviour)();
      assert.equal(status.lifecycleState, "BLOCKED");
      assert.equal(status.blocker?.code, "review-inconsistent");
      assert.match(status.blocker?.detail ?? "", /verdict_consistent/);
      assert.equal(status.journeyApproved, false);
      assert.match(status.nextAction, /awsf retry/);
      const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
      try {
        const verdict = gatesForSession(db, status.sessionId).find((gate) => gate.gate_id === "verdict_consistent");
        assert.equal(verdict?.passed, 0);
        assert.match(String(verdict?.violations_json), violation);
      } finally { db.close(); }
    } finally {
      world.projection.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

test("landing a tier-2 candidate is refused until the owner records the journey, then permitted", async () => {
  const world = await fixture(2);
  try {
    const { status } = await withLiveCandidate(world, { kind: "accept" })();
    assert.equal(status.lifecycleState, "AWAITING_OWNER");

    // The review is present but the journey is not, so L20 must refuse.
    await assert.rejects(
      landCommand({ attemptDir: world.created.attemptDir, terminal: terminal(true), projectRecord: world.projection.project }),
      (error: Error) => /end-user journey was not approved/.test(error.message),
    );

    // A journey against anything other than the exact candidate is rejected.
    await assert.rejects(
      journeyCommand({
        attemptDir: world.created.attemptDir, terminal: terminal(true),
        journeyId: "t2-journey", observedSha: status.baseSha!, projectRecord: world.projection.project,
      }),
      JourneyEvidenceRejected,
    );
    assert.equal((await readAttempt(world.created.attemptDir)).journeyApproved, false);

    // A declined attestation records nothing.
    const declined = await journeyCommand({
      attemptDir: world.created.attemptDir, terminal: terminal(false),
      journeyId: "t2-journey", observedSha: status.candidateSha!, projectRecord: world.projection.project,
    });
    assert.equal(declined.confirmed, false);
    assert.equal((await readAttempt(world.created.attemptDir)).journeyApproved, false);

    const lines: string[] = [];
    const recorded = await journeyCommand({
      attemptDir: world.created.attemptDir, terminal: terminal(true, lines),
      journeyId: "t2-journey", observedSha: status.candidateSha!, projectRecord: world.projection.project,
    });
    assert.equal(recorded.confirmed, true);
    assert.equal(recorded.status.journeyApproved, true);
    assert.ok(lines.some((line) => line.includes(status.candidateSha!)), "the owner is shown the SHA they are attesting to");

    const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
    try {
      const journey = gatesForSession(db, recorded.status.sessionId).find((gate) => gate.gate_id === "journey_passes");
      assert.equal(journey?.passed, 1);
      assert.equal(journey?.gate_kind, "journey");
      assert.equal(journey?.candidate_sha, status.candidateSha);
    } finally { db.close(); }

    const landed = await landCommand({
      attemptDir: world.created.attemptDir, terminal: terminal(true),
      projectRecord: world.projection.project, assertAdvancement: world.projection.assertAdvancement,
    });
    assert.equal(landed.status.lifecycleState, "LANDED");
    assert.equal(git(world.canonical, "rev-parse", "HEAD"), status.candidateSha);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("the journey command refuses a piped owner and a tier that never bought a journey", async () => {
  const world = await fixture(1);
  try {
    await assert.rejects(
      journeyCommand({
        attemptDir: world.created.attemptDir, terminal: { interactive: false, write: () => {}, confirm: async () => true },
        journeyId: "t2-journey", observedSha: "HEAD", projectRecord: world.projection.project,
      }),
      JourneyNotApplicable,
    );
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("a tier-1 attempt may not run a tier-2 recipe", async () => {
  const world = await fixture(1);
  try {
    await assert.rejects(
      runProductionCommand({
        attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
        projectRecord: world.projection.project,
      }),
      (error: Error) => /recipe is tier 2 but the attempt is tier 1/.test(error.message),
    );
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});
