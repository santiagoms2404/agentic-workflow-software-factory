import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { StubAdapter } from "../../../src/adapters/stub.ts";
import type {
  BrokerProcessRegistration,
  ModelRequest,
  ProcessTransport,
  TransportBroker,
} from "../../../src/adapters/interface.ts";
import { isTaskEdgeRegistration, reservationIdOf } from "../../../src/adapters/interface.ts";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import { toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import { loadConfig } from "../../../src/config/load.ts";
import type { ArchitectureReviewOutput } from "../../../src/contracts/architecture-review-output.ts";
import type { DesignOutput } from "../../../src/contracts/design-output.ts";
import type { DesignPlanOutput } from "../../../src/contracts/design-plan-output.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import type { EnvelopeBase } from "../../../src/contracts/envelope-base.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { runProductionCommand } from "../../../src/cli/commands/production-run.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import type { BrokerOptions } from "../../../src/execution/transport-broker.ts";
import { gatesForSession, phasesForSession, processesForSession } from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { writePlacement } from "../../../src/registry/placement.ts";
import { spineCoverage } from "../../../src/registry/plan-spine.ts";
import { parseAwsfPlanHtmlV1 } from "../../../src/registry/plan-source.ts";

const STUB_PROVIDER = resolve("core/test/fixtures/providers/stub/stub-provider.mjs");
const REQUEST = "Make design claims traceable into rendered tickets.";
const STEM = "generated-plan";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function fixtureConfig(): AwsfConfig {
  const loaded = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  const fixtureRoles = new Set(["designer", "architecture-reviewer", "planner"]);
  return {
    ...loaded,
    runtime: { ...loaded.runtime, seed_paths: [] },
    agents: loaded.agents.map((agent) => fixtureRoles.has(agent.name)
      ? {
          ...agent,
          model: "stub/success",
          thinking: "none" as const,
          harness: { adapter: "stub", continuity: "none" as const },
        }
      : agent),
    gates: {},
  };
}

function design(): DesignOutput {
  return {
    schema: "awsf.design-output/v1",
    producerStatus: "success",
    summary: "Designed a traceable plan spine.",
    artifacts: [],
    notesForNextPhase: "Review every declared design claim.",
    answeredRequest: REQUEST,
    components: [{ name: "plan renderer", responsibility: "Render one synchronized plan and ticket set." }],
    decisions: [{ id: "D-1", statement: "Render plan documents from one validated envelope." }],
    invariants: [{ id: "INV-1", statement: "Every rendered ticket mirrors its plan task." }],
    acceptanceCriteria: [{
      id: "AC-1",
      statement: "The rendered plan and ticket set pass the ticket-plan-sync fence.",
      verifiedBy: "Run the ticket-plan-sync assertions.",
    }],
    openQuestions: [],
  };
}

function review(blocked: boolean): ArchitectureReviewOutput {
  return {
    schema: "awsf.architecture-review-output/v1",
    producerStatus: "success",
    summary: blocked ? "Found one blocking architecture defect." : "Reviewed the traceable plan spine.",
    artifacts: [],
    notesForNextPhase: blocked ? "Return the design to its owner." : "Carry the reviewed spine into planning.",
    reviewedDesign: design().summary,
    verdict: blocked ? "concern" : "accept",
    findings: [{
      id: "F1",
      severity: blocked ? "high" : "medium",
      subject: "AC-1",
      title: blocked ? "Blocking coverage gap" : "Keep coverage explicit",
      detail: blocked
        ? "The proposed rendering path does not prove every declaration is served."
        : "The rendered set must retain an explicit coverage assertion.",
      evidence: blocked ? "blocking-review-evidence" : "ticket-plan-sync includes COVERAGE and MIRROR",
    }],
    limitations: ["Did not execute a provider or inspect a live subscription."],
  };
}

function plan(): DesignPlanOutput {
  return {
    schema: "awsf.design-plan-output/v1",
    producerStatus: "success",
    summary: "Plan the synchronized rendered set.",
    artifacts: [],
    notesForNextPhase: "Render the plan, prompt, and ticket from this envelope.",
    milestones: [{ id: "M1", title: "Synchronized output" }],
    steps: [{
      id: "T01",
      title: "Render the synchronized plan set",
      milestone: "M1",
      files: ["specs/generated-plan.html", "specs/tickets/generated-plan/T01.md"],
      serves: ["INV-1", "AC-1"],
      dependsOn: [],
      buildPrompt: "Render the plan and verify its ticket-plan synchronization.",
    }],
    testStrategy: ["Run the ticket-plan-sync assertions against the rendered set."],
    risks: [{ risk: "A renderer copy can drift.", mitigation: "Render every copy from the same envelope." }],
    openQuestions: [],
  };
}

class CannedStubAdapter extends StubAdapter {
  readonly requests: ModelRequest[] = [];
  readonly #responses: EnvelopeBase[];

  constructor(sideEffectPath: string, responses: readonly EnvelopeBase[]) {
    super({ providerPath: STUB_PROVIDER, sideEffectPath });
    this.#responses = [...responses];
  }

  get responsesRemaining(): number {
    return this.#responses.length;
  }

  override async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.requests.push(request);
    const response = this.#responses.shift();
    if (response === undefined) throw new Error("the route requested an unplanned fixture call");
    const at = "2026-08-24T00:00:00.000Z";
    yield {
      kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null,
      adapter: this.id, requestedModel: request.model,
    };
    yield {
      kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null,
      adapter: this.id, provider: "stub", requestedModel: request.model,
      resolvedModel: "stub-model-1", provenance: "stream-authoritative",
    };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: JSON.stringify(response) };
    yield { kind: "run.completed", seq: 4, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec): Promise<ProcessTransport> {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" as const },
        runId: registration.runId,
        edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
        ...(registration.kind === "agent-phase" ? {
          phase: {
            taskSessionId: registration.taskSessionId,
            workflowId: registration.workflowId,
            phaseId: registration.phaseId,
            phaseOrdinal: registration.phaseOrdinal,
            adapterId: registration.adapterId,
            role: registration.role,
          },
        } : {}),
        reservationId: reservationIdOf(registration),
        command: [spec.executable, ...spec.argv],
        cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
      await options.register(record);
      const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
      await options.onSpent?.(record, reservation);
      return {
        runId: registration.runId,
        identity: record.identity,
        stdout: (async function* () {})(),
        stderr: (async function* () {})(),
        exit: Promise.resolve({ code: 0, signal: null }),
        cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }),
      };
    },
  };
}

