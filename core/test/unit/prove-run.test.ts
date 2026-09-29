import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
import { isTaskEdgeRegistration, reservationIdOf } from "../../src/adapters/interface.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import { loadConfig } from "../../src/config/load.ts";
import type { AdapterEntry } from "../../src/config/schema.ts";
import { provingGroundItemDigest, type ReplayRecord, type ReviewItem } from "../../src/contracts/proving-ground.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import type { PhaseRouteSelection } from "../../src/contracts/route-selection.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { journeyCommand } from "../../src/cli/commands/journey.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import { runSystemCommand, type BrokerOptions } from "../../src/execution/transport-broker.ts";
import { callCeilingsOf } from "../../src/state/tiers.ts";
import { PROVING_GROUND_DIR } from "../../src/workflow/prove/bind.ts";
import { ReplayNotDeliverable } from "../../src/workflow/prove/compile.ts";

// W18 task 12, the runner half: one review replay from DRAFT to AWAITING_OWNER
// on the fixture route over a two-commit repository, so the pinned base and
// the seed commit are real Git objects. No provider is called. Seeded mode is
// taken, the arm's route is required, and land and journey refuse the replay.

const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];
const ARM = "claude/anthropic/claude:opus@high";
const ARM_ROUTE = { adapter: "claude", provider: "anthropic", model: "claude:opus", effort: "high" } as const;
const REQUEST = "Report the probe's second line.";
const PATCH = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n base\n+seeded\n";
const GATE = ["-e", "process.exit(0)"] as const;

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

/** The shipped config with prove enabled, cut to one offline gate. */
function configText(): string {
  return readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replaceAll("interrupted_turn: true", "interrupted_turn: false")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace(/(\n {4}enabled: \[[^\]]*)\]/u, "$1, prove]")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", `test: { argv: [node, ${GATE[0]}, ${GATE[1]}], timeout_seconds: 10 }`)
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "");
}

function world() {
  const root = mkdtempSync(join(tmpdir(), "awsf-prove-run-"));
  const canonical = join(root, "canonical");
  execFileSync("git", ["init", "-q", "-b", "main", canonical]);
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", ".");
  git(canonical, ...OWNER, "commit", "-q", "-m", "base");
  const baseSha = git(canonical, "rev-parse", "HEAD");
  // The corpus postdates the base, so the replay's worktree cannot hold it.
  const item: ReviewItem = {
    schema: "awsf.proving-ground-item/v1", id: "probe-01", kind: "review", taskClass: "evidence-heavy-defect-review",
    role: "reviewer", baseSha, request: REQUEST,
    seed: { patch: `${PROVING_GROUND_DIR}/probe-01.patch`, defectClass: "off-by-one", expected: [{ file: "README.md", lineStart: 2, lineEnd: 2 }] },
  };
  mkdirSync(join(canonical, PROVING_GROUND_DIR), { recursive: true });
  writeFileSync(join(canonical, PROVING_GROUND_DIR, "probe-01.json"), `${JSON.stringify(item, null, 2)}\n`);
  writeFileSync(join(canonical, item.seed.patch), PATCH);
  git(canonical, "add", ".");
  git(canonical, ...OWNER, "commit", "-q", "-m", "corpus");

  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText());
  const config = loadConfig(configText());
  assert.ok(config.workflows.enabled.includes("prove"), "the fixture config enables prove; the committed one does not");
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      mkdirSync(resolve(join(root, promptPath), ".."), { recursive: true });
      writeFileSync(join(root, promptPath), readFileSync(resolve(promptPath), "utf8"));
    }
  }
  mkdirSync(join(root, "prompts", "shared"), { recursive: true });
  writeFileSync(join(root, "prompts/shared/headless-role.md"), readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));
  const replay: ReplayRecord = {
    itemId: item.id, itemDigest: provingGroundItemDigest(item, new Uint8Array(Buffer.from(PATCH))),
    arm: ARM, repetition: 1, order: 1, baseSha,
  };
  return { root, canonical, stateRoot: join(root, "state"), worktreeRoot: join(root, "worktrees"), config, configPath, baseSha, replay };
}

type World = ReturnType<typeof world>;

function review(worktree: string): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: "reviewed the seeded candidate",
    artifacts: [], notesForNextPhase: "The owner reads the findings.", verdict: "accept",
    reviewedSha: git(worktree, "rev-parse", "HEAD"), findings: [],
    limitations: [{ detail: "Scripted offline review.", affectedFiles: [] }],
  };
}

