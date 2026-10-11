import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import type { Availability, BrokerProcessRegistration, HarnessAdapter, ModelInfo, ModelRequest, ProcessSpec, ProcessTransport, TransportBroker } from "../../src/adapters/interface.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { Ticket } from "../../src/contracts/ticket.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { IntakeOutput } from "../../src/contracts/intake-output.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import { loadConfig } from "../../src/config/load.ts";
import { main } from "../../src/cli/main.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { readClosure } from "../../src/closure/readout.ts";
import { closureGitRunner, verifyClosureCommit } from "../../src/git/closure.ts";
import { writePlacement } from "../../src/registry/placement.ts";
import { TicketStore } from "../../src/persistence/ticket-store.ts";
import { fakeBroker } from "../fixtures/recording-broker.ts";
import { k1Request, startUnderK1 } from "../fixtures/k1-preflight.ts";
import { assertReviewDelivery } from "../fixtures/assert-review-delivery.ts";

const PROJECT = "light-journey", PATH = "specs/tickets/T00.md";
const ticket: Ticket = { id: "T00", title: "Small change", milestone: "M1", tier: 2, state: "todo", depends_on: [],
  workflow: "build-review", outcome: "Small change works", context: ["Fixture context"], acceptance: ["Observable result"], non_goals: ["Other work"] };
const body = "# Small change\n\n## Handoff\n\nFixture findings.\n\n## Work\n\nBuild the small change.\n";
function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
}

/** This adapter scripts envelopes; the fake broker is the only route and launches no provider. */
class LightAdapter implements HarnessAdapter {
  readonly id: string;
  readonly worktree: string;
  readonly outputTicket: Ticket;
  constructor(id: string, worktree: string, outputTicket: Ticket) { this.id = id; this.worktree = worktree; this.outputTicket = outputTicket; }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return { adapter: this.id, provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: model,
      contextWindow: null, supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none", usageAuthority: "provider", costAuthority: "unavailable" };
  }
  buildSpec(request: ModelRequest): ProcessSpec { return { executable: "node", argv: ["-e", ""], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false }; }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    let payload: BuildOutput | IntakeOutput | ReviewOutput;
    if (request.prompt.includes("awsf.intake-output/v1")) {
      await new TicketStore(join(this.worktree, "specs/tickets")).write(this.outputTicket, body);
      payload = { schema: "awsf.intake-output/v1", producerStatus: "success", summary: "Created one fixture ticket", artifacts: [{ path: PATH, kind: "documentation", description: "Light fixture ticket" }], notesForNextPhase: "Owner checks the fixture", ticket: this.outputTicket };
    } else if (request.prompt.includes("awsf.review-output/v1")) {
      assertReviewDelivery(request);
      payload = { schema: "awsf.review-output/v1", producerStatus: "success", summary: "Reviewed the fixture candidate", artifacts: [], notesForNextPhase: "Owner decides",
        verdict: "accept", reviewedSha: git(this.worktree, "rev-parse", "HEAD"), findings: [], limitations: [{ detail: "Scripted fixture only", affectedFiles: [] }] };
    } else {
      const path = "core/src/small.ts";
      mkdirSync(dirname(join(this.worktree, path)), { recursive: true }); writeFileSync(join(this.worktree, path), "export const small = true;\n");
      payload = { schema: "awsf.build-output/v1", producerStatus: "success", summary: "Built small fixture change", artifacts: [{ path, kind: "source", description: "Small fixture" }], notesForNextPhase: "Review the fixture",
        changedFiles: [path], implementationNotes: ["Small fixture"], commandsRun: [], proposedCommitMessage: "feat: add small fixture change" };
    }
    const at = "2026-10-09T23:00:00Z", base = { runId: registration.runId, hostAt: at, providerAt: null };
    yield { ...base, kind: "run.started", seq: 1, adapter: this.id, requestedModel: request.model };
    yield { ...base, kind: "model.resolved", seq: 2, adapter: this.id, provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: request.model, resolvedModel: request.model, provenance: "route-attributed" };
    yield { ...base, kind: "text.delta", seq: 3, text: JSON.stringify(payload) };
    yield { ...base, kind: "usage", seq: 4, usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { ...base, kind: "run.completed", seq: 5, exitCode: 0 };
  }
}

