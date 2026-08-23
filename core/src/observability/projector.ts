// The SQLite projector — the only place besides `sqlite.ts` and the
// migrations that may write to the database (enforced by
// `sqlite-write-fence.test.ts`). Projection is a pure function of the
// journal: given the same `JournalRecord` twice, the second application is a
// no-op, and a failure never throws into the caller's phase — it degrades.

import type { JournalRecord } from "../persistence/journal.ts";
import type { NormalizedEvent } from "../contracts/normalized-events.ts";
import { isPersistableKind } from "../contracts/normalized-events.ts";
import type { DatabaseSync } from "./sqlite.ts";
import type { AttemptEvidence } from "./attempt-evidence.ts";
import {
  scrubCredentialString,
  scrubCredentials,
  scrubJsonText,
  stringifyRedacted,
} from "../policy/redaction.ts";

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
export interface AttemptStatusProjection extends SessionInit {
  lifecycleState: string;
  baseSha: string | null;
  candidateSha: string | null;
  callsSpent: number;
  callsReserved: number;
  correctionsAuto: number;
  correctionsOwner: number;
  /** Attempt-scoped owner re-entries, separate from the per-phase pair above. */
  ownerReentries: number;
  workerModelResolved: string | null;
  updatedAt: string;
  endedAt: string | null;
  stateRevision: number;
  evidence?: AttemptEvidence;
}

/**
 * Projects one canonical CLI attempt record into its session summary.
 *
 * The journal sequence is also the projection cursor. Re-applying a record is
 * a no-op; skipping a record degrades rather than manufacturing a complete
 * summary. Like provider-event projection, failure never throws into the
 * lifecycle command that already durably journaled its transition.
 */
