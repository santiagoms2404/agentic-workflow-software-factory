import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import type { Availability, BrokerProcessRegistration, HarnessAdapter, ModelInfo, ModelRequest, ProcessSpec, ProcessTransport, TransportBroker } from "../../src/adapters/interface.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import type { AwsfConfig } from "../../src/config/schema.ts";
import { loadConfig } from "../../src/config/load.ts";
import { main } from "../../src/cli/main.ts";
import { readAttempt, type AttemptStatus } from "../../src/cli/commands/attempt.ts";
import { closeCommand } from "../../src/cli/commands/close.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import { closureDelta } from "../../src/closure/delta.ts";
import { treeAgreement } from "../../src/closure/tree.ts";
import { closureGitRunner, readClosureSnapshot, verifyClosureCommit } from "../../src/git/closure.ts";
import { writePlacement } from "../../src/registry/placement.ts";
import { fakeBroker } from "../fixtures/recording-broker.ts";
import { k1Request, startUnderK1 } from "../fixtures/k1-preflight.ts";
import { assertReviewDelivery } from "../fixtures/assert-review-delivery.ts";

const PROJECT = "closure-journey";
const PLAN = "fixture-deep";
const TASK = "fixture-build";
const IDS = ["T01", "T02"] as const;
const planPath = `specs/${PLAN}.html`;
const ticketPath = (id: string) => `specs/tickets/${PLAN}/${id}.md`;
const sourcePath = (id: string) => `core/src/widget-${id.toLowerCase()}.ts`;
const marker = '<code class="status">[]</code>';

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], {
    encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function ticket(id: string, title: string, depends: string[] = []): string {
  return `---\nid: ${id}\ntitle: ${title}\nmilestone: M1\nstate: todo\ndepends_on: [${depends.join(", ")}]\nworkflow: build-review\n---\n# ${id}\n\n## Handoff\n\nFixture findings stay unchanged.\n\n## Build prompt\n\n\`\`\`\nTASK ${id}. Write ${sourcePath(id)}.\n\`\`\`\n`;
}

function prompts(entries: readonly [string, string][]): string {
  return "# Section B — Task prompts (recommended)\n" + entries.map(([id, title]) =>
    `### T${id.slice(1)} — ${title}\n\n\`\`\`\nTASK ${id}. Write ${sourcePath(id)}.\n\`\`\`\n`).join("\n");
}

/** Scripted stub route: no provider process runs, but every call spends through the broker. */
class ClosureAdapter implements HarnessAdapter {
  readonly id: string;
  readonly #worktree: string;
  readonly #calls: string[];
  constructor(id: string, worktree: string, calls: string[]) { this.id = id; this.#worktree = worktree; this.#calls = calls; }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return { adapter: this.id, provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: model,
      contextWindow: null, supportsThinking: true, supportsTools: true, supportsImages: false,
      continuity: "none", usageAuthority: "provider", costAuthority: "unavailable" };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return { executable: "node", argv: ["-e", ""], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false };
  }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    let payload: BuildOutput | ReviewOutput;
    if (request.prompt.includes("awsf.review-output/v1")) {
      assertReviewDelivery(request);
      this.#calls.push(`review:${this.id}`);
      payload = { schema: "awsf.review-output/v1", producerStatus: "success", summary: "Reviewed the exact fixture candidate.",
        artifacts: [], notesForNextPhase: "The fixture owner decides.", verdict: "accept", reviewedSha: git(this.#worktree, "rev-parse", "HEAD"),
        findings: [], limitations: [{ detail: "Scripted offline review only.", affectedFiles: [] }] };
    } else {
      const id = /TASK (T\d\d)\./u.exec(request.prompt)?.[1] ?? "T01";
      const path = sourcePath(id);
      this.#calls.push(`${id}:${this.id}`);
      mkdirSync(dirname(join(this.#worktree, path)), { recursive: true });
      writeFileSync(join(this.#worktree, path), `export const ${id.toLowerCase()} = true;\n`);
      payload = { schema: "awsf.build-output/v1", producerStatus: "success", summary: `Built fixture ${id}.`,
        artifacts: [{ path, kind: "source", description: "Fixture widget" }], notesForNextPhase: "Run the configured gate.",
        changedFiles: [path], implementationNotes: ["Fixture implementation"], commandsRun: [], proposedCommitMessage: `feat: add fixture ${id} widget` };
    }
    const at = "2026-10-09T23:00:00.000Z";
    yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id,
      provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: JSON.stringify(payload) };
    yield { kind: "usage", seq: 4, runId: registration.runId, hostAt: at, providerAt: null,
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { kind: "run.completed", seq: 5, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

async function world(shift = false, land = true) {
  const root = mkdtempSync(join(tmpdir(), "awsf-closure-journey-"));
  const canonical = join(root, "canonical"), stateRoot = join(root, "state"), configPath = join(root, "awsf.config.yaml");
  const projection = createDashboardProjection(stateRoot);
  try {
    execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
    git(canonical, "config", "user.name", "Santiago Marin");
    git(canonical, "config", "user.email", "santiagomarinsuarez@me.com");
    for (const stem of [PLAN, "fixture-spine"]) mkdirSync(join(canonical, "specs/tickets", stem), { recursive: true });
    writeFileSync(join(canonical, "awsf.project.yaml"), `version: awsf.project/v1\nproject: {slug: ${PROJECT}}\nrepositories:\n  app: {role: plan, default_branch: main}\nplans: {root: specs, format: awsf-plan-html/v1}\n`);
    writeFileSync(join(canonical, "README.md"), "Fixture repository only.\n");
    writeFileSync(join(canonical, "binary.dat"), Buffer.from([255, 0, 128]));
    writeFileSync(join(canonical, planPath), `<section class="phase"><h3>${marker} Milestone M1: Widgets</h3>\n` +
      IDS.map((id, i) => `<h4>${i + 1}. Widget ${id}</h4>\n<ul><li>${marker} Widget ${id} exists.</li><li>${marker} Widget ${id} passes its gate.</li></ul>\n`).join("") + "</section>\n");
    writeFileSync(join(canonical, `specs/${PLAN}-build-prompts.md`), prompts(IDS.map(id => [id, `Widget ${id}`])));
    for (const id of IDS) writeFileSync(join(canonical, ticketPath(id)), ticket(id, `Widget ${id}`, id === "T02" ? ["T01"] : []));
    writeFileSync(join(canonical, "specs/fixture-spine.html"), `<section class="phase"><h3>${marker} Milestone M1: Workstreams</h3>\n<p><a href="./${PLAN}.html">Fixture deep plan</a></p>\n<h4>1. Fixture workstream</h4>\n<ul><li>${marker} Authored and approved.</li><li>${marker} Implementation accepted.</li></ul></section>\n`);
    writeFileSync(join(canonical, "specs/fixture-spine-build-prompts.md"), prompts([["W01", "Fixture workstream"]]));
    writeFileSync(join(canonical, "specs/tickets/fixture-spine/W01.md"), ticket("W01", "Fixture workstream"));
    git(canonical, "add", "."); git(canonical, "commit", "-m", "test: seed closure journey");
    const config: AwsfConfig = { ...loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8")) };
    config.project = { ...config.project, slug: PROJECT };
    config.runtime = { ...config.runtime, seed_paths: [] };
    config.gates = { test: { argv: ["node", "-e", "process.exit(0)"], timeout_seconds: 10 } };
    config.agents = config.agents.map(agent => ({ ...agent, harness: { ...agent.harness, interrupted_turn: false } }));
    // Keep every shipped protected glob; only provider execution and the fixture gate are substituted.
    writeFileSync(configPath, stringify(config));
    for (const agent of config.agents) for (const path of [agent.prompt.system, agent.prompt.user]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), readFileSync(resolve(path)));
    }
    mkdirSync(join(root, "prompts/shared"), { recursive: true });
    writeFileSync(join(root, "prompts/shared/headless-role.md"), readFileSync(resolve("prompts/shared/headless-role.md")));
    await writePlacement(stateRoot, PROJECT, { version: "awsf.placement/v1", project: PROJECT,
      repositories: { app: { path: canonical } }, worktree_root: join(root, "worktrees") });
    const terminal: OwnerTerminal = { interactive: true, write: () => {}, confirm: async () => true };
    const invoke = async (argv: string[], owner = terminal) => {
      const out: string[] = [], err: string[] = [];
      // Shift ticket discovery resolves self-placement from process.cwd().
      const previous = process.cwd();
      process.chdir(canonical);
      try {
        const code = await main({ argv: [...argv, "--config", configPath, "--state-root", stateRoot], cwd: canonical,
          terminal: owner, writeOut: line => out.push(line), writeError: line => err.push(line) });
        return { code, out, err };
      } finally { process.chdir(previous); }
    };
    const created = await invoke(["new", TASK, k1Request("Build fixture widgets.", "core/src/widget.ts"),
      "--workflow", shift ? "shift" : "build-review", "--plan", PLAN, ...(shift ? ["--milestone", "M1"] : ["--ticket", "T01"])]);
    assert.equal(created.code, 0, created.err.join("\n"));
    const attemptDir = join(stateRoot, "projects", PROJECT, "tasks", TASK, "1");
    const prepared = await startUnderK1({ attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
      preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project });
    const calls: string[] = [];
    const done = await runProductionCommand({ attemptDir, stateRoot, config, configPath, projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement, assertLaunchProjection: projection.assertLaunchPermitted,
      infrastructure: { adapterFor: (_entry, id) => new ClosureAdapter(id, prepared.worktree!, calls), createBroker: fakeBroker, sandboxProbe: () => false } });
    assert.equal(done.lifecycleState, "AWAITING_OWNER", done.blocker?.detail);
    assert.equal(done.requiredReviewPresent, true);
    assert.equal(done.gatesPass, true);
    assert.deepEqual(calls, [...(shift ? IDS : ["T01"]).map(id => `${id}:codex`), "review:claude"]);
    assert.equal(done.budget.callsSpent, calls.length);
    if (land) {
      // Only this disposable fixture's T2 journey is approved, never the running task.
      const journey = await invoke(["journey", TASK, "--journey", "fixture-widgets", "--sha", done.candidateSha!]);
      assert.equal(journey.code, 0, journey.err.join("\n"));
      const landed = await invoke(["land", TASK]);
      assert.equal(landed.code, 0, landed.err.join("\n"));
      assert.equal((await readAttempt(attemptDir)).lifecycleState, "LANDED");
      assert.equal(git(canonical, "rev-parse", "HEAD"), done.candidateSha);
    }
    const snapshot = readClosureSnapshot(closureGitRunner(canonical), git(canonical, "rev-parse", "HEAD"));
    assert.deepEqual(treeAgreement(snapshot.tree, snapshot.registry), []);
    return { root, canonical, stateRoot, configPath, attemptDir, terminal, invoke, done, projection };
  } catch (error) { projection.close(); rmSync(root, { recursive: true, force: true }); throw error; }
}

type World = Awaited<ReturnType<typeof world>>;
function dispose(w: World) { w.projection.close(); rmSync(w.root, { recursive: true, force: true }); }

/** Files, modes, canonical index and HEAD binding; Git object creation is not a checkout edit. */
function checkoutBytes(repository: string): Map<string, string> {
  const bytes = new Map<string, string>();
  const visit = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".git") continue;
      const physical = join(dir, name), path = `${prefix}${name}`, stat = lstatSync(physical);
      if (stat.isDirectory()) visit(physical, `${path}/`);
      else bytes.set(path, `${stat.mode}:${readFileSync(physical).toString("hex")}`);
    }
  };
  visit(repository, "");
  for (const path of ["index", "HEAD", "refs/heads/main"]) bytes.set(`.git/${path}`, readFileSync(join(repository, ".git", path)).toString("hex"));
  return bytes;
}

async function assertClosure(w: World, ids: readonly string[], rows: number) {
  const evidence = await readAttemptEvidence(w.attemptDir);
  const records = evidence.flatMap(item => item.type === "closure-record" ? [item.record] : []);
  assert.equal(records.length, 1);
  const record = records[0]!;
  assert.deepEqual(record.tickets, ids);
  assert.equal(record.parentSha, w.done.candidateSha);
  assert.equal(record.rowsClosed.length, rows);
  assert.equal(record.rowsLeftOpen.length, 0);
  const runner = closureGitRunner(w.canonical);
  verifyClosureCommit(runner, record);
  const before = readClosureSnapshot(runner, record.parentSha), after = readClosureSnapshot(runner, record.commitSha);
  assert.deepEqual(treeAgreement(after.tree, after.registry), []);
  assert.equal(closureDelta(before.tree, after.tree, after.registry, { before: before.modes, after: after.modes }).ok, true);
  assert.equal(git(w.canonical, "rev-parse", "HEAD"), record.commitSha);
  assert.equal(git(w.canonical, "status", "--porcelain"), "");
  assert.equal(git(w.canonical, "show", "--format=%an <%ae>|%cn <%ce>", "--no-patch", record.commitSha),
    "Santiago Marin <santiagomarinsuarez@me.com>|Santiago Marin <santiagomarinsuarez@me.com>");
  assert.equal(git(w.canonical, "show", "--format=%B", "--no-patch", record.commitSha),
    `chore(specs): close ${PLAN} ${ids.join(",")} after ${w.done.candidateSha!.slice(0, 7)}`);
  assert.deepEqual(readFileSync(join(w.canonical, "binary.dat")), Buffer.from([255, 0, 128]));
  assert.equal((await readAttempt(w.attemptDir)).lifecycleState, "LANDED");
  return record;
}

test("a selected build-review travels the stub route, lands and closes through main with a markers-only diff", async () => {
  const w = await world();
  try {
    const result = await w.invoke(["close", TASK]);
    assert.equal(result.code, 0, result.err.join("\n"));
    const record = await assertClosure(w, ["T01"], 2);
    assert.deepEqual(record.blobs.map(blob => blob.path), [planPath, ticketPath("T01")]);
    assert.ok(result.out.includes("Nothing was pushed."));
    assert.ok(result.out.includes(`Closed ${PLAN} T01 in ${record.commitSha.slice(0, 7)}: 2 row(s) closed, 0 left open.`));
    assert.match(readFileSync(join(w.canonical, ticketPath("T01")), "utf8"), /state: done/);
    assert.match(readFileSync(join(w.canonical, ticketPath("T02")), "utf8"), /state: todo/);
    assert.match(readFileSync(join(w.canonical, planPath), "utf8"), /\[wip\]<\/code> Milestone/);
    const bytes = checkoutBytes(w.canonical), journal = readFileSync(join(w.attemptDir, "journal.jsonl"));
    assert.equal((await w.invoke(["close", TASK], { ...w.terminal, confirm: async () => assert.fail("completed closure must not confirm again") })).code, 0);
    assert.deepEqual(checkoutBytes(w.canonical), bytes);
    assert.deepEqual(readFileSync(join(w.attemptDir, "journal.jsonl")), journal);
  } finally { dispose(w); }
});

/** Only synthetic evidence is altered; ordinary journeys above use real lifecycle acts. */
async function changeEvidence(w: World, changes: Partial<AttemptStatus>) {
  const status = { ...await readAttempt(w.attemptDir), ...changes };
  // Plant malformed history in a disposable journal, without reopening a sealed attempt.
  const path = join(w.attemptDir, "journal.jsonl");
  const records = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
  records.at(-1).event.next = status;
  writeFileSync(path, records.map(record => JSON.stringify(record)).join("\n") + "\n");
  writeFileSync(join(w.attemptDir, "status.json"), JSON.stringify(status));
}

for (const scenario of ["non-interactive", "wrong actor", "not LANDED", "no selection", "candidate outside HEAD", "dirty", "changed ask", "unset identity", "HEAD moved"] as const) {
  test(`closure refuses ${scenario} after a real stub build and preserves checkout bytes`, async () => {
    const w = await world(false, scenario !== "not LANDED" && scenario !== "candidate outside HEAD");
    try {
      let message: RegExp;
      let terminal = w.terminal;
      let atConfirmation: Map<string, string> | undefined;
      switch (scenario) {
        case "non-interactive": terminal = { ...terminal, interactive: false }; message = /closure requires an interactive owner terminal/; break;
        case "wrong actor": message = /closure requires a human actor/; break;
        case "not LANDED": message = /closure requires a LANDED attempt/; break;
        case "no selection": await changeEvidence(w, { ticketSelection: null }); message = /closure requires a sealed ticket selection/; break;
        case "candidate outside HEAD": await changeEvidence(w, { lifecycleState: "LANDED" }); message = /closure candidate is not an ancestor of canonical HEAD/; break;
        case "dirty": writeFileSync(join(w.canonical, "untracked.txt"), "Preserve owner bytes.\n"); message = /closure requires a clean canonical checkout/; break;
        case "changed ask":
          writeFileSync(join(w.canonical, planPath), readFileSync(join(w.canonical, planPath), "utf8").replace("Widget T01 exists.", "Different requirement."));
          git(w.canonical, "add", planPath); git(w.canonical, "commit", "-m", "test: change fixture ask");
          message = /closure ask changed since base: T01.checklist/; break;
        case "unset identity": git(w.canonical, "config", "user.name", ""); message = /closure requires the checkout's configured user.name and user.email/; break;
        case "HEAD moved":
          terminal = { ...terminal, confirm: async prompt => {
            if (prompt.startsWith("Commit these")) {
              writeFileSync(join(w.canonical, "README.md"), "External owner movement.\n");
              git(w.canonical, "add", "README.md"); git(w.canonical, "commit", "-m", "test: move fixture HEAD during confirmation");
              atConfirmation = checkoutBytes(w.canonical);
            }
            return true;
          } };
          message = /canonical HEAD moved during closure confirmation/; break;
      }
      const bytes = checkoutBytes(w.canonical), journal = readFileSync(join(w.attemptDir, "journal.jsonl"));
      if (scenario === "wrong actor") {
        // main deliberately has no actor override: exercise the act's authority boundary directly.
        await assert.rejects(closeCommand({ attemptDir: w.attemptDir, terminal, actor: "host" }), message);
      } else {
        const result = await w.invoke(["close", TASK], terminal);
        assert.equal(result.code, 1);
        assert.match(result.err.join("\n"), message);
      }
      if (scenario === "HEAD moved") assert.ok(atConfirmation, "the refusal must occur after external HEAD movement");
      assert.deepEqual(checkoutBytes(w.canonical), atConfirmation ?? bytes);
      assert.deepEqual(readFileSync(join(w.attemptDir, "journal.jsonl")), journal);
    } finally { dispose(w); }
  });
}

test("an accumulated two-ticket shift closes the deep plan and link-mapped spine in one commit", async () => {
  const w = await world(true);
  try {
    const commits = git(w.canonical, "rev-list", "--reverse", `${w.done.baseSha}..${w.done.candidateSha}`).split("\n");
    assert.equal(commits.length, 2);
    const result = await w.invoke(["close", TASK]);
    assert.equal(result.code, 0, result.err.join("\n"));
    const record = await assertClosure(w, IDS, 6);
    assert.deepEqual(record.notClosable, []);
    assert.deepEqual(record.blobs.map(blob => blob.path), [planPath, "specs/fixture-spine.html", ...IDS.map(ticketPath), "specs/tickets/fixture-spine/W01.md"]);
    for (const path of [planPath, "specs/fixture-spine.html"]) assert.match(readFileSync(join(w.canonical, path), "utf8"), /\[x\]<\/code> Milestone/);
    for (const path of [...IDS.map(ticketPath), "specs/tickets/fixture-spine/W01.md"]) assert.match(readFileSync(join(w.canonical, path), "utf8"), /state: done/);
    assert.deepEqual(record.rowsClosed.map(row => row.ticket), ["T01", "T01", "T02", "T02", "W01", "W01"]);
  } finally { dispose(w); }
});

for (const step of ["intent", "published"] as const) {
  test(`closure interrupted after ${step} is reported or finished through main, never repeated`, async () => {
    const w = await world();
    try {
      await assert.rejects(closeCommand({ attemptDir: w.attemptDir, terminal: w.terminal, projectRecord: w.projection.project,
        onStep: point => { if (point === step) throw new Error("Fixture interruption"); } }), /Fixture interruption/);
      const head = git(w.canonical, "rev-parse", "HEAD"), bytes = checkoutBytes(w.canonical);
      const journal = readFileSync(join(w.attemptDir, "journal.jsonl"));
      const result = await w.invoke(["close", TASK], { ...w.terminal, confirm: async () => assert.fail("interruption must not replay confirmation") });
      if (step === "intent") {
        assert.equal(result.code, 1);
        assert.match(result.err.join("\n"), /interrupted closure: no published prepared commit; no automatic replay/);
        assert.deepEqual(checkoutBytes(w.canonical), bytes);
        assert.deepEqual(readFileSync(join(w.attemptDir, "journal.jsonl")), journal);
        assert.equal(head, w.done.candidateSha);
      } else {
        assert.equal(result.code, 0, result.err.join("\n"));
        await assertClosure(w, ["T01"], 2);
        const finished = readFileSync(join(w.attemptDir, "journal.jsonl"));
        assert.equal((await w.invoke(["close", TASK])).code, 0);
        assert.deepEqual(readFileSync(join(w.attemptDir, "journal.jsonl")), finished);
      }
      assert.equal(git(w.canonical, "rev-parse", "HEAD"), head);
      const evidence = await readAttemptEvidence(w.attemptDir);
      assert.equal(evidence.filter(item => item.type === "closure-intent").length, 1);
      assert.equal(evidence.filter(item => item.type === "closure-record").length, step === "intent" ? 0 : 1);
      assert.equal(existsSync(join(w.stateRoot, "projects", PROJECT, "closure")), false);
    } finally { dispose(w); }
  });
}
