import { test } from "node:test";
import assert from "node:assert/strict";
import type { JournalRecord } from "../../../src/persistence/journal.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { createSession, projectAttemptStatus, projectEvent, type AttemptStatusProjection, type ProjectionContext, type SessionInit } from "../../../src/observability/projector.ts";

function freshDb() {
  return openDatabase(":memory:");
}

const SESSION: SessionInit = {
  sessionId: "s1",
  projectSlug: "proj",
  taskId: "T1",
  attempt: 1,
  workflowId: "wf",
  riskTier: 0,
  isProtected: false,
  requestText: "do the thing",
  callCeiling: 5,
  configSnapshotJson: "{}",
  journalPath: "/attempt/journal.jsonl",
  startedAt: "2026-08-06T00:00:00.000Z",
};

function seededDb() {
  const db = freshDb();
  createSession(db, SESSION);
  return db;
}

function record(seq: number, event: NormalizedEvent): JournalRecord<NormalizedEvent> {
  return { source_seq: seq, recorded_at: "2026-08-06T00:00:00.000Z", event };
}

const ctx: ProjectionContext = { sessionId: "s1", runId: "run1", phaseId: null };

function attempt(evidence: NonNullable<AttemptStatusProjection["evidence"]>): AttemptStatusProjection {
  return {
    ...SESSION,
    lifecycleState: "RUNNING",
    baseSha: null,
    candidateSha: null,
    callsSpent: 0,
    callsReserved: 1,
    correctionsAuto: 0,
    correctionsOwner: 0,
    ownerReentries: 0,
    workerModelResolved: null,
    updatedAt: SESSION.startedAt,
    endedAt: null,
    stateRevision: 1,
    evidence,
  };
}

test("createSession is idempotent (INSERT OR IGNORE) and safe to call twice", () => {
  const db = freshDb();
  createSession(db, SESSION);
  createSession(db, SESSION);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
  assert.equal(count, 1);
});

test("an L26 transition projects against the unchanged transitions schema", () => {
  const db = freshDb();
  try {
    const outcome = projectAttemptStatus(db, {
      ...attempt({
        type: "transition",
        id: "transition-l26",
        seq: 1,
        from: "RUNNING",
        to: "AWAITING_OWNER",
        actor: "host",
        edgeId: "L26",
        reasonSource: "process",
        reasonCode: null,
        reasonDetail: "quota reset in 4 minutes; threshold is 5 minutes",
        spawnSite: false,
        at: SESSION.startedAt,
      }),
      lifecycleState: "AWAITING_OWNER",
    }, 1);
    assert.equal(outcome.ok, true);
    const row = db.prepare(
      "SELECT from_state, to_state, actor, edge_id, spawn_site FROM transitions WHERE transition_id = ?",
    ).get("transition-l26");
    assert.deepEqual({ ...row as object }, {
      from_state: "RUNNING",
      to_state: "AWAITING_OWNER",
      actor: "host",
      edge_id: "L26",
      spawn_site: 0,
    });
  } finally {
    db.close();
  }
});

test("a run.started event is projected as one events row", () => {
  const db = seededDb();
  const rec = record(1, { seq: 1, runId: "run1", hostAt: "t0", providerAt: null, kind: "run.started", adapter: "claude-code", requestedModel: "sonnet-5" });
  const outcome = projectEvent(db, ctx, rec);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.applied, true);
  const rows = (db.prepare("SELECT type, run_id FROM events WHERE session_id = ?").all("s1") as object[]).map((r) => ({
    ...r,
  }));
  assert.deepEqual(rows, [{ type: "run.started", run_id: "run1" }]);
});

