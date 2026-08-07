// The SQLite projector — the only place besides `sqlite.ts` and the
// migrations that may write to the database (enforced by
// `sqlite-write-fence.test.ts`). Projection is a pure function of the
// journal: given the same `JournalRecord` twice, the second application is a
// no-op, and a failure never throws into the caller's phase — it degrades.

import type { JournalRecord } from "../persistence/journal.ts";
import type { NormalizedEvent } from "../contracts/normalized-events.ts";
import { isPersistableKind } from "../contracts/normalized-events.ts";
import type { DatabaseSync } from "./sqlite.ts";

export interface ProjectionContext {
  sessionId: string;
  runId: string;
  /** `null` for session-level events not attached to any phase. */
  phaseId: string | null;
}

export interface ProjectionOutcome {
  ok: boolean;
  /** `false` when the record was already applied (idempotent no-op). */
  applied: boolean;
  /**
   * The session's observability is degraded — the projection no longer
   * matches the journal. True on every failure, INCLUDING one so bad that
   * the flag could not be written into the database itself: a session is
   * degraded because the projection failed, not because a row says so.
   */
  degraded: boolean;
  /**
   * Whether `sessions.observability_degraded` was actually set. `false` with
   * `degraded: true` means the database could not even record its own
   * illness — the caller's journaled notice is then the only durable flag,
   * and `awsf db rebuild` is the only exit.
   */
  flagPersisted: boolean;
  notice?: { code: "sqlite-projection-failed"; message: string; detail: string | null };
}

/** The minimum a caller must supply to mint a `sessions` row before projecting its events. */
export interface SessionInit {
  sessionId: string;
  projectSlug: string;
  taskId: string;
  attempt: number;
  workflowId: string;
  riskTier: 0 | 1 | 2;
  isProtected: boolean;
  requestText: string;
  callCeiling: number;
  configSnapshotJson: string;
  journalPath: string;
  startedAt: string;
}

/**
 * Inserts the `sessions` row a session's events are projected against.
 * `INSERT OR IGNORE` so re-running session creation for the same id is a
 * no-op rather than a constraint-violation throw.
 */
export function createSession(db: DatabaseSync, init: SessionInit): void {
  db.prepare(
    `INSERT OR IGNORE INTO sessions
       (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
        lifecycle_state, request_text, call_ceiling, started_at, updated_at, config_snapshot_json, journal_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)`,
  ).run(
    init.sessionId,
    init.projectSlug,
    init.taskId,
    init.attempt,
    init.workflowId,
    init.riskTier,
    init.isProtected ? 1 : 0,
    init.requestText,
    init.callCeiling,
    init.startedAt,
    init.startedAt,
    init.configSnapshotJson,
    init.journalPath,
  );
}

function getLastProjectedSeq(db: DatabaseSync, sessionId: string): number | null {
  const row = db.prepare("SELECT last_projected_seq FROM sessions WHERE session_id = ?").get(sessionId) as
    | { last_projected_seq: number }
    | undefined;
  return row?.last_projected_seq ?? null;
}

function setDegraded(db: DatabaseSync, sessionId: string): void {
  db.prepare("UPDATE sessions SET observability_degraded = 1, updated_at = ? WHERE session_id = ?").run(
    new Date().toISOString(),
    sessionId,
  );
}

function toolCallEventId(runId: string, toolCallId: string): string {
  return `${runId}:tool:${toolCallId}`;
}

function recordEventId(runId: string, sourceSeq: number): string {
  return `${runId}:${sourceSeq}`;
}

