import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Availability, BrokerProcessRegistration, HarnessAdapter, ModelInfo, ModelRequest, ProcessSpec, ProcessTransport, TransportBroker } from "../../src/adapters/interface.ts";
import { main } from "../../src/cli/main.ts";
import { readAttempt, type AttemptEvent } from "../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import { loadConfig } from "../../src/config/load.ts";
import { closureDelta } from "../../src/closure/delta.ts";
import { treeAgreement } from "../../src/closure/tree.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { PlanAuthorOutput } from "../../src/contracts/plan-author-output.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import { closureGitRunner, readClosureSnapshot, verifyClosureCommit } from "../../src/git/closure.ts";
import { parseAwsfPlanHtmlV1 } from "../../src/registry/plan-source.ts";
import { writePlacement } from "../../src/registry/placement.ts";
import { assertReviewDelivery } from "../fixtures/assert-review-delivery.ts";
import { k1Request, startUnderK1 } from "../fixtures/k1-preflight.ts";
import { fakeBroker } from "../fixtures/recording-broker.ts";
import { installPrompts } from "../unit/cli/_offline-route.ts";

const PROJECT = "plan-author-journey";
const SPINE = "fixture-spine";
const DEEP = "fixture-deep";
const TASK = "author-fixture";
const spinePath = `specs/${SPINE}.html`;
const spineTicket = `specs/tickets/${SPINE}/W01.md`;
const deepPath = `specs/${DEEP}.html`;
const idle = '<code class="status">[]</code>';
const title = "Build the fixture widget";
const prompt = "```\nWrite core/src/widget.ts and verify the fixture gate.\n```";
const deepPlan = `<section id="spine"><dl><dt><code class="inv">INV-1</code></dt><dd>Only the fixture widget changes.</dd><dt><code class="ac">AC-1</code></dt><dd>The fixture gate passes.</dd></dl></section>\n` +
  `<section class="phase"><h3>${idle} Milestone M1: Widget</h3><h4>1. ${title}</h4><p class="sub">Serves <code class="serves">INV-1</code> · <code class="serves">AC-1</code></p><ul><li>${idle} Widget exists.</li><li>${idle} Fixture gate passes.</li></ul></section>\n`;
