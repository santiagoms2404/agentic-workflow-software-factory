import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
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
import { CandidateAdoptionEvidenceSchema } from "../../src/contracts/candidate-adoption.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import { sealShiftManifest, type ShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { adoptCommand, CandidateAdoptionRejected } from "../../src/cli/commands/adopt.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { cancelCommand } from "../../src/cli/commands/cancel.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { runSystemCommand, type BrokerOptions } from "../../src/execution/transport-broker.ts";
import { journalFilePath, statusFilePath } from "../../src/persistence/platform-paths.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { callCeilingsOf } from "../../src/state/tiers.ts";
import type { CandidateAdoptionEvidence } from "../../src/contracts/candidate-adoption.ts";
import { seedCommand } from "../../src/cli/commands/seed.ts";
import { inspectSeedSource, type ProcessQuiescence } from "../../src/workflow/candidate-seed.ts";
import { ShiftTicketDigestMismatch } from "../../src/workflow/shift/compile.ts";
import { bindShiftRecipe } from "../../src/workflow/shift/bind.ts";

// W17 M6 task 17: a shift that held good work but could not finish. Four
// tickets, the gate red on the one the fixture names. The owner cancels the
// ticket-blocked shift, which seals it, and adopts it into build-review: the
// candidate is the last ticket whose gates accepted its commit, the red
// ticket's commit is left behind, and the adoption evidence names the tickets
// completed and the tail, so the continuation's intent can name the tail.

const PLAN = "fixture-shift-adopt";
const TICKETS = ["T01", "T02", "T03", "T04"] as const;
const OWNER = { name: "Santiago Marin", email: "santiagomarinsuarez@me.com" };
const GATE = ["-e", "process.exit(0)"] as const;

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

const widget = (ticket: string): string => `core/src/widget-${ticket.toLowerCase()}.ts`;

function build(ticket: string): BuildOutput {
  return {
    schema: "awsf.build-output/v1", producerStatus: "success", summary: `built ${ticket}`,
    artifacts: [{ path: widget(ticket), kind: "source", description: `${ticket} widget` }], notesForNextPhase: "run host commands",
    changedFiles: [widget(ticket)], implementationNotes: [`${ticket} fixture implementation`], commandsRun: [],
    proposedCommitMessage: `feat: add the ${ticket} widget`,
  };
}

