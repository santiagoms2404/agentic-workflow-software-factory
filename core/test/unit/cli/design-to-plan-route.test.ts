import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

import { loadConfig } from "../../../src/config/load.ts";
import { runProductionCommand } from "../../../src/cli/commands/production-run.ts";
import { gatesForSession, phasesForSession, processesForSession } from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { spineCoverage } from "../../../src/registry/plan-spine.ts";
import { parseAwsfPlanHtmlV1 } from "../../../src/registry/plan-source.ts";
import {
  CannedStubAdapter,
  STEM,
  design,
  fakeBroker,
  git,
  plan,
  review,
  world,
} from "./_offline-route.ts";

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
  const adapter = new CannedStubAdapter({ sideEffectPath: sideEffect, responses: [design(), review(false), plan()] });
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
        resolveExecutable: () => { throw new Error("quota probe unavailable in this offline unit test"); },
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
  const adapter = new CannedStubAdapter({ sideEffectPath: sideEffect, responses: [design(), review(true)] });
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
        resolveExecutable: () => { throw new Error("quota probe unavailable in this offline unit test"); },
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