/** The review route. Any other launch is a defect: a seeded replay builds nothing. */
class ReviewAdapter implements HarnessAdapter {
  readonly id: string;
  readonly #worktree: () => string;
  readonly #launches: string[];
  constructor(id: string, worktree: () => string, launches: string[]) {
    this.id = id; this.#worktree = worktree; this.#launches = launches;
  }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return { adapter: this.id, provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: model, contextWindow: null,
      supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none", usageAuthority: "provider", costAuthority: "unavailable" };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return { executable: "node", argv: ["-e", ""], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false };
  }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    assert.ok(request.prompt.includes("awsf.review-output/v1"), "the only provider call is the review");
    this.#launches.push(`review:${this.id}:${request.model}:${String(request.effort)}`);
    // The reviewer is handed the request and the candidate, and nothing that
    // names the item, its defect or the suite (T11 C5).
    for (const leak of ["probe-01", "off-by-one", "proving-ground"]) assert.equal(request.prompt.includes(leak), false, leak);
    const at = "2026-09-29T00:00:00.000Z";
    yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id,
      provider: "anthropic", requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: JSON.stringify(review(this.#worktree())) };
    yield { kind: "usage", seq: 4, runId: registration.runId, hostAt: at, providerAt: null,
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { kind: "run.completed", seq: 5, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

/** Spends on GO like the real broker, and records every edge it is asked to start. */
function countingBroker(started: string[]) {
  return (options: BrokerOptions): TransportBroker => ({
    async startProcess(registration, spec) {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
        runId: registration.runId, edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
        ...(registration.kind === "agent-phase" ? { phase: { taskSessionId: registration.taskSessionId, workflowId: registration.workflowId,
          phaseId: registration.phaseId, phaseOrdinal: registration.phaseOrdinal, adapterId: registration.adapterId, role: registration.role } } : {}),
        reservationId: reservationIdOf(registration), command: [spec.executable, ...spec.argv], cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
      started.push(isTaskEdgeRegistration(registration) ? `edge ${registration.edge}` : registration.kind);
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
  });
}

const terminal: OwnerTerminal = { interactive: true, write: () => undefined, confirm: async () => true };

/** `awsf new` for a replay, as `awsf prove` will call it (T13), then `awsf start` and the runner. */
async function runReplay(fixture: World, taskId: string, routeOverrides: Readonly<Record<string, PhaseRouteSelection>>) {
  const created = await newCommand({
    stateRoot: fixture.stateRoot, project: fixture.config.project.slug, taskId, repository: fixture.canonical,
    request: REQUEST, workflow: "prove", tier: 2, replay: fixture.replay, routeOverrides,
    configSnapshotJson: toConfigSnapshotJson(fixture.config), callCeilings: callCeilingsOf(fixture.config.risk.call_ceiling),
    allowance: fixture.config.risk.correction_allowance,
  });
  const prepared = await startCommand({
    attemptDir: created.attemptDir, worktreeRoot: fixture.worktreeRoot, configPath: fixture.configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }),
  });
  const launches: string[] = [];
  const brokered: string[] = [];
  const done = await runProductionCommand({
    attemptDir: created.attemptDir, stateRoot: fixture.stateRoot, config: fixture.config, configPath: fixture.configPath,
    infrastructure: {
      adapterFor: (_entry: AdapterEntry, id: string) => new ReviewAdapter(id, () => prepared.worktree!, launches),
      createBroker: countingBroker(brokered), runCommand: runSystemCommand, sandboxProbe: () => false,
    },
  });
  return { attemptDir: created.attemptDir, prepared, done, launches, brokered };
}

test("a review replay starts at its pinned base, seeds one host commit, and is reviewed once on the arm's route", async () => {
  const fixture = world();
  const { attemptDir, prepared, done, launches, brokered } = await runReplay(fixture, "replay-probe", { reviewer: ARM_ROUTE });

  // The worktree starts at the item's base, not at the canonical HEAD that holds the corpus.
  assert.equal(prepared.baseSha, fixture.baseSha);
  assert.notEqual(git(fixture.canonical, "rev-parse", "HEAD"), fixture.baseSha);
  assert.deepEqual(prepared.replay, fixture.replay);

  assert.equal(done.lifecycleState, "AWAITING_OWNER", done.blocker?.detail ?? done.lastActivity);
  // One host commit on the base, holding the patch's bytes and nothing else.
  const worktree = prepared.worktree!;
  assert.equal(git(worktree, "rev-list", "--count", `${fixture.baseSha}..HEAD`), "1");
  assert.equal(git(worktree, "rev-parse", "HEAD^"), fixture.baseSha);
  assert.equal(done.candidateSha, git(worktree, "rev-parse", "HEAD"));
  assert.equal(readFileSync(join(worktree, "README.md"), "utf8"), "base\nseeded\n");
  assert.equal(git(worktree, "log", "-1", "--format=%B"), REQUEST, "the seed commit's message is the request");
  assert.equal(git(worktree, "log", "-1", "--format=%an <%ae>"), "Santiago Marin <santiagomarinsuarez@me.com>");
  assert.equal(git(worktree, "ls-files", PROVING_GROUND_DIR), "", "the replay's tree holds no answer key");

  // One call: the review, on the arm's own route, through L11 and no other edge.
  assert.deepEqual(launches, ["review:claude:claude:opus:high"]);
  assert.deepEqual(brokered, ["edge L11"]);
  assert.equal(done.budget.callsSpent, 1);
  assert.equal(done.budget.callsReserved, 0);
  assert.match(done.nextAction, /awsf cancel replay-probe/);
  assert.doesNotMatch(done.nextAction, /awsf land|awsf journey/);

  const evidence = await readAttemptEvidence(attemptDir);
  const reviewing = evidence.find((entry) => entry.type === "transition" && entry.to === "REVIEWING");
  assert.match(reviewing?.type === "transition" ? reviewing.reasonDetail ?? "" : "", /seeded anthropic review on the replay arm's route/);
  const seed = evidence.find((entry) => entry.type === "phase-accepted" && entry.accepted.phaseKey === "seed");
  assert.equal(seed?.type === "phase-accepted" ? seed.accepted.candidateSha : null, done.candidateSha,
    "the seed is accepted as the phase that produced the candidate");

  // A replay is measurement, never delivery.
  await assert.rejects(landCommand({ attemptDir, terminal }), (error: unknown) =>
    error instanceof ReplayNotDeliverable && /awsf land/.test(error.message) && /awsf cancel replay-probe/.test(error.message));
  await assert.rejects(journeyCommand({ attemptDir, terminal, journeyId: "w18-m4", observedSha: done.candidateSha! }), (error: unknown) =>
    error instanceof ReplayNotDeliverable && /awsf journey/.test(error.message));
  const after = await readAttempt(attemptDir);
  assert.equal(after.lifecycleState, "AWAITING_OWNER");
  assert.equal(after.revision, done.revision, "neither refusal wrote a record");
  assert.notEqual(git(fixture.canonical, "rev-parse", "HEAD"), done.candidateSha, "the canonical branch never moved");
});

test("seeded mode refuses a replay whose reviewer route is not the arm, before any call", async () => {
  const fixture = world();
  const missing = await runReplay(fixture, "replay-unrouted", {});
  assert.equal(missing.done.lifecycleState, "BLOCKED");
  assert.match(missing.done.blocker?.detail ?? "", /^ReplayArmNotRouted: .*--route reviewer=claude\/anthropic\/claude:opus@high; the attempt records no route for it/);
  assert.deepEqual(missing.launches, []);
  assert.deepEqual(missing.brokered, []);
  assert.equal(missing.done.budget.callsSpent, 0);

  const partial = await runReplay(fixture, "replay-partial", { reviewer: { ...ARM_ROUTE, effort: "max" } });
  assert.equal(partial.done.lifecycleState, "BLOCKED");
  assert.match(partial.done.blocker?.detail ?? "", /ReplayArmNotRouted: .*differs in effort/);
  assert.equal(partial.done.budget.callsSpent, 0);
});

test("a prove task is created only with a replay record, and no other workflow carries one", async () => {
  const fixture = world();
  const common = {
    stateRoot: fixture.stateRoot, project: fixture.config.project.slug, repository: fixture.canonical, request: REQUEST,
    configSnapshotJson: toConfigSnapshotJson(fixture.config),
  };
  await assert.rejects(newCommand({ ...common, taskId: "bare-prove", workflow: "prove", tier: 2 }), /requires a replay record, which only `awsf prove` creates/);
  await assert.rejects(newCommand({ ...common, taskId: "stray-replay", workflow: "build-review", tier: 2, replay: fixture.replay }), /cannot carry a replay record/);
  await assert.rejects(newCommand({ ...common, taskId: "bad-replay", workflow: "prove", tier: 2, replay: { ...fixture.replay, order: 0 } }), /invalid replay record/);
});
