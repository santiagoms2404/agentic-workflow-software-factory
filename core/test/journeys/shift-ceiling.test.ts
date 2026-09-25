import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { loadConfig } from "../../src/config/load.ts";
import type { AdapterEntry } from "../../src/config/schema.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { resumeProductionCommand, runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { CeilingRaiseNotInteractive, raiseCommand } from "../../src/cli/commands/raise.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { statusCommand } from "../../src/cli/commands/status.ts";
import type { CallBudget, Reservation } from "../../src/execution/call-budget.ts";
import type { BrokerOptions } from "../../src/execution/transport-broker.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { CallCeilingExceeded } from "../../src/state/errors.ts";
import { callCeilingsOf } from "../../src/state/tiers.ts";

// W17 M3 task 9, end to end on the fixture route: a three-ticket shift at
// T2's ceiling of five, with a cold builder. Ticket 1's first reply is
// malformed, so its paid correction spends the shift's one call of headroom.
// Ticket 2's build declares a correction round the ceiling can no longer fund,
// so the shift stops at the clean boundary before it — RUNNING, with the
// accepted prefix durable and the ticket named. The shift cannot move its own
// ceiling; the owner raises at a TTY, and resume continues from the prefix
// without re-running a completed phase or re-spending a settled call.

const PLAN = "fixture-shift";
const TICKETS = ["T01", "T02", "T03"] as const;
const OWNER = { name: "Santiago Marin", email: "santiagomarinsuarez@me.com" };

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function ticketSource(id: string): string {
  const title = `Ticket ${id} adds its own widget`;
  return [
    "---", `id: ${id}`, `title: ${JSON.stringify(title)}`, "milestone: M1", "state: todo", "depends_on: []", "---",
    `# ${id} · ${title}`, "", "## Handoff", "", "_Empty._", "", "## Build prompt", "", "```",
    `TASK ${id}. Write core/src/widget-${id.toLowerCase()}.ts.`, "```", "",
  ].join("\n");
}

function build(ticket: string): BuildOutput {
  const path = `core/src/widget-${ticket.toLowerCase()}.ts`;
  return {
    schema: "awsf.build-output/v1", producerStatus: "success", summary: `built ${ticket}`,
    artifacts: [{ path, kind: "source", description: `${ticket} widget` }], notesForNextPhase: "run host commands",
    changedFiles: [path], implementationNotes: [`${ticket} fixture implementation`], commandsRun: [],
    proposedCommitMessage: `feat: add the ${ticket} widget`,
  };
}

function review(worktree: string): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: "reviewed the accumulated shift candidate",
    artifacts: [], notesForNextPhase: "The owner decides.", verdict: "accept",
    reviewedSha: git(worktree, "rev-parse", "HEAD"), findings: [],
    limitations: [{ detail: "Scripted offline review.", affectedFiles: [] }],
  };
}

