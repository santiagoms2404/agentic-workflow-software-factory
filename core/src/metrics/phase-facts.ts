// One fact record per agent phase, read from the projection. Read-only SQL on
// a caller's connection: this module imports the `DatabaseSync` type from the
// observability driver and never `node:sqlite`, so it cannot write
// (invariant 6, `sqlite-write-fence.test.ts`).
//
// Tokens are the sum of the phase's `usage` events. `agent_sessions` token
// columns are never read here: the projector replaces them on every call, so
// for any role with more than one call they hold the last call only (W18 F8).

import type { DatabaseSync } from "../observability/sqlite.ts";
import type { ModelResolutionProvenance, ReasoningRelation } from "../contracts/normalized-events.ts";
import type { RouteEffort, RouteSelectionProvenance, RouteValueSource } from "../contracts/route-selection.ts";
import { resolvePhaseRoute, type EffortSource } from "../observability/phase-route.ts";
import { TOOL_CLASSES, toolClass, type ToolClass } from "./tool-class.ts";

export interface PhaseRouteFacts {
  readonly adapterId: string | null;
  readonly adapterKind: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly effort: RouteEffort | null;
  /** `null` only on a row projected before migration 0007 and not yet rebuilt. */
  readonly effortSource: EffortSource | null;
  /** The route event's `requested.sources.effort`; `null` unless `effortSource` is `journal`. */
  readonly journalSource: RouteValueSource | null;
}

/** Two fields, never merged: what the route asked for, and what was observed answering. */
export interface PhaseModelIdentity {
  readonly requestedModel: string | null;
  readonly resolvedModel: string | null;
  readonly modelProvenance: ModelResolutionProvenance | null;
}

/** Summed over the phase's `usage` events. A kind no event reported stays `null`, never `0`. */
export interface PhaseTokens {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly reasoningTokens: number | null;
  /** The events' shared relation; `unknown` when they disagree or none was reported. */
  readonly reasoningRelation: ReasoningRelation;
  readonly usageEvents: number;
}

export interface PhaseTools {
  readonly calls: number;
  readonly byClass: Readonly<Record<ToolClass, number>>;
  readonly errors: number;
  /** Sum of `$.durationMs` over completed calls; a call still running has none. */
  readonly timeMs: number;
}

/** Role-level: `agent_sessions` is keyed by session and agent, so every phase of one role shares it. */
export interface RoleSessionFacts {
  readonly callCount: number;
  readonly modelProvenance: ModelResolutionProvenance | null;
  readonly costAuthority: "provider" | "catalog-estimate" | "unavailable";
  /** Occupancy after the role's last turn, not a sum. */
  readonly contextTokens: number | null;
  readonly contextWindow: number | null;
}

export interface PhaseFacts {
  readonly sessionId: string;
  readonly projectSlug: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly workflowId: string;
  readonly observabilityDegraded: boolean;
  readonly phaseId: string;
  readonly phaseKey: string;
  readonly ordinal: number;
  /** The role that owns the phase. */
  readonly owner: string;
  readonly status: string;
  readonly correctionCount: number;
  readonly maxCorrections: number;
  readonly errorCode: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  /** `null` while the phase is open. */
  readonly minutes: number | null;
  /** The phase's `run.started` events: one per provider call. */
  readonly turns: number;
  readonly route: PhaseRouteFacts;
  readonly identity: PhaseModelIdentity;
  readonly tokens: PhaseTokens;
  readonly tools: PhaseTools;
  /** `null` when the role has no `agent_sessions` row. */
  readonly role: RoleSessionFacts | null;
}

interface PhaseQueryRow {
  phase_id: string;
  session_id: string;
  ordinal: number;
  phase_key: string;
  owner: string;
  status: string;
  correction_count: number;
  max_corrections: number;
  error_code: string | null;
  started_at: string | null;
  ended_at: string | null;
  route_adapter: string | null;
  route_provider: string | null;
  route_model: string | null;
  route_effort: RouteEffort | null;
  effort_source: EffortSource | null;
  project_slug: string;
  task_id: string;
  attempt: number;
  workflow_id: string;
  observability_degraded: number;
  config_snapshot_json: string;
}

interface EventAggregateRow {
  phase_id: string;
  turns: number;
  usage_events: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  relation_count: number;
  relation: ReasoningRelation | null;
  tool_calls: number;
  tool_errors: number;
  tool_ms: number | null;
}

