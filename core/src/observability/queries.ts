// Read-side queries against the SQLite projection. Every function here is a
// `SELECT` on a `readonly: true` connection — the Concurrency rule's other
// half of "one writer per workflow process". This module never imports
// `node:sqlite` directly (only a type from `sqlite.ts`), so it sits outside
// the write fence by construction rather than by allowlisting.

import type { DatabaseSync } from "./sqlite.ts";

export interface SessionRow {
  session_id: string;
  project_slug: string;
  task_id: string;
  attempt: number;
  lifecycle_state: string;
  observability_degraded: number;
  last_projected_seq: number;
  archived: number;
  started_at: string;
  updated_at: string;
}

export function getSession(db: DatabaseSync, sessionId: string): SessionRow | null {
  const row = db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as SessionRow | undefined;
  return row ?? null;
}

export interface ListSessionsOptions {
  archived?: boolean;
  limit?: number;
}

/** Ordered newest-first, over `idx_sessions_recent` — no full scan. */
export function listSessions(db: DatabaseSync, opts: ListSessionsOptions = {}): SessionRow[] {
  const archived = opts.archived === true ? 1 : 0;
  const limit = opts.limit ?? 50;
  return db
    .prepare("SELECT * FROM sessions WHERE archived = ? ORDER BY started_at DESC, session_id LIMIT ?")
    .all(archived, limit) as SessionRow[];
}

export interface EventRow {
  event_row: number;
  event_id: string;
  session_id: string;
  phase_id: string | null;
  type: string;
  name: string;
  status: string | null;
  payload_json: string;
  started_at: string;
  ended_at: string | null;
}

/**
 * The load-bearing poll query: `WHERE session_id = ? AND event_row > ?
 * ORDER BY event_row LIMIT ?`, over `idx_events_cursor`. A dashboard cursor
 * is just the last `event_row` it has already rendered.
 */
export function pollEvents(db: DatabaseSync, sessionId: string, afterEventRow: number, limit = 200): EventRow[] {
  return db
    .prepare(
      "SELECT * FROM events WHERE session_id = ? AND event_row > ? ORDER BY event_row LIMIT ?",
    )
    .all(sessionId, afterEventRow, limit) as EventRow[];
}

/** Same cursor shape, scoped to one phase over `idx_events_phase_cursor`. */
export function pollPhaseEvents(db: DatabaseSync, phaseId: string, afterEventRow: number, limit = 200): EventRow[] {
  return db
    .prepare("SELECT * FROM events WHERE phase_id = ? AND event_row > ? ORDER BY event_row LIMIT ?")
    .all(phaseId, afterEventRow, limit) as EventRow[];
}
