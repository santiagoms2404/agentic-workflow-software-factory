import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { loadConfig } from "../../../src/config/load.ts";
import { toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import { sealTicketSelection } from "../../../src/contracts/ticket-selection-record.ts";
import { PLAN_AUTHOR_DOCUMENT_MAX_BYTES, PLAN_AUTHOR_ENVELOPE_MAX_BYTES, PLAN_AUTHOR_TABLE_MAX_BYTES, type PlanAuthorOutput } from "../../../src/contracts/plan-author-output.ts";
import { compilePlanAuthor, assertPlanAuthorRole } from "../../../src/workflow/recipes/plan-author.ts";
import { readPlanAuthorInput } from "../../../src/workflow/plan-author-input.ts";
import { compileWorkflow, compileWorkflowStructure, InvalidReviewBuildProducerCount, reviewWorkerProvider } from "../../../src/workflow/compiler.ts";
import { compiledWorkflow, WORKFLOW_RECIPES } from "../../../src/workflow/catalog.ts";
import { outputOwnershipCheck } from "../../../src/workflow/output-ownership.ts";
import { writeTargetAllowed } from "../../../src/policy/path-policy.ts";
import { renderPlanDocument } from "../../../src/registry/plan-render.ts";
import { admitProductionPlanIntoWorktree, runProductionCommand } from "../../../src/cli/commands/production-run.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { validDesignPlanOutput, validPlanContext } from "../contracts/fixtures.ts";
import { fixtureConfig, installPrompts, fakeBroker } from "../cli/_offline-route.ts";
import { k1Request, startUnderK1 } from "../../fixtures/k1-preflight.ts";
import type { Availability, BrokerProcessRegistration, HarnessAdapter, ModelInfo, ModelRequest, ProcessSpec, ProcessTransport, TransportBroker } from "../../../src/adapters/interface.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";

const selection = sealTicketSelection({ plan: "fixture-spine", tickets: [{ id: "W01", path: "specs/tickets/fixture-spine/W01.md", digest: "a".repeat(64) }] });
const binding = { planRef: "fixture-spine", ticketSelection: selection };
const protectedPaths = ["specs/*.html", "specs/*-build-prompts.md", "specs/tickets/*/**"];
function output(): PlanAuthorOutput {
  return { schema: "awsf.plan-author-output/v1", producerStatus: "success", summary: "A new fixture deep plan", artifacts: [], notesForNextPhase: "Admit as idle files only",
    stem: "authored-plan", runtimeFiles: { plan: "plan.html", buildPrompts: "build-prompts.md", tickets: "tickets.json" } };
}
function documents(runtime: string): void {
  mkdirSync(runtime, { recursive: true });
  const plan = validDesignPlanOutput();
  const docs = renderPlanDocument({ stem: output().stem, plan, identifierSet: validPlanContext().identifierSet });
  writeFileSync(join(runtime, "plan.html"), docs.get(`specs/${output().stem}.html`)!);
  writeFileSync(join(runtime, "build-prompts.md"), docs.get(`specs/${output().stem}-build-prompts.md`)!);
  writeFileSync(join(runtime, "tickets.json"), JSON.stringify(plan.steps.map(step => ({ id: step.id, title: step.title, milestone: step.milestone, depends_on: step.dependsOn, serves: step.serves }))));
}
function git(root: string, ...argv: string[]): string { return execFileSync("git", ["-C", root, ...argv], { encoding: "utf8" }).trim(); }
function world() {
  const root = mkdtempSync(join(tmpdir(), "awsf-author-unit-")), repo = join(root, "repo"), runtime = join(root, "runtime");
  mkdirSync(repo); git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Santiago Marin"); git(repo, "config", "user.email", "santiagomarinsuarez@me.com");
  writeFileSync(join(repo, "README.md"), "fixture\n"); git(repo, "add", "."); git(repo, "commit", "-m", "test: seed plan author fixture");
  documents(runtime);
  return { root, repo, runtime, baseSha: git(repo, "rev-parse", "HEAD"), close: () => rmSync(root, { recursive: true, force: true }) };
}
function config(): AwsfConfig {
  const base = fixtureConfig();
  const planner = base.agents.find(agent => agent.name === "planner")!;
  return { ...base, workflows: { enabled: [...base.workflows.enabled, "plan-author"] },
    agents: [...base.agents, { ...planner, name: "plan-author", model: "codex:gpt-6-sol", purpose: "Author new plan sets in session output only",
      harness: { adapter: "codex", continuity: "none", interrupted_turn: false },
      prompt: { system: "prompts/plan-author/system.md", user: "prompts/plan-author/user.md" },
      tools: { profile: "managed-worker", allow: ["read", "grep", "find", "ls", "edit", "write"] }, writes: [] }] };
}

test("plan-author compiles only against one sealed spine ticket and declares an independent reviewer", () => {
  const recipe = compilePlanAuthor(binding), compiled = compileWorkflow(recipe, 2);
  assert.equal(compiled.minimumCalls, 2);
  assert.deepEqual(compiled.reviewBuildPhaseIds, ["plan-author"]);
  assert.equal(reviewWorkerProvider(compiled, id => id === "plan-author" ? "anthropic" : "openai-codex"), "anthropic");
  assert.equal(compiledWorkflow(recipe.id)?.compile, compilePlanAuthor);
  assert.equal(WORKFLOW_RECIPES.some(shipped => shipped.id === recipe.id), false);
  assert.deepEqual(recipe.phases.map(phase => phase.id), ["request", "plan-author", "plan-admit", "tests", "review-context", "reviewer"]);
  for (const phase of compiled.phases) {
    assert.ok(outputOwnershipCheck(phase.id, phase.id === "plan-author" ? output() : { schema: phase.schemaId, producerStatus: "success", summary: "fixture", artifacts: [], notesForNextPhase: "" }).ok);
    if (phase.kind === "agent") assert.ok(phase.renderPrompt(output()).includes('"additionalProperties": false'));
  }
  assert.throws(() => compileWorkflowStructure({ ...recipe, id: "other" }), InvalidReviewBuildProducerCount, "author schema cannot substitute for a build producer in another workflow");
});

for (const [name, value] of [
  ["missing selection", { planRef: "fixture-spine" }],
  ["missing plan", { ticketSelection: selection }],
  ["different plan", { ...binding, planRef: "different" }],
  ["light ticket", { planRef: null, ticketSelection: sealTicketSelection({ plan: null, tickets: [{ id: "T01", path: "specs/tickets/T01.md", digest: "a".repeat(64) }] }) }],
  ["task ticket", { ...binding, ticketSelection: sealTicketSelection({ plan: selection.plan, tickets: [{ ...selection.tickets[0]!, id: "T01" }] }) }],
  ["two spine tickets", { ...binding, ticketSelection: sealTicketSelection({ plan: selection.plan, tickets: [selection.tickets[0]!, { ...selection.tickets[0]!, id: "W02" }] }) }],
] as const) {
  test(`plan-author refuses ${name} at compilation and before a DRAFT exists`, async () => {
    assert.throws(() => compilePlanAuthor(value), /plan-author requires/u);
    const w = world();
    try {
      await assert.rejects(newCommand({ stateRoot: join(w.root, "state"), project: "fixture", taskId: "author", repository: w.repo,
        request: "fixture", workflow: "plan-author", tier: 2,
        ...(value.planRef == null ? {} : { planRef: value.planRef }),
        ...("ticketSelection" in value ? { ticketSelection: value.ticketSelection } : {}) }));
      assert.equal(existsSync(join(w.root, "state")), false);
    } finally { w.close(); }
  });
}

test("the test role loads without enabling the shipped config and grants only runtime writes", () => {
  const loaded = loadConfig(stringify(config()));
  assertPlanAuthorRole(loaded);
  const role = loaded.agents.find(agent => agent.name === "plan-author")!;
  const policy = { writes: role.writes, protectedPaths: loaded.policy.protected_paths };
  assert.equal(writeTargetAllowed({ scope: "session-runtime" }, policy), true);
  assert.equal(writeTargetAllowed({ scope: "repository", path: "specs/new.html" }, policy), false);
  assert.equal(writeTargetAllowed({ scope: "repository", path: "core/src/new.ts" }, policy), false);
  const shipped = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  assert.equal(shipped.workflows.enabled.includes("plan-author"), false);
  assert.equal(shipped.agents.some(agent => agent.name === "plan-author"), false);
  for (const patch of [{ writes: ["specs/**"] }, { tools: { profile: "readonly", allow: ["read"] } }, { tools: { profile: "managed-worker", allow: ["write", "exec"] } }]) {
    assert.throws(() => assertPlanAuthorRole({ ...loaded, agents: loaded.agents.map(agent => agent.name === "plan-author" ? { ...agent, ...patch } : agent) }));
  }
  assert.throws(() => assertPlanAuthorRole({ ...loaded, routing: { ...loaded.routing, review: "same-provider-degraded" } }));
});

for (const defect of ["symlink", "hardlink", "executable", "redirected-root", "oversized-plan", "oversized-table", "oversized-envelope", "invalid-json", "state", "marker", "title", "artifact", "escaping-path", "failure"] as const) {
  test(`the private input boundary refuses ${defect} without repository writes`, () => {
    const w = world();
    try {
      let runtime = w.runtime, envelope = output();
      const path = join(runtime, "plan.html");
      if (defect === "symlink") { rmSync(path); symlinkSync(join(w.repo, "README.md"), path); }
      if (defect === "hardlink") linkSync(path, join(runtime, "alias"));
      if (defect === "executable") chmodSync(path, 0o755);
      if (defect === "redirected-root") { symlinkSync(runtime, join(w.root, "alias")); runtime = join(w.root, "alias"); }
      if (defect === "oversized-plan") writeFileSync(path, "x".repeat(PLAN_AUTHOR_DOCUMENT_MAX_BYTES + 1));
      if (defect === "oversized-table") writeFileSync(join(runtime, "tickets.json"), "x".repeat(PLAN_AUTHOR_TABLE_MAX_BYTES + 1));
      if (defect === "oversized-envelope") envelope = { ...envelope, notesForNextPhase: "x".repeat(PLAN_AUTHOR_ENVELOPE_MAX_BYTES) };
      if (defect === "invalid-json") writeFileSync(join(runtime, "tickets.json"), "not JSON");
      if (defect === "state" || defect === "title") {
        const table = JSON.parse(readFileSync(join(runtime, "tickets.json"), "utf8"));
        table[0][defect] = defect === "state" ? "todo" : "Different";
        writeFileSync(join(runtime, "tickets.json"), JSON.stringify(table));
      }
      if (defect === "marker") writeFileSync(path, readFileSync(path, "utf8").replace("[]", "[x]"));
      if (defect === "artifact") envelope = { ...envelope, artifacts: [{ path: "specs/old.html", kind: "plan", description: "illegal" }] };
      if (defect === "escaping-path") envelope = { ...envelope, runtimeFiles: { ...envelope.runtimeFiles, plan: "../old.html" } } as unknown as PlanAuthorOutput;
      if (defect === "failure") envelope = { ...envelope, producerStatus: "failure" };
      assert.throws(() => readPlanAuthorInput(runtime, envelope));
      assert.equal(git(w.repo, "status", "--porcelain"), "");
      assert.equal(git(w.repo, "rev-parse", "HEAD"), w.baseSha);
    } finally { w.close(); }
  });
}

test("host admission derives prompt equality, records evidence before commit and accepts only new protected files", async () => {
  const w = world();
  try {
    const result = await admitProductionPlanIntoWorktree({ worktree: w.repo, admissionInput: readPlanAuthorInput(w.runtime, output()), summary: output().summary,
      protectedPaths, baseSha: w.baseSha, at: "2026-10-10T00:00:00Z", journalAdmission: async record => {
        assert.equal(git(w.repo, "rev-parse", "HEAD"), w.baseSha);
        assert.equal(record.stem, output().stem);
      } });
    assert.ok(result.candidateSha);
    assert.ok(result.reports.every(report => report.passed));
    assert.ok(result.output.changedFiles.every(path => path.startsWith("specs/")));
    assert.match(readFileSync(join(w.repo, "specs/tickets/authored-plan/T01.md"), "utf8"), /state: todo/u);
    assert.equal(git(w.repo, "status", "--porcelain"), "");
  } finally { w.close(); }
});

for (const defect of ["existing-stem", "dirty-existing-plan", "non-idle", "supplied-state", "extra-path"] as const) {
  test(`the host phase refuses ${defect} before any commit`, async () => {
    const w = world();
    try {
      let input = readPlanAuthorInput(w.runtime, output());
      if (defect === "existing-stem" || defect === "dirty-existing-plan") {
        mkdirSync(join(w.repo, "specs")); writeFileSync(join(w.repo, "specs/authored-plan.html"), "existing protected bytes\n");
        git(w.repo, "add", "."); git(w.repo, "commit", "-m", "test: existing plan");
        if (defect === "dirty-existing-plan") writeFileSync(join(w.repo, "specs/authored-plan.html"), "changed existing protected bytes\n");
      }
      if (defect === "non-idle") input = { ...input, planHtml: input.planHtml.replace("[]", "[wip]") };
      if (defect === "supplied-state") input = { ...input, tickets: input.tickets.map(row => ({ ...row, state: "todo" })) };
      if (defect === "extra-path") input = { ...input, tickets: input.tickets.map(row => ({ ...row, path: "specs/old.html" })) };
      const head = git(w.repo, "rev-parse", "HEAD"), before = git(w.repo, "status", "--porcelain");
      await assert.rejects(admitProductionPlanIntoWorktree({ worktree: w.repo, admissionInput: input, summary: "fixture", protectedPaths, baseSha: head }));
      assert.equal(git(w.repo, "rev-parse", "HEAD"), head);
      assert.equal(git(w.repo, "status", "--porcelain"), before);
      assert.equal(existsSync(join(w.repo, "specs/authored-plan-build-prompts.md")), false);
    } finally { w.close(); }
  });
}

/** Production adapters are replaced, not the author/admission/review host boundaries. */
class AuthorAdapter implements HarnessAdapter {
  readonly id: string;
  readonly provider: string;
  readonly launched: string[];
  constructor(id: string, launched: string[]) { this.id = id; this.provider = id === "claude" ? "anthropic" : "openai-codex"; this.launched = launched; }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> { return { adapter: this.id, provider: this.provider, requestedModel: model, contextWindow: null, supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none", usageAuthority: "provider", costAuthority: "unavailable" }; }
  buildSpec(request: ModelRequest): ProcessSpec { return { executable: "node", argv: ["-e", ""], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false }; }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration, signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.launched.push(this.provider);
    const author = registration.role === "plan-author";
    if (author) {
      const runtime = /Host-provided session-runtime output directory: ([^\n]+)/u.exec(request.prompt)?.[1];
      assert.ok(runtime);
      assert.match(request.prompt, /Host-sealed spine selection: .*"id":"W01"/u);
      documents(runtime);
    }
    const envelope = author ? output() : { schema: "awsf.review-output/v1", producerStatus: "success", summary: "Reviewed the admitted plan", artifacts: [], notesForNextPhase: "Owner decides", verdict: "accept", reviewedSha: git(request.cwd, "rev-parse", "HEAD"), findings: [], limitations: [{ detail: "Synthetic unit review", affectedFiles: [] }] };
    const at = "2026-10-10T00:00:00Z";
    yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, provider: this.provider, requestedModel: request.model, resolvedModel: "fixture-model", provenance: "stream-authoritative" };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: JSON.stringify(envelope) };
    yield { kind: "run.completed", seq: 4, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

test("the test configuration runs private authoring, host admission, quality commands and opposite-provider review", async () => {
  const w = world(), stateRoot = join(w.root, "state"), cfg = config(), configPath = join(w.root, "awsf.config.yaml");
  installPrompts(w.root, ["plan-author", "reviewer"]); writeFileSync(configPath, stringify(cfg));
  const projection = createDashboardProjection(stateRoot);
  try {
    const created = await newCommand({ stateRoot, project: cfg.project.slug, taskId: "author", repository: w.repo, workflow: "plan-author", tier: 2,
      ...binding, request: k1Request("Author the fixture deep plan", "nothing; private authoring followed by host admission"), configSnapshotJson: toConfigSnapshotJson(cfg), projectRecord: projection.project });
    await startUnderK1({ attemptDir: created.attemptDir, configPath, worktreeRoot: join(w.root, "worktrees"), preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project });
    const launched: string[] = [];
    const status = await runProductionCommand({ attemptDir: created.attemptDir, stateRoot, config: cfg, configPath, projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement, assertLaunchProjection: projection.assertLaunchPermitted,
      infrastructure: { adapterFor: (_entry, id) => new AuthorAdapter(id, launched), createBroker: fakeBroker, resolveExecutable: () => { throw new Error("no quota probe in unit fixture"); }, sandboxProbe: () => false } });
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, 2);
    assert.deepEqual(launched, ["openai-codex", "anthropic"]);
    assert.ok(status.requiredReviewPresent);
    assert.ok(status.candidateSha);
    assert.equal(git(w.repo, "rev-parse", "HEAD"), w.baseSha, "canonical never advances during authoring");
    assert.ok((await readAttemptEvidence(created.attemptDir)).some(row => row.type === "envelope" && row.envelope.payload?.schema === "awsf.plan-author-output/v1"));
    assert.match(readFileSync(join(status.worktree!, "specs/tickets/authored-plan/T01.md"), "utf8"), /state: todo/u);
  } finally { projection.close(); w.close(); }
});
