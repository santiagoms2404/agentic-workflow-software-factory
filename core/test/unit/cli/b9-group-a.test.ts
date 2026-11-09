// B9-10, B9-15, B9-19, B9-23, B9-25, B9-28: Tier 4 Batch 9 Group A regression tests.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { toAttemptStatusProjection } from "../../../src/cli/commands/attempt-projection.ts";
import { duplicateFacts } from "../../../src/cli/commands/preflight.ts";
import { delegateReplayCommand } from "../../../src/cli/commands/delegate-replay.ts";

import { ticketStoreFor } from "../../../src/cli/commands/ticket.ts";
import { sessionsForStage } from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";

function fakeAttemptStatus(overrides: Partial<AttemptStatus> = {}): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1",
    sessionId: "sess-1",
    project: "demo-project",
    taskId: "T01-task",
    continuesTask: null,
    groupId: null,
    planRef: "plan-a",
    attempt: 1,
    repository: "/tmp/repo",
    worktree: null,
    workflow: "build",
    tier: 1,
    request: "implement something",
    configSnapshotJson: "{}",
    lifecycleState: "RUNNING",
    baseSha: "base123",
    candidateSha: null,
    phase: null,
    budget: {
      attempt: 1,
      ceiling: 10,
      callsSpent: 2,
      callsReserved: 1,
      correctionsAuto: 0,
      correctionsOwner: 0,
      ownerReentries: 0,
      allowance: {
        auto: 3,
        owner: 3,
        ownerReentries: 3,
      },
    },
    ceilingGrants: [],
    routeOverrides: {},
    reviewDegradation: null,
    model: null,
    lastActivityAt: "2026-11-03T12:00:00.000Z",
    lastActivity: "started",
    revision: 1,
    ...overrides,
  } as any as AttemptStatus;
}

test("B9-10: toAttemptStatusProjection reflects isProtected when protected evidence is present", () => {
  const status = fakeAttemptStatus();
  const projectionWithoutEvent = toAttemptStatusProjection("/tmp/state", status);
  assert.equal(projectionWithoutEvent.isProtected, false);

  const projectionWithGrant = toAttemptStatusProjection("/tmp/state", status, {
    kind: "attempt.updated",
    next: status,
    evidence: {
      type: "protected-grant",
      grant: {} as any,
    },
  });
  assert.equal(projectionWithGrant.isProtected, true, "isProtected must be true when protected-grant evidence is present");
});

