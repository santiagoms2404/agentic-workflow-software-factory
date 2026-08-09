// Read-side queries against the SQLite projection. Every function here is a
// `SELECT` on a `readonly: true` connection. Response queries name columns
// explicitly so private references cannot enter an API object by accident.

import type { DatabaseSync } from "./sqlite.ts";

export interface SessionRow {
  session_id: string;
  project_slug: string;
  task_id: string;
  attempt: number;
  workflow_id: string;
  risk_tier: 0 | 1 | 2;
  is_protected: number;
  lifecycle_state: string;
  request_text: string;
  base_sha: string | null;
  head_sha: string | null;
  candidate_sha: string | null;
  worker_provider: string | null;
  worker_model_requested: string | null;
  worker_model_resolved: string | null;
  review_provider: string | null;
  review_verdict: string | null;
  call_ceiling: number;
  calls_reserved: number;
  calls_spent: number;
  corrections_auto: number;
  corrections_owner: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  reasoning_relation: "included-in-output" | "additive" | "unknown";
  usage_authority: "provider" | "partial" | "none";
  estimated_cost_usd: number | null;
  cost_authority: "provider" | "catalog-estimate" | "unavailable";
  cost_partial: number;
  observability_degraded: number;
  archived: number;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  state_revision: number;
  last_projected_seq: number;
}

const SESSION_PUBLIC_COLUMNS = `
  session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
  lifecycle_state, request_text, base_sha, head_sha, candidate_sha,
  worker_provider, worker_model_requested, worker_model_resolved, review_provider, review_verdict,
  call_ceiling, calls_reserved, calls_spent, corrections_auto, corrections_owner,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens,
  reasoning_relation, usage_authority, estimated_cost_usd, cost_authority, cost_partial,
  observability_degraded, archived, started_at, updated_at, ended_at, state_revision, last_projected_seq`;

export function getSession(db: DatabaseSync, sessionId: string): SessionRow | null {
  const row = db.prepare(`SELECT ${SESSION_PUBLIC_COLUMNS} FROM sessions WHERE session_id = ?`).get(sessionId) as
    | SessionRow
    | undefined;
  return row ?? null;
}

export interface ListSessionsOptions {
  archived?: boolean;
  limit?: number;
  before?: string;
  state?: string;
}

export function listSessions(db: DatabaseSync, opts: ListSessionsOptions = {}): SessionRow[] {
  const clauses = ["archived = ?"];
  const params: Array<string | number> = [opts.archived === true ? 1 : 0];
  if (opts.before !== undefined) {
    clauses.push("started_at < ?");
    params.push(opts.before);
  }
  if (opts.state !== undefined) {
    clauses.push("lifecycle_state = ?");
    params.push(opts.state);
  }
  params.push(opts.limit ?? 50);
  return db
    .prepare(`SELECT ${SESSION_PUBLIC_COLUMNS} FROM sessions WHERE ${clauses.join(" AND ")} ORDER BY started_at DESC, session_id LIMIT ?`)
    .all(...params) as unknown as SessionRow[];
}