/** One adapter per route. The builder names its ticket from its brief; a review reads the tree it was launched in. */
class ShiftAdapter implements HarnessAdapter {
  readonly id: string;
  readonly #launches: string[];
  readonly #lost: string | null;
  /** `lost` names a ticket whose build's provider stream ends without a terminal event, before any write. */
  constructor(id: string, launches: string[], lost: string | null = null) {
    this.id = id; this.#launches = launches; this.#lost = lost;
  }
  get provider(): string { return this.id === "claude" ? "anthropic" : "openai-codex"; }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return { adapter: this.id, provider: this.provider, requestedModel: model, contextWindow: null,
      supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none", usageAuthority: "provider", costAuthority: "unavailable" };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    // A review launch must name its private system prompt path exactly once.
    const system = request.systemPromptPath === undefined ? [] : ["--append-system-prompt", request.systemPromptPath];
    return { executable: "node", argv: ["-e", "", ...system], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false };
  }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    const at = "2026-09-26T00:00:00.000Z";
    let text: string;
    if (request.prompt.includes("awsf.review-output/v1")) {
      this.#launches.push(`review:${this.provider}`);
      const review: ReviewOutput = {
        schema: "awsf.review-output/v1", producerStatus: "success", summary: "reviewed the candidate", artifacts: [],
        notesForNextPhase: "The owner decides.", verdict: "accept", reviewedSha: git(request.cwd, "rev-parse", "HEAD"),
        findings: [], limitations: [{ detail: "Scripted offline review.", affectedFiles: [] }],
      };
      text = JSON.stringify(review);
    } else {
      const ticket = /TASK (T\d\d)\./u.exec(request.prompt)?.[1];
      assert.ok(ticket !== undefined, "the builder is rendered its own ticket's brief");
      this.#launches.push(ticket);
      if (ticket === this.#lost) {
        yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel: request.model };
        yield { kind: "run.failed", seq: 2, runId: registration.runId, hostAt: at, providerAt: null,
          errorCode: "E_TERMINAL_MISSING", message: "the provider's stream ended without a terminal event" };
        return;
      }
      mkdirSync(join(request.cwd, "core", "src"), { recursive: true });
      writeFileSync(join(request.cwd, widget(ticket)), `export const ${ticket.toLowerCase()} = true;\n`);
      text = JSON.stringify(build(ticket));
    }
    yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id,
      provider: this.provider, requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text };
    yield { kind: "usage", seq: 4, runId: registration.runId, hostAt: at, providerAt: null,
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { kind: "run.completed", seq: 5, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

function broker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec) {
      // Past any pid_max, so the host's own quiescence census at seed and start
      // time can never find a live group under this identity.
      const record = {
        identity: { pid: 2147483001, pgid: 2147483001, startIdentity: "fixture:shift-adopt", startIdentitySource: "fixture" },
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
}

/** The configured gate, red only on the tree whose newest widget is `red`'s. Every other command runs for real. */
function scriptedGate(red: string) {
  const next = TICKETS[TICKETS.indexOf(red as (typeof TICKETS)[number]) + 1];
  return (executable: string, argv: readonly string[], options: Parameters<typeof runSystemCommand>[2]) => {
    const cwd = typeof options === "number" ? undefined : options.cwd;
    const gate = executable === "node" && argv.length === 2 && argv[0] === GATE[0] && argv[1] === GATE[1];
    const onRed = cwd !== undefined && existsSync(join(cwd, widget(red))) && (next === undefined || !existsSync(join(cwd, widget(next))));
    if (gate && onRed) return { status: 1, stdout: "", stderr: `widget-${red.toLowerCase()} fails its suite\n`, error: null };
    return runSystemCommand(executable, argv, options);
  };
}

const lines: string[] = [];
const terminal = { interactive: true, write: (line: string) => { lines.push(line); }, confirm: async () => true };

/** A four-ticket shift, started and ready to run: its tickets committed on canonical HEAD, which is its base. */
async function startedShift() {
  const root = mkdtempSync(join(tmpdir(), "awsf-shift-adopt-"));
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
    .replace("call_ceiling: { T0: 1, T1: 3, T2: 5 }", "call_ceiling: { T0: 1, T1: 3, T2: 10 }")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", `test: { argv: [node, ${GATE[0]}, ${GATE[1]}], timeout_seconds: 10 }`)
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "")
    .replace("  journeys: { argv: [npm, run, test:journeys], timeout_seconds: 2400 }\n", "");
  const config = loadConfig(configText);
  assert.equal(config.risk.call_ceiling.T2, 10);
  assert.ok(config.workflows.enabled.includes("build-review"));
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
    request: "run milestone M1 of the adoption fixture", workflow: "shift", tier: 2, shift: manifest,
    callCeilings: callCeilingsOf(config.risk.call_ceiling), configSnapshotJson: JSON.stringify(config), projectRecord: projection.project });
  await startCommand({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project });
  return { root, canonical, stateRoot, config, configPath, projection, manifest, sourceDir: created.attemptDir };
}

/** A four-ticket shift, run until its gate goes red on `red`, then cancelled by the owner. */
async function blockedAndCancelledShift(red: string) {
  const { root, canonical, stateRoot, config, configPath, projection, sourceDir } = await startedShift();
  const launches: string[] = [];
  const adapterFor = (_entry: AdapterEntry, id: string) => new ShiftAdapter(id, launches);
  const blocked = await runProductionCommand({
    attemptDir: sourceDir, stateRoot, config, configPath,
    projectRecord: projection.project, assertAdvancement: projection.assertAdvancement,
    assertLaunchProjection: projection.assertLaunchPermitted,
    infrastructure: { adapterFor, createBroker: broker, runCommand: scriptedGate(red), sandboxProbe: () => false },
  });
  assert.equal(blocked.lifecycleState, "RUNNING", blocked.lastActivity);
  assert.equal(blocked.recovery?.kind, "ticket-block");
  assert.equal(blocked.recovery?.ticket, red);
  assert.equal(blocked.process, null);

  // The production cancel, with no injected terminator: a ticket block parks
  // the shift with every call settled and no process, and no controller holds
  // the lease, so the empty survivor list is a record, not a guess.
  const cancelled = await cancelCommand({ attemptDir: sourceDir, terminal, cause: "owner", reason: "Stop the blocked shift", projectRecord: projection.project, projectAttribution: projection.projectAttribution });
  assert.equal(cancelled.status.lifecycleState, "CANCELLED");
  assert.deepEqual(cancelled.report.survivors, []);
  const commits = git(blocked.worktree!, "rev-list", "--reverse", `${blocked.baseSha!}..HEAD`).split("\n");
  return { root, canonical, stateRoot, config, configPath, projection, sourceDir, source: cancelled.status,
    commits, launches, adapterFor };
}

