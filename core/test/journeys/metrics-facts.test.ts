// W18 M1 journey: live projection, `awsf db rebuild` and the role-row builder
// agree, and the owner's attribution override survives a rebuild.
//
// Four synthetic runs go through the same paths a real attempt takes: each is
// minted by `awsf new`, every evidence record is persisted with
// `persistAttempt` and projected live through `createDashboardProjection`, and
// the rebuild is the real `rebuildCommand` over the state root. The override is
// the real `attributeCommand` with a fake owner terminal. No provider, no
// network, no owner data.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attributeCommand } from "../../src/cli/commands/attribute.ts";
import { createDashboardProjection, type DashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../src/cli/commands/attempt.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { rebuildCommand } from "../../src/cli/commands/operator.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import type { GateId } from "../../src/gates/interface.ts";
import { readRoleRows, type RoleRow } from "../../src/metrics/role-rows.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import type { TokenUsage } from "../../src/contracts/normalized-events.ts";
import type { RouteSelectionProvenance } from "../../src/contracts/route-selection.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import type { TaskState } from "../../src/state/task-machine.ts";
import { AT, OPUS_HIGH, SNAPSHOT, SyntheticAttempt, phase, session, usage } from "../unit/_metrics-journal.ts";

const PROJECT = "awsf";
const ENDED = "2026-09-26T10:30:00.000Z";

interface AgentPhaseSpec {
  readonly key: string;
  readonly owner: "builder" | "reviewer";
  readonly ordinal: number;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly errorCode?: string;
  readonly corrections?: number;
  /** [round, gate, passed] */
  readonly gates?: ReadonlyArray<readonly [number, GateId, boolean]>;
  /** [round, producer status] */
  readonly envelopes?: ReadonlyArray<readonly [number, "success" | "failure"]>;
  readonly tokens?: TokenUsage;
  readonly route?: RouteSelectionProvenance;
}

const BUILDER = { adapter: "codex", provider: "openai-codex", requested: "codex:gpt-6-sol", resolved: "gpt-6-sol", kind: "pi-codex" } as const;
const REVIEWER = { adapter: "claude", provider: "anthropic", requested: "claude:opus", resolved: "claude-opus-5-5", kind: "claude-code" } as const;

/** One agent phase from launch to its final status, with its calls, gates and envelopes. */
function agentPhase(run: SyntheticAttempt, spec: AgentPhaseSpec): void {
  const sid = run.init.sessionId;
  const phaseId = `${sid}-${spec.key}`;
  const who = spec.owner === "builder" ? BUILDER : REVIEWER;
  const runId = `${phaseId}-run`;
  const tokens = spec.tokens ?? usage(1_000, 100, 4_000, 0, 20);
  const record = (overrides: Parameters<typeof phase>[2] = {}): ReturnType<typeof phase> =>
    phase(spec.key, spec.owner, { phaseId, ordinal: spec.ordinal, maxCorrections: 1, ...overrides });

  run.phase(record());
  run.start(phaseId, spec.owner, who.adapter, who.provider, who.requested, spec.route);
  run.event(phaseId, runId, { kind: "run.started", adapter: who.kind, requestedModel: who.resolved });
  run.event(phaseId, runId, { kind: "usage", usage: tokens });
  run.call(phaseId, spec.owner, who.adapter, who.provider, who.requested, who.resolved, tokens);
  for (const [round, status] of spec.envelopes ?? [[0, spec.status === "SUCCEEDED" ? "success" : "failure"]]) {
    run.envelope(phaseId, spec.owner, round, status);
  }
  for (const [round, gateId, passed] of spec.gates ?? [[0, "envelope_valid", true]]) run.gate(phaseId, round, gateId, passed);
  run.phase(record({
    status: spec.status, correctionCount: spec.corrections ?? 0, errorCode: spec.errorCode ?? null, endedAt: ENDED,
  }));
}

/** A host phase judging the agent phase before it: a shift's `tNN-tests`. */
function hostPhase(run: SyntheticAttempt, key: string, ordinal: number, status: "SUCCEEDED" | "FAILED", errorCode: string | null = null): void {
  const phaseId = `${run.init.sessionId}-${key}`;
  run.phase(phase(key, "host", { phaseId, ordinal, kind: "code" }));
  run.phase(phase(key, "host", { phaseId, ordinal, kind: "code", status, errorCode, endedAt: ENDED }));
}

interface SyntheticRun {
  readonly taskId: string;
  readonly workflow: "shift" | "build-review";
  readonly evidence: SyntheticAttempt;
}

function synthetic(taskId: string, workflow: SyntheticRun["workflow"]): SyntheticRun {
  const evidence = new SyntheticAttempt({ ...session(`${taskId}-session`), taskId, workflowId: workflow });
  evidence.transition("PREPARED").transition("RUNNING");
  return { taskId, workflow, evidence };
}

/** Three tickets; t02's build fails a claim gate on round 0 and passes after one correction. */
function threeTicketShift(): SyntheticRun {
  const run = synthetic("metrics-shift", "shift");
  const e = run.evidence;
  agentPhase(e, { key: "t01-build", owner: "builder", ordinal: 1, status: "SUCCEEDED" });
  hostPhase(e, "t01-tests", 2, "SUCCEEDED");
  agentPhase(e, {
    key: "t02-build", owner: "builder", ordinal: 3, status: "SUCCEEDED", corrections: 1,
    envelopes: [[0, "success"], [1, "success"]],
    gates: [[0, "envelope_valid", true], [0, "diff_matches_claims", false], [1, "envelope_valid", true], [1, "diff_matches_claims", true]],
    tokens: usage(2_000, 300, 9_000, 500, 40),
  });
  hostPhase(e, "t02-tests", 4, "SUCCEEDED");
  agentPhase(e, { key: "t03-build", owner: "builder", ordinal: 5, status: "SUCCEEDED" });
  hostPhase(e, "t03-tests", 6, "SUCCEEDED");
  agentPhase(e, { key: "shift-review", owner: "reviewer", ordinal: 7, status: "SUCCEEDED", route: OPUS_HIGH });
  e.review(`${e.init.sessionId}-shift-review`, "accept");
  e.transition("GATING").transition("REVIEWING").transition("AWAITING_OWNER");
  return run;
}

function buildReview(): SyntheticRun {
  const run = synthetic("metrics-build-review", "build-review");
  const e = run.evidence;
  agentPhase(e, { key: "build", owner: "builder", ordinal: 1, status: "SUCCEEDED" });
  agentPhase(e, {
    key: "review", owner: "reviewer", ordinal: 2, status: "SUCCEEDED",
    route: { ...OPUS_HIGH, phaseId: "review", requested: { ...OPUS_HIGH.requested, phaseId: "review" } },
  });
  e.review(`${e.init.sessionId}-review`, "accept");
  e.transition("GATING").transition("REVIEWING").transition("AWAITING_OWNER").transition("LANDING").transition("LANDED");
  return run;
}

/** The builder writes a protected path: a guardrail hit the heuristic calls the model's. */
function permissionBreach(): SyntheticRun {
  const run = synthetic("metrics-breach", "build-review");
  const e = run.evidence;
  agentPhase(e, {
    key: "build", owner: "builder", ordinal: 1, status: "FAILED", errorCode: "PermissionBreach",
    envelopes: [[0, "success"]], gates: [[0, "envelope_valid", true], [0, "no_protected_paths", false]],
  });
  e.transition("BLOCKED", "phase-abort");
  return run;
}

/** The builder's executable is not installed: the heuristic calls it the environment's. */
function executableNotFound(): SyntheticRun {
  const run = synthetic("metrics-enoent", "shift");
  const e = run.evidence;
  const phaseId = `${e.init.sessionId}-t01-build`;
  e.phase(phase("t01-build", "builder", { phaseId, ordinal: 1 }));
  e.phase(phase("t01-build", "builder", { phaseId, ordinal: 1, status: "FAILED", errorCode: "ExecutableNotFound", endedAt: ENDED }));
  e.transition("BLOCKED", "phase-abort");
  return run;
}

/**
 * Mints the run with `awsf new`, then persists every evidence record as the
 * next attempt revision, projected live. The lifecycle state each record
 * carries is the attempt's, so the BLOCKED record seals the attempt last.
 */
async function drive(stateRoot: string, repository: string, projection: DashboardProjection, run: SyntheticRun): Promise<void> {
  const shift = run.workflow === "shift"
    ? sealShiftManifest({ plan: "metrics-fixture", milestones: ["M1"],
      tickets: [{ id: "T01", path: "specs/tickets/metrics-fixture/T01.md", digest: "0".repeat(64) }] })
    : undefined;
  const created = await newCommand({
    stateRoot, project: PROJECT, taskId: run.taskId, repository, request: `synthetic ${run.taskId}`,
    workflow: run.workflow, tier: 2, configSnapshotJson: JSON.stringify(SNAPSHOT),
    ...(shift === undefined ? {} : { shift }),
    now: () => AT, sessionId: () => run.evidence.init.sessionId, projectRecord: projection.project,
  });
  let status: AttemptStatus = created.status;
  for (const record of run.evidence.records) {
    if (record.evidence === undefined) continue;
    status = await persistAttempt(created.attemptDir, status.revision, {
      kind: "attempt.updated",
      next: nextRevision(status, { lifecycleState: record.lifecycleState as TaskState, lastActivity: `synthetic ${record.evidence.type}` }),
      evidence: record.evidence,
    }, projection.project);
  }
}

function rows(stateRoot: string): RoleRow[] {
  const db = openDatabase(join(stateRoot, "awsf.db"), { readonly: true });
  try {
    return readRoleRows(db);
  } finally {
    db.close();
  }
}

function removeDatabase(stateRoot: string): void {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(join(stateRoot, `awsf.db${suffix}`), { force: true });
  assert.equal(existsSync(join(stateRoot, "awsf.db")), false);
}

function rowOf(all: readonly RoleRow[], taskId: string, role: string): RoleRow {
  const row = all.find((candidate) => candidate.taskId === taskId && candidate.role === role);
  assert.ok(row, `no ${role} row for ${taskId}`);
  return row;
}

const OWNER: OwnerTerminal = { interactive: true, write: () => {}, confirm: async () => true };

test("live rows equal rows rebuilt from nothing, and the owner's override flips blocked-here and survives a second rebuild", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-metrics-facts-"));
  const stateRoot = join(root, "state");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // 1. Live: four runs, projected as they are persisted.
  const live = createDashboardProjection(stateRoot);
  try {
    for (const run of [threeTicketShift(), buildReview(), permissionBreach(), executableNotFound()]) {
      await drive(stateRoot, root, live, run);
    }
  } finally {
    live.close();
  }
  const liveRows = rows(stateRoot);

  // The rows say what the four runs did, before any rebuild is compared with them.
  // Every run starts at the same instant, so the sessions order by id.
  assert.deepEqual(liveRows.map((row) => `${row.taskId}/${row.role}`), [
    "metrics-breach/builder",
    "metrics-build-review/builder", "metrics-build-review/reviewer",
    "metrics-enoent/builder",
    "metrics-shift/builder", "metrics-shift/reviewer",
  ]);
  const shiftBuilder = rowOf(liveRows, "metrics-shift", "builder");
  assert.equal(shiftBuilder.phases, 3);
  assert.equal(shiftBuilder.corrections, 1);
  assert.equal(shiftBuilder.corrected, 1);
  assert.equal(shiftBuilder.recovered, 1);
  assert.equal(shiftBuilder.refuted, 1, "t02's round-0 success was refuted by its claim gate");
  assert.equal(shiftBuilder.firstPass, false);
  assert.equal(shiftBuilder.stateGroup, "AWAITING_OWNER");
  assert.equal(shiftBuilder.attribution, null);
  assert.equal(shiftBuilder.attributionSource, null);
  assert.equal(rowOf(liveRows, "metrics-shift", "reviewer").firstPass, true);
  assert.equal(rowOf(liveRows, "metrics-build-review", "builder").stateGroup, "LANDED");
  assert.equal(rowOf(liveRows, "metrics-build-review", "builder").cleanCompletion, true);

  const breach = rowOf(liveRows, "metrics-breach", "builder");
  assert.equal(breach.failedHere, true);
  assert.equal(breach.guardrailHits, 1);
  assert.equal(breach.attribution, "model");
  assert.equal(breach.attributionSource, "heuristic");
  assert.equal(breach.heuristicAttribution, "model");
  assert.equal(breach.blockedHere, true);

  const enoent = rowOf(liveRows, "metrics-enoent", "builder");
  assert.equal(enoent.failedHere, true);
  assert.equal(enoent.attribution, "environment");
  assert.equal(enoent.blockedHere, false, "an environment block never counts against a route");

  // 2. Rebuild from nothing: the live file is gone, so nothing is retained.
  removeDatabase(stateRoot);
  const first = await rebuildCommand(stateRoot);
  assert.equal(first.ok, true, first.ok ? undefined : first.reason);
  assert.equal(first.ok && first.retainedPath, null, "the rebuild started from no database at all");
  assert.equal(first.ok && first.sessions, 4);
  assert.deepEqual(rows(stateRoot), liveRows, "rows rebuilt from nothing equal the live rows");
  t.diagnostic(`rebuild 1: ${liveRows.length} live rows equal ${rows(stateRoot).length} rows rebuilt from nothing (${first.ok ? first.records : 0} journal records)`);

  // 3. The owner attributes the PermissionBreach to themselves: the ticket asked for the path.
  const blockedAt = await readAttempt(join(stateRoot, "projects", PROJECT, "tasks", "metrics-breach", "1"));
  const projection = createDashboardProjection(stateRoot);
  try {
    const result = await attributeCommand({
      stateRoot, project: PROJECT, taskId: "metrics-breach", attempt: 1, cause: "owner",
      reason: "the ticket's own wording asked for the protected path", terminal: OWNER,
      projectAttribution: projection.projectAttribution, now: () => "2026-09-28T10:00:00.000Z",
    });
    assert.equal(result.confirmed, true);
  } finally {
    projection.close();
  }
  const blockedAfter = await readAttempt(join(stateRoot, "projects", PROJECT, "tasks", "metrics-breach", "1"));
  assert.equal(blockedAfter.revision, blockedAt.revision, "the sealed attempt was not reopened");

  const overridden = rows(stateRoot);
  const flipped = rowOf(overridden, "metrics-breach", "builder");
  assert.equal(flipped.blockedHere, false, "the override flips blocked-here");
  assert.equal(flipped.failedHere, true);
  assert.equal(flipped.attribution, "owner");
  assert.equal(flipped.attributionSource, "owner");
  assert.equal(flipped.heuristicAttribution, "model", "the heuristic stays beside the override");
  // Nothing else moved.
  assert.deepEqual(
    overridden.filter((row) => row.taskId !== "metrics-breach"),
    liveRows.filter((row) => row.taskId !== "metrics-breach"),
  );
  assert.deepEqual({ ...flipped, blockedHere: true, attribution: "model", attributionSource: "heuristic" }, breach);

  // 4. A second rebuild from nothing keeps the override.
  removeDatabase(stateRoot);
  const second = await rebuildCommand(stateRoot);
  assert.equal(second.ok, true, second.ok ? undefined : second.reason);
  assert.deepEqual(rows(stateRoot), overridden, "the override survives a second rebuild");
  t.diagnostic(`rebuild 2: the override survives; metrics-breach/builder blockedHere=${String(rowOf(rows(stateRoot), "metrics-breach", "builder").blockedHere)} attribution=owner heuristic=model`);
});