/** Applies one journal record's projection inside the already-open transaction. */
function applyEvent(
  db: DatabaseSync,
  ctx: ProjectionContext,
  record: JournalRecord<NormalizedEvent>,
): void {
  const event = record.event;

  if (!isPersistableKind(event.kind)) {
    // Invariant 9: thinking is never persisted, streamed only. Still counts
    // as processed so the session's cursor advances past it.
    return;
  }

  if (event.kind === "tool.requested") {
    db.prepare(
      `INSERT INTO events
         (event_id, session_id, phase_id, run_id, first_source_seq, last_source_seq,
          type, name, status, payload_json, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'tool_call', ?, 'running', ?, ?)`,
    ).run(
      toolCallEventId(ctx.runId, event.toolCallId),
      ctx.sessionId,
      ctx.phaseId,
      ctx.runId,
      record.source_seq,
      record.source_seq,
      event.name,
      JSON.stringify({ toolCallId: event.toolCallId, inputSummary: event.inputSummary }),
      event.hostAt,
    );
    return;
  }

  if (event.kind === "tool.completed") {
    db.prepare(
      `UPDATE events
         SET status = ?, last_source_seq = ?, ended_at = ?,
             payload_json = json_patch(payload_json, ?)
       WHERE event_id = ?`,
    ).run(
      event.outcome,
      record.source_seq,
      event.hostAt,
      JSON.stringify({ outcome: event.outcome, durationMs: event.durationMs, resultSnippet: event.resultSnippet }),
      toolCallEventId(ctx.runId, event.toolCallId),
    );
    return;
  }

  db.prepare(
    `INSERT INTO events
       (event_id, session_id, phase_id, run_id, first_source_seq, last_source_seq,
        type, payload_json, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    recordEventId(ctx.runId, record.source_seq),
    ctx.sessionId,
    ctx.phaseId,
    ctx.runId,
    record.source_seq,
    record.source_seq,
    event.kind,
    JSON.stringify(event),
    event.hostAt,
  );
}

/**
 * Projects one journal record. Idempotent — a record whose `source_seq` is
 * already at or behind the session's `last_projected_seq` is a no-op, so
 * re-applying the same record (or replaying from an earlier cursor) never
 * double-writes. Transactional — the event write and the cursor advance
 * happen in one `BEGIN IMMEDIATE`. Never throws: a failure anywhere in the
 * transaction is caught, the session is flagged `observability_degraded`
 * (best-effort, in its own transaction), and a `sqlite-projection-failed`
 * notice is returned for the caller to journal — the run itself is never
 * killed for a projection failure.
 */
export function projectEvent(
  db: DatabaseSync,
  ctx: ProjectionContext,
  record: JournalRecord<NormalizedEvent>,
): ProjectionOutcome {
  try {
    const lastSeq = getLastProjectedSeq(db, ctx.sessionId);
    if (lastSeq === null) {
      return {
        ok: false,
        applied: false,
        degraded: true,
        flagPersisted: false,
        notice: {
          code: "sqlite-projection-failed",
          message: `no session row for ${ctx.sessionId}; cannot project`,
          detail: null,
        },
      };
    }
    if (record.source_seq <= lastSeq) {
      return { ok: true, applied: false, degraded: false, flagPersisted: false };
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      applyEvent(db, ctx, record);
      db.prepare("UPDATE sessions SET last_projected_seq = ? WHERE session_id = ?").run(
        record.source_seq,
        ctx.sessionId,
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return { ok: true, applied: true, degraded: false, flagPersisted: false };
  } catch (err) {
    let flagPersisted = false;
    try {
      setDegraded(db, ctx.sessionId);
      flagPersisted = true;
    } catch {
      // Best-effort: if even the degraded flag can't be written, the caller
      // still gets a notice back and the provider still isn't killed.
    }
    return {
      ok: false,
      applied: false,
      degraded: true,
      flagPersisted,
      notice: {
        code: "sqlite-projection-failed",
        message: `projection failed for session ${ctx.sessionId} at source_seq ${record.source_seq}`,
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Turns a failed projection into the `notice` event the caller journals.
 *
 * The journal is the durable flag. A database corrupt enough to swallow its
 * own `observability_degraded` column cannot hide the failure, because the
 * record of it is written to the file the database is only a projection of.
 * Returns `null` for an outcome that carries no notice — a healthy
 * projection has nothing to say.
 */
export function projectionNotice(
  outcome: ProjectionOutcome,
  at: { seq: number; runId: string; hostAt: string },
): NormalizedEvent | null {
  if (outcome.notice === undefined) return null;
  return {
    kind: "notice",
    seq: at.seq,
    runId: at.runId,
    hostAt: at.hostAt,
    providerAt: null,
    code: outcome.notice.code,
    message: outcome.notice.message,
    detail: outcome.notice.detail,
  };
}