interface AgentSessionRow {
  session_id: string;
  agent: string;
  call_count: number;
  model_provenance: ModelResolutionProvenance | null;
  cost_authority: RoleSessionFacts["costAuthority"];
  context_tokens: number | null;
  context_window: number | null;
}

interface ModelResolvedPayload {
  resolvedModel?: unknown;
  provenance?: unknown;
}

const PROVENANCES: readonly ModelResolutionProvenance[] = ["stream-authoritative", "route-attributed"];

function provenanceOf(value: unknown): ModelResolutionProvenance | null {
  return PROVENANCES.includes(value as ModelResolutionProvenance) ? value as ModelResolutionProvenance : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The last payload per phase, in projection order. */
function latestPayloadByPhase(db: DatabaseSync, type: string): Map<string, string> {
  const rows = db.prepare(`SELECT phase_id, payload_json FROM events
      WHERE type = ? AND phase_id IS NOT NULL ORDER BY event_row`).all(type) as unknown as Array<{
    phase_id: string;
    payload_json: string;
  }>;
  return new Map(rows.map((row) => [row.phase_id, row.payload_json]));
}

function minutesBetween(startedAt: string | null, endedAt: string | null): number | null {
  if (startedAt === null || endedAt === null) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) ? ms / 60_000 : null;
}

function emptyByClass(): Record<ToolClass, number> {
  return Object.fromEntries(TOOL_CLASSES.map((name) => [name, 0])) as Record<ToolClass, number>;
}