interface World {
  readonly root: string;
  readonly canonical: string;
  readonly stateRoot: string;
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly attemptDir: string;
  readonly sessionId: string;
  readonly worktree: string;
  readonly projection: ReturnType<typeof createDashboardProjection>;
}

async function world(): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "awsf-design-to-plan-route-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  mkdirSync(canonical, { recursive: true });
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "fixture plan repository\n");
  writeFileSync(join(canonical, "awsf.project.yaml"), [
    "version: awsf.project/v1",
    "",
    "project:",
    "  slug: agentic-workflow-software-factory",
    "",
    "repositories:",
    "  fixture:",
    "    role: plan",
    "    default_branch: main",
    "    gates: {}",
    "",
    "plans:",
    "  root: specs",
    "  format: awsf-plan-html/v1",
    "  default: generated-plan",
    "",
  ].join("\n"));
  git(canonical, "add", "README.md", "awsf.project.yaml");
  git(
    canonical,
    "-c", "user.name=Santiago Marin",
    "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-m", "test: seed design route",
  );

  const config = fixtureConfig();
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, stringify(config));
  for (const role of ["designer", "architecture-reviewer", "planner"]) {
    for (const kind of ["system", "user"] as const) {
      const source = resolve(`prompts/${role}/${kind}.md`);
      const destination = join(root, "prompts", role, `${kind}.md`);
      mkdirSync(join(root, "prompts", role), { recursive: true });
      writeFileSync(destination, readFileSync(source, "utf8"));
    }
  }
  mkdirSync(join(root, "prompts", "shared"), { recursive: true });
  writeFileSync(
    join(root, "prompts", "shared", "headless-role.md"),
    readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"),
  );

  await writePlacement(stateRoot, config.project.slug, {
    version: "awsf.placement/v1",
    project: config.project.slug,
    repositories: { fixture: { path: canonical } },
    worktree_root: join(root, "worktrees"),
  });
  const projection = createDashboardProjection(stateRoot);
  const created = await newCommand({
    stateRoot,
    project: config.project.slug,
    taskId: STEM,
    repository: canonical,
    request: REQUEST,
    workflow: "design-to-plan",
    tier: 1,
    configSnapshotJson: toConfigSnapshotJson(config),
    projectRecord: projection.project,
  });
  const prepared = await startCommand({
    attemptDir: created.attemptDir,
    worktreeRoot: join(root, "worktrees"),
    configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }),
    projectRecord: projection.project,
  });
  assert.notEqual(prepared.worktree, null);
  return {
    root,
    canonical,
    stateRoot,
    config,
    configPath,
    attemptDir: created.attemptDir,
    sessionId: created.status.sessionId,
    worktree: prepared.worktree!,
    projection,
  };
}

