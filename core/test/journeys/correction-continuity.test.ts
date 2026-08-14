// The journey pilot 2 could not take, driven end to end on scripted transports
// at zero provider cost.
//
//   1. a write-capable builder produces candidate A
//   2. the host commits A and runs the configured deterministic commands
//      against that exact SHA
//   3. a command fails, and the host sends the SAME provider session a bounded,
//      actionable correction — the failed command, its exit code, the candidate
//      SHA, and output that still contains the failing test's identity
//   4. the resumed builder fixes the defect without a cold restart, the host
//      creates candidate B, and every gate reruns against B
//   5. only after green gates does the fresh opposite-provider reviewer run
//
// The number that makes this worth building is asserted in the first test:
// `callsSpent` is 2, not 3. The correction cost tokens.
//
// The failure fixture is shaped like the one that actually happened: a red test
// near the BEGINNING of the output followed by a long green tail, so the
// evidence defect cannot regress unnoticed.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  ContinuityEvidence,
  ContinuityRef,
  ContinuityCapableAdapter,
  ModelInfo,
  ModelRequest,
  ObservedProviderSession,
  ProcessSpec,
  TransportBroker,
} from "../../src/adapters/interface.ts";
import { type BrokerOptions } from "../../src/execution/transport-broker.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { publicApiValue } from "../../src/api/responses.ts";
import { gatesForSession, getSession } from "../../src/observability/queries.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";

const AT = "2026-08-13T00:00:00.000Z";
const SOURCE = "core/src/generated.ts";
const MARKER = "FIXED";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

/**
 * The gate command, committed at base so it is not part of any candidate's
 * diff. It prints a TAP run of 240 tests with the failure at index 6 — the
 * pilot's shape inverted on purpose, because a trailing window would have kept a
 * failure at 239 and it is the early one that was lost.
 */
const CHECKER = `import { readFileSync } from "node:fs";
let source = "";
try { source = readFileSync("${SOURCE}", "utf8"); } catch { source = ""; }
const fixed = source.includes("${MARKER}");
const lines = ["TAP version 13"];
for (let index = 1; index <= 240; index += 1) {
  if (index === 6 && !fixed) {
    lines.push("not ok 6 - the fusion pane keeps its scrollback across a resume");
    lines.push("  ---");
    lines.push("  error: |-");
    lines.push("    Expected values to be strictly equal:");
    lines.push("    + actual - expected");
    lines.push("    + 'pane-2'");
    lines.push("    - 'pane-1'");
    lines.push("  code: 'ERR_ASSERTION'");
    lines.push("  ...");
    continue;
  }
  lines.push(\`ok \${index} - a passing assertion with a reasonably long descriptive name\`);
}
lines.push("1..240", "# tests 240", \`# pass \${fixed ? 240 : 239}\`, \`# fail \${fixed ? 0 : 1}\`);
process.stdout.write(lines.join("\\n"));
process.exit(fixed ? 0 : 1);
`;

function build(round: number): BuildOutput {
  return {
    schema: "awsf.build-output/v1",
    producerStatus: "success",
    summary: round === 0 ? "wrote one source" : "corrected the failing assertion in the same session",
    artifacts: [{ path: SOURCE, kind: "source", description: "bounded source" }],
    notesForNextPhase: "run host commands",
    changedFiles: [SOURCE],
    implementationNotes: ["fixture implementation"],
    commandsRun: [],
    proposedCommitMessage: round === 0 ? "feat: add generated source" : "fix: correct the failing assertion",
  };
}

function review(reviewedSha: string): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: "audited the exact candidate",
    artifacts: [], notesForNextPhase: "owner decides", verdict: "accept",
    reviewedSha, findings: [], limitations: ["scripted fixture review"],
  };
}

// ---------------------------------------------------------------------------
// The scripted transports. Continuity is MODELLED, not mocked away: the worker
// records which locator each turn was launched with, and the correction turn
// only produces corrected output if it really re-entered the conversation that
// wrote the first one.
// ---------------------------------------------------------------------------