test("compiled system prompt projection retains full text and composition digests without a schema change", () => {
  const db = freshDb();
  const text = "role bytes\n\nshared bytes\n";
  const composition = {
    roleSystemDigest: "1".repeat(64),
    sharedBlockDigest: "2".repeat(64),
    composedSystemDigest: "3".repeat(64),
    compositionVersion: "awsf.prompt-composition/v1",
  };
  const phase = projectAttemptStatus(db, attempt({
    type: "phase",
    phase: {
      phaseId: "phase-1", ordinal: 1, key: "builder", name: "builder", kind: "agent", owner: "builder",
      description: "fixture phase", status: "RUNNING", correctionCount: 0, maxCorrections: 0,
      errorCode: null, errorMessage: null, startedAt: SESSION.startedAt, endedAt: null, createdAt: SESSION.startedAt,
    },
  }), 1);
  assert.equal(phase.ok, true);
  const promptStatus = {
    ...attempt({
      type: "compiled-prompt", phaseId: "phase-1", name: "system", text,
      ...composition, lineCount: 4, at: SESSION.startedAt,
    }),
    stateRevision: 2,
  };
  const outcome = projectAttemptStatus(db, promptStatus, 2);
  assert.equal(outcome.ok, true);
  const row = db.prepare("SELECT type, name, payload_json FROM events").get() as {
    type: string; name: string; payload_json: string;
  };
  assert.equal(row.type, "compiled_prompt");
  assert.equal(row.name, "system");
  assert.deepEqual(JSON.parse(row.payload_json), { text, lineCount: 4, ...composition });
});

test("agent launch evidence creates a route-attributed null-usage row with exact broker grant", () => {
  const db = freshDb();
  const outcome = projectAttemptStatus(db, attempt({
    type: "agent-start",
    phaseId: "phase-1",
    agent: "builder",
    adapterId: "pi-codex",
    provider: "openai-codex",
    color: "#22D3EE",
    requestedModel: "gpt-5.6-sol",
    sandboxBadge: "tool-policy",
    sandboxMechanism: "adapter-tool-policy",
    at: SESSION.startedAt,
  }), 1);
  assert.equal(outcome.ok, true);
  const row = db.prepare(`SELECT provider, requested_model, resolved_model, model_provenance,
      call_count, input_tokens, sandbox_badge, sandbox_mechanism FROM agent_sessions`).get();
  assert.deepEqual({ ...row as object }, {
    provider: "openai-codex",
    requested_model: "gpt-5.6-sol",
    resolved_model: null,
    model_provenance: "route-attributed",
    call_count: 0,
    input_tokens: null,
    sandbox_badge: "tool-policy",
    sandbox_mechanism: "adapter-tool-policy",
  });
});

test("credential-shaped request and event values are scrubbed before SQLite", () => {
  const db = freshDb();
  const shaped = `AK${"IA"}${"A".repeat(16)}`;
  createSession(db, {
    ...SESSION,
    requestText: `inspect ${shaped}`,
    configSnapshotJson: JSON.stringify({ safe: true, auth_token: shaped }),
  });
  projectEvent(db, ctx, record(1, {
    seq: 1,
    runId: "run1",
    hostAt: "t0",
    providerAt: null,
    kind: "text.delta",
    text: `provider echoed ${shaped}`,
  }));
  const session = db.prepare("SELECT request_text, config_snapshot_json FROM sessions WHERE session_id = 's1'").get() as {
    request_text: string;
    config_snapshot_json: string;
  };
  const event = db.prepare("SELECT payload_json FROM events").get() as { payload_json: string };
  assert.equal(session.request_text, "[REDACTED]");
  assert.equal(session.config_snapshot_json.includes(shaped), false);
  assert.equal(event.payload_json.includes(shaped), false);
  assert.equal(event.payload_json.includes("[REDACTED]"), true);
});