export interface PhaseRow {
  phase_id: string;
  session_id: string;
  ordinal: number;
  phase_key: string;
  name: string;
  kind: "agent" | "code" | "engineer";
  owner: string;
  description: string;
  status: string;
  correction_count: number;
  max_corrections: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export function phasesForSession(db: DatabaseSync, sessionId: string): PhaseRow[] {
  return db.prepare("SELECT * FROM phases WHERE session_id = ? ORDER BY ordinal").all(sessionId) as unknown as PhaseRow[];
}

export function phaseForSession(db: DatabaseSync, sessionId: string, phaseId: string): PhaseRow | null {
  const row = db.prepare("SELECT * FROM phases WHERE session_id = ? AND phase_id = ?").get(sessionId, phaseId) as PhaseRow | undefined;
  return row ?? null;
}

export interface AgentRow {
  session_id: string;
  agent: string;
  adapter_id: string;
  provider: string;
  color: string | null;
  requested_model: string;
  resolved_model: string | null;
  model_provenance: "stream-authoritative" | "route-attributed" | null;
  context_tokens: number | null;
  context_window: number | null;
  call_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  cost_authority: "provider" | "catalog-estimate" | "unavailable";
  created_at: string;
  last_used_at: string;
}

export function agentsForSession(db: DatabaseSync, sessionId: string): AgentRow[] {
  return db.prepare(`SELECT session_id, agent, adapter_id, provider, color, requested_model,
      resolved_model, model_provenance, context_tokens, context_window, call_count,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      total_tokens, estimated_cost_usd, cost_authority, created_at, last_used_at
    FROM agent_sessions WHERE session_id = ? ORDER BY created_at, agent`).all(sessionId) as unknown as AgentRow[];
}

export interface EventRow {
  event_row: number;
  event_id: string;
  session_id: string;
  phase_id: string | null;
  run_id: string | null;
  parent_event_id: string | null;
  first_source_seq: number;
  last_source_seq: number;
  type: string;
  name: string;
  status: string | null;
  payload_json: string;
  started_at: string;
  ended_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  cost_authority: "provider" | "catalog-estimate" | "unavailable" | null;
  redaction_level: "public" | "private-ref";
}

export function pollEvents(db: DatabaseSync, sessionId: string, afterEventRow: number, limit = 200): EventRow[] {
  return db.prepare(`SELECT event_row, event_id, session_id, phase_id, run_id, parent_event_id,
      first_source_seq, last_source_seq, type, name, status, payload_json, started_at, ended_at,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      total_tokens, estimated_cost_usd, cost_authority, redaction_level
    FROM events WHERE session_id = ? AND event_row > ? ORDER BY event_row LIMIT ?`)
    .all(sessionId, afterEventRow, limit) as unknown as EventRow[];
}

export function pollPhaseEvents(db: DatabaseSync, phaseId: string, afterEventRow: number, limit = 200): EventRow[] {
  return db.prepare(`SELECT event_row, event_id, session_id, phase_id, run_id, parent_event_id,
      first_source_seq, last_source_seq, type, name, status, payload_json, started_at, ended_at,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      total_tokens, estimated_cost_usd, cost_authority, redaction_level
    FROM events WHERE phase_id = ? AND event_row > ? ORDER BY event_row LIMIT ?`)
    .all(phaseId, afterEventRow, limit) as unknown as EventRow[];
}

export function compiledPromptEvents(db: DatabaseSync, phaseId: string): Pick<EventRow, "name" | "payload_json">[] {
  return db.prepare(`SELECT name, payload_json FROM events
    WHERE phase_id = ? AND type = 'compiled_prompt' ORDER BY event_row`)
    .all(phaseId) as unknown as Pick<EventRow, "name" | "payload_json">[];
}

export interface TransitionRow {
  transition_id: string;
  seq: number;
  from_state: string;
  to_state: string;
  actor: "host" | "owner" | "human";
  edge_id: string;
  reason_source: string;
  reason_code: string | null;
  reason_detail: string | null;
  spawn_site: number;
  at: string;
}

export function transitionsForSession(db: DatabaseSync, sessionId: string): TransitionRow[] {
  return db.prepare(`SELECT transition_id, seq, from_state, to_state, actor, edge_id,
      reason_source, reason_code, reason_detail, spawn_site, at
    FROM transitions WHERE session_id = ? ORDER BY seq`).all(sessionId) as unknown as TransitionRow[];
}

export interface GateRow {
  gate_result_id: string;
  phase_id: string;
  correction_round: number;
  gate_id: string;
  gate_kind: string;
  candidate_sha: string | null;
  passed: number;
  exit_code: number | null;
  checks_json: string;
  violations_json: string;
  started_at: string;
  ended_at: string;
}

export function gatesForSession(db: DatabaseSync, sessionId: string, phaseId?: string): GateRow[] {
  const suffix = phaseId === undefined ? "session_id = ?" : "session_id = ? AND phase_id = ?";
  const params = phaseId === undefined ? [sessionId] : [sessionId, phaseId];
  return db.prepare(`SELECT gate_result_id, phase_id, correction_round, gate_id, gate_kind,
      candidate_sha, passed, exit_code, checks_json, violations_json, started_at, ended_at
    FROM gate_results WHERE ${suffix} ORDER BY phase_id, correction_round, gate_id`).all(...params) as unknown as GateRow[];
}

export interface ProcessRow {
  process_id: string;
  phase_id: string | null;
  run_id: string;
  adapter_id: string;
  role: string;
  transport: string;
  status: string;
  registered_at: string;
  released_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
  exit_signal: string | null;
}

export function processesForSession(db: DatabaseSync, sessionId: string, phaseId?: string): ProcessRow[] {
  const suffix = phaseId === undefined ? "session_id = ?" : "session_id = ? AND phase_id = ?";
  const params = phaseId === undefined ? [sessionId] : [sessionId, phaseId];
  return db.prepare(`SELECT process_id, phase_id, run_id, adapter_id, role, transport, status,
      registered_at, released_at, ended_at, exit_code, exit_signal
    FROM processes WHERE ${suffix} ORDER BY registered_at, process_id`).all(...params) as unknown as ProcessRow[];
}

export interface EnvelopeRow {
  envelope_id: string;
  agent: string;
  schema_id: string;
  correction_round: number;
  valid: number;
  producer_status: "success" | "failure" | null;
  payload_json: string;
  violations_json: string;
  created_at: string;
}

export function envelopesForPhase(db: DatabaseSync, sessionId: string, phaseId: string): EnvelopeRow[] {
  return db.prepare(`SELECT envelope_id, agent, schema_id, correction_round, valid,
      producer_status, payload_json, violations_json, created_at
    FROM envelopes WHERE session_id = ? AND phase_id = ? ORDER BY correction_round, created_at`)
    .all(sessionId, phaseId) as unknown as EnvelopeRow[];
}

export function configSnapshotForSession(db: DatabaseSync, sessionId: string): string | null {
  const row = db.prepare("SELECT config_snapshot_json FROM sessions WHERE session_id = ?").get(sessionId) as
    | { config_snapshot_json: string }
    | undefined;
  return row?.config_snapshot_json ?? null;
}

export interface HealthProjection {
  schemaVersion: number;
  journalMode: string;
  activeSessions: number;
  projectorLag: number;
  degradedSessions: number;
}

export function projectionHealth(db: DatabaseSync): HealthProjection {
  const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const mode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  const counts = db.prepare(`SELECT
      SUM(CASE WHEN lifecycle_state NOT IN ('LANDED','BLOCKED','CANCELLED') THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN observability_degraded = 1 THEN 1 ELSE 0 END) degraded,
      MAX(CASE WHEN state_revision > last_projected_seq THEN state_revision - last_projected_seq ELSE 0 END) lag
    FROM sessions`).get() as { active: number | null; degraded: number | null; lag: number | null };
  return {
    schemaVersion: version.user_version,
    journalMode: mode.journal_mode,
    activeSessions: counts.active ?? 0,
    projectorLag: counts.lag ?? 0,
    degradedSessions: counts.degraded ?? 0,
  };
}