/** One adapter per route. The builder names its ticket from the brief it was rendered. */
class ShiftAdapter implements HarnessAdapter {
  readonly id: string;
  readonly #worktree: string;
  readonly #launches: string[];
  readonly #malformedFirst: Set<string>;
  constructor(id: string, worktree: string, launches: string[], malformedFirst: Set<string>) {
    this.id = id; this.#worktree = worktree; this.#launches = launches; this.#malformedFirst = malformedFirst;
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
    const at = "2026-09-25T00:00:00.000Z";
    let text: string;
    if (request.prompt.includes("awsf.review-output/v1")) {
      this.#launches.push("review");
      text = JSON.stringify(review(this.#worktree));
    } else {
      const ticket = /TASK (T\d\d)\./u.exec(request.prompt)?.[1];
      assert.ok(ticket !== undefined, "the builder is rendered its own ticket's brief");
      this.#launches.push(ticket);
      mkdirSync(join(this.#worktree, "core", "src"), { recursive: true });
      writeFileSync(join(this.#worktree, "core", "src", `widget-${ticket.toLowerCase()}.ts`), `export const ${ticket.toLowerCase()} = true;\n`);
      text = this.#malformedFirst.delete(ticket) ? "not-json" : JSON.stringify(build(ticket));
    }
    yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id,
      provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text };
    yield { kind: "usage", seq: 4, runId: registration.runId, hostAt: at, providerAt: null,
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { kind: "run.completed", seq: 5, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

/**
 * Spends on GO like the real broker, and keeps each run's ledger so its
 * history() can be read afterwards. The port is typed narrowly; the object
 * behind it is the run's own CallBudget.
 */
function recordingBroker(ledgers: Set<CallBudget>) {
  return (options: BrokerOptions): TransportBroker => {
    ledgers.add(options.ledger as unknown as CallBudget);
    return {
      async startProcess(registration, spec) {
        const record = {
          identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
          runId: registration.runId, edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
          ...(registration.kind === "agent-phase" ? { phase: { taskSessionId: registration.taskSessionId, workflowId: registration.workflowId,
            phaseId: registration.phaseId, phaseOrdinal: registration.phaseOrdinal, adapterId: registration.adapterId, role: registration.role } } : {}),
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
  };
}

async function world() {
  const root = mkdtempSync(join(tmpdir(), "awsf-shift-ceiling-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  const directory = join(canonical, "specs", "tickets", PLAN);
  mkdirSync(directory, { recursive: true });
  for (const id of TICKETS) writeFileSync(join(directory, `${id}.md`), ticketSource(id));
  git(canonical, "add", ".");
  git(canonical, "-c", `user.name=${OWNER.name}`, "-c", `user.email=${OWNER.email}`, "commit", "-m", "test: seed a shift's tickets");
  const configText = readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replaceAll("interrupted_turn: true", "interrupted_turn: false")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", "test: { argv: [node, -e, process.exit(0)], timeout_seconds: 10 }")
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "");
  const config = loadConfig(configText);
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText);
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      mkdirSync(resolve(join(root, promptPath), ".."), { recursive: true });
      writeFileSync(join(root, promptPath), readFileSync(resolve(promptPath), "utf8"));
    }
  }
  mkdirSync(join(root, "prompts", "shared"), { recursive: true });
  writeFileSync(join(root, "prompts/shared/headless-role.md"), readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));
  const manifest = sealShiftManifest({
    plan: PLAN, milestones: ["M1"],
    tickets: TICKETS.map((id) => {
      const path = `specs/tickets/${PLAN}/${id}.md`;
      return { id, path, digest: ticketFileDigest(readFileSync(join(canonical, path))) };
    }),
  });
  const projection = createDashboardProjection(stateRoot);
  const created = await newCommand({ stateRoot, project: config.project.slug, taskId: "fixture-shift-m1", repository: canonical,
    request: "run milestone M1 of the fixture shift", workflow: "shift", tier: 2, shift: manifest,
    callCeilings: callCeilingsOf(config.risk.call_ceiling), configSnapshotJson: JSON.stringify(config), projectRecord: projection.project });
  await startCommand({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project });
  return { root, canonical, stateRoot, config, configPath, projection, attemptDir: created.attemptDir };
}

const settledCalls = (history: readonly Reservation[]): number => history.reduce((sum, entry) => sum + entry.spent, 0);

test("a shift that cannot fund its next ticket's correction stops before it, and resumes after an owner raise", async () => {
  const fixture = await world();
  const launches: string[] = [];
  const ledgers = new Set<CallBudget>();
  try {
    const prepared = await readAttempt(fixture.attemptDir);
    assert.equal(prepared.budget.ceiling, 5, "T2's configured ceiling; a three-ticket shift needs four calls");
    const malformedFirst = new Set(["T01"]);
    const options = {
      attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, config: fixture.config, configPath: fixture.configPath,
      projectRecord: fixture.projection.project, assertAdvancement: fixture.projection.assertAdvancement,
      assertLaunchProjection: fixture.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ShiftAdapter(id, prepared.worktree!, launches, malformedFirst),
        createBroker: recordingBroker(ledgers), sandboxProbe: () => false,
      },
    };

    // The stop: RUNNING, not BLOCKED, so the owner's raise is still legal.
    const paused = await runProductionCommand(options);
    assert.equal(paused.lifecycleState, "RUNNING", paused.blocker?.detail);
    assert.equal(paused.blocker, null);
    assert.equal(paused.recovery?.kind, "ceiling-pause");
    assert.equal(paused.recovery?.ticket, "T02", "the checkpoint names the ticket it stopped before");
    assert.deepEqual(paused.recovery?.prefix.map((entry) => entry.phaseKey), ["t01-brief", "t01-build", "t01-tests", "t02-brief"]);
    assert.match(paused.lastActivity, /ceiling stop before ticket T02 \(t02-build\)/u);
    assert.match(paused.nextAction, /ceiling-paused before ticket T02; the owner runs `awsf raise fixture-shift-m1 --calls 1/u);
    assert.deepEqual(launches, ["T01", "T01"], "ticket 1 and its one paid correction, and nothing after the stop");
    assert.equal(paused.budget.callsSpent, 2);
    assert.equal(paused.budget.callsReserved, 0);

    // The ledger itself, not a log line: every reservation it ever held is
    // settled, both were spent before the stop, and none is outstanding.
    assert.equal(ledgers.size, 1);
    const stopped = [...ledgers][0]!;
    assert.deepEqual(stopped.outstanding(), []);
    assert.equal(stopped.history().length, 2, "no call was reserved after the stop");
    assert.equal(settledCalls(stopped.history()), 2);

    // The prefix is durable: the first ticket's commit is on the worktree head.
    const firstTicketSha = paused.recovery!.prefix.find((entry) => entry.phaseKey === "t01-build")!.candidateSha!;
    assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), firstTicketSha);
    assert.equal(git(prepared.worktree!, "rev-list", "--count", `${prepared.baseSha!}..HEAD`), "1");

    const statusLines: string[] = [];
    statusLines.push(...await statusCommand(fixture.attemptDir));
    assert.ok(statusLines.some((line) => /Recovery: ceiling-paused.*next ticket T02/u.test(line)), statusLines.join("\n"));

    // The shift cannot move its own ceiling: resume without a raise is the
    // same refusal, restated with the ticket and the calls it is short.
    const terminal = { interactive: true, write: () => {}, confirm: async () => true };
    await assert.rejects(resumeProductionCommand({ ...options, reason: "continue the shift", terminal }), (error: Error) =>
      error instanceof CallCeilingExceeded &&
      /resume of fixture-shift-m1 before ticket T02 \(t02-build\): needs 1 more call\(s\) from the owner's `awsf raise fixture-shift-m1`/u.test(error.message));
    assert.deepEqual(launches, ["T01", "T01"]);
    await assert.rejects(raiseCommand({ attemptDir: fixture.attemptDir, calls: 1, reason: "fund ticket 2's correction round",
      terminal: { ...terminal, interactive: false } }), CeilingRaiseNotInteractive);

    const raised = await raiseCommand({ attemptDir: fixture.attemptDir, calls: 1, reason: "fund ticket 2's correction round",
      terminal, projectRecord: fixture.projection.project });
    assert.equal(raised.ceiling, 6);
    assert.equal(raised.status.recovery?.kind, "ceiling-pause", "a raise moves the ceiling and nothing else");

    const resumed = await resumeProductionCommand({ ...options, reason: "the owner raised the ceiling", terminal });
    assert.equal(resumed.confirmed, true);
    const done = resumed.status;
    assert.equal(done.lifecycleState, "AWAITING_OWNER", done.blocker?.detail);
    assert.deepEqual(launches, ["T01", "T01", "T02", "T03", "review"], "no completed phase ran twice");
    assert.equal(done.budget.callsSpent, 5, "two settled before the stop, three after it, none twice");
    assert.equal(done.budget.callsReserved, 0);
    assert.equal(ledgers.size, 2);
    assert.equal(settledCalls([...ledgers][1]!.history()), 3, "the resumed ledger paid only for the unrun tail");

    // Each ticket is its own commit on one accumulating head, ticket 1's first.
    const commits = git(prepared.worktree!, "rev-list", "--reverse", `${prepared.baseSha!}..HEAD`).split("\n");
    assert.equal(commits.length, 3);
    assert.equal(commits[0], firstTicketSha, "ticket 1's commit survived the stop and the resume unchanged");
    for (const id of TICKETS) assert.ok(git(prepared.worktree!, "ls-files", `core/src/widget-${id.toLowerCase()}.ts`).length > 0);
  } finally {
    fixture.projection.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