test("a sealed shift is adopted into build-review at its last completed ticket, and the evidence names the completed tickets and the tail", async () => {
  const fixture = await blockedAndCancelledShift("T03");
  try {
    assert.deepEqual(fixture.launches, ["T01", "T02", "T03"]);
    assert.equal(fixture.commits.length, 3, "tickets 1 and 2 were accepted and ticket 3 committed before its gate went red");
    const [, completedTip, redCommit] = fixture.commits as [string, string, string];
    const before = { journal: readFileSync(journalFilePath(fixture.sourceDir)), status: readFileSync(statusFilePath(fixture.sourceDir)) };

    lines.length = 0;
    const result = await adoptCommand({
      sourceAttemptDir: fixture.sourceDir, stateRoot: fixture.stateRoot, targetTaskId: "fixture-shift-m1-tail",
      request: "finish T03 and T04 of fixture-shift-adopt M1 on the adopted T01-T02 candidate",
      routes: ["reviewer=claude/anthropic/shift-target-review@high"],
      worktreeRoot: join(fixture.root, "worktrees"), terminal, config: fixture.config, configPath: fixture.configPath,
      projectRecord: fixture.projection.project, assertAdvancement: fixture.projection.assertAdvancement,
      assertLaunchProjection: fixture.projection.assertLaunchPermitted,
      infrastructure: { adapterFor: fixture.adapterFor, createBroker: broker, runCommand: runSystemCommand, pidIsLive: () => false },
    });

    assert.equal(result.confirmed, true);
    const target = result.status!;
    assert.equal(target.lifecycleState, "AWAITING_OWNER", target.blocker?.detail ?? target.lastActivity);
    assert.equal(target.workflow, "build-review", "the continuation is ordinary review work, never a shift");
    assert.deepEqual(target.routeOverrides, { reviewer: { adapter: "claude", provider: "anthropic", model: "shift-target-review", effort: "high" } });
    const reviewStart = (await readAttemptEvidence(result.attemptDir!)).find((entry) => entry.type === "agent-start" && entry.purpose === "review");
    assert.equal(reviewStart?.type === "agent-start" ? reviewStart.requestedModel : null, "shift-target-review");
    assert.equal(target.shift ?? null, null);
    assert.equal(target.continuesTask, fixture.source.taskId);
    assert.equal(target.candidateSha, completedTip, "the candidate is the last ticket whose gates accepted its commit");
    assert.notEqual(target.candidateSha, redCommit);
    assert.equal(git(target.worktree!, "rev-parse", "HEAD"), completedTip);
    assert.equal(existsSync(join(target.worktree!, widget("T03"))), false, "the red ticket's work is not adopted");
    assert.ok(existsSync(join(target.worktree!, widget("T02"))));
    assert.deepEqual(fixture.launches.slice(3), ["review:anthropic"], "one fresh review, opposite the shift's builder provider");

    const adoption = (await readAttemptEvidence(result.attemptDir!)).find((entry) => entry.type === "candidate-adoption");
    assert.ok(adoption?.type === "candidate-adoption");
    assert.ok(Value.Check(CandidateAdoptionEvidenceSchema, adoption.adoption), "the recorded evidence is the contract's shape");
    assert.equal(adoption.adoption.sourceLifecycle, "CANCELLED");
    assert.equal(adoption.adoption.candidateSha, completedTip);
    assert.deepEqual(adoption.adoption.shift, {
      plan: PLAN, milestones: ["M1"], completedTickets: ["T01", "T02"], remainingTickets: ["T03", "T04"],
    });
    assert.ok(lines.includes(`Shift ${PLAN} M1: completed T01, T02; not adopted T03, T04 — name the tail in the fresh intent`), lines.join("\n"));

    assert.deepEqual(readFileSync(journalFilePath(fixture.sourceDir)), before.journal, "the source is read-only throughout");
    assert.deepEqual(readFileSync(statusFilePath(fixture.sourceDir)), before.status);
    assert.equal((await readAttempt(fixture.sourceDir)).lifecycleState, "CANCELLED");
  } finally {
    fixture.projection.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a sealed shift that completed no ticket is refused as partial work", async () => {
  const fixture = await blockedAndCancelledShift("T01");
  try {
    assert.deepEqual(fixture.launches, ["T01"]);
    await assert.rejects(adoptCommand({
      sourceAttemptDir: fixture.sourceDir, stateRoot: fixture.stateRoot, targetTaskId: "fixture-shift-m1-tail",
      request: "finish M1", worktreeRoot: join(fixture.root, "worktrees"), terminal, config: fixture.config, configPath: fixture.configPath,
      infrastructure: { adapterFor: fixture.adapterFor, createBroker: broker, runCommand: runSystemCommand, pidIsLive: () => false },
    }), (error: unknown) => error instanceof CandidateAdoptionRejected && /completed no ticket; partial work is never adopted/u.test(error.message));
    assert.equal(existsSync(join(fixture.stateRoot, "projects", fixture.source.project, "tasks", "fixture-shift-m1-tail")), false, "no target was created");
  } finally {
    fixture.projection.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

// The W18 M1 shape. A shift accepts T01 and T02, then T03's provider stream
// ends with no terminal event before T03 writes anything: the host records
// that turn FAILED, ended and identity-bound but with neither exit code nor
// signal, and blocks the shift at L8, so it never records L7. Canonical HEAD
// then advances and rewrites T01 (a handoff), so today's T01 bytes are not the
// ones the run compiled from. The T01-T02 prefix is integrated over that HEAD,
// the integration is cancelled, and it seeds the tail: the seed re-proves the
// prefix from the shift's accepted ticket records, over the recipe rebuilt from
// the ticket blobs of the source's own base, in place of L7.

const AT = "2026-09-28T00:00:00.000Z";
const TAIL = "fixture-shift-m1-tail";
const SEEDED = "fixture-shift-m1-t03";
const LOST = "T03";

interface JournalLine {
  event: { evidence?: Record<string, unknown>; next: Record<string, unknown> };
}

/** Rewrite an attempt's journal in place and return the function that puts its exact bytes back. */
function rewriteJournal(attemptDir: string, change: (records: JournalLine[]) => void): () => void {
  const path = journalFilePath(attemptDir);
  const before = readFileSync(path);
  const records = before.toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line) as JournalLine);
  change(records);
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return () => { writeFileSync(path, before); };
}

/** Rewrite an attempt's recorded shift selection in every journal revision and its status alike, so only the selection itself can refuse. */
function rewriteSelection(attemptDir: string, change: (manifest: ShiftManifest) => void): () => void {
  const statusPath = statusFilePath(attemptDir);
  const status = readFileSync(statusPath);
  const restoreJournal = rewriteJournal(attemptDir, (records) => {
    for (const record of records) if (record.event.next["shift"] != null) change(record.event.next["shift"] as ShiftManifest);
  });
  const next = JSON.parse(status.toString("utf8")) as { shift: ShiftManifest };
  change(next.shift);
  writeFileSync(statusPath, JSON.stringify(next));
  return () => { restoreJournal(); writeFileSync(statusPath, status); };
}

/** Set the source's spent calls in its final revision and its status alike, so only the spend itself can refuse. */
function rewriteSpent(attemptDir: string, callsSpent: number): () => void {
  const statusPath = statusFilePath(attemptDir);
  const status = readFileSync(statusPath);
  const restoreJournal = rewriteJournal(attemptDir, (records) => {
    (records.at(-1)!.event.next["budget"] as { callsSpent: number }).callsSpent = callsSpent;
  });
  const next = JSON.parse(status.toString("utf8")) as { budget: { callsSpent: number } };
  next.budget.callsSpent = callsSpent;
  writeFileSync(statusPath, JSON.stringify(next));
  return () => { restoreJournal(); writeFileSync(statusPath, status); };
}

/** The accepted record's own phase and acceptance, for one compiled phase. */
function acceptedOf(records: JournalLine[], phaseKey: string): { phase: { key: string; ordinal: number; status: string }; accepted: { ordinal: number; candidateSha: string } } {
  return acceptedRecord(records, phaseKey).event.evidence as never;
}

/** The shift's accepted record for one compiled phase, such as `t02-tests`. */
function acceptedRecord(records: JournalLine[], phaseKey: string): JournalLine {
  const record = records.find((line) => line.event.evidence?.["type"] === "phase-accepted" &&
    (line.event.evidence["accepted"] as { phaseKey: string }).phaseKey === phaseKey);
  assert.ok(record !== undefined, `the shift accepted ${phaseKey}`);
  return record;
}

/** The last process record of the lost T03 turn. */
function lostTurn(records: JournalLine[]): Record<string, unknown> {
  const record = records.filter((line) => line.event.evidence?.["type"] === "process" &&
    String(line.event.evidence["phaseId"]).endsWith(`:${LOST.toLowerCase()}-build`)).at(-1);
  assert.ok(record !== undefined, "the lost turn recorded its process");
  return record.event.evidence!;
}

function attemptBytes(attemptDir: string): Buffer[] {
  return [readFileSync(journalFilePath(attemptDir)), readFileSync(statusFilePath(attemptDir))];
}

function refs(repository: string): string {
  return `${git(repository, "for-each-ref", "--format=%(refname) %(objectname)")}\nHEAD ${git(repository, "rev-parse", "HEAD")}`;
}

function ownerCommit(repository: string, message: string): void {
  git(repository, "-c", `user.name=${OWNER.name}`, "-c", `user.email=${OWNER.email}`, "commit", "-q", "-m", message);
}

/** A shift blocked by T03's lost stream, canonical HEAD advanced with T01 rewritten, its T01-T02 prefix integrated as a merge, the integration cancelled. */
async function integratedShiftPrefix() {
  const world = await startedShift();
  const launches: string[] = [];
  const adapterFor = (_entry: AdapterEntry, id: string) => new ShiftAdapter(id, launches, LOST);
  const blocked = await runProductionCommand({
    attemptDir: world.sourceDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
    projectRecord: world.projection.project, assertAdvancement: world.projection.assertAdvancement,
    assertLaunchProjection: world.projection.assertLaunchPermitted,
    infrastructure: { adapterFor, createBroker: broker, runCommand: runSystemCommand, sandboxProbe: () => false },
  });
  assert.equal(blocked.lifecycleState, "BLOCKED", blocked.lastActivity);
  assert.deepEqual(launches, ["T01", "T02", "T03"]);
  const [first, completedTip, ...rest] = git(blocked.worktree!, "rev-list", "--reverse", `${blocked.baseSha!}..HEAD`).split("\n") as [string, string];
  assert.deepEqual(rest, [], "the lost T03 turn made no commit");

  const turn = lostTurn(readFileSync(journalFilePath(world.sourceDir), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line) as JournalLine));
  assert.deepEqual({ status: turn["status"], exitCode: turn["exitCode"], exitSignal: turn["exitSignal"], ended: turn["endedAt"] !== null },
    { status: "FAILED", exitCode: 0, exitSignal: null, ended: true }, "the lost turn is FAILED, carrying the exit its transport reported");

  mkdirSync(join(world.canonical, "docs"), { recursive: true });
  writeFileSync(join(world.canonical, "docs", "canonical.md"), "canonical advance\n");
  const t01 = join(world.canonical, "specs", "tickets", PLAN, "T01.md");
  writeFileSync(t01, readFileSync(t01, "utf8").replace("_Empty._", "T01 landed; its findings go to T03."));
  git(world.canonical, "add", ".");
  ownerCommit(world.canonical, "docs: advance canonical and hand T01's findings on");
  const head = git(world.canonical, "rev-parse", "HEAD");
  await assert.rejects(bindShiftRecipe(world.canonical, world.manifest, { prompts: { builder: "", reviewer: "" } }),
    ShiftTicketDigestMismatch, "today's T01 bytes are not the ones the shift ran");

  const adopted = await adoptCommand({
    sourceAttemptDir: world.sourceDir, stateRoot: world.stateRoot, targetTaskId: TAIL,
    request: "carry the adopted T01-T02 prefix of fixture-shift-adopt M1 over the advanced canonical HEAD",
    routes: ["reviewer=claude/anthropic/shift-target-review@high"],
    worktreeRoot: join(world.root, "worktrees"), terminal, config: world.config, configPath: world.configPath,
    infrastructure: { adapterFor, createBroker: broker, runCommand: runSystemCommand, pidIsLive: () => false, now: () => AT },
  });
  assert.equal(adopted.status?.lifecycleState, "AWAITING_OWNER", adopted.status?.blocker?.detail ?? adopted.status?.lastActivity);
  const merge = adopted.status!.candidateSha!;
  assert.equal(adopted.status!.baseSha, head);
  assert.deepEqual(git(world.canonical, "rev-list", "--parents", "-n", "1", merge).split(" "), [merge, head, completedTip],
    "the merge carries the completed T02 commit over canonical HEAD");
  assert.equal((await cancelCommand({ attemptDir: adopted.attemptDir!, terminal, cause: "owner", reason: "End adopted shift" })).status.lifecycleState, "CANCELLED");
  return { ...world, first, completedTip, head, merge, tailDir: adopted.attemptDir! };
}

type ShiftPrefixWorld = Awaited<ReturnType<typeof integratedShiftPrefix>>;

function seedTail(world: ShiftPrefixWorld, candidateSha: string, quiescence?: ProcessQuiescence) {
  return seedCommand({
    stateRoot: world.stateRoot, project: world.config.project.slug, repository: world.canonical,
    targetTaskId: SEEDED, sourceTaskId: TAIL, sourceAttempt: 1, candidateSha,
    request: "build T03 and T04 of fixture-shift-adopt M1 on the adopted T01-T02 merge", workflow: "build-review",
    config: world.config, configPath: world.configPath, terminal, now: () => AT,
    ...(quiescence === undefined ? {} : { quiescence }),
  });
}

interface ShiftSeedRefusal {
  readonly name: string;
  readonly expected: RegExp;
  /** Change the world before the seed; the returned function puts it back exactly. */
  readonly apply?: (world: ShiftPrefixWorld) => () => void;
  readonly select?: (world: ShiftPrefixWorld) => string;
  readonly quiescence?: ProcessQuiescence;
}

const SOURCE = "integration source fixture-shift-m1 attempt 1";
const source = (detail: string): RegExp => new RegExp(`${SOURCE}: ${detail}`, "u");
const UNSETTLED = source("source process is live or its settlement/survivors are unknown");

const SHIFT_SEED_REFUSALS: readonly ShiftSeedRefusal[] = [
  { name: "a completed ticket whose gate acceptance is gone",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => { delete acceptedRecord(records, "t02-tests").event.evidence; }),
    expected: source("the completed ticket prefix is not the exact one the adoption recorded") },
  { name: "a completed ticket whose gates accepted another commit",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => {
      (acceptedRecord(records, "t02-tests").event.evidence!["accepted"] as { candidateSha: string }).candidateSha = world.first;
    }),
    expected: source("ticket T02's gates accepted [0-9a-f]{40}, not its build's commit") },
  { name: "a ticket brief missing from the accepted run",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => { delete acceptedRecord(records, "t02-brief").event.evidence; }),
    expected: source("accepted ticket binding is missing or inconsistent at t02-brief") },
  { name: "an accepted ticket build whose round is not its own",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => {
      (acceptedRecord(records, "t01-build").event.evidence!["accepted"] as { round: number }).round += 1;
    }),
    expected: source("accepted ticket binding is missing or inconsistent at t01-build") },
  { name: "accepted ticket builds and gates that agree on a commit the adoption never recorded",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => {
      acceptedOf(records, "t02-build").accepted.candidateSha = world.first;
      acceptedOf(records, "t02-tests").accepted.candidateSha = world.first;
    }),
    expected: source("the completed ticket prefix is not the exact one the adoption recorded") },
  { name: "an accepted gate phase that names another phase",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => { acceptedOf(records, "t01-tests").phase.key = "t01-other"; }),
    expected: source("accepted ticket binding is missing or inconsistent at t01-tests") },
  { name: "an accepted gate phase whose phase ordinal is out of order",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => { acceptedOf(records, "t01-tests").phase.ordinal += 1; }),
    expected: source("accepted ticket binding is missing or inconsistent at t01-tests") },
  { name: "an accepted gate phase whose acceptance ordinal is out of order",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => { acceptedOf(records, "t01-tests").accepted.ordinal += 1; }),
    expected: source("accepted ticket binding is missing or inconsistent at t01-tests") },
  { name: "an accepted gate phase that never succeeded",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => { acceptedOf(records, "t01-tests").phase.status = "VALIDATING"; }),
    expected: source("accepted ticket binding is missing or inconsistent at t01-tests") },
  { name: "an accepted ticket build a later record left FAILED",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => {
      const at = records.indexOf(acceptedRecord(records, "t01-build"));
      const later = records.slice(at + 1).find((line) => line.event.evidence?.["type"] === "phase" &&
        (line.event.evidence["phase"] as { key: string }).key === "t01-build");
      assert.ok(later !== undefined, "the host recorded t01-build's state after accepting it");
      (later.event.evidence!["phase"] as { status: string }).status = "FAILED";
    }),
    expected: source("phase t01-build did not stay SUCCEEDED after its acceptance") },
  { name: "more recorded process calls than the source spent",
    apply: (world) => rewriteSpent(world.sourceDir, 0),
    expected: source("missing completed builder or settled call evidence") },
  { name: "a source that recorded no process",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => {
      for (const record of records) if (record.event.evidence?.["type"] === "process") delete record.event.evidence;
    }),
    expected: source("missing completed builder or settled call evidence") },
  { name: "a recorded ticket run the source never completed",
    apply: (world) => rewriteJournal(world.tailDir, (records) => {
      const adoption = records[0]!.event.evidence!["adoption"] as CandidateAdoptionEvidence;
      adoption.shift = { ...adoption.shift!, completedTickets: ["T01", "T02", "T03"], remainingTickets: ["T04"] };
    }),
    expected: source("the completed ticket prefix is not the exact one the adoption recorded") },
  { name: "a selection that names today's T01 bytes rather than its base's",
    apply: (world) => rewriteSelection(world.sourceDir, (manifest) => {
      manifest.tickets[0]!.digest = ticketFileDigest(readFileSync(join(world.canonical, manifest.tickets[0]!.path)));
      manifest.manifestDigest = sealShiftManifest(manifest).manifestDigest;
    }),
    expected: source("the source shift cannot be rebuilt from its recorded selection at its base: ticket T01 changed since selection") },
  { name: "a selection whose manifest digest no longer covers its tickets",
    apply: (world) => rewriteSelection(world.sourceDir, (manifest) => {
      manifest.manifestDigest = `${manifest.manifestDigest.slice(0, -1)}${manifest.manifestDigest.endsWith("0") ? "1" : "0"}`;
    }),
    expected: source("the source shift cannot be rebuilt from its recorded selection at its base: .*manifestDigest does not cover") },
  { name: "a selection naming a ticket its base never held",
    apply: (world) => rewriteSelection(world.sourceDir, (manifest) => {
      manifest.tickets[1]!.path = `specs/tickets/${PLAN}/T09.md`;
      manifest.manifestDigest = sealShiftManifest(manifest).manifestDigest;
    }),
    expected: source("the source shift cannot be rebuilt from its recorded selection at its base: ticket T02 has no blob") },
  { name: "a changed source revision",
    apply: (world) => rewriteJournal(world.tailDir, (records) => {
      (records[0]!.event.evidence!["adoption"] as CandidateAdoptionEvidence).sourceRevision += 1;
    }),
    expected: source("not the exact sealed revision the adoption recorded") },
  { name: "a changed source status",
    apply: (world) => {
      const path = statusFilePath(world.sourceDir);
      const before = readFileSync(path);
      writeFileSync(path, JSON.stringify({ ...JSON.parse(before.toString("utf8")), lastActivity: "rewritten after sealing" }));
      return () => { writeFileSync(path, before); };
    },
    expected: source("status does not equal the final journal revision") },
  { name: "a recorded source candidate short of the completed prefix",
    apply: (world) => rewriteJournal(world.tailDir, (records) => {
      (records[0]!.event.evidence!["adoption"] as CandidateAdoptionEvidence).candidateSha = world.first;
    }),
    expected: /recorded integration is not the host's exact merge/u },
  { name: "the completed prefix commit selected instead of the merge", select: (world) => world.completedTip,
    expected: /no exact host-created integration candidate binding/u },
  { name: "the first ticket's commit selected", select: (world) => world.first,
    expected: /no exact host-created integration candidate binding/u },
  { name: "a canonical HEAD that moved after the integration",
    apply: (world) => {
      writeFileSync(join(world.canonical, "docs", "later.md"), "later\n");
      git(world.canonical, "add", "docs/later.md");
      ownerCommit(world.canonical, "docs: advance canonical again");
      return () => { git(world.canonical, "reset", "-q", "--hard", world.head); };
    },
    expected: /candidate\/base mismatch or canonical HEAD moved/u },
  { name: "a dirty canonical checkout",
    apply: (world) => {
      writeFileSync(join(world.canonical, "stray.txt"), "dirty\n");
      return () => { rmSync(join(world.canonical, "stray.txt")); };
    },
    expected: /not clean/u },
  { name: "a live source process", quiescence: () => "live", expected: UNSETTLED },
  { name: "an unknown source process census", quiescence: () => "unknown", expected: UNSETTLED },
  { name: "a lost turn bound to no start identity",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => {
      ((lostTurn(records)["record"] as { identity: { startIdentity: string | null } }).identity).startIdentity = null;
    }),
    quiescence: () => "quiescent", expected: UNSETTLED },
  { name: "a lost turn that never ended",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => { lostTurn(records)["endedAt"] = null; }),
    quiescence: () => "quiescent", expected: UNSETTLED },
  { name: "a turn recorded EXITED with neither exit code nor signal",
    apply: (world) => rewriteJournal(world.sourceDir, (records) => {
      const turn = lostTurn(records);
      turn["status"] = "EXITED";
      turn["exitCode"] = null;
    }),
    quiescence: () => "quiescent", expected: UNSETTLED },
];

