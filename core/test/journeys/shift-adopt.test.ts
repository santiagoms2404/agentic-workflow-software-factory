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
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
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
  constructor(id: string, launches: string[]) {
    this.id = id; this.#launches = launches;
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

/** A four-ticket shift, run until its gate goes red on `red`, then cancelled by the owner. */
async function blockedAndCancelledShift(red: string) {
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
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "");
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
  const launches: string[] = [];
  const adapterFor = (_entry: AdapterEntry, id: string) => new ShiftAdapter(id, launches);
  const blocked = await runProductionCommand({
    attemptDir: created.attemptDir, stateRoot, config, configPath,
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
  const cancelled = await cancelCommand({ attemptDir: created.attemptDir, terminal, projectRecord: projection.project });
  assert.equal(cancelled.status.lifecycleState, "CANCELLED");
  assert.deepEqual(cancelled.report.survivors, []);
  const commits = git(blocked.worktree!, "rev-list", "--reverse", `${blocked.baseSha!}..HEAD`).split("\n");
  return { root, canonical, stateRoot, config, configPath, projection, sourceDir: created.attemptDir, source: cancelled.status,
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
      worktreeRoot: join(fixture.root, "worktrees"), terminal, config: fixture.config, configPath: fixture.configPath,
      projectRecord: fixture.projection.project, assertAdvancement: fixture.projection.assertAdvancement,
      assertLaunchProjection: fixture.projection.assertLaunchPermitted,
      infrastructure: { adapterFor: fixture.adapterFor, createBroker: broker, runCommand: runSystemCommand, pidIsLive: () => false },
    });

    assert.equal(result.confirmed, true);
    const target = result.status!;
    assert.equal(target.lifecycleState, "AWAITING_OWNER", target.blocker?.detail ?? target.lastActivity);
    assert.equal(target.workflow, "build-review", "the continuation is ordinary review work, never a shift");
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