async function assertTicketPlanSync(worktree: string): Promise<void> {
  const planPath = join(worktree, "specs", `${STEM}.html`);
  const promptsPath = join(worktree, "specs", `${STEM}-build-prompts.md`);
  const ticketsPath = join(worktree, "specs", "tickets", STEM);
  const html = readFileSync(planPath, "utf8");
  const parsedPlan = parseAwsfPlanHtmlV1(html, STEM);
  assert.equal(parsedPlan.length, 1);
  assert.equal(parsedPlan[0]?.number, 1);
  assert.equal(parsedPlan[0]?.milestone, "M1");
  assert.equal(parsedPlan[0]?.milestoneMarker, "");
  assert.deepEqual(parsedPlan[0]?.checklist, [""]);

  const ticketRaw = readFileSync(join(ticketsPath, "T01.md"), "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/u.exec(ticketRaw);
  assert.notEqual(frontmatter, null);
  const fields = parse(frontmatter![1]!) as {
    id: string;
    title: string;
    milestone: string;
    state: string;
    depends_on: string[];
    serves: string[];
    tier?: number;
    workflow?: string;
  };
  assert.equal(fields.id, "T01");
  assert.equal(fields.milestone, "M1");
  assert.equal(fields.state, "todo");
  assert.deepEqual(fields.depends_on, []);
  assert.deepEqual(fields.serves, ["INV-1", "AC-1"]);
  assert.equal(fields.tier, undefined);
  assert.equal(fields.workflow, undefined);
  const promptBody = ticketRaw.split("## Build prompt\n\n")[1]?.replace(/\n+$/u, "");
  const prompts = readFileSync(promptsPath, "utf8");
  const promptBlock = /^### T01 — ([^\n]+)\n\n([\s\S]*?)\n*$/mu.exec(
    prompts.split("# Section B — Task prompts (recommended)\n\n")[1] ?? "",
  );
  assert.notEqual(promptBlock, null);
  assert.equal(promptBlock![1], fields.title);
  assert.equal(promptBlock![2], promptBody);
  assert.match(html, new RegExp(`<h4>1\\. ${fields.title}</h4>`, "u"));

  const coverage = spineCoverage(
    { label: STEM, declarations: parsedPlan.declarations },
    parsedPlan.map((task) => ({ id: `T${String(task.number).padStart(2, "0")}`, serves: task.serves })),
    [{ id: fields.id, serves: fields.serves }],
    [STEM],
  );
  assert.deepEqual(coverage, [], coverage.map((violation) => violation.message).join("; "));
}

test("the committed amendment loads with both roles and the design-to-plan vocabulary", () => {
  const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  assert.ok(config.workflows.enabled.includes("design-to-plan"));
  assert.ok(config.agents.some((agent) => agent.name === "designer"));
  assert.ok(config.agents.some((agent) => agent.name === "architecture-reviewer"));
});