test("B9-15: selectedTickets in duplicateFacts returns ticketSelection when present on status", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-b9-15-"));
  try {
    const project = "demo-project";
    const taskDir = join(stateRoot, "projects", project, "tasks", "T01-task", "1");
    mkdirSync(taskDir, { recursive: true });

    const status = fakeAttemptStatus({
      ticketSelection: {
        plan: "plan-a",
        selectionDigest: "digest-1",
        tickets: [{ id: "T05", path: "specs/tickets/T05.md", digest: "sha256-abc" }],
      },
    });
    writeFileSync(join(taskDir, "status.json"), JSON.stringify(status), "utf8");

    const facts = await duplicateFacts(stateRoot, status);
    assert.deepEqual(facts.tickets, ["T05"], "duplicateFacts must report selected tickets from ticketSelection");
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("B9-19: sessionsForStage returns all sessions for project including archived", () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b9-19-"));
  try {
    const dbPath = join(dir, "awsf.db");
    const db = openDatabase(dbPath);

    // Insert 1 unarchived session for project A
    db.prepare(`INSERT INTO sessions
      (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected, lifecycle_state, request_text, call_ceiling, started_at, updated_at, archived, config_snapshot_json, journal_path)
      VALUES (?, ?, 'task-1', 1, 'build', 1, 0, 'LANDED', 'req1', 10, '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z', 0, '{}', '/tmp/j1')`)
      .run("sess-a1", "project-a");

    // Insert 1 archived session for project A
    db.prepare(`INSERT INTO sessions
      (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected, lifecycle_state, request_text, call_ceiling, started_at, updated_at, archived, config_snapshot_json, journal_path)
      VALUES (?, ?, 'task-2', 2, 'build', 1, 0, 'LANDED', 'req2', 10, '2026-11-02T10:00:00.000Z', '2026-11-02T10:00:00.000Z', 1, '{}', '/tmp/j2')`)
      .run("sess-a2", "project-a");

    // Insert 1 session for project B
    db.prepare(`INSERT INTO sessions
      (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected, lifecycle_state, request_text, call_ceiling, started_at, updated_at, archived, config_snapshot_json, journal_path)
      VALUES (?, ?, 'task-3', 1, 'build', 1, 0, 'LANDED', 'req3', 10, '2026-11-03T10:00:00.000Z', '2026-11-03T10:00:00.000Z', 0, '{}', '/tmp/j3')`)
      .run("sess-b1", "project-b");

    const aSessions = sessionsForStage(db, "project-a");
    assert.equal(aSessions.length, 2, "sessionsForStage must return all sessions for project-a including archived");
    const ids = aSessions.map((s) => s.session_id).sort();
    assert.deepEqual(ids, ["sess-a1", "sess-a2"]);

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("B9-23: ticketStoreFor respects catalog plans.root when present", () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b9-23-"));
  try {
    const yaml = `version: awsf.project/v1
project:
  slug: custom-project
repositories:
  awsf:
    role: plan
    default_branch: main
plans:
  root: doc/plans
  format: awsf-plan-html/v1
  default: plan-a
`;
    writeFileSync(join(dir, "awsf.project.yaml"), yaml, "utf8");
    const store = ticketStoreFor(dir);
    assert.equal(store.directory, join(dir, "doc", "plans", "tickets"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("B9-28: attemptStatuses does not swallow non-ENOENT read errors", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-b9-28-"));
  try {
    const project = "demo-project";
    const taskDir = join(stateRoot, "projects", project, "tasks", "T01-task", "1");
    mkdirSync(taskDir, { recursive: true });

    // Write malformed JSON
    writeFileSync(join(taskDir, "status.json"), "{ invalid json", "utf8");

    const status = fakeAttemptStatus();
    // duplicateFacts scans tasks and calls attemptStatuses
    await assert.rejects(async () => {
      await duplicateFacts(stateRoot, status);
    }, (err: any) => {
      return err instanceof SyntaxError || err?.name === "SyntaxError";
    }, "attemptStatuses must rethrow syntax error from corrupted status.json");
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("B9-25: live replay judge propagates fatal error from decide rather than recording unavailable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b9-25-"));
  try {
    const project = "demo-project";
    const taskDir = join(dir, "projects", project, "tasks", "T01-task", "1");
    mkdirSync(taskDir, { recursive: true });

    const status = fakeAttemptStatus({
      lifecycleState: "RUNNING",
      recovery: {
        kind: "ceiling-pause",
        at: "2026-11-03T12:00:00.000Z",
        phase: "worker",
        id: "cp-1",
        reason: "ceiling",
        prefix: [],
      } as any,
    });
    const journalLine = JSON.stringify({
      schema: "awsf/journal-record/v1",
      seq: 1,
      source_seq: 1,
      at: "2026-11-03T12:00:00.000Z",
      recorded_at: "2026-11-03T12:00:00.000Z",
      event: {
        kind: "state-transition",
        previous: null,
        next: status,
        evidence: {
          type: "ceiling-pause",
          at: "2026-11-03T12:00:00.000Z",
        },
      },
    }) + "\n";
    writeFileSync(join(taskDir, "journal.jsonl"), journalLine, "utf8");
    writeFileSync(join(taskDir, "status.json"), JSON.stringify(status), "utf8");

    const failingTransport = {
      async ask() {
        throw new Error("fatal code defect in transport");
      },
    } as any;

    const fakeTerminal = {
      interactive: true,
      async confirm() {
        return true;
      },
      write() {},
    } as any;

    await assert.rejects(async () => {
      await delegateReplayCommand({
        stateRoot: dir,
        project,
        catalogPath: join(dir, "nonexistent.yaml"),
        live: true,
        terminal: fakeTerminal,
        transport: failingTransport,
        phasesFor: async () => ({
          config: {
            phases: [{ id: "worker", ticket: null, route: "mock" }],
          },
          roles: { worker: "builder" },
        }),
      });
    }, (err: any) => {
      return err.message.includes("fatal code defect in transport");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
