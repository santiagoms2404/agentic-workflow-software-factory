import assert from "node:assert/strict";
import { renderAttemptNextAction } from "../../src/lifecycle/renderer.ts";
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
import { isTaskEdgeRegistration, reservationIdOf } from "../../src/adapters/interface.ts";
import { loadConfig } from "../../src/config/load.ts";
import type { AdapterEntry } from "../../src/config/schema.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import { REVIEW_CONTEXT_SCHEMA_ID, type ReviewContext } from "../../src/contracts/review-context.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { resumeProductionCommand, runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import { k1Request, startUnderK1 } from "../fixtures/k1-preflight.ts";
import { statusCommand } from "../../src/cli/commands/status.ts";
import type { CallBudget, Reservation } from "../../src/execution/call-budget.ts";
import { runSystemCommand, type BrokerOptions } from "../../src/execution/transport-broker.ts";
import { readCandidateRef } from "../../src/git/candidate-ref.ts";
import { bindShiftRecipe, shiftTicketCandidates } from "../../src/workflow/shift/bind.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { callCeilingsOf } from "../../src/state/tiers.ts";

// W17 M4 task 11, end to end on the fixture route: a six-ticket shift whose
// gate goes red on ticket 3. The shift stops at that ticket and says so, with
// tickets 1 and 2 accepted and committed and tickets 4 to 6 never reserving a
// call. It does not skip ticket 3 and it does not rework it. The owner fixes
// the cause, and resume re-measures ticket 3 against the same candidate, then
// runs the tail and the one review.
//
// The gate verdict is scripted through the runner's command seam, keyed to the
// candidate ticket 3 produced, so the red is deterministic and costs nothing.

const PLAN = "fixture-shift";
const TICKETS = ["T01", "T02", "T03", "T04", "T05", "T06"] as const;
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
  constructor(id: string, worktree: string, launches: string[]) {
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
      text = JSON.stringify(build(ticket));
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

/** Spends on GO like the real broker, and keeps each run's ledger so its history() can be read. */
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

/**
 * The configured `test` gate, with its verdict scripted for ticket 3's
 * candidate only: `exit` is a suite that ran and failed, `no-exit` a command
 * that never reported an exit status. Every other command runs for real.
 */
function scriptedGate(verdict: { value: "green" | "exit" | "no-exit" }, measuredT03: string[]) {
  return (executable: string, argv: readonly string[], options: Parameters<typeof runSystemCommand>[2]) => {
    const cwd = typeof options === "number" ? undefined : options.cwd;
    const gate = executable === "node" && argv.length === 2 && argv[0] === GATE[0] && argv[1] === GATE[1];
    const t03 = cwd !== undefined && existsSync(join(cwd, "core/src/widget-t03.ts")) && !existsSync(join(cwd, "core/src/widget-t04.ts"));
    if (!gate || !t03) return runSystemCommand(executable, argv, options);
    measuredT03.push(verdict.value);
    if (verdict.value === "exit") return { status: 1, stdout: "", stderr: "widget-t03 fails its suite\n", error: null };
    if (verdict.value === "no-exit") return { status: null, stdout: "", stderr: "", error: "spawnSync node ETIMEDOUT" };
    return runSystemCommand(executable, argv, options);
  };
}

async function world() {
  const root = mkdtempSync(join(tmpdir(), "awsf-shift-blocked-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  const directory = join(canonical, "specs", "tickets", PLAN);
  mkdirSync(directory, { recursive: true });
  for (const id of TICKETS) writeFileSync(join(directory, `${id}.md`), ticketSource(id));
  git(canonical, "add", ".");
  git(canonical, "-c", `user.name=${OWNER.name}`, "-c", `user.email=${OWNER.email}`, "commit", "-m", "test: seed a shift's tickets");
  // Six tickets need seven calls, plus the one call of cold-correction
  // headroom `awsf start` holds back, so T2's ceiling is set to ten.
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
    request: k1Request("run milestone M1 of the fixture shift", "core/src/widget.ts"), workflow: "shift", tier: 2, shift: manifest,
    callCeilings: callCeilingsOf(config.risk.call_ceiling), configSnapshotJson: JSON.stringify(config), projectRecord: projection.project });
  await startUnderK1({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project });
  return { root, canonical, stateRoot, config, configPath, projection, attemptDir: created.attemptDir };
}

async function harness(fixture: Awaited<ReturnType<typeof world>>, verdict: { value: "green" | "exit" | "no-exit" }) {
  const prepared = await readAttempt(fixture.attemptDir);
  const launches: string[] = [];
  const ledgers = new Set<CallBudget>();
  const measuredT03: string[] = [];
  const options = {
    attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, config: fixture.config, configPath: fixture.configPath,
    projectRecord: fixture.projection.project, assertAdvancement: fixture.projection.assertAdvancement,
    assertLaunchProjection: fixture.projection.assertLaunchPermitted,
    infrastructure: {
      adapterFor: (_entry: AdapterEntry, id: string) => new ShiftAdapter(id, prepared.worktree!, launches),
      createBroker: recordingBroker(ledgers), runCommand: scriptedGate(verdict, measuredT03), sandboxProbe: () => false,
    },
  };
  return { prepared, launches, ledgers, measuredT03, options };
}

const settledCalls = (history: readonly Reservation[]): number => history.reduce((sum, entry) => sum + entry.spent, 0);
const terminal = { interactive: true, write: () => {}, confirm: async () => true };

/** The phase each spent reservation paid for, read off the process rows that spent it. */
async function phasesPaidBy(attemptDir: string, history: readonly Reservation[]): Promise<string[]> {
  const evidence = await readAttemptEvidence(attemptDir);
  return history.map((reservation) => {
    const spent = evidence.find((entry) => entry.type === "process" && entry.status === "RUNNING" && entry.record.reservationId === reservation.id);
    assert.ok(spent?.type === "process", `reservation ${reservation.id} has a spending process row`);
    return spent.phaseId.split(":").at(-1)!;
  });
}

test("a red gate on ticket 3 of 6 blocks the shift there, keeps the prefix, reserves nothing after it, and resumes to the review", async () => {
  const fixture = await world();
  const verdict = { value: "exit" as "green" | "exit" | "no-exit" };
  const { prepared, launches, ledgers, measuredT03, options } = await harness(fixture, verdict);
  try {
    assert.equal(prepared.budget.ceiling, 10);

    // The block: RUNNING with a blocker, because BLOCKED is sealed and a
    // sealed attempt could never resume from its prefix.
    const blocked = await runProductionCommand(options);
    assert.equal(blocked.lifecycleState, "RUNNING", blocked.lastActivity);
    assert.equal(blocked.recovery?.kind, "ticket-block");
    assert.equal(blocked.recovery?.ticket, "T03", "the checkpoint names the ticket it blocked at");
    assert.equal(blocked.blocker?.code, "phase-abort");
    assert.equal(blocked.blocker?.source, "gate", "the suite ran and measured the candidate red");
    assert.match(blocked.blocker!.detail, /^ticket T03 \(t03-tests\) blocked the shift: gate commands_pass is red on [0-9a-f]{40}: test exited 1$/u);
    assert.equal(blocked.nextAction, renderAttemptNextAction(blocked));
    assert.match(blocked.nextAction, /ticket-blocked at ticket T03.*awsf resume fixture-shift-m1.*--reason/u);
    const accepted = ["t01-brief", "t01-build", "t01-tests", "t02-brief", "t02-build", "t02-tests", "t03-brief", "t03-build"];
    assert.deepEqual(blocked.recovery?.prefix.map((entry) => entry.phaseKey), accepted, "the prefix is durable up to ticket 3's build");
    assert.deepEqual(launches, ["T01", "T02", "T03"], "ticket 3 was neither skipped nor retried, and nothing after it launched");
    assert.deepEqual(measuredT03, ["exit"]);
    assert.equal(blocked.budget.callsSpent, 3);
    assert.equal(blocked.budget.callsReserved, 0);

    // The ledger, not a log line: three reservations ever held, all settled,
    // none outstanding, and each one paid for a ticket-1..3 build.
    assert.equal(ledgers.size, 1);
    const first = [...ledgers][0]!;
    assert.deepEqual(first.outstanding(), []);
    assert.equal(first.history().length, 3, "no later ticket's phase reserved a call after the block");
    assert.equal(settledCalls(first.history()), 3);
    assert.deepEqual(await phasesPaidBy(fixture.attemptDir, first.history()), ["t01-build", "t02-build", "t03-build"]);

    // Nothing sealed the attempt, and the record reads as a gate.
    const evidence = await readAttemptEvidence(fixture.attemptDir);
    assert.equal(evidence.some((entry) => entry.type === "transition" && entry.to === "BLOCKED"), false);
    const block = evidence.findLast((entry) => entry.type === "ticket-block");
    assert.ok(block?.type === "ticket-block");
    assert.equal(block.source, "gate");
    assert.equal(block.phaseKey, "t03-tests");
    const lines = await statusCommand(fixture.attemptDir);
    assert.ok(lines.some((line) => line.startsWith("State: RUNNING; blocker phase-abort (gate): ticket T03 (t03-tests)")), lines.join("\n"));
    assert.ok(lines.some((line) => /Recovery: ticket-blocked.*8 completed phase\(s\); next ticket T03/u.test(line)), lines.join("\n"));

    // Every earlier ticket's commit is on the head, ticket 3's red one last.
    const ticketThreeSha = blocked.recovery!.prefix.at(-1)!.candidateSha!;
    // The owner readout, gathered by `awsf status` from the real records.
    assert.ok(lines.includes(`  T03  Ticket T03 adds its own widget  ${ticketThreeSha.slice(0, 7)}  RED: gates red`), lines.join("\n"));
    assert.ok(lines.includes("  T04  Ticket T04 adds its own widget  -------  not run"), lines.join("\n"));
    const prefixCommits = git(prepared.worktree!, "rev-list", "--reverse", `${prepared.baseSha!}..HEAD`).split("\n");
    assert.equal(prefixCommits.length, 3);
    assert.equal(prefixCommits[2], ticketThreeSha);
    assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), ticketThreeSha);
    assert.equal(readCandidateRef(fixture.canonical, blocked), null, "a ticket block does not seal, so no candidate ref is written");

    // A resume before the cause is fixed re-measures ticket 3 only. It builds
    // nothing and holds no call, so no broker is ever created for it.
    const again = await resumeProductionCommand({ ...options, reason: "retry the gate once more", terminal });
    assert.equal(again.status.lifecycleState, "RUNNING");
    assert.equal(again.status.recovery?.kind, "ticket-block");
    assert.equal(again.status.recovery?.ticket, "T03");
    assert.deepEqual(measuredT03, ["exit", "exit"], "the gate was dispatched afresh, not restored from the red run");
    assert.deepEqual(launches, ["T01", "T02", "T03"]);
    assert.equal(ledgers.size, 1, "the re-measure never opened a broker, so it could not reserve a call");
    assert.equal(again.status.budget.callsSpent, 3);

    // The owner fixes the cause. Resume re-runs ticket 3's gate phase, then
    // the tail and the review, and repeats nothing that was accepted.
    verdict.value = "green";
    const resumed = await resumeProductionCommand({ ...options, reason: "the owner fixed the gate environment", terminal });
    assert.equal(resumed.confirmed, true);
    const done = resumed.status;
    assert.equal(done.lifecycleState, "AWAITING_OWNER", done.blocker?.detail);
    assert.equal(done.blocker, null);
    assert.deepEqual(measuredT03, ["exit", "exit", "green"]);
    assert.deepEqual(launches, ["T01", "T02", "T03", "T04", "T05", "T06", "review"], "no completed phase ran twice");
    assert.equal(done.budget.callsSpent, 7);
    assert.equal(done.budget.callsReserved, 0);
    assert.equal(ledgers.size, 2);
    const last = [...ledgers][1]!;
    assert.equal(settledCalls(last.history()), 4, "the resumed ledger paid only for the unrun tail and the review");

    // Six ticket commits on one head, the first three exactly as they were.
    const commits = git(prepared.worktree!, "rev-list", "--reverse", `${prepared.baseSha!}..HEAD`).split("\n");
    assert.equal(commits.length, 6);
    assert.deepEqual(commits.slice(0, 3), prefixCommits, "the earlier tickets' commits survived the block and the resume");
    for (const id of TICKETS) assert.ok(git(prepared.worktree!, "ls-files", `core/src/widget-${id.toLowerCase()}.ts`).length > 0);

    // One ref at the tip, in the canonical repository, and every ticket's own
    // commit projected from the accepted prefix against its ticket id.
    assert.equal(done.candidateSha, commits[5]);
    assert.equal(readCandidateRef(fixture.canonical, done), commits[5]);
    assert.equal(git(fixture.canonical, "for-each-ref", "--format=%(refname)", "refs/awsf"), `refs/awsf/candidates/${done.project}/${done.taskId}/1`);
    const readout = await statusCommand(fixture.attemptDir);
    for (const [index, id] of TICKETS.entries()) {
      assert.ok(readout.includes(`  ${id}  Ticket ${id} adds its own widget  ${commits[index]!.slice(0, 7)}  gates 1/1`), readout.join("\n"));
    }
    assert.ok(readout.some((line) => /^Shift review: accept by claude\/\S+ on [0-9a-f]{7} for the accumulated diff — 0 finding\(s\), 0 blocking$/u.test(line)), readout.join("\n"));
    assert.ok(readout.includes(`Candidate ref: refs/awsf/candidates/${done.project}/${done.taskId}/1 at ${commits[5]!} — ` +
      `reach it with \`git log refs/awsf/candidates/${done.project}/${done.taskId}/1\`; no worktree is needed`), readout.join("\n"));
    assert.ok(readout.some((line) => line.startsWith("Owner gate: AWAITING_OWNER since ")), readout.join("\n"));
    const recipe = await bindShiftRecipe(fixture.canonical, done.shift!, { prompts: { builder: "", reviewer: "" } });
    assert.deepEqual(shiftTicketCandidates(recipe.phases, done.recovery!.prefix),
      TICKETS.map((ticketId, index) => ({ ticketId, candidateSha: commits[index] })));

    // The one review is judged against every ticket's brief, not the last.
    const contexts = (await readAttemptEvidence(fixture.attemptDir))
      .flatMap((entry) => entry.type === "envelope" && entry.envelope.schemaId === REVIEW_CONTEXT_SCHEMA_ID ? [entry.envelope.payload as ReviewContext] : []);
    assert.equal(contexts.length, 1);
    assert.deepEqual(contexts[0]!.goals.map((goal) => /TASK (T\d\d)\./u.exec(goal)?.[1]), [...TICKETS]);
    assert.deepEqual(contexts[0]!.acceptanceCriteria.map((criterion) => criterion.split(":")[0]), [...TICKETS]);
  } finally {
    fixture.projection.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a gate command with no exit status blocks as a process failure, and reads differently from a red gate", async () => {
  const fixture = await world();
  const verdict = { value: "no-exit" as "green" | "exit" | "no-exit" };
  const { launches, ledgers, options } = await harness(fixture, verdict);
  try {
    const blocked = await runProductionCommand(options);
    assert.equal(blocked.lifecycleState, "RUNNING", blocked.lastActivity);
    assert.equal(blocked.recovery?.kind, "ticket-block");
    assert.equal(blocked.recovery?.ticket, "T03");
    assert.equal(blocked.blocker?.code, "phase-abort");
    assert.equal(blocked.blocker?.source, "process", "the host never got a verdict from the gate");
    assert.match(blocked.blocker!.detail,
      /^ticket T03 \(t03-tests\) blocked the shift: test reported no exit status on [0-9a-f]{40}, so the host could not measure it and the cause may not be this ticket$/u);
    assert.doesNotMatch(blocked.blocker!.detail, /is red/u);
    assert.deepEqual(launches, ["T01", "T02", "T03"]);
    assert.equal([...ledgers][0]!.history().length, 3);
    const lines = await statusCommand(fixture.attemptDir);
    assert.ok(lines.some((line) => line.startsWith("State: RUNNING; blocker phase-abort (process): ticket T03 (t03-tests)")), lines.join("\n"));
    const block = (await readAttemptEvidence(fixture.attemptDir)).findLast((entry) => entry.type === "ticket-block");
    assert.ok(block?.type === "ticket-block");
    assert.equal(block.source, "process");
  } finally {
    fixture.projection.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