async function world(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "awsf-light-journey-")), repository = join(root, "repository"), stateRoot = join(root, "state"), configPath = join(root, "awsf.config.yaml");
  const projection = createDashboardProjection(stateRoot);
  t.after(() => { projection.close(); rmSync(root, { recursive: true, force: true }); });
  execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
  git(repository, "config", "user.name", "Santiago Marin"); git(repository, "config", "user.email", "santiagomarinsuarez@me.com");
  mkdirSync(join(repository, "specs/tickets"), { recursive: true });
  writeFileSync(join(repository, "README.md"), "Disposable light-ticket fixture\n");
  writeFileSync(join(repository, "awsf.project.yaml"), `version: awsf.project/v1\nproject: {slug: ${PROJECT}}\nrepositories:\n  app: {role: plan, default_branch: main}\nplans: {root: specs, format: awsf-plan-html/v1}\n`);
  git(repository, "add", "."); git(repository, "commit", "-m", "test: seed light fixture");
  const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  config.project = { ...config.project, slug: PROJECT }; config.runtime = { ...config.runtime, seed_paths: [] };
  config.gates = { test: { argv: ["node", "-e", "process.exit(0)"], timeout_seconds: 10 } };
  // The scripted route has no provider session, so fund its declared cold correction.
  config.risk = { ...config.risk, call_ceiling: { ...config.risk.call_ceiling, T0: 2 } };
  config.agents = config.agents.map(agent => ({ ...agent, harness: { ...agent.harness, interrupted_turn: false, continuity: "none" } }));
  writeFileSync(configPath, stringify(config));
  for (const agent of config.agents) for (const path of [agent.prompt.system, agent.prompt.user]) {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), readFileSync(resolve(path)));
  }
  mkdirSync(join(root, "prompts/shared"), { recursive: true });
  writeFileSync(join(root, "prompts/shared/headless-role.md"), readFileSync(resolve("prompts/shared/headless-role.md")));
  await writePlacement(stateRoot, PROJECT, { version: "awsf.placement/v1", project: PROJECT, repositories: { app: { path: repository } }, worktree_root: join(root, "worktrees") });
  const terminal = { interactive: true, write: (_line: string) => {}, confirm: async (_prompt: string) => true };
  const invoke = async (argv: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main({ argv: [...argv, "--config", configPath, "--state-root", stateRoot], cwd: repository, terminal, writeOut: line => out.push(line), writeError: line => err.push(line) });
    return { code, out, err };
  };
  const run = async (task: string, outputTicket = ticket) => {
    const attemptDir = join(stateRoot, "projects", PROJECT, "tasks", task, "1");
    const prepared = await startUnderK1({ attemptDir, worktreeRoot: join(root, "worktrees"), configPath, projectRecord: projection.project,
      preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
    return runProductionCommand({ attemptDir, stateRoot, config, configPath, projectRecord: projection.project, assertAdvancement: projection.assertAdvancement,
      assertLaunchProjection: projection.assertLaunchPermitted, infrastructure: { adapterFor: (_entry, id) => new LightAdapter(id, prepared.worktree!, outputTicket), createBroker: fakeBroker, sandboxProbe: () => false } });
  };
  const intake = async (action: "new" | "refine") => {
    const created = await invoke(["ticket", action, "T00", "Make the fixture work observable"]);
    assert.equal(created.code, 0, created.err.join("\n"));
    const task = /Created light-journey\/([^ ]+) attempt/u.exec(created.out.join("\n"))?.[1];
    assert.ok(task);
    return task;
  };
  return { root, repository, stateRoot, invoke, run, intake };
}

for (const done of [true, false]) test(`ticket new, selected build-review, landing and light closure (${done ? "done" : "wip"}) use the stub route`, async t => {
  const w = await world(t);
  const intakeTask = await w.intake("new");
  const intake = await w.run(intakeTask);
  assert.equal(intake.lifecycleState, "AWAITING_OWNER", intake.blocker?.detail);
  assert.equal((await w.invoke(["land", intakeTask])).code, 0);
  const before = readFileSync(join(w.repository, PATH), "utf8");
  const created = await w.invoke(["new", "small-build", k1Request("Build the small fixture change", "core/src/small.ts"), "--workflow", "build-review", "--ticket", "T00"]);
  assert.equal(created.code, 0, created.err.join("\n"));
  const built = await w.run("small-build");
  assert.equal(built.lifecycleState, "AWAITING_OWNER", built.blocker?.detail);
  assert.equal(built.requiredReviewPresent, true);
  assert.equal((await w.invoke(["journey", "small-build", "--journey", "small-fixture", "--sha", built.candidateSha!])).code, 0);
  assert.equal((await w.invoke(["land", "small-build"])).code, 0);
  const dir = join(w.stateRoot, "projects", PROJECT, "tasks/small-build/1");
  assert.equal((await readClosure(dir, await readAttempt(dir))).state, "not closed");
  const out: string[] = [], err: string[] = [];
  assert.equal(await main({ argv: ["close", "small-build", "--config", join(w.root, "awsf.config.yaml"), "--state-root", w.stateRoot], cwd: w.repository,
    terminal: { interactive: true, write: line => out.push(line), confirm: async prompt => prompt.startsWith("Mark ") ? done : true }, writeOut: line => out.push(line), writeError: line => err.push(line) }), 0, err.join("\n"));
  const readout = await readClosure(dir, await readAttempt(dir));
  assert.equal(readout.state, done ? "closed" : "open by the owner's choice");
  assert.deepEqual(readout.record!.blobs.map(blob => blob.path), [PATH]);
  verifyClosureCommit(closureGitRunner(w.repository), readout.record!);
  assert.equal(readFileSync(join(w.repository, PATH), "utf8"), before.replace("state: todo", `state: ${done ? "done" : "wip"}`));
  assert.equal(git(w.repository, "status", "--porcelain"), "");
  const status = JSON.parse((await w.invoke(["status", "small-build", "--json"])).out.join("\n"));
  assert.equal(status.closure.state, readout.state);
  const doctor = await w.invoke(["doctor", "--json"]);
  assert.equal(doctor.code, 0, doctor.err.join("\n"));
  assert.match(doctor.out.join("\n"), new RegExp(`light/T00=${done ? "done" : "wip"}|${readout.state}`));
});

for (const state of ["wip", "done", "failed"] as const) test(`intake cannot create a new light ticket in ${state}`, async t => {
  const w = await world(t), task = await w.intake("new"), head = git(w.repository, "rev-parse", "HEAD");
  const result = await w.run(task, { ...ticket, state });
  assert.equal(result.lifecycleState, "BLOCKED");
  assert.match(result.blocker!.detail, /new ticket starts todo/);
  assert.equal(git(w.repository, "rev-parse", "HEAD"), head);
  assert.equal(git(w.repository, "status", "--porcelain"), "");
});

test("intake refines a closed light ticket without changing its state", async t => {
  const w = await world(t);
  await new TicketStore(join(w.repository, "specs/tickets")).write({ ...ticket, state: "done" }, body);
  git(w.repository, "add", "."); git(w.repository, "commit", "-m", "test: seed closed light fixture");
  const task = await w.intake("refine");
  const result = await w.run(task, { ...ticket, title: "Refined", state: "done" });
  assert.equal(result.lifecycleState, "AWAITING_OWNER", result.blocker?.detail);
  assert.equal((await w.invoke(["land", task])).code, 0);
  const records = await new TicketStore(join(w.repository, "specs/tickets")).load();
  assert.equal(records[0]!.ticket!.title, "Refined");
  assert.equal(records[0]!.ticket!.state, "done");
});

test("intake cannot move an existing light ticket state even to todo", async t => {
  const w = await world(t);
  await new TicketStore(join(w.repository, "specs/tickets")).write({ ...ticket, state: "done" }, body);
  git(w.repository, "add", "."); git(w.repository, "commit", "-m", "test: seed closed light fixture");
  const before = readFileSync(join(w.repository, PATH)), head = git(w.repository, "rev-parse", "HEAD"), task = await w.intake("refine");
  const result = await w.run(task, { ...ticket, title: "Refined", state: "todo" });
  assert.equal(result.lifecycleState, "BLOCKED");
  assert.match(result.blocker!.detail, /refine preserves state/);
  assert.deepEqual(readFileSync(join(w.repository, PATH)), before);
  assert.equal(git(w.repository, "rev-parse", "HEAD"), head);
  assert.equal(git(w.repository, "status", "--porcelain"), "");
});