test("a shift's T01-T02 prefix, stopped by a lost T03 stream and integrated over a HEAD that rewrote T01, seeds T03 read-only and starts; every broken proof refuses first", async (t) => {
  const world = await integratedShiftPrefix();
  const continued = join(world.stateRoot, "projects", world.config.project.slug, "tasks", SEEDED);
  try {
    const exact = [...attemptBytes(world.sourceDir), ...attemptBytes(world.tailDir)];
    const refsBefore = refs(world.canonical);

    await t.test("read-only inspection passes on the exact merge and integration base", async () => {
      const inspected = await inspectSeedSource(world.tailDir, world.canonical,
        { project: world.config.project.slug, taskId: TAIL, attempt: 1, candidateSha: world.merge });
      assert.deepEqual({ baseSha: inspected.baseSha, candidateSha: inspected.candidateSha }, { baseSha: world.head, candidateSha: world.merge });
      assert.deepEqual([...attemptBytes(world.sourceDir), ...attemptBytes(world.tailDir)], exact);
      assert.equal(refs(world.canonical), refsBefore);
    });

    for (const scenario of SHIFT_SEED_REFUSALS) {
      await t.test(`seed refuses before target creation: ${scenario.name}`, async () => {
        const restore = scenario.apply?.(world) ?? (() => {});
        try {
          const bytes = [...attemptBytes(world.sourceDir), ...attemptBytes(world.tailDir)];
          const refsNow = refs(world.canonical);
          await assert.rejects(seedTail(world, scenario.select?.(world) ?? world.merge, scenario.quiescence), scenario.expected);
          assert.equal(existsSync(continued), false, "no target was created");
          assert.deepEqual([...attemptBytes(world.sourceDir), ...attemptBytes(world.tailDir)], bytes, "a refused seed writes nothing");
          assert.equal(refs(world.canonical), refsNow);
        } finally {
          restore();
        }
        assert.deepEqual([...attemptBytes(world.sourceDir), ...attemptBytes(world.tailDir)], exact);
        assert.equal(refs(world.canonical), refsBefore);
      });
    }

    await t.test("the seed is created on the exact merge and its startup re-proves the prefix", async () => {
      const seeded = await seedTail(world, world.merge);
      assert.equal(seeded.confirmed, true);
      const seed = seeded.status?.seed;
      assert.deepEqual({ source: seed?.source.taskId, base: seed?.integrationBaseSha, candidate: seed?.seedCandidateSha },
        { source: TAIL, base: world.head, candidate: world.merge });
      const started = await startCommand({ attemptDir: seeded.attemptDir!, worktreeRoot: join(world.root, "targets"),
        configPath: world.configPath, preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
      assert.equal(started.lifecycleState, "PREPARED", started.blocker?.detail);
      assert.equal(git(started.worktree!, "rev-parse", "HEAD"), world.merge);
      assert.equal(git(world.canonical, "rev-parse", "HEAD"), world.head, "no seed or start moves canonical HEAD");
      assert.deepEqual([...attemptBytes(world.sourceDir), ...attemptBytes(world.tailDir)], exact, "neither sealed attempt was written");
    });
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});
