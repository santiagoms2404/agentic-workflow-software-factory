import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { main } from "../../src/cli/main.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { journeyCommand } from "../../src/cli/commands/journey.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import { statusCommand } from "../../src/cli/commands/status.ts";
import { runSystemCommand, type BrokerOptions } from "../../src/execution/transport-broker.ts";
import { readCandidateRef } from "../../src/git/candidate-ref.ts";
import { attemptDir as attemptDirectory } from "../../src/persistence/platform-paths.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { minimumCallsFor } from "../../src/workflow/catalog.ts";
import { bindShiftRecipe, shiftTicketCandidates } from "../../src/workflow/shift/bind.ts";
import { serializeShiftRecipe, ShiftTicketDigestMismatch, type ShiftRecipe } from "../../src/workflow/shift/compile.ts";

// W17 M6 task 18: one milestone, selection through AWAITING_OWNER, driven
// through the real CLI for every step a terminal takes (`awsf shift plan`,
// `awsf new --workflow shift --plan --milestone`, `awsf start`) and through
// the production runner on the fixture route for the part a provider would
// spend. Every Identifier Spine row is asserted here or, where an earlier
// milestone already owns the proof, pointed at by name in the last test, so
// the whole claim can be read in one file.

const PLAN = "fixture-milestone";
const PROJECT = "agentic-workflow-software-factory";
const TASK = "fixture-milestone-m1";
const SELECTED = ["T01", "T02", "T03"] as const;
const OWNER = { name: "Santiago Marin", email: "santiagomarinsuarez@me.com" };
const GATE = ["-e", "process.exit(0)"] as const;

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

const TICKETS: Readonly<Record<string, { milestone: string; state: string; depends: string[] }>> = {
  T00: { milestone: "M0", state: "done", depends: [] },
  T01: { milestone: "M1", state: "todo", depends: ["T00"] },
  T02: { milestone: "M1", state: "todo", depends: ["T01"] },
  T03: { milestone: "M1", state: "todo", depends: ["T01", "T02"] },
};

function ticketSource(id: string): string {
  const { milestone, state, depends } = TICKETS[id]!;
  const title = `Ticket ${id} adds its own widget`;
  return [
    "---", `id: ${id}`, `title: ${JSON.stringify(title)}`, `milestone: ${milestone}`, `state: ${state}`,
    `depends_on: [${depends.join(", ")}]`, "---",
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
    const at = "2026-09-26T00:00:00.000Z";
    let text: string;
    if (request.prompt.includes("awsf.review-output/v1")) {
      this.#launches.push(`review:${this.id}`);
      text = JSON.stringify(review(this.#worktree));
    } else {
      const ticket = /TASK (T\d\d)\./u.exec(request.prompt)?.[1];
      assert.ok(ticket !== undefined, "the builder is rendered its own ticket's brief");
      this.#launches.push(`${ticket}:${this.id}`);
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

/** Spends on GO like the real broker, and counts every process it is asked to start. */
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

/** The shipped config, cut to an offline gate, with T2's ceiling at `t2`. */
function configText(t2: number): string {
  return readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replaceAll("interrupted_turn: true", "interrupted_turn: false")
    .replace("call_ceiling: { T0: 1, T1: 3, T2: 5 }", `call_ceiling: { T0: 1, T1: 3, T2: ${String(t2)} }`)
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", `test: { argv: [node, ${GATE[0]}, ${GATE[1]}], timeout_seconds: 10 }`)
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "")
    .replace("  journeys: { argv: [npm, run, test:journeys], timeout_seconds: 2400 }\n", "");
}

function world() {
  const root = mkdtempSync(join(tmpdir(), "awsf-shift-milestone-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  writeFileSync(join(canonical, "awsf.project.yaml"), [
    "version: awsf.project/v1", "", "project:", `  slug: ${PROJECT}`, "", "repositories:", "  app:", "    role: plan",
    "    default_branch: main", "    delivery: none", "", "plans:", "  root: specs", "  format: awsf-plan-html/v1", "",
  ].join("\n"));
  const directory = join(canonical, "specs", "tickets", PLAN);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(canonical, "specs", `${PLAN}.html`), "<!doctype html><title>fixture milestone plan</title>\n");
  for (const id of Object.keys(TICKETS)) writeFileSync(join(directory, `${id}.md`), ticketSource(id));
  git(canonical, "add", ".");
  git(canonical, "-c", `user.name=${OWNER.name}`, "-c", `user.email=${OWNER.email}`, "commit", "-m", "test: seed a milestone's tickets");
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText(5));
  const tightConfigPath = join(root, "awsf.tight.yaml");
  writeFileSync(tightConfigPath, configText(3));
  const config = loadConfig(configText(5));
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      mkdirSync(resolve(join(root, promptPath), ".."), { recursive: true });
      writeFileSync(join(root, promptPath), readFileSync(resolve(promptPath), "utf8"));
    }
  }
  mkdirSync(join(root, "prompts", "shared"), { recursive: true });
  writeFileSync(join(root, "prompts/shared/headless-role.md"), readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));
  return { root, canonical, stateRoot, config, configPath, tightConfigPath, worktreeRoot: join(root, "worktrees") };
}