interface TurnRecord {
  readonly phase: string;
  readonly turn: number;
  readonly providerSessionId: string | null;
  readonly turnKind: "open" | "resume" | undefined;
  readonly prompt: string;
  readonly argv: readonly string[];
  readonly registrationKind: string;
}

class Journal {
  readonly turns: TurnRecord[] = [];
  readonly providers: string[] = [];
  /** Locators the fixture "provider" has actually created sessions for. */
  readonly openedSessions = new Set<string>();
}

type Misbehaviour =
  | { readonly kind: "well-behaved" }
  /** Answers the correction in a DIFFERENT conversation — a cold start in disguise. */
  | { readonly kind: "switched-session" }
  /** Answers the correction on a different model. */
  | { readonly kind: "switched-model" }
  /** The resume transport itself fails. */
  | { readonly kind: "resume-transport-failure" }
  /** Never fixes the defect, so the allowance is what has to stop it. */
  | { readonly kind: "never-fixes" }
  /** "Fixes" the failing command by writing outside the configured globs. */
  | { readonly kind: "breaches-on-correction" };

class ScriptedContinuityAdapter implements ContinuityCapableAdapter {
  readonly id: string;
  readonly supportsSameSessionCorrection = true as const;
  readonly #worktree: string;
  readonly #journal: Journal;
  readonly #misbehaviour: Misbehaviour;
  readonly #candidateSha: () => string | null;
  readonly #workerAdapterId: string;
  #turn = 0;

  constructor(
    id: string,
    worktree: string,
    journal: Journal,
    misbehaviour: Misbehaviour,
    candidateSha: () => string | null,
    workerAdapterId: string,
  ) {
    this.id = id;
    this.#worktree = worktree;
    this.#journal = journal;
    this.#misbehaviour = misbehaviour;
    this.#candidateSha = candidateSha;
    this.#workerAdapterId = workerAdapterId;
  }

  get #isWorker(): boolean { return this.id === this.#workerAdapterId; }

  #provider(): string { return this.id === "claude" ? "anthropic" : "openai-codex"; }

  async isAvailable(): Promise<Availability> { return { status: "available" }; }

  async getModelInfo(model: string): Promise<ModelInfo> {
    return {
      adapter: this.id, provider: this.#provider(), requestedModel: model, contextWindow: null,
      supportsThinking: true, supportsTools: true, supportsImages: false,
      continuity: "same-session-correction", usageAuthority: "provider", costAuthority: "unavailable",
    };
  }

  continuityStoreDir(runtimeDir: string): string { return join(runtimeDir, "scripted-sessions"); }

  /**
   * The host-visible proof, modelled the way pi's really works: the session must
   * be in the store the host handed the CLI, or the resume would silently open
   * a fresh one.
   */
  assertResumable(ref: ContinuityRef): ContinuityEvidence {
    if (!this.#journal.openedSessions.has(ref.providerSessionId)) {
      throw new AdapterError(this.id, "E_BACKEND_FAILURE", "refusing to resume: no session in the host-owned store carries the expected id");
    }
    return { proof: "host-visible-session-store", detail: "scripted store holds the conversation" };
  }

  assertSameSession(first: ObservedProviderSession, next: ObservedProviderSession): void {
    if (first.resolvedModel !== next.resolvedModel) {
      throw new AdapterError(this.id, "E_MODEL_MISMATCH", `the correction answered on ${JSON.stringify(next.resolvedModel)} but the phase began on ${JSON.stringify(first.resolvedModel)}`);
    }
    if (first.sessionId === null || next.sessionId === null || first.sessionId !== next.sessionId) {
      throw new AdapterError(this.id, "E_BACKEND_FAILURE", "the correction ran in a different provider session; a correction re-enters the session it corrects");
    }
  }