/** Reads one `PhaseFacts` per agent phase, sessions in start order and phases in ordinal order. */
export function readPhaseFacts(db: DatabaseSync): PhaseFacts[] {
  const phases = db.prepare(`SELECT p.phase_id, p.session_id, p.ordinal, p.phase_key, p.owner, p.status,
      p.correction_count, p.max_corrections, p.error_code, p.started_at, p.ended_at,
      p.route_adapter, p.route_provider, p.route_model, p.route_effort, p.effort_source,
      s.project_slug, s.task_id, s.attempt, s.workflow_id, s.observability_degraded, s.config_snapshot_json
    FROM phases p JOIN sessions s ON s.session_id = p.session_id
    WHERE p.kind = 'agent'
    ORDER BY s.started_at, s.session_id, p.ordinal`).all() as unknown as PhaseQueryRow[];

  const aggregates = new Map((db.prepare(`SELECT phase_id,
      COALESCE(SUM(type = 'run.started'), 0) AS turns,
      COALESCE(SUM(type = 'usage'), 0) AS usage_events,
      SUM(CASE WHEN type = 'usage' THEN json_extract(payload_json, '$.usage.inputTokens') END) AS input_tokens,
      SUM(CASE WHEN type = 'usage' THEN json_extract(payload_json, '$.usage.outputTokens') END) AS output_tokens,
      SUM(CASE WHEN type = 'usage' THEN json_extract(payload_json, '$.usage.cacheReadTokens') END) AS cache_read_tokens,
      SUM(CASE WHEN type = 'usage' THEN json_extract(payload_json, '$.usage.cacheWriteTokens') END) AS cache_write_tokens,
      SUM(CASE WHEN type = 'usage' THEN json_extract(payload_json, '$.usage.reasoningTokens') END) AS reasoning_tokens,
      COUNT(DISTINCT CASE WHEN type = 'usage' THEN json_extract(payload_json, '$.usage.reasoningRelation') END) AS relation_count,
      MIN(CASE WHEN type = 'usage' THEN json_extract(payload_json, '$.usage.reasoningRelation') END) AS relation,
      COALESCE(SUM(type = 'tool_call'), 0) AS tool_calls,
      COALESCE(SUM(type = 'tool_call' AND status = 'error'), 0) AS tool_errors,
      SUM(CASE WHEN type = 'tool_call' THEN json_extract(payload_json, '$.durationMs') END) AS tool_ms
    FROM events
    WHERE phase_id IS NOT NULL AND type IN ('run.started', 'usage', 'tool_call')
    GROUP BY phase_id`).all() as unknown as EventAggregateRow[]).map((row) => [row.phase_id, row]));

  const toolClasses = new Map<string, Record<ToolClass, number>>();
  for (const row of db.prepare(`SELECT phase_id, name, COUNT(*) AS calls FROM events
      WHERE type = 'tool_call' AND phase_id IS NOT NULL GROUP BY phase_id, name`).all() as unknown as Array<{
    phase_id: string;
    name: string;
    calls: number;
  }>) {
    const byClass = toolClasses.get(row.phase_id) ?? emptyByClass();
    byClass[toolClass(row.name)] += row.calls;
    toolClasses.set(row.phase_id, byClass);
  }

  const routeEvents = latestPayloadByPhase(db, "route_resolution");
  const modelEvents = latestPayloadByPhase(db, "model.resolved");
  const roles = new Map((db.prepare(`SELECT session_id, agent, call_count, model_provenance, cost_authority,
      context_tokens, context_window FROM agent_sessions`).all() as unknown as AgentSessionRow[])
    .map((row) => [`${row.session_id}\u0000${row.agent}`, row]));
  const snapshots = new Map<string, unknown>();

  return phases.map((phase): PhaseFacts => {
    const routeJson = routeEvents.get(phase.phase_id);
    const routeEvent = routeJson === undefined ? null : JSON.parse(routeJson) as RouteSelectionProvenance;
    if (!snapshots.has(phase.session_id)) snapshots.set(phase.session_id, JSON.parse(phase.config_snapshot_json));
    // The five columns are the projected truth. The resolver is consulted only
    // for what they do not hold, the adapter kind and the journal's own source,
    // and only when it resolves the same route the projector wrote.
    const resolved = resolvePhaseRoute({
      phase: { key: phase.phase_key, owner: phase.owner },
      routeEvent,
      configSnapshot: snapshots.get(phase.session_id),
    });
    const agrees = phase.effort_source !== null && resolved.effortSource === phase.effort_source &&
      resolved.adapterId === phase.route_adapter;

    const modelJson = modelEvents.get(phase.phase_id);
    const modelEvent = modelJson === undefined ? null : JSON.parse(modelJson) as ModelResolvedPayload;
    const observed = routeEvent?.observed ?? null;
    const configured = phase.effort_source === "config-phase-route" || phase.effort_source === "config-agent";

    const events = aggregates.get(phase.phase_id);
    const role = roles.get(`${phase.session_id}\u0000${phase.owner}`);
    return {
      sessionId: phase.session_id,
      projectSlug: phase.project_slug,
      taskId: phase.task_id,
      attempt: phase.attempt,
      workflowId: phase.workflow_id,
      observabilityDegraded: phase.observability_degraded === 1,
      phaseId: phase.phase_id,
      phaseKey: phase.phase_key,
      ordinal: phase.ordinal,
      owner: phase.owner,
      status: phase.status,
      correctionCount: phase.correction_count,
      maxCorrections: phase.max_corrections,
      errorCode: phase.error_code,
      startedAt: phase.started_at,
      endedAt: phase.ended_at,
      minutes: minutesBetween(phase.started_at, phase.ended_at),
      turns: events?.turns ?? 0,
      route: {
        adapterId: phase.route_adapter,
        adapterKind: agrees ? resolved.adapterKind : null,
        provider: phase.route_provider,
        model: phase.route_model,
        effort: phase.route_effort,
        effortSource: phase.effort_source,
        journalSource: agrees ? resolved.journalSource : null,
      },
      identity: {
        // A configured route's model column IS the selector the runner asked
        // for; a journaled one holds the adapter-canonical form instead.
        requestedModel: textOf(routeEvent?.requested?.model) ?? (configured ? phase.route_model : null),
        resolvedModel: textOf(observed?.resolvedModel) ?? textOf(modelEvent?.resolvedModel),
        modelProvenance: observed !== null && textOf(observed.resolvedModel) !== null
          ? provenanceOf(observed.modelProvenance)
          : provenanceOf(modelEvent?.provenance),
      },
      tokens: {
        inputTokens: events?.input_tokens ?? null,
        outputTokens: events?.output_tokens ?? null,
        cacheReadTokens: events?.cache_read_tokens ?? null,
        cacheWriteTokens: events?.cache_write_tokens ?? null,
        reasoningTokens: events?.reasoning_tokens ?? null,
        reasoningRelation: events?.relation_count === 1 && events.relation !== null ? events.relation : "unknown",
        usageEvents: events?.usage_events ?? 0,
      },
      tools: {
        calls: events?.tool_calls ?? 0,
        byClass: Object.freeze(toolClasses.get(phase.phase_id) ?? emptyByClass()),
        errors: events?.tool_errors ?? 0,
        timeMs: events?.tool_ms ?? 0,
      },
      role: role === undefined ? null : {
        callCount: role.call_count,
        modelProvenance: role.model_provenance,
        costAuthority: role.cost_authority,
        contextTokens: role.context_tokens,
        contextWindow: role.context_window,
      },
    };
  });
}