const deepPrompts = `# Section B — Task prompts (recommended)\n\n### T01 — ${title}\n\n${prompt}\n`;
const table = [{ id: "T01", title, milestone: "M1", depends_on: [], serves: ["INV-1", "AC-1"], workflow: "build-review" }];
type Defect = "existing plan change" | "existing stem" | "non-idle marker" | "non-todo state";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], {
    encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

/** Checkout bytes, modes, index and HEAD binding, as in the closure journeys. */
function checkoutBytes(repository: string): Map<string, string> {
  const bytes = new Map<string, string>();
  const visit = (directory: string, prefix: string) => {
    for (const name of readdirSync(directory).sort()) {
      if (name === ".git") continue;
      const physical = join(directory, name), path = `${prefix}${name}`, stat = lstatSync(physical);
      if (stat.isDirectory()) visit(physical, `${path}/`);
      else bytes.set(path, `${stat.mode}:${readFileSync(physical).toString("hex")}`);
    }
  };
  visit(repository, "");
  for (const path of ["index", "HEAD", "refs/heads/main"]) {
    bytes.set(`.git/${path}`, readFileSync(git(repository, "rev-parse", "--path-format=absolute", "--git-path", path)).toString("hex"));
  }
  return bytes;
}

/** No provider runs; fake GO still spends the real phase reservation. */
class AuthorAdapter implements HarnessAdapter {
  readonly id: string;
  readonly #calls: string[];
  readonly #defect: Defect | undefined;
  constructor(id: string, calls: string[], defect?: Defect) { this.id = id; this.#calls = calls; this.#defect = defect; }
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
    const author = registration.role === "plan-author";
    this.#calls.push(`${registration.role}:${this.id}`);
    let payload: PlanAuthorOutput | ReviewOutput;
    if (author) {
      assert.equal(request.profile, "managed-worker");
      assert.ok(request.tools?.includes("write"));
      assert.equal(request.tools?.includes("exec"), false);
      assert.match(request.prompt, /Host-sealed spine selection: .*"id":"W01"/u);
      const runtime = /Host-provided session-runtime output directory: ([^\n]+)/u.exec(request.prompt)?.[1];
      assert.ok(runtime);
      mkdirSync(runtime, { recursive: true });
      writeFileSync(join(runtime, "plan.html"), this.#defect === "non-idle marker" ? deepPlan.replace("[]", "[wip]") : deepPlan);
      writeFileSync(join(runtime, "build-prompts.md"), deepPrompts);
      writeFileSync(join(runtime, "tickets.json"), JSON.stringify(this.#defect === "non-todo state" ? [{ ...table[0], state: "done" }] : table));
      payload = { schema: "awsf.plan-author-output/v1", producerStatus: "success", summary: "Authored a new fixture deep plan.",
        // A claimed existing-plan change is emitted, not applied behind the role's write fence.
        artifacts: this.#defect === "existing plan change" ? [{ path: spinePath, kind: "plan", description: "Replace the existing spine's requirements." }] : [],
        notesForNextPhase: "Admit only new idle files.", stem: DEEP,
        runtimeFiles: { plan: "plan.html", buildPrompts: "build-prompts.md", tickets: "tickets.json" } };
    } else {
      assert.equal(this.#defect, undefined, "refused authors must never reach review");
      const delivery = assertReviewDelivery(request);
      const diff = delivery.full.toString("utf8");
      for (const path of [deepPath, `specs/${DEEP}-build-prompts.md`, `specs/tickets/${DEEP}/README.md`, `specs/tickets/${DEEP}/T01.md`]) {
        assert.ok(diff.includes(`diff --git a/${path} b/${path}`), `review received ${path}`);
      }
      assert.ok(diff.includes("Widget exists."));
      assert.ok(diff.includes(prompt.split("\n")[1]!));
      assert.ok(diff.includes("state: todo"));
      assert.ok(diff.includes("INV-1"));
      payload = { schema: "awsf.review-output/v1", producerStatus: "success", summary: "Read the delivered admitted fixture diff.",
        artifacts: [], notesForNextPhase: "The fixture owner decides.", verdict: "accept", reviewedSha: git(request.cwd, "rev-parse", "HEAD"),
        findings: [], limitations: [{ detail: "Scripted offline review, not plan quality on a live route.", affectedFiles: [] }] };
    }
    const at = "2026-10-12T00:00:00Z";
    yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id,
      provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: request.model, resolvedModel: "fixture-model", provenance: "stream-authoritative" };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: JSON.stringify(payload) };
    yield { kind: "run.completed", seq: 4, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

async function world(defect?: Defect) {
  const root = mkdtempSync(join(tmpdir(), "awsf-plan-author-journey-"));
  const canonical = join(root, "canonical"), stateRoot = join(root, "state"), configPath = join(root, "awsf.config.yaml");
  const projection = createDashboardProjection(stateRoot);
  try {
    execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
    git(canonical, "config", "user.name", "Santiago Marin");
    git(canonical, "config", "user.email", "santiagomarinsuarez@me.com");
    mkdirSync(join(canonical, "specs/tickets", SPINE), { recursive: true });
    writeFileSync(join(canonical, "awsf.project.yaml"), `version: awsf.project/v1\nproject: {slug: ${PROJECT}}\nrepositories:\n  app: {role: plan, default_branch: main}\nplans: {root: specs, format: awsf-plan-html/v1}\n`);
    writeFileSync(join(canonical, "README.md"), "Disposable fixture repository.\n");
    writeFileSync(join(canonical, spinePath), `<section class="phase"><h3>${idle} Milestone M1: Workstreams</h3><p><a href="./${DEEP}.html">Fixture deep plan</a></p><h4>1. Fixture workstream</h4><ul><li>${idle} Authored and approved.</li><li>${idle} Implementation accepted.</li></ul></section>\n`);
    const spinePrompt = "```\nAuthor the fixture deep plan; do not implement it.\n```";
    writeFileSync(join(canonical, `specs/${SPINE}-build-prompts.md`), `# Section B — Task prompts (recommended)\n\n### T01 — Fixture workstream\n\n${spinePrompt}\n`);
    writeFileSync(join(canonical, spineTicket), `---\nid: W01\ntitle: Fixture workstream\nmilestone: M1\nstate: todo\ndepends_on: []\nworkflow: build-review\n---\n# W01\n\n## Handoff\n\nFixture findings stay unchanged.\n\n## Build prompt\n\n${spinePrompt}\n`);
    if (defect === "existing stem") {
      mkdirSync(join(canonical, "specs/tickets", DEEP), { recursive: true });
      writeFileSync(join(canonical, deepPath), deepPlan);
      writeFileSync(join(canonical, `specs/${DEEP}-build-prompts.md`), deepPrompts);
      writeFileSync(join(canonical, `specs/tickets/${DEEP}/T01.md`), `---\n${stringify({ ...table[0], state: "todo" }).trimEnd()}\n---\n\n## Build prompt\n\n${prompt}\n`);
    }
    git(canonical, "add", "."); git(canonical, "commit", "-m", "test: seed plan author journey");
    const shipped = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
    assert.equal(shipped.workflows.enabled.includes("plan-author"), shipped.agents.some(agent => agent.name === "plan-author"),
      "the shipped config must declare and enable plan-author together, or neither");
    const planner = shipped.agents.find(agent => agent.name === "planner")!;
    const config = { ...shipped, project: { ...shipped.project, slug: PROJECT }, runtime: { ...shipped.runtime, seed_paths: [] },
      workflows: { enabled: [...shipped.workflows.enabled.filter(id => id !== "plan-author"), "plan-author"] },
      gates: { test: { argv: ["node", "-e", "process.exit(0)"], timeout_seconds: 10 } },
      agents: [...shipped.agents.filter(agent => agent.name !== "plan-author").map(agent => ({ ...agent, harness: { ...agent.harness, interrupted_turn: false } })),
        { ...planner, name: "plan-author", model: "codex:gpt-6-sol", purpose: "Author private plan output only",
          harness: { adapter: "codex", continuity: "none" as const, interrupted_turn: false },
          prompt: { system: "prompts/plan-author/system.md", user: "prompts/plan-author/user.md" },
          tools: { profile: "managed-worker", allow: ["read", "grep", "find", "ls", "edit", "write"] }, writes: [] }] };
    assert.deepEqual(config.policy.protected_paths, shipped.policy.protected_paths);
    writeFileSync(configPath, stringify(config));
    installPrompts(root, ["plan-author", "reviewer"]);
    await writePlacement(stateRoot, PROJECT, { version: "awsf.placement/v1", project: PROJECT,
      repositories: { app: { path: canonical } }, worktree_root: join(root, "worktrees") });
    const terminal: OwnerTerminal = { interactive: true, write: () => {}, confirm: async () => true };
    const invoke = async (argv: string[], owner = terminal) => {
      const out: string[] = [], err: string[] = [];
      const code = await main({ argv: [...argv, "--config", configPath, "--state-root", stateRoot], cwd: canonical,
        terminal: owner, writeOut: line => out.push(line), writeError: line => err.push(line) });
      return { code, out, err };
    };
    const created = await invoke(["new", TASK, k1Request("Author a deep plan for the fixture spine workstream.", "nothing; private output followed by host admission"),
      "--workflow", "plan-author", "--plan", SPINE, "--ticket", "W01"]);
    assert.equal(created.code, 0, created.err.join("\n"));
    const attemptDir = join(stateRoot, "projects", PROJECT, "tasks", TASK, "1");
    const prepared = await startUnderK1({ attemptDir, configPath, worktreeRoot: join(root, "worktrees"),
      preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project });
    assert.equal(prepared.ticketSelection?.plan, SPINE);
    assert.equal(prepared.ticketSelection?.tickets[0]?.id, "W01");
    const before = checkoutBytes(canonical), managedBefore = checkoutBytes(prepared.worktree!);
    const calls: string[] = [];
    const done = await runProductionCommand({ attemptDir, stateRoot, config, configPath, projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement, assertLaunchProjection: projection.assertLaunchPermitted,
      infrastructure: { adapterFor: (_entry, id) => new AuthorAdapter(id, calls, defect), createBroker: fakeBroker,
        resolveExecutable: () => { throw new Error("no quota probe in this offline journey"); }, sandboxProbe: () => false } });
    assert.deepEqual(checkoutBytes(canonical), before, "author/admission/review never changes canonical");
    return { root, canonical, projection, attemptDir, prepared, before, managedBefore, calls, done, invoke };
  } catch (error) { projection.close(); rmSync(root, { recursive: true, force: true }); throw error; }
}

function dispose(w: Awaited<ReturnType<typeof world>>) { w.projection.close(); rmSync(w.root, { recursive: true, force: true }); }
function admissionRecords(attemptDir: string) {
  return readFileSync(join(attemptDir, "journal.jsonl"), "utf8").trim().split("\n")
    .flatMap(line => {
      const { event } = JSON.parse(line) as { event: AttemptEvent };
      return event.admission === undefined ? [] : [event.admission];
    });
}

test("a private stub author admits a deep plan, delivers its diff to opposite-provider review, lands and closes only the fixture spine approval row", async () => {
  const w = await world();
  try {
    assert.equal(w.done.lifecycleState, "AWAITING_OWNER", w.done.blocker?.detail);
    assert.deepEqual(w.calls, ["plan-author:codex", "reviewer:claude"]);
    assert.equal(w.done.budget.callsSpent, 2);
    assert.equal(w.done.gatesPass, true);
    assert.equal(w.done.requiredReviewPresent, true);
    const candidate = w.done.candidateSha!;
    assert.match(candidate, /^[a-f0-9]{40}$/u);
    const admissions = admissionRecords(w.attemptDir);
    assert.equal(admissions.length, 1);
    assert.equal(admissions[0]!.baseSha, w.prepared.baseSha);
    const admittedPaths = [deepPath, `specs/${DEEP}-build-prompts.md`, `specs/tickets/${DEEP}/README.md`, `specs/tickets/${DEEP}/T01.md`].sort();
    assert.deepEqual(admissions[0]!.files.map(file => file.path).sort(), admittedPaths);
    assert.equal(git(w.done.worktree!, "rev-list", "--count", `${w.prepared.baseSha}..${candidate}`), "1");
    assert.deepEqual(git(w.done.worktree!, "diff", "--name-status", w.prepared.baseSha!, candidate).split("\n"), admittedPaths.map(path => `A\t${path}`));
    const runner = closureGitRunner(w.done.worktree!);
    const admitted = readClosureSnapshot(runner, candidate);
    assert.deepEqual(treeAgreement(admitted.tree, admitted.registry), []);
    for (const path of [spinePath, deepPath]) {
      for (const task of parseAwsfPlanHtmlV1(readFileSync(join(w.done.worktree!, path), "utf8"), path)) {
        assert.equal(task.milestoneMarker, "");
        assert.ok(task.checklist.length > 0);
        assert.ok(task.checklist.every(marker => marker === ""));
      }
    }
    assert.ok(readFileSync(join(w.done.worktree!, `specs/tickets/${DEEP}/T01.md`), "utf8").endsWith(`${prompt}\n`));
    const journey = await w.invoke(["journey", TASK, "--journey", "fixture-plan-author", "--sha", candidate]);
    assert.equal(journey.code, 0, journey.err.join("\n"));
    const landed = await w.invoke(["land", TASK]);
    assert.equal(landed.code, 0, landed.err.join("\n"));
    assert.equal(git(w.canonical, "rev-parse", "HEAD"), candidate);
    assert.equal((await readAttempt(w.attemptDir)).lifecycleState, "LANDED");
    const choices: string[] = [];
    const closed = await w.invoke(["close", TASK], { interactive: true, write: () => {}, confirm: async question => {
      choices.push(question);
      if (question.startsWith("Mark all")) return false;
      if (question.startsWith("Mark ")) return question === `Mark ${spinePath} W01 row 0 complete?`;
      assert.equal(question, "Commit these exact closure substitutions?");
      return true;
    } });
    assert.equal(closed.code, 0, closed.err.join("\n"));
    assert.ok(choices.includes(`Mark ${spinePath} W01 row 1 complete?`));
    const records = (await readAttemptEvidence(w.attemptDir)).flatMap(row => row.type === "closure-record" ? [row.record] : []);
    assert.equal(records.length, 1);
    const record = records[0]!;
    assert.equal(record.parentSha, candidate);
    assert.deepEqual(record.tickets, ["W01"]);
    assert.deepEqual(record.rowsClosed.map(row => row.rowIndex), [0]);
    assert.deepEqual(record.rowsLeftOpen.map(row => row.rowIndex), [1]);
    const canonicalRunner = closureGitRunner(w.canonical);
    verifyClosureCommit(canonicalRunner, record);
    const after = readClosureSnapshot(canonicalRunner, record.commitSha);
    assert.deepEqual(treeAgreement(after.tree, after.registry), []);
    assert.equal(closureDelta(admitted.tree, after.tree, after.registry, { before: admitted.modes, after: after.modes }).ok, true);
    assert.deepEqual(git(w.canonical, "diff", "--name-only", candidate, record.commitSha).split("\n"), [spinePath, spineTicket]);
    assert.match(readFileSync(join(w.canonical, spineTicket), "utf8"), /state: wip/u);
    assert.match(readFileSync(join(w.canonical, spinePath), "utf8"), /\[x\]<\/code> Authored and approved\./u);
    assert.match(readFileSync(join(w.canonical, spinePath), "utf8"), /\[\]<\/code> Implementation accepted\./u);
    assert.match(readFileSync(join(w.canonical, spinePath), "utf8"), /\[wip\]<\/code> Milestone/u);
    for (const path of admittedPaths) assert.deepEqual(after.tree.get(path), admitted.tree.get(path), "approval earns no deep-plan marker or state");
    assert.equal(git(w.canonical, "status", "--porcelain"), "");
  } finally { dispose(w); }
});

for (const defect of ["existing plan change", "existing stem", "non-idle marker", "non-todo state"] as const) {
  test(`a scripted author emitting ${defect} is refused before commit with both checkouts unchanged`, async () => {
    const w = await world(defect);
    try {
      assert.equal(w.done.lifecycleState, "BLOCKED");
      const expected = defect === "existing stem" ? /path exists at the base/u : defect === "non-idle marker" ? /every admitted marker must be idle/u
        : defect === "non-todo state" ? /state is host-owned/u : /no repository artifacts/u;
      assert.match(w.done.blocker?.detail ?? "", expected);
      assert.ok(w.calls.length > 0);
      assert.ok(w.calls.every(call => call === "plan-author:codex"), "no review follows a refusal");
      assert.deepEqual(checkoutBytes(w.canonical), w.before);
      assert.deepEqual(checkoutBytes(w.prepared.worktree!), w.managedBefore);
      assert.equal(git(w.prepared.worktree!, "rev-parse", "HEAD"), w.prepared.baseSha);
      const evidence = await readAttemptEvidence(w.attemptDir);
      assert.equal(admissionRecords(w.attemptDir).length, 0);
      assert.equal(evidence.some(row => row.type === "closure-record"), false);
      assert.equal(existsSync(join(w.prepared.worktree!, `specs/tickets/${DEEP}/README.md`)), false);
    } finally { dispose(w); }
  });
}