test("design-to-plan runs request through render on canned stub envelopes and its product passes ticket-plan-sync", async () => {
  const fixture = await world();
  const sideEffect = join(fixture.root, "provider-ran.json");
  const adapter = new CannedStubAdapter(sideEffect, [design(), review(false), plan()]);
  try {
    const status = await runProductionCommand({
      attemptDir: fixture.attemptDir,
      stateRoot: fixture.stateRoot,
      config: fixture.config,
      configPath: fixture.configPath,
      projectRecord: fixture.projection.project,
      assertAdvancement: fixture.projection.assertAdvancement,
      assertLaunchProjection: fixture.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: () => adapter,
        createBroker: fakeBroker,
        sandboxProbe: () => false,
      },
    });

    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, 3);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(adapter.requests.length, 3);
    assert.equal(adapter.responsesRemaining, 0);
    assert.equal(existsSync(sideEffect), false, "the fixture provider process must not run");
    assert.equal(git(fixture.worktree, "status", "--porcelain"), "");
    assert.equal(git(fixture.worktree, "rev-parse", "HEAD"), status.candidateSha);
    await assertTicketPlanSync(fixture.worktree);

    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.deepEqual(phasesForSession(db, fixture.sessionId).map((phase) => [phase.phase_key, phase.status]), [
        ["request", "SUCCEEDED"],
        ["design-context", "SUCCEEDED"],
        ["design", "SUCCEEDED"],
        ["architecture-review", "SUCCEEDED"],
        ["plan-context", "SUCCEEDED"],
        ["plan", "SUCCEEDED"],
        ["plan-render", "SUCCEEDED"],
      ]);
      assert.equal(processesForSession(db, fixture.sessionId).length, 3);
      assert.ok(gatesForSession(db, fixture.sessionId).every((gate) => gate.passed === 1));
    } finally {
      db.close();
    }
  } finally {
    fixture.projection.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a high architecture finding blocks through L8 before context composition or planning", async () => {
  const fixture = await world();
  const sideEffect = join(fixture.root, "provider-ran.json");
  const adapter = new CannedStubAdapter(sideEffect, [design(), review(true)]);
  try {
    const status = await runProductionCommand({
      attemptDir: fixture.attemptDir,
      stateRoot: fixture.stateRoot,
      config: fixture.config,
      configPath: fixture.configPath,
      projectRecord: fixture.projection.project,
      assertLaunchProjection: fixture.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: () => adapter,
        createBroker: fakeBroker,
        sandboxProbe: () => false,
      },
    });

    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.blocker?.code, "phase-abort");
    assert.match(status.blocker?.detail ?? "", /architecture_review_clear/u);
    assert.equal(status.budget.callsSpent, 2);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(adapter.requests.length, 2, "the planner must never be called");
    assert.equal(adapter.responsesRemaining, 0);
    assert.equal(existsSync(sideEffect), false, "the fixture provider process must not run");
    assert.equal(existsSync(join(fixture.worktree, "specs", `${STEM}.html`)), false, "a blocked review must produce no plan");
    assert.equal(existsSync(join(fixture.attemptDir, "envelopes", "plan-context-0.json")), false);

    const journal = readFileSync(join(fixture.attemptDir, "journal.jsonl"), "utf8");
    assert.match(journal, /"edgeId":"L8"/u);
    assert.match(journal, /Blocking coverage gap/u);
    assert.match(journal, /blocking-review-evidence/u);

    const db = openDatabase(join(fixture.stateRoot, "awsf.db"), { readonly: true });
    try {
      const phases = phasesForSession(db, fixture.sessionId);
      assert.equal(phases.find((phase) => phase.phase_key === "plan-context")?.status, "FAILED");
      assert.equal(phases.find((phase) => phase.phase_key === "plan")?.status, "QUEUED");
      assert.equal(phases.find((phase) => phase.phase_key === "plan-render")?.status, "QUEUED");
      assert.equal(processesForSession(db, fixture.sessionId).length, 2);
      const blockerGate = gatesForSession(db, fixture.sessionId)
        .find((gate) => gate.gate_id === "architecture_review_clear");
      assert.equal(blockerGate?.passed, 0);
      assert.match(blockerGate?.violations_json ?? "", /no blocking findings/u);
    } finally {
      db.close();
    }
  } finally {
    fixture.projection.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