  buildSpec(request: ModelRequest): ProcessSpec {
    const argv = ["-e", ""];
    if (request.continuity !== undefined) {
      argv.push("--session-id", request.continuity.ref.providerSessionId, "--turn", request.continuity.turn);
    } else {
      argv.push("--no-session");
    }
    return { executable: "node", argv, cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false };
  }

  async *parse(): AsyncIterable<NormalizedEvent> { yield* []; }

  async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
    observed?: ObservedProviderSession,
  ): AsyncIterable<NormalizedEvent> {
    const turn = this.#turn;
    this.#turn += 1;
    const locator = request.continuity?.ref.providerSessionId ?? null;
    const spec = this.buildSpec(request);
    this.#journal.providers.push(this.#provider());
    this.#journal.turns.push({
      phase: this.#isWorker ? "builder" : "reviewer",
      turn,
      providerSessionId: locator,
      turnKind: request.continuity?.turn,
      prompt: request.prompt,
      argv: spec.argv,
      registrationKind: registration.kind ?? "task-edge",
    });
    if (turn === 0 && locator !== null) this.#journal.openedSessions.add(locator);

    if (turn > 0 && this.#misbehaviour.kind === "resume-transport-failure") {
      throw new AdapterError(this.id, "E_BACKEND_FAILURE", "scripted resume transport failure");
    }
    await broker.startProcess(registration, spec, signal);

    const resolvedModel = turn > 0 && this.#misbehaviour.kind === "switched-model"
      ? "a-different-model"
      : `${request.model}-resolved`;
    const answeringSession = turn > 0 && this.#misbehaviour.kind === "switched-session"
      ? "00000000-0000-4000-8000-0000deadbeef"
      : locator;

    let payload: BuildOutput | ReviewOutput;
    if (this.#isWorker) {
      // The correction is only a correction if it re-entered the conversation.
      // A cold start has no memory of the first turn, and this fixture models
      // that literally: it writes the fixed source only when it was resumed.
      const resumed = request.continuity?.turn === "resume" && locator !== null && this.#journal.openedSessions.has(locator);
      const fixes = resumed && this.#misbehaviour.kind !== "never-fixes";
      mkdirSync(join(this.#worktree, "core", "src"), { recursive: true });
      writeFileSync(
        join(this.#worktree, "core", "src", "generated.ts"),
        fixes ? `export const generated = "${MARKER}";\n` : "export const generated = true;\n",
      );
      // A correction that "fixes" the suite by reaching outside its writes
      // globs. The point is that this must be terminal rather than correctable:
      // asking the model to try again is asking it to try the breach again.
      if (resumed && this.#misbehaviour.kind === "breaches-on-correction") {
        writeFileSync(join(this.#worktree, "check.mjs"), "process.exit(0);\n");
      }
      payload = build(turn);
    } else {
      payload = review(this.#candidateSha() ?? "0".repeat(40));
    }

    if (observed !== undefined) {
      observed.sessionId = answeringSession;
      observed.resolvedModel = resolvedModel;
    }

    const runId = registration.runId;
    yield { kind: "run.started", seq: 1, runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId, hostAt: AT, providerAt: null, adapter: this.id, provider: this.#provider(), requestedModel: request.model, resolvedModel, provenance: "route-attributed" };
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
        ...(registration.kind === "agent-phase" || registration.kind === "phase-correction" ? {
          phase: {
            taskSessionId: registration.taskSessionId, workflowId: registration.workflowId,
            phaseId: registration.phaseId, phaseOrdinal: registration.phaseOrdinal,
            adapterId: registration.adapterId, role: registration.role,
          },
        } : {}),
        reservationId: reservationIdOf(registration), command: [spec.executable, ...spec.argv], cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
      // The correction path goes through the real verifier, so a fixture broker
      // cannot wave through a launch the production one would refuse.
      if (registration.kind === "phase-correction") {
        const evidence = options.correctionLaunchVerifier!.verify(registration);
        await options.register(record);
        await options.onCorrection?.(record, evidence);
      } else {
        await options.register(record);
        const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
        await options.onSpent?.(record, reservation);
      }
      return {
        runId: registration.runId, identity: record.identity,
        stdout: (async function* () {})(), stderr: (async function* () {})(),
        exit: Promise.resolve({ code: 0, signal: null }),
        cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------

/** `worker` names which adapter alias builds; the reviewer is the other one. */
type Direction = "codex-builds" | "claude-builds";

function configText(): string {
  return readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace(
      "test: { argv: [npm, run, test:unit], timeout_seconds: 600 }",
      "test: { argv: [node, check.mjs], timeout_seconds: 60 }",
    )
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "");
}

/**
 * Swaps which alias the builder and reviewer sit on, so the same journey runs in
 * both directions. Everything else — globs, profiles, allowances — is untouched.
 */
function withDirection(config: AwsfConfig, direction: Direction): AwsfConfig {
  const builderAdapter = direction === "codex-builds" ? "codex" : "claude";
  const reviewerAdapter = direction === "codex-builds" ? "claude" : "codex";
  return {
    ...config,
    agents: config.agents.map((agent) => {
      if (agent.name === "builder") {
        return {
          ...agent,
          model: builderAdapter === "codex" ? "codex:gpt-5.6-sol" : "claude:opus",
          harness: { ...agent.harness, adapter: builderAdapter, continuity: "same-session" as const },
        };
      }
      if (agent.name === "reviewer") {
        return {
          ...agent,
          model: reviewerAdapter === "codex" ? "codex:gpt-5.6-sol" : "claude:opus",
          harness: { ...agent.harness, adapter: reviewerAdapter, continuity: "none" as const },
        };
      }
      return agent;
    }),
  };
}

async function fixture(direction: Direction, configure: (config: AwsfConfig) => AwsfConfig = (config) => config) {
  const root = mkdtempSync(join(tmpdir(), "awsf-correction-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  writeFileSync(join(canonical, "check.mjs"), CHECKER);
  git(canonical, "add", "README.md", "check.mjs");
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed correction runner");
  const text = configText();
  const config = configure(withDirection(loadConfig(text), direction));
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, text);
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      const destination = join(root, promptPath);
      mkdirSync(resolve(destination, ".."), { recursive: true });
      writeFileSync(destination, readFileSync(resolve(promptPath), "utf8"));
    }
  }
  const projection = createDashboardProjection(stateRoot);
  const created = await newCommand({
    stateRoot, project: config.project.slug, taskId: `fixture-correction-${direction}`, repository: canonical,
    request: "write one bounded source", workflow: "build-review", tier: 2,
    configSnapshotJson: JSON.stringify(config), projectRecord: projection.project,
  });
  await startCommand({
    attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }),
    projectRecord: projection.project,
  });
  return { root, canonical, stateRoot, config, configPath, projection, created, direction };
}

async function run(
  world: Awaited<ReturnType<typeof fixture>>,
  misbehaviour: Misbehaviour = { kind: "well-behaved" },
) {
  const prepared = await readAttempt(world.created.attemptDir);
  const journal = new Journal();
  const workerAdapterId = world.direction === "codex-builds" ? "codex" : "claude";
  const adapters = new Map<string, ScriptedContinuityAdapter>();
  const status = await runProductionCommand({
    attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath,
    projectRecord: world.projection.project, assertAdvancement: world.projection.assertAdvancement,
    assertLaunchProjection: world.projection.assertLaunchPermitted,
    infrastructure: {
      adapterFor: (_entry: AdapterEntry, id: string) => {
        const existing = adapters.get(id);
        if (existing !== undefined) return existing;
        const created = new ScriptedContinuityAdapter(
          id, prepared.worktree!, journal, misbehaviour,
          () => { try { return git(prepared.worktree!, "rev-parse", "HEAD"); } catch { return null; } },
          workerAdapterId,
        );
        adapters.set(id, created);
        return created;
      },
      createBroker: fakeBroker,
      sandboxProbe: () => false,
    },
  });
  return { status, prepared, journal };
}

function close(world: Awaited<ReturnType<typeof fixture>>): void {
  world.projection.close();
  rmSync(world.root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// The journey, in both directions.
// ---------------------------------------------------------------------------

for (const direction of ["codex-builds", "claude-builds"] as const) {
  const workerProvider = direction === "codex-builds" ? "openai-codex" : "anthropic";
  const reviewProvider = direction === "codex-builds" ? "anthropic" : "openai-codex";

  test(`[${direction}] a red configured command is corrected in the same session and never buys a call`, async () => {
    const world = await fixture(direction);
    try {
      const { status, journal, prepared } = await run(world);

      assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
      // THE number. Without continuity this journey costs three calls — a whole
      // second builder from a cold start, then the review. With it, the
      // correction is a turn in a conversation already paid for.
      assert.equal(status.budget.callsSpent, 2, "one builder call plus one review call; the correction cost tokens");
      assert.equal(status.budget.callsReserved, 0);

      // Two builder turns and one reviewer turn, in that order.
      const builderTurns = journal.turns.filter((record) => record.phase === "builder");
      assert.equal(builderTurns.length, 2, "the builder answered twice");
      assert.equal(builderTurns[0]?.turnKind, "open");
      assert.equal(builderTurns[1]?.turnKind, "resume");
      assert.equal(builderTurns[0]?.registrationKind, "task-edge", "the first turn is the L4 spawn site");
      assert.equal(builderTurns[1]?.registrationKind, "phase-correction", "the correction is its own authorization class");
      assert.equal(
        builderTurns[0]?.providerSessionId,
        builderTurns[1]?.providerSessionId,
        "a correction re-enters the conversation it corrects",
      );
      assert.deepEqual(journal.providers, [workerProvider, workerProvider, reviewProvider]);

      // The candidate that landed in AWAITING_OWNER is B, built on top of A.
      const head = git(prepared.worktree!, "rev-parse", "HEAD");
      assert.equal(status.candidateSha, head);
      const parent = git(prepared.worktree!, "rev-parse", "HEAD^");
      assert.notEqual(parent, prepared.baseSha, "candidate B sits on candidate A, which is retained as evidence");
      assert.equal(git(prepared.worktree!, "rev-parse", "HEAD^^"), prepared.baseSha);
      assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
    } finally { close(world); }
  });

  test(`[${direction}] the review runs only after the gates are green, and is bound to candidate B`, async () => {
    const world = await fixture(direction);
    try {
      const { status, journal } = await run(world);
      assert.equal(status.requiredReviewPresent, true);
      assert.equal(status.journeyApproved, false, "the owner journey is never assumed");

      // The reviewer's turn is last, and it names the FINAL candidate.
      const last = journal.turns.at(-1)!;
      assert.equal(last.phase, "reviewer");
      assert.equal(last.turnKind, undefined, "a reviewer is never resumed as a substitute for a builder");

      const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
      try {
        const session = getSession(db, status.sessionId);
        assert.equal(session?.worker_provider, workerProvider);
        assert.equal(session?.review_provider, reviewProvider);
        assert.notEqual(session?.review_provider, session?.worker_provider, "the inversion holds in both directions");
        assert.equal(session?.review_verdict, "accept");

        const gates = gatesForSession(db, status.sessionId);
        const verdict = gates.find((gate) => gate.gate_id === "verdict_consistent");
        assert.equal(verdict?.passed, 1);
        assert.equal(verdict?.candidate_sha, status.candidateSha, "the review is gated against candidate B");

        // Both rounds of the deterministic gate are on the record: the red one
        // at candidate A and the green one at candidate B. A failed candidate is
        // evidence, not something to overwrite.
        const commands = gates.filter((gate) => gate.gate_id === "commands_pass");
        const red = commands.filter((gate) => gate.passed === 0);
        const green = commands.filter((gate) => gate.passed === 1);
        assert.equal(red.length, 1, "the red candidate keeps its own row");
        assert.notEqual(red[0]!.candidate_sha, status.candidateSha, "and it is a different candidate");
        // Two green rows against candidate B: the builder's own verification,
        // and the `tests` phase recording the measurement rather than paying for
        // the suite a second time against the same SHA.
        assert.equal(green.length, 2);
        for (const gate of green) assert.equal(gate.candidate_sha, status.candidateSha);
        assert.equal(new Set(green.map((gate) => gate.phase_id)).size, 2, "one row per phase, not one phase twice");
      } finally { db.close(); }
    } finally { close(world); }
  });
}

// ---------------------------------------------------------------------------
// The evidence the correction carries. This is the pilot's other defect.
// ---------------------------------------------------------------------------

test("the correction prompt carries the failing test's identity, not just the totals", async () => {
  const world = await fixture("codex-builds");
  try {
    const { journal } = await run(world);
    const correction = journal.turns.find((record) => record.turnKind === "resume")!.prompt;

    // The identity and the diagnostic — the exact bytes the retained
    // 4,000-character tail had already discarded when pilot 2 needed them.
    assert.ok(correction.includes("not ok 6"), "the failing test's number");
    assert.ok(correction.includes("keeps its scrollback across a resume"), "its name");
    assert.ok(correction.includes("+ 'pane-2'"), "its diagnostic");
    // And the totals still arrive, so the model can see how much else passed.
    assert.ok(correction.includes("# tests 240"));
    assert.ok(correction.includes("# fail 1"));
    assert.ok(correction.includes("characters omitted"), "and it says what it left out");

    // The command, its exit code, and the exact SHA it ran against.
    assert.ok(correction.includes('"gateId": "test"') || correction.includes("Command `test`"));
    assert.ok(/exited 1/.test(correction), "the exit code the host measured");
    assert.match(correction, /[0-9a-f]{40}/, "the exact candidate SHA");
    assert.ok(correction.includes("do not create a commit"), "and what the host will do next");
  } finally { close(world); }
});

test("the correction prompt carries no absolute path and no provider locator", async () => {
  const world = await fixture("codex-builds");
  try {
    const { journal, prepared } = await run(world);
    const resumed = journal.turns.find((record) => record.turnKind === "resume")!;
    assert.equal(resumed.prompt.includes(prepared.worktree!), false, "an absolute machine path reached the model");
    assert.equal(resumed.prompt.includes(world.created.attemptDir), false);
    assert.equal(
      resumed.prompt.includes(resumed.providerSessionId!),
      false,
      "the provider locator reaches argv and nothing else",
    );
    // The prompt rides stdin on the correction turn too.
    for (const argument of resumed.argv) {
      assert.equal(argument.includes("not ok 6"), false, `correction evidence leaked into argv: ${argument}`);
    }
  } finally { close(world); }
});

test("the complete command output is retained privately, unwindowed and mode 0600", async () => {
  const world = await fixture("codex-builds");
  try {
    await run(world);
    const raw = join(world.created.attemptDir, "raw");
    const logs = readdirSync(raw).filter((name) => name.startsWith("command-"));
    assert.equal(logs.length, 2, "one full log per candidate measured");
    for (const name of logs) {
      const path = join(raw, name);
      assert.equal(statSync(path).mode & 0o777, 0o600);
      const content = readFileSync(path, "utf8");
      // Unwindowed: the whole 240-line run, not the bounded rendering. Retaining
      // only the rendering is what made the pilot's failure unfixable.
      assert.ok(content.includes("ok 240 -"), `${name} lost its tail`);
      assert.ok(content.includes("TAP version 13"), `${name} lost its head`);
      assert.ok(content.length > 4_000, `${name} looks like it was bounded on the way in`);
    }
  } finally { close(world); }
});

// ---------------------------------------------------------------------------
// Fail closed: every way a correction could have become a cold restart.
// ---------------------------------------------------------------------------

for (const misbehaviour of [
  { kind: "switched-session", expect: /different provider session/ },
  { kind: "switched-model", expect: /answered on/ },
  { kind: "resume-transport-failure", expect: /scripted resume transport failure/ },
] as const) {
  test(`a correction that ${misbehaviour.kind} blocks without a cold restart`, async () => {
    const world = await fixture("codex-builds");
    try {
      const { status, journal } = await run(world, { kind: misbehaviour.kind });
      assert.equal(status.lifecycleState, "BLOCKED");
      assert.match(status.blocker?.detail ?? "", misbehaviour.expect);
      // The builder is never re-run from scratch, and the review never happens:
      // a red candidate is not reviewed.
      assert.equal(status.budget.callsSpent, 1, "only the first builder call was ever spent");
      assert.equal(status.budget.callsReserved, 0, "and nothing is left held");
      assert.equal(journal.providers.filter((provider) => provider === "anthropic").length, 0, "no reviewer ran");
      assert.ok(journal.turns.filter((record) => record.phase === "builder").length <= 2, "no third builder turn");
    } finally { close(world); }
  });
}

test("a builder that never fixes the defect exhausts the allowance and blocks — no unbounded loop", async () => {
  const world = await fixture("codex-builds");
  try {
    const { status, journal } = await run(world, { kind: "never-fixes" });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.match(status.blocker?.detail ?? "", /PhaseGateFailure/);
    assert.equal(status.budget.callsSpent, 1, "an exhausted allowance never escalates itself into a call");
    assert.equal(status.budget.callsReserved, 0);
    // `maxCorrections: 1` on the builder plus `correction_allowance.auto: 1`.
    // Two turns total, and the second one is where it stops.
    assert.equal(journal.turns.filter((record) => record.phase === "builder").length, 2);
    assert.equal(journal.providers.includes("anthropic"), false, "a red candidate is never reviewed");
  } finally { close(world); }
});

test("a correction that writes outside its globs is a breach, and a breach is never corrected", async () => {
  const world = await fixture("codex-builds");
  try {
    const { status, journal } = await run(world, { kind: "breaches-on-correction" });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.blocker?.code, "permission-breach", status.blocker?.detail);
    // `check.mjs` sits outside `core/src/**` and is where the gate command
    // lives, so a breach here would also have been a way to make the gate pass
    // by rewriting the gate.
    assert.match(status.blocker?.detail ?? "", /check\.mjs/);
    assert.equal(status.budget.callsSpent, 1, "a breach never escalates into another call");
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(journal.turns.filter((record) => record.phase === "builder").length, 2, "and never into another turn");
    assert.equal(journal.providers.includes("anthropic"), false, "a breached candidate is never reviewed");
  } finally { close(world); }
});

test("the owner tranche is not drawn by a non-interactive runner on the owner's behalf", async () => {
  // The lifecycle makes the second correction owner-only. `awsf run` is
  // non-interactive by construction, so it draws `auto` while `auto` remains and
  // then refuses — spending an authorization nobody gave would be the cheapest
  // possible way to lose the control.
  const world = await fixture("codex-builds", (config) => ({
    ...config,
    risk: { ...config.risk, correction_allowance: { auto: 1, owner: 3 } },
  }));
  try {
    const { status, journal } = await run(world, { kind: "never-fixes" });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(journal.turns.filter((record) => record.phase === "builder").length, 2, "the owner's three rounds stayed the owner's");
    assert.equal(status.budget.callsSpent, 1);
  } finally { close(world); }
});

// ---------------------------------------------------------------------------
// Privacy.
// ---------------------------------------------------------------------------

test("the provider locator is private on disk and absent from every public projection", async () => {
  const world = await fixture("codex-builds");
  try {
    const { status } = await run(world);

    const continuityPath = join(world.created.attemptDir, "private", "continuity.json");
    assert.equal(existsSync(continuityPath), true);
    assert.equal(statSync(continuityPath).mode & 0o777, 0o600, "the locator must not be group- or world-readable");
    const stored = JSON.parse(readFileSync(continuityPath, "utf8")) as {
      records: Record<string, { providerSessionId: string; handle: string }>;
    };
    const record = stored.records["continuity:builder"]!;
    const locator = record.providerSessionId;
    assert.equal(record.handle, "continuity:builder");
    assert.notEqual(locator, record.handle);

    // status.json, the journal, and the SQLite projection are the three public
    // stores. None of them may carry the locator.
    for (const name of ["status.json", "journal.jsonl"]) {
      const content = readFileSync(join(world.created.attemptDir, name), "utf8");
      assert.equal(content.includes(locator), false, `${name} carries the provider locator`);
    }
    // The journal, which is the durable public record, still names the
    // conversation — by its handle. Privacy here means "not a locator", never
    // "not mentioned".
    const journalText = readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8");
    assert.ok(journalText.includes("continuity:builder"));
    const db = readFileSync(join(world.stateRoot, "awsf.db"));
    assert.equal(db.includes(locator), false, "the SQLite projection carries the provider locator");

    // The route it escapes by if nobody stops it: the locator rides argv,
    // because that IS the protocol, and the barrier records argv verbatim into
    // `processes.command_json`. A feature that worked would have published it.
    const journalLines = journalText.split("\n").filter((line) => line.includes('"type":"process"'));
    assert.ok(journalLines.length > 0, "the fixture must actually record process rows");
    assert.ok(journalText.includes("[continuity-ref]"), "the recorded argv must show the redaction, not omit the flag");
    assert.ok(
      journalLines.some((line) => line.includes("--session-id")),
      "the flag itself stays visible; it is the value that is private",
    );

    // And the API, which is the only thing a browser ever sees.
    const projected = JSON.stringify(publicApiValue(JSON.parse(readFileSync(join(world.created.attemptDir, "status.json"), "utf8")) as unknown));
    assert.equal(projected.includes(locator), false);
    assert.equal(status.lifecycleState, "AWAITING_OWNER");
  } finally { close(world); }
});

test("a blocked correction names the conversation by handle in the blocker a human reads", async () => {
  const world = await fixture("codex-builds");
  try {
    const { status } = await run(world, { kind: "switched-session" });
    const detail = status.blocker?.detail ?? "";
    assert.match(detail, /different provider session/);
    const stored = JSON.parse(readFileSync(join(world.created.attemptDir, "private", "continuity.json"), "utf8")) as {
      records: Record<string, { providerSessionId: string }>;
    };
    // The exact failure mode this design exists for: an identity error carries
    // the identity in its message, and a blocked attempt writes that message
    // into `status.json`.
    assert.equal(detail.includes(stored.records["continuity:builder"]!.providerSessionId), false);
  } finally { close(world); }
});

// ---------------------------------------------------------------------------
// A route that declines the capability keeps the pre-continuity behaviour.
// ---------------------------------------------------------------------------

test("with continuity declined, a red command blocks on L8 exactly as it did before", async () => {
  const world = await fixture("codex-builds", (config) => ({
    ...config,
    agents: config.agents.map((agent) => agent.name === "builder"
      ? { ...agent, harness: { ...agent.harness, continuity: "none" as const } }
      : agent),
  }));
  try {
    const { status, journal } = await run(world);
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 1);
    assert.equal(journal.turns.filter((record) => record.phase === "builder").length, 1, "no second turn is authorized");
    assert.equal(journal.turns[0]?.turnKind, undefined, "and the argv keeps the ephemeral shape");
    assert.equal(existsSync(join(world.created.attemptDir, "private", "continuity.json")), false);
  } finally { close(world); }
});