/**
 * Runs the real CLI from inside the fixture repository. Plan sources resolve
 * self-placement from `process.cwd()`, so a `cwd` option alone would find no
 * plan; the directory is restored whatever happens.
 */
async function cli(canonical: string, argv: readonly string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const previous = process.cwd();
  process.chdir(canonical);
  try {
    const code = await main({ argv, cwd: canonical, writeOut: (line) => out.push(line), writeError: (line) => err.push(line) });
    return { code, out, err };
  } finally {
    process.chdir(previous);
  }
}

const serialized = (recipe: unknown): string => serializeShiftRecipe(recipe as ShiftRecipe);

test("one milestone runs from selection to AWAITING_OWNER once, with the readout, the ref and the per-ticket record, then journeys and lands", async () => {
  const fixture = world();
  const common = ["--state-root", fixture.stateRoot, "--config", fixture.configPath];
  try {
    // AC-1 · AC-2: the pre-flight readout, at zero cost.
    const plan = await cli(fixture.canonical, ["shift", "plan", PLAN, "--milestone", "M1", "--config", fixture.configPath]);
    assert.equal(plan.code, 0, plan.err.join("\n"));
    assert.deepEqual(plan.out.slice(0, 7), [
      `shift plan ${PLAN} --milestone M1`,
      ...SELECTED.map((id) => `  ${id}  Ticket ${id} adds its own widget`),
      "minimumCalls = 3 + 1 = 4",
      "ceiling: T2 = 5",
      "remaining headroom: 1 call(s)",
    ]);
    assert.match(plan.out.slice(7).join("\n"), /Route advisory · builder · unclassified/);
    assert.match(plan.out.slice(7).join("\n"), /advisory: the runner never routes on this/);
    // AC-2 · INV-5: a ceiling that cannot fit is refused by name, before any
    // attempt, worktree or process exists, and names the raise act it needs.
    const tight = await cli(fixture.canonical, ["shift", "plan", PLAN, "--milestone", "M1", "--config", fixture.tightConfigPath]);
    assert.equal(tight.code, 1);
    assert.ok(tight.err.some((line) => /CallCeilingExceeded/u.test(line) && /needs 1 awsf raise act\(s\)/u.test(line)), tight.err.join("\n"));
    assert.equal(existsSync(join(fixture.stateRoot, "projects")), false, "a refused pre-flight wrote nothing");

    // AC-1: one selection act seals the manifest onto the attempt. The done
    // M0 dependency is outside the selection and admitted; nothing else is.
    const created = await cli(fixture.canonical, ["new", TASK, "run milestone M1 of the fixture plan", "--workflow", "shift",
      "--plan", PLAN, "--milestone", "M1", ...common]);
    assert.equal(created.code, 0, created.err.join("\n"));
    const attemptDir = attemptDirectory(fixture.stateRoot, PROJECT, TASK, "1");
    const drafted = await readAttempt(attemptDir);
    assert.equal(drafted.workflow, "shift");
    assert.equal(drafted.tier, 2, "the tier is derived from the selection, never typed");
    assert.equal(drafted.planRef !== null, true, "the shift is recorded against its plan");
    const manifest = drafted.shift!;
    assert.equal(manifest.plan, PLAN);
    assert.deepEqual(manifest.milestones, ["M1"]);
    assert.deepEqual(manifest.tickets.map((ticket) => ticket.id), [...SELECTED]);
    for (const ticket of manifest.tickets) {
      assert.equal(ticket.path, `specs/tickets/${PLAN}/${ticket.id}.md`);
      assert.equal(ticket.digest, ticketFileDigest(readFileSync(join(fixture.canonical, ticket.path))), `${ticket.id}'s bytes are digested whole`);
    }
    assert.ok(created.out.includes(`Shift: ${PLAN} M1, 3 ticket(s) sealed as ${manifest.manifestDigest}.`), created.out.join("\n"));
    // A shift without a selection, and a selection without a shift, are refused.
    const bare = await cli(fixture.canonical, ["new", `${TASK}-bare`, "no selection", "--workflow", "shift", ...common]);
    assert.equal(bare.code, 1);
    assert.ok(bare.err.some((line) => line.includes("requires --plan <stem> and --milestone")), bare.err.join("\n"));
    const stray = await cli(fixture.canonical, ["new", `${TASK}-stray`, "a stray selection", "--workflow", "build-review", "--milestone", "M1", ...common]);
    assert.equal(stray.code, 1);
    assert.ok(stray.err.some((line) => line.includes("--milestone selects a shift")), stray.err.join("\n"));

    // INV-4: the recipe is rebuilt byte for byte from the manifest and the
    // ticket files, and one moved byte refuses the compile instead of running
    // other words.
    const prompts = { builder: "", reviewer: "" };
    const first = await bindShiftRecipe(fixture.canonical, manifest, { prompts });
    assert.equal(serialized(first), serialized(await bindShiftRecipe(fixture.canonical, manifest, { prompts })));
    assert.equal(minimumCallsFor(first), SELECTED.length + 1, "AC-2: N tickets compile to N + 1 calls");
    const t02 = join(fixture.canonical, manifest.tickets[1]!.path);
    const original = readFileSync(t02);
    writeFileSync(t02, Buffer.concat([original, Buffer.from(" ")]));
    await assert.rejects(bindShiftRecipe(fixture.canonical, manifest, { prompts }), ShiftTicketDigestMismatch);
    writeFileSync(t02, original);

    const started = await cli(fixture.canonical, ["start", TASK, "--stub", "true", "--worktree-root", fixture.worktreeRoot, ...common]);
    assert.equal(started.code, 0, started.err.join("\n"));

    // The provider half, on the fixture route.
    const prepared = await readAttempt(attemptDir);
    const launches: string[] = [];
    const brokered: string[] = [];
    const projection = createDashboardProjection(fixture.stateRoot);
    let done;
    try {
      done = await runProductionCommand({
        attemptDir, stateRoot: fixture.stateRoot, config: fixture.config, configPath: fixture.configPath,
        projectRecord: projection.project, assertAdvancement: projection.assertAdvancement,
        assertLaunchProjection: projection.assertLaunchPermitted,
        infrastructure: {
          adapterFor: (_entry: AdapterEntry, id: string) => new ShiftAdapter(id, prepared.worktree!, launches),
          createBroker: countingBroker(brokered), runCommand: runSystemCommand, sandboxProbe: () => false,
        },
      });
    } finally {
      projection.close();
    }

    // AC-6: the owner gate is reached, and exactly once.
    assert.equal(done.lifecycleState, "AWAITING_OWNER", done.blocker?.detail ?? done.lastActivity);
    const evidence = await readAttemptEvidence(attemptDir);
    const arrivals = evidence.filter((entry) => entry.type === "transition" && entry.to === "AWAITING_OWNER");
    assert.equal(arrivals.length, 1, "one shift, one owner gate");

    // AC-2 · INV-5: N + 1 calls spent against the ceiling the attempt was
    // created with, which nothing in the run widened.
    assert.deepEqual(launches, ["T01:codex", "T02:codex", "T03:codex", "review:claude"]);
    assert.equal(done.budget.callsSpent, SELECTED.length + 1);
    assert.equal(done.budget.callsReserved, 0);
    assert.equal(done.budget.ceiling, 5);
    assert.deepEqual(done.ceilingGrants, [], "no raise act was taken, by the shift or anyone");

    // AC-3: one worktree, one accumulating head, one host commit per ticket,
    // each built on the one before it.
    const commits = git(prepared.worktree!, "rev-list", "--reverse", `${prepared.baseSha!}..HEAD`).split("\n");
    assert.equal(commits.length, SELECTED.length);
    for (const [index, sha] of commits.entries()) {
      assert.equal(git(prepared.worktree!, "rev-parse", `${sha}^`), index === 0 ? prepared.baseSha : commits[index - 1]);
      assert.deepEqual(git(prepared.worktree!, "diff-tree", "--no-commit-id", "--name-only", "-r", sha).split("\n"),
        [`core/src/widget-${SELECTED[index]!.toLowerCase()}.ts`]);
    }
    const recipe = await bindShiftRecipe(fixture.canonical, done.shift!, { prompts });
    // AC-5: every ticket's own SHA beside its id, projected from the prefix.
    assert.deepEqual(shiftTicketCandidates(recipe.phases, done.recovery!.prefix),
      SELECTED.map((ticketId, index) => ({ ticketId, candidateSha: commits[index] })));

    // AC-5: the tip is reachable by a ref that is not a branch.
    const ref = `refs/awsf/candidates/${PROJECT}/${TASK}/1`;
    assert.equal(done.candidateSha, commits.at(-1));
    assert.equal(readCandidateRef(fixture.canonical, done), commits.at(-1));
    assert.equal(git(fixture.canonical, "for-each-ref", "--format=%(refname)", "refs/awsf"), ref);
    assert.equal(git(fixture.canonical, "branch", "--list", "--format=%(refname:short)"), "main");

    // AC-6: the readout names each ticket, its commit, its gate result and
    // the one review, and says where the candidate is and how to preview it.
    const readout = await statusCommand(attemptDir);
    const text = readout.join("\n");
    assert.ok(readout.some((line) => line.startsWith(`Shift: plan ${PLAN}, milestone M1, 3 ticket(s)`)), text);
    for (const [index, id] of SELECTED.entries()) {
      assert.ok(readout.includes(`  ${id}  Ticket ${id} adds its own widget  ${commits[index]!.slice(0, 7)}  gates 1/1`), text);
    }
    assert.ok(readout.some((line) => /^Shift review: accept by claude\/\S+ on [0-9a-f]{7} for the accumulated diff — 0 finding\(s\), 0 blocking$/u.test(line)), text);
    assert.ok(readout.some((line) => line.startsWith(`Candidate ref: ${ref} at ${commits.at(-1)!}`)), text);
    assert.ok(readout.some((line) => line.startsWith("Preview: not built — `awsf preview")), text);
    assert.ok(readout.some((line) => line.startsWith("Owner gate: AWAITING_OWNER since ")), text);

    // INV-1: nothing the shift did moved toward landing, and landing still
    // refuses a terminal that is not interactive.
    assert.equal(evidence.some((entry) => entry.type === "transition" && (entry.to === "LANDING" || entry.to === "LANDED")), false);
    await assert.rejects(landCommand({ attemptDir, terminal: { interactive: false, write: () => {}, confirm: async () => true } }));
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "AWAITING_OWNER");

    // INV-2 · INV-3: every agent process went through the broker, and the
    // canonical repository gained a ref and nothing else — no branch move, no
    // remote, no push.
    assert.equal(brokered.length, launches.length, `every provider launch was a broker start: ${brokered.join(", ")}`);
    assert.equal(git(fixture.canonical, "rev-parse", "main"), prepared.baseSha);
    assert.equal(git(fixture.canonical, "remote"), "");

    // The owner's half, which the workstream first closed without: a shift is
    // a T2 candidate, so landing needs an attested journey, and `awsf journey`
    // once refused every workflow but build-review and simple-sdlc.
    const owner = { interactive: true, write: () => {}, confirm: async () => true };
    const journeyed = await journeyCommand({ attemptDir, terminal: owner, journeyId: "fixture-milestone-walkthrough", observedSha: commits.at(-1)! });
    assert.equal(journeyed.confirmed, true);
    assert.equal(journeyed.status.journeyApproved, true);
    const landed = await landCommand({ attemptDir, terminal: owner });
    assert.equal(landed.status.lifecycleState, "LANDED", landed.status.lastActivity);
    assert.equal(git(fixture.canonical, "rev-parse", "main"), commits.at(-1), "landing fast-forwarded main to the shift's tip");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

/**
 * The whole Identifier Spine in one table. Rows this file proves above point
 * here; rows an earlier milestone already proved point at that proof by file
 * and test name, and the assertion is that the named proof still exists, so a
 * rename or a deletion turns this red rather than leaving a claim unbacked.
 */
const SPINE: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  "AC-1": [["core/test/journeys/shift-milestone.test.ts", "one milestone runs from selection to AWAITING_OWNER"],
    ["core/test/unit/shift-select.test.ts", "three"], ["core/test/unit/shift-selection-record.test.ts", "manifestDigest"]],
  "AC-2": [["core/test/journeys/shift-milestone.test.ts", "minimumCalls = 3 + 1 = 4"], ["core/test/unit/shift-budget.test.ts", "MAX_CALL_CEILING"],
    ["core/test/unit/shift-compile.test.ts", "minimumCalls"]],
  "AC-3": [["core/test/journeys/shift-milestone.test.ts", "one accumulating head"], ["core/test/journeys/shift-chain.test.ts", "groupSessionStacks"]],
  "AC-4": [["core/test/journeys/shift-blocked.test.ts", "a red gate on ticket 3 of 6 blocks the shift there"],
    ["core/test/journeys/shift-adopt.test.ts", "adopt"]],
  "AC-5": [["core/test/journeys/shift-milestone.test.ts", "readCandidateRef"], ["core/test/unit/candidate-ref.test.ts", "prun"]],
  "AC-6": [["core/test/journeys/shift-milestone.test.ts", "one shift, one owner gate"], ["core/test/unit/shift-readout.test.ts", "blocked at ticket 3"],
    ["core/test/unit/shift-preview.test.ts", "stale"]],
  "INV-1": [["core/test/journeys/shift-milestone.test.ts", "landCommand"], ["core/test/unit/meta/shift-owner-gate-fence.test.ts", "L20"]],
  "INV-2": [["core/test/journeys/shift-milestone.test.ts", "went through the broker"], ["core/test/unit/meta/shift-owner-gate-fence.test.ts", "API_ROUTE_TABLE"],
    ["core/test/unit/meta/child-process-fence.test.ts", "child_process"]],
  "INV-3": [["core/test/journeys/shift-milestone.test.ts", "no push"], ["core/test/unit/meta/no-destructive-paths.test.ts", "force"],
    ["core/test/unit/meta/publish-fence.test.ts", "push"], ["core/test/unit/meta/no-skill-in-stages.test.ts", "skill"]],
  "INV-4": [["core/test/journeys/shift-milestone.test.ts", "ShiftTicketDigestMismatch"], ["core/test/unit/shift-compile.test.ts", "byte-identical"]],
  "INV-5": [["core/test/journeys/shift-milestone.test.ts", "no raise act was taken"], ["core/test/unit/meta/shift-no-raise-import.test.ts", "raise"],
    ["core/test/journeys/shift-ceiling.test.ts", "ceiling"]],
};

test("every Identifier Spine row is backed by a named proof that still exists", () => {
  const plan = readFileSync(resolve("specs/awsf-v2-w17-shift.html"), "utf8");
  const declared = [...plan.matchAll(/<dt[^>]*>(?:<code[^>]*>)?((?:AC|INV)-\d+)/gu)].map((match) => match[1]!);
  assert.deepEqual([...new Set(declared)].sort(), Object.keys(SPINE).sort(), "the table covers the plan's spine, no more and no less");
  for (const [row, proofs] of Object.entries(SPINE)) {
    for (const [file, marker] of proofs) {
      assert.ok(existsSync(resolve(file)), `${row}: ${file} is gone`);
      assert.ok(readFileSync(resolve(file), "utf8").includes(marker), `${row}: ${file} no longer carries ${JSON.stringify(marker)}`);
    }
  }
  assert.ok(readdirSync(resolve("core/test/journeys")).includes("shift-milestone.test.ts"));
});