test("re-applying the exact same record is a no-op (idempotent double-apply)", () => {
  const db = seededDb();
  const rec = record(1, { seq: 1, runId: "run1", hostAt: "t0", providerAt: null, kind: "run.started", adapter: "claude-code", requestedModel: "sonnet-5" });

  const first = projectEvent(db, ctx, rec);
  const second = projectEvent(db, ctx, rec);

  assert.equal(first.applied, true);
  assert.equal(second.ok, true);
  assert.equal(second.applied, false, "second application of the same source_seq must be a no-op");

  const count = (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  assert.equal(count, 1, "double-apply must not create a second row");
});

test("thinking.delta is counted as processed but never persisted (invariant 9)", () => {
  const db = seededDb();
  const rec = record(1, { seq: 1, runId: "run1", hostAt: "t0", providerAt: null, kind: "thinking.delta", text: "pondering..." });
  const outcome = projectEvent(db, ctx, rec);
  assert.equal(outcome.ok, true);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  assert.equal(count, 0);
  const session = db.prepare("SELECT last_projected_seq FROM sessions WHERE session_id = 's1'").get() as {
    last_projected_seq: number;
  };
  assert.equal(session.last_projected_seq, 1, "cursor still advances past a skipped kind");
});

test("tool-call folding: tool.requested creates one row, tool.completed updates it in place", () => {
  const db = seededDb();
  const requested = record(1, {
    seq: 1,
    runId: "run1",
    hostAt: "t0",
    providerAt: null,
    kind: "tool.requested",
    toolCallId: "t1",
    name: "bash",
    inputSummary: "ls -la",
  });
  const completed = record(2, {
    seq: 2,
    runId: "run1",
    hostAt: "t1",
    providerAt: null,
    kind: "tool.completed",
    toolCallId: "t1",
    outcome: "ok",
    durationMs: 42,
    resultSnippet: "total 0",
  });

  projectEvent(db, ctx, requested);
  const afterRequest = db.prepare("SELECT status, type FROM events").get() as { status: string; type: string };
  assert.equal(afterRequest.status, "running");
  assert.equal(afterRequest.type, "tool_call");

  projectEvent(db, ctx, completed);
  const rows = db.prepare("SELECT status, type, payload_json FROM events").all() as {
    status: string;
    type: string;
    payload_json: string;
  }[];
  assert.equal(rows.length, 1, "tool.completed updates the existing row rather than creating a new one");
  const row = rows[0];
  if (row === undefined) throw new Error("expected exactly one events row");
  assert.equal(row.status, "ok");
  const payload = JSON.parse(row.payload_json) as { outcome: string; durationMs: number };
  assert.equal(payload.outcome, "ok");
  assert.equal(payload.durationMs, 42);
});

test("re-applying tool.completed twice does not double-update (double-apply on folded rows)", () => {
  const db = seededDb();
  const requested = record(1, {
    seq: 1,
    runId: "run1",
    hostAt: "t0",
    providerAt: null,
    kind: "tool.requested",
    toolCallId: "t1",
    name: "bash",
    inputSummary: "ls",
  });
  const completed = record(2, {
    seq: 2,
    runId: "run1",
    hostAt: "t1",
    providerAt: null,
    kind: "tool.completed",
    toolCallId: "t1",
    outcome: "ok",
    durationMs: 10,
    resultSnippet: "ok",
  });

  projectEvent(db, ctx, requested);
  projectEvent(db, ctx, completed);
  const second = projectEvent(db, ctx, completed);

  assert.equal(second.applied, false);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  assert.equal(count, 1);
});

test("projection failure never throws: it returns a degraded outcome with a sqlite-projection-failed notice", () => {
  const db = seededDb();
  // Pre-insert a conflicting event_id so the projector's own INSERT collides.
  db.prepare(
    "INSERT INTO events (event_id, session_id, run_id, first_source_seq, last_source_seq, type, payload_json, started_at) VALUES ('run1:1','s1','run1',1,1,'x','{}','t0')",
  ).run();

  const rec = record(1, { seq: 1, runId: "run1", hostAt: "t0", providerAt: null, kind: "run.started", adapter: "claude-code", requestedModel: "sonnet-5" });

  let outcome;
  assert.doesNotThrow(() => {
    outcome = projectEvent(db, ctx, rec);
  });
  assert.equal(outcome!.ok, false);
  assert.equal(outcome!.degraded, true);
  assert.equal(outcome!.notice?.code, "sqlite-projection-failed");

  const session = db.prepare("SELECT observability_degraded, last_projected_seq FROM sessions WHERE session_id = 's1'").get() as {
    observability_degraded: number;
    last_projected_seq: number;
  };
  assert.equal(session.observability_degraded, 1);
  assert.equal(session.last_projected_seq, 0, "a failed apply must not advance the cursor");
});

test("projecting against an unknown session id fails without touching sqlite state, never throws", () => {
  const db = freshDb();
  const rec = record(1, { seq: 1, runId: "run1", hostAt: "t0", providerAt: null, kind: "run.started", adapter: "claude-code", requestedModel: "sonnet-5" });
  const outcome = projectEvent(db, { sessionId: "does-not-exist", runId: "run1", phaseId: null }, rec);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.notice?.code, "sqlite-projection-failed");
});