export function projectAttemptStatus(
  db: DatabaseSync,
  status: AttemptStatusProjection,
  sourceSeq: number,
): ProjectionOutcome {
  try {
    createSession(db, status);
    const lastSeq = getLastProjectedSeq(db, status.sessionId);
    if (lastSeq === null) throw new Error(`no session row for ${status.sessionId}`);
    if (sourceSeq <= lastSeq) {
      return { ok: true, applied: false, degraded: false, flagPersisted: false };
    }
    if (sourceSeq !== lastSeq + 1 || status.stateRevision !== sourceSeq) {
      throw new Error(
        `non-contiguous attempt projection: cursor ${lastSeq}, source_seq ${sourceSeq}, revision ${status.stateRevision}`,
      );
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      if (status.evidence !== undefined) applyAttemptEvidence(db, status.sessionId, sourceSeq, status.evidence);
      // `call_ceiling` is written on every record, not only at session creation:
      // an owner raise moves it mid-attempt, and a column that only ever held
      // the creation-time number would make the dashboard's `spent/ceiling`
      // meter say the run is over a ceiling it was granted past.
      db.prepare(`UPDATE sessions SET
          lifecycle_state = ?, base_sha = ?, candidate_sha = ?, call_ceiling = ?, calls_spent = ?, calls_reserved = ?,
          corrections_auto = ?, corrections_owner = ?, owner_reentries = ?, worker_model_resolved = ?,
          updated_at = ?, ended_at = ?, state_revision = ?, last_projected_seq = ?
        WHERE session_id = ?`).run(
        status.lifecycleState,
        status.baseSha,
        status.candidateSha,
        status.callCeiling,
        status.callsSpent,
        status.callsReserved,
        status.correctionsAuto,
        status.correctionsOwner,
        status.ownerReentries,
        status.workerModelResolved === null ? null : scrubCredentialString(status.workerModelResolved),
        status.updatedAt,
        status.endedAt,
        status.stateRevision,
        sourceSeq,
        status.sessionId,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ok: true, applied: true, degraded: false, flagPersisted: false };
  } catch (error) {
    let flagPersisted = false;
    try {
      setDegraded(db, status.sessionId);
      flagPersisted = true;
    } catch {
      // The journal still owns the failed record when SQLite cannot flag itself.
    }
    return {
      ok: false,
      applied: false,
      degraded: true,
      flagPersisted,
      notice: {
        code: "sqlite-projection-failed",
        message: `attempt projection failed for session ${status.sessionId} at source_seq ${sourceSeq}`,
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function createSession(db: DatabaseSync, init: SessionInit): void {
  db.prepare(
    `INSERT OR IGNORE INTO sessions
       (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
        lifecycle_state, request_text, call_ceiling, started_at, updated_at, config_snapshot_json, journal_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)`,
  ).run(
    init.sessionId,
    scrubCredentialString(init.projectSlug),
    scrubCredentialString(init.taskId),
    init.attempt,
    scrubCredentialString(init.workflowId),
    init.riskTier,
    init.isProtected ? 1 : 0,
    scrubCredentialString(init.requestText),
    init.callCeiling,
    init.startedAt,
    init.startedAt,
    scrubJsonText(init.configSnapshotJson),
    scrubCredentialString(init.journalPath),
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

function totalTokens(usage: { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; reasoningRelation: string }): number | null {
  if (usage.inputTokens === null && usage.outputTokens === null && usage.reasoningTokens === null) return null;
  const base = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  return usage.reasoningRelation === "additive" ? base + (usage.reasoningTokens ?? 0) : base;
}

function applyAttemptEvidence(db: DatabaseSync, sessionId: string, sourceSeq: number, evidence: AttemptEvidence): void {
  switch (evidence.type) {
    case "transition":
      db.prepare(`INSERT OR IGNORE INTO transitions
        (transition_id, session_id, seq, from_state, to_state, actor, edge_id, reason_source,
         reason_code, reason_detail, spawn_site, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(evidence.id, sessionId, evidence.seq, evidence.from, evidence.to, evidence.actor,
          evidence.edgeId, evidence.reasonSource, evidence.reasonCode, evidence.reasonDetail,
          evidence.spawnSite ? 1 : 0, evidence.at);
      return;
    case "phase": {
      const phase = evidence.phase;
      db.prepare(`INSERT INTO phases
        (phase_id, session_id, ordinal, phase_key, name, kind, owner, description, status,
         correction_count, max_corrections, error_code, error_message, started_at, ended_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(phase_id) DO UPDATE SET status=excluded.status,
          correction_count=excluded.correction_count, error_code=excluded.error_code,
          error_message=excluded.error_message, started_at=excluded.started_at, ended_at=excluded.ended_at`)
        .run(phase.phaseId, sessionId, phase.ordinal, phase.key, phase.name, phase.kind, phase.owner,
          phase.description, phase.status, phase.correctionCount, phase.maxCorrections, phase.errorCode,
          phase.errorMessage, phase.startedAt, phase.endedAt, phase.createdAt);
      return;
    }
    case "normalized-event":
      applyEvent(db, { sessionId, runId: evidence.event.runId, phaseId: evidence.phaseId }, {
        source_seq: sourceSeq,
        recorded_at: evidence.event.hostAt,
        event: evidence.event,
      });
      return;
    case "compiled-prompt":
      db.prepare(`INSERT OR IGNORE INTO events
        (event_id, session_id, phase_id, first_source_seq, last_source_seq, type, name,
         payload_json, started_at) VALUES (?, ?, ?, ?, ?, 'compiled_prompt', ?, ?, ?)`)
        .run(`${sessionId}:prompt:${sourceSeq}`, sessionId, evidence.phaseId, sourceSeq, sourceSeq,
          evidence.name, stringifyRedacted({
            text: evidence.text,
            lineCount: evidence.lineCount,
            ...(evidence.roleSystemDigest === undefined ? {} : { roleSystemDigest: evidence.roleSystemDigest }),
            ...(evidence.sharedBlockDigest === undefined ? {} : { sharedBlockDigest: evidence.sharedBlockDigest }),
            ...(evidence.composedSystemDigest === undefined ? {} : { composedSystemDigest: evidence.composedSystemDigest }),
            ...(evidence.compositionVersion === undefined ? {} : { compositionVersion: evidence.compositionVersion }),
          }), evidence.at);
      return;
    case "process": {
      const record = evidence.record;
      db.prepare(`INSERT INTO processes
        (process_id, session_id, phase_id, run_id, adapter_id, role, transport, pid, pgid,
         process_start_identity, status, command_json, cwd_display, registered_at, released_at,
         ended_at, exit_code, exit_signal)
        VALUES (?, ?, ?, ?, ?, ?, 'process', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(process_id) DO UPDATE SET status=excluded.status, released_at=excluded.released_at,
          ended_at=excluded.ended_at, exit_code=excluded.exit_code, exit_signal=excluded.exit_signal`)
        .run(`${sessionId}:${record.runId}`, sessionId, evidence.phaseId, record.runId,
          evidence.adapterId, evidence.role, record.identity.pid,
          record.identity.pgid, record.identity.startIdentity, evidence.status,
          stringifyRedacted(record.command), scrubCredentialString(record.cwd), evidence.registeredAt,
          evidence.releasedAt, evidence.endedAt, evidence.exitCode, evidence.exitSignal);
      return;
    }
    case "envelope": {
      const envelope = evidence.envelope;
      db.prepare(`INSERT OR IGNORE INTO envelopes
        (envelope_id, session_id, phase_id, agent, schema_id, correction_round, valid,
         producer_status, payload_json, violations_json, file_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(envelope.envelopeId, sessionId, evidence.phaseId, scrubCredentialString(envelope.agent),
          envelope.schemaId, envelope.correctionRound, envelope.valid ? 1 : 0,
          envelope.payload?.producerStatus ?? null, stringifyRedacted(envelope.payload),
          stringifyRedacted(envelope.violations), scrubCredentialString(envelope.rawOutputPath), envelope.createdAt);
      return;
    }
    case "gate":
      db.prepare(`INSERT OR REPLACE INTO gate_results
        (gate_result_id, session_id, phase_id, correction_round, gate_id, gate_kind, candidate_sha,
         passed, exit_code, checks_json, violations_json, output_path, started_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(evidence.id, sessionId, evidence.phaseId, evidence.round, evidence.gateId, evidence.kind,
          evidence.candidateSha, evidence.passed ? 1 : 0, evidence.exitCode,
          stringifyRedacted(evidence.checks), stringifyRedacted(evidence.violations),
          evidence.outputPath === null ? null : scrubCredentialString(evidence.outputPath),
          evidence.startedAt, evidence.endedAt);
      return;
    case "agent-start":
      db.prepare(`INSERT INTO agent_sessions
        (session_id, agent, adapter_id, provider, color, requested_model, resolved_model,
         model_provenance, call_count, sandbox_badge, sandbox_mechanism, created_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 'route-attributed', 0, ?, ?, ?, ?)
        ON CONFLICT(session_id, agent) DO UPDATE SET adapter_id=excluded.adapter_id,
          provider=excluded.provider, color=excluded.color, requested_model=excluded.requested_model,
          resolved_model=NULL, model_provenance='route-attributed', context_tokens=NULL,
          context_window=NULL, input_tokens=NULL, output_tokens=NULL, cache_read_tokens=NULL,
          cache_write_tokens=NULL, reasoning_tokens=NULL, total_tokens=NULL, estimated_cost_usd=NULL,
          cost_authority='unavailable', sandbox_badge=excluded.sandbox_badge,
          sandbox_mechanism=excluded.sandbox_mechanism, last_used_at=excluded.last_used_at`)
        .run(sessionId, scrubCredentialString(evidence.agent), scrubCredentialString(evidence.adapterId),
          scrubCredentialString(evidence.provider), evidence.color, scrubCredentialString(evidence.requestedModel),
          evidence.sandboxBadge, evidence.sandboxMechanism, evidence.at, evidence.at);
      // The worker columns belong to the worker. A review call reaching them
      // would overwrite the very fact the inversion is proved from, leaving a
      // session whose worker and reviewer both read as the reviewer.
      if ((evidence.purpose ?? "worker") === "worker") {
        db.prepare(`UPDATE sessions SET worker_provider=?, worker_model_requested=?, worker_model_resolved=NULL
          WHERE session_id=?`).run(scrubCredentialString(evidence.provider),
            scrubCredentialString(evidence.requestedModel), sessionId);
      } else {
        db.prepare(`UPDATE sessions SET review_provider=? WHERE session_id=?`)
          .run(scrubCredentialString(evidence.provider), sessionId);
      }
      return;
    case "agent": {
      const usage = evidence.usage;
      const total = totalTokens(usage);
      db.prepare(`INSERT INTO agent_sessions
        (session_id, agent, adapter_id, provider, color, requested_model, resolved_model,
         model_provenance, context_tokens, context_window, call_count, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens, estimated_cost_usd,
         cost_authority, created_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, agent) DO UPDATE SET resolved_model=excluded.resolved_model,
          model_provenance=excluded.model_provenance, context_tokens=excluded.context_tokens,
          context_window=excluded.context_window, call_count=agent_sessions.call_count + 1,
          input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
          cache_read_tokens=excluded.cache_read_tokens, cache_write_tokens=excluded.cache_write_tokens,
          reasoning_tokens=excluded.reasoning_tokens, total_tokens=excluded.total_tokens,
          estimated_cost_usd=excluded.estimated_cost_usd, cost_authority=excluded.cost_authority,
          last_used_at=excluded.last_used_at`)
        .run(sessionId, evidence.agent, evidence.adapterId, evidence.provider, evidence.color,
          evidence.requestedModel, evidence.resolvedModel, evidence.modelProvenance,
          evidence.contextTokens, evidence.contextWindow, usage.inputTokens, usage.outputTokens,
          usage.cacheReadTokens, usage.cacheWriteTokens, usage.reasoningTokens, total,
          evidence.costUsd, evidence.costAuthority, evidence.at, evidence.at);
      const current = db.prepare(`SELECT input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, reasoning_tokens, total_tokens, estimated_cost_usd, cost_authority,
          cost_partial, usage_authority FROM sessions WHERE session_id=?`).get(sessionId) as {
            input_tokens: number | null; output_tokens: number | null; cache_read_tokens: number | null;
            cache_write_tokens: number | null; reasoning_tokens: number | null; total_tokens: number | null;
            estimated_cost_usd: number | null; cost_authority: "provider" | "catalog-estimate" | "unavailable";
            cost_partial: number; usage_authority: "provider" | "partial" | "none";
          };
      const add = (left: number | null, right: number | null): number | null =>
        right === null ? left : (left ?? 0) + right;
      const hadPrior = current.input_tokens !== null || current.output_tokens !== null || current.usage_authority !== "none";
      const mixedCost = current.cost_partial === 1 || (hadPrior && current.cost_authority !== evidence.costAuthority);
      const usageAuthority = current.usage_authority === "none"
        ? evidence.usageAuthority
        : current.usage_authority === evidence.usageAuthority ? current.usage_authority : "partial";
      // Usage accumulates across every call the session made, because the
      // session's cost is the sum of both sides. Route identity does not: only
      // the worker names the worker columns, and only a review names its own.
      db.prepare(`UPDATE sessions SET
          input_tokens=?, output_tokens=?, cache_read_tokens=?, cache_write_tokens=?, reasoning_tokens=?,
          total_tokens=?, reasoning_relation=?, usage_authority=?, estimated_cost_usd=?, cost_authority=?, cost_partial=?
        WHERE session_id=?`).run(
          add(current.input_tokens, usage.inputTokens), add(current.output_tokens, usage.outputTokens),
          add(current.cache_read_tokens, usage.cacheReadTokens), add(current.cache_write_tokens, usage.cacheWriteTokens),
          add(current.reasoning_tokens, usage.reasoningTokens), add(current.total_tokens, total),
          usage.reasoningRelation, usageAuthority, add(current.estimated_cost_usd, evidence.costUsd),
          evidence.costAuthority, mixedCost ? 1 : 0, sessionId);
      if ((evidence.purpose ?? "worker") === "worker") {
        db.prepare(`UPDATE sessions SET worker_provider=?, worker_model_requested=?, worker_model_resolved=?
          WHERE session_id=?`).run(evidence.provider, evidence.requestedModel, evidence.resolvedModel, sessionId);
      } else {
        db.prepare(`UPDATE sessions SET review_provider=? WHERE session_id=?`).run(evidence.provider, sessionId);
      }
      return;
    }
    case "ceiling-grant":
      // Session-level, so `phase_id` is deliberately NULL: the owner raised
      // what the TASK may cost, not what any one phase did. `sessions.call_ceiling`
      // is carried by the status projection below, so this row exists to answer
      // the question that column cannot — who raised it, by how much, and why.
      db.prepare(`INSERT OR IGNORE INTO events
        (event_id, session_id, phase_id, first_source_seq, last_source_seq, type, name,
         payload_json, started_at) VALUES (?, ?, NULL, ?, ?, 'ceiling_grant', 'owner call-ceiling raise', ?, ?)`)
        .run(`${sessionId}:ceiling-grant:${sourceSeq}`, sessionId, sourceSeq, sourceSeq,
          stringifyRedacted({
            calls: evidence.calls, from: evidence.from, to: evidence.to,
            reason: evidence.reason, attempt: evidence.attempt,
          }), evidence.at);
      return;
    case "review":
      // The verdict is the reviewer's own finding, recorded beside the provider
      // that produced it so the inversion is checkable from one row.
      db.prepare(`UPDATE sessions SET review_provider=?, review_verdict=? WHERE session_id=?`)
        .run(scrubCredentialString(evidence.provider), evidence.verdict, sessionId);
      return;
  }
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
  const event = scrubCredentials(record.event);

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
      stringifyRedacted({ toolCallId: event.toolCallId, inputSummary: event.inputSummary }),
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
      stringifyRedacted({ outcome: event.outcome, durationMs: event.durationMs, resultSnippet: event.resultSnippet }),
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
    stringifyRedacted(event),
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
