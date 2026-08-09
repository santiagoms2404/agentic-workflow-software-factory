import type { DatabaseSync } from "../observability/sqlite.ts";
import { openDatabase, setSessionArchived } from "../observability/sqlite.ts";
import {
  agentsForSession,
  configSnapshotForSession,
  envelopesForPhase,
  gatesForSession,
  getSession,
  listSessions,
  phaseForSession,
  phasesForSession,
  pollEvents,
  processesForSession,
  projectionHealth,
  transitionsForSession,
  type AgentRow,
  type EventRow,
  type GateRow,
  type PhaseRow,
  type ProcessRow,
  type SessionRow,
} from "../observability/queries.ts";
import { buildEffectiveConfig } from "../config/effective-config.ts";
import type { AwsfConfig } from "../config/schema.ts";
import type {
  AdapterHealth,
  AdaptersResponse,
  AgentSummary,
  ArchiveResponse,
  CostAuthority,
  EnvelopeRound,
  EventItem,
  EventsResponse,
  GateSummary,
  HealthResponse,
  LifecycleState,
  PhaseDetailResponse,
  PhaseStatus,
  PhaseSummary,
  ProcessSummary,
  SessionCard,
  SessionDetailResponse,
  SessionsResponse,
  SettingsResponse,
  UsageTotals,
} from "../../../dashboard/shared/types.ts";
import { ApiRequestError, jsonResponse, safely, type ApiHandler, type ApiResponse, type HandlerRequest } from "./responses.ts";
import { decodePathSegments, validateAuthority } from "./security.ts";

export const API_ROUTE_TABLE = Object.freeze([
  { method: "GET", path: "/api/v1/health", name: "health" },
  { method: "GET", path: "/api/v1/sessions", name: "sessions" },
  { method: "GET", path: "/api/v1/sessions/:id", name: "session" },
  { method: "GET", path: "/api/v1/sessions/:id/phases/:phaseId", name: "phase" },
  { method: "GET", path: "/api/v1/sessions/:id/events", name: "events" },
  { method: "GET", path: "/api/v1/settings", name: "settings" },
  { method: "GET", path: "/api/v1/adapters", name: "adapters" },
  { method: "POST", path: "/api/v1/sessions/:id/archive", name: "archive" },
] as const);

export type ApiRouteName = (typeof API_ROUTE_TABLE)[number]["name"];

const LIFECYCLE_STATES: readonly LifecycleState[] = [
  "DRAFT", "PREPARED", "RUNNING", "GATING", "REVIEWING", "AWAITING_OWNER",
  "LANDING", "LANDED", "BLOCKED", "CANCELLED",
];

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function usage(row: SessionRow): UsageTotals {
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    reasoningRelation: row.reasoning_relation,
    usageAuthority: row.usage_authority,
    estimatedCostUsd: row.estimated_cost_usd,
    costAuthority: row.cost_authority,
    costPartial: row.cost_partial === 1,
  };
}

function phase(row: PhaseRow): PhaseSummary {
  return {
    phaseId: row.phase_id,
    ordinal: row.ordinal,
    key: row.phase_key,
    name: row.name,
    kind: row.kind,
    owner: row.owner,
    description: row.description,
    status: row.status as PhaseStatus,
    correctionCount: row.correction_count,
    maxCorrections: row.max_corrections,
    error: row.error_code === null && row.error_message === null
      ? null
      : { code: row.error_code, message: row.error_message },
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

function agent(row: AgentRow): AgentSummary {
  return {
    agent: row.agent,
    adapterId: row.adapter_id,
    provider: row.provider,
    color: row.color,
    requestedModel: row.requested_model,
    resolvedModel: row.resolved_model,
    modelProvenance: row.model_provenance,
    contextTokens: row.context_tokens,
    contextWindow: row.context_window,
    callCount: row.call_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    costAuthority: row.cost_authority,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function card(db: DatabaseSync, row: SessionRow): SessionCard {
  return {
    sessionId: row.session_id,
    project: row.project_slug,
    taskId: row.task_id,
    attempt: row.attempt,
    workflowId: row.workflow_id,
    riskTier: row.risk_tier,
    protected: row.is_protected === 1,
    state: row.lifecycle_state as LifecycleState,
    request: row.request_text,
    callCeiling: row.call_ceiling,
    callsReserved: row.calls_reserved,
    callsSpent: row.calls_spent,
    observabilityDegraded: row.observability_degraded === 1,
    archived: row.archived === 1,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    usage: usage(row),
    phases: phasesForSession(db, row.session_id).map(phase),
    agents: agentsForSession(db, row.session_id).map(agent),
  };
}

function gate(row: GateRow): GateSummary {
  return {
    id: row.gate_result_id,
    phaseId: row.phase_id,
    round: row.correction_round,
    gateId: row.gate_id,
    kind: row.gate_kind,
    candidateSha: row.candidate_sha,
    passed: row.passed === 1,
    exitCode: row.exit_code,
    checks: parseJson(row.checks_json),
    violations: parseJson(row.violations_json),
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function processSummary(row: ProcessRow): ProcessSummary {
  return {
    id: row.process_id,
    phaseId: row.phase_id,
    runId: row.run_id,
    adapterId: row.adapter_id,
    role: row.role,
    transport: row.transport,
    status: row.status,
    registeredAt: row.registered_at,
    releasedAt: row.released_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    exitSignal: row.exit_signal,
  };
}

function event(row: EventRow): EventItem {
  return {
    row: row.event_row,
    id: row.event_id,
    phaseId: row.phase_id,
    runId: row.run_id,
    parentEventId: row.parent_event_id,
    firstSourceSeq: row.first_source_seq,
    lastSourceSeq: row.last_source_seq,
    type: row.type,
    name: row.name,
    status: row.status,
    payload: row.redaction_level === "private-ref" ? {} : parseJson(row.payload_json),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    costAuthority: row.cost_authority as CostAuthority | null,
  };
}

function requireSession(db: DatabaseSync, id: string): SessionRow {
  const found = getSession(db, id);
  if (found === null) throw new ApiRequestError(404, "session-not-found", "session not found");
  return found;
}

function searchParams(request: HandlerRequest, allowed: readonly string[]): URLSearchParams {
  const params = new URL(request.url, "http://127.0.0.1").searchParams;
  for (const key of params.keys()) {
    if (!allowed.includes(key)) throw new ApiRequestError(400, "invalid-query", `unknown query parameter: ${key}`);
    if (params.getAll(key).length !== 1) throw new ApiRequestError(400, "invalid-query", `duplicate query parameter: ${key}`);
  }
  return params;
}

function boundedInteger(params: URLSearchParams, key: string, fallback: number, minimum: number, maximum: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) throw new ApiRequestError(400, "invalid-query", `${key} must be an integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiRequestError(400, "invalid-query", `${key} is outside its allowed range`);
  }
  return parsed;
}

function allowedNextActions(state: string): string[] {
  if (state === "DRAFT") return ["prepare in terminal"];
  if (state === "PREPARED") return ["run in terminal"];
  if (state === "AWAITING_OWNER") return ["inspect owner gate in terminal"];
  if (["RUNNING", "GATING", "REVIEWING", "LANDING"].includes(state)) return ["watch"];
  return [];
}

export interface ApiRouterOptions {
  readonly dbPath: string;
  readonly config: AwsfConfig;
  readonly open?: typeof openDatabase;
}

export interface ApiRouter {
  dispatch(request: HandlerRequest): Promise<ApiResponse>;
  close(): void;
}

function routeParams(routePath: string, segments: readonly string[]): Record<string, string> | null {
  const expected = routePath.split("/").slice(1);
  if (expected.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const pattern = expected[index] ?? "";
    const actual = segments[index] ?? "";
    if (pattern.startsWith(":")) params[pattern.slice(1)] = actual;
    else if (pattern !== actual) return null;
  }
  return params;
}

export function createApiRouter(options: ApiRouterOptions): ApiRouter {
  const opener = options.open ?? openDatabase;
  const readDb = opener(options.dbPath, { readonly: true });
  let archiveDb: DatabaseSync | null = null;

  const handlers: Readonly<Record<ApiRouteName, ApiHandler>> = {
    health: safely(() => {
      const status = projectionHealth(readDb);
      return jsonResponse({ ok: true, project: options.config.project.slug, ...status } satisfies HealthResponse);
    }),
    sessions: safely((request) => {
      const params = searchParams(request, ["limit", "before", "state", "archived"]);
      const limit = boundedInteger(params, "limit", 50, 1, 100);
      const before = params.get("before") ?? undefined;
      if (before !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(before) || Number.isNaN(Date.parse(before)))) {
        throw new ApiRequestError(400, "invalid-query", "before must be an ISO timestamp");
      }
      const state = params.get("state") ?? undefined;
      if (state !== undefined && !(LIFECYCLE_STATES as readonly string[]).includes(state)) {
        throw new ApiRequestError(400, "invalid-query", "state is not a lifecycle state");
      }
      const archivedRaw = params.get("archived");
      if (archivedRaw !== null && archivedRaw !== "true" && archivedRaw !== "false") {
        throw new ApiRequestError(400, "invalid-query", "archived must be true or false");
      }
      const rows = listSessions(readDb, {
        limit,
        ...(before === undefined ? {} : { before }),
        ...(state === undefined ? {} : { state }),
        archived: archivedRaw === "true",
      });
      return jsonResponse({ sessions: rows.map((row) => card(readDb, row)) } satisfies SessionsResponse);
    }),
    session: safely((_request, params) => {
      const row = requireSession(readDb, params.id ?? "");
      const base = card(readDb, row);
      const response: SessionDetailResponse = {
        ...base,
        baseSha: row.base_sha,
        headSha: row.head_sha,
        candidateSha: row.candidate_sha,
        workerProvider: row.worker_provider,
        workerModelRequested: row.worker_model_requested,
        workerModelResolved: row.worker_model_resolved,
        reviewProvider: row.review_provider,
        reviewVerdict: row.review_verdict,
        correctionsAuto: row.corrections_auto,
        correctionsOwner: row.corrections_owner,
        stateRevision: row.state_revision,
        transitions: transitionsForSession(readDb, row.session_id).map((item) => ({
          id: item.transition_id,
          seq: item.seq,
          from: item.from_state,
          to: item.to_state,
          actor: item.actor,
          edgeId: item.edge_id,
          reason: { source: item.reason_source, code: item.reason_code, detail: item.reason_detail },
          spawnSite: item.spawn_site === 1,
          at: item.at,
        })),
        gates: gatesForSession(readDb, row.session_id).map(gate),
        processes: processesForSession(readDb, row.session_id).map(processSummary),
        allowedNextActions: allowedNextActions(row.lifecycle_state),
      };
      return jsonResponse(response);
    }),
    phase: safely((_request, params) => {
      const sessionId = params.id ?? "";
      const phaseId = params.phaseId ?? "";
      const session = requireSession(readDb, sessionId);
      const found = phaseForSession(readDb, sessionId, phaseId);
      if (found === null) throw new ApiRequestError(404, "phase-not-found", "phase not found");
      const snapshot = configSnapshotForSession(readDb, sessionId);
      const envelopes: EnvelopeRound[] = envelopesForPhase(readDb, sessionId, phaseId).map((item) => ({
        id: item.envelope_id,
        agent: item.agent,
        schemaId: item.schema_id,
        correctionRound: item.correction_round,
        valid: item.valid === 1,
        producerStatus: item.producer_status,
        payload: parseJson(item.payload_json),
        violations: parseJson(item.violations_json),
        createdAt: item.created_at,
      }));
      const response: PhaseDetailResponse = {
        sessionId,
        phase: phase(found),
        effectiveConfig: snapshot === null ? {} : parseJson(snapshot),
        compiledPrompts: [],
        envelopes,
        gates: gatesForSession(readDb, sessionId, phaseId).map(gate),
        usage: usage(session),
        agents: agentsForSession(readDb, sessionId).map(agent),
        processes: processesForSession(readDb, sessionId, phaseId).map(processSummary),
      };
      return jsonResponse(response);
    }),
    events: safely((request, params) => {
      const sessionId = params.id ?? "";
      requireSession(readDb, sessionId);
      const query = searchParams(request, ["after", "limit"]);
      const after = boundedInteger(query, "after", 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = boundedInteger(query, "limit", 200, 1, 500);
      const rows = pollEvents(readDb, sessionId, after, limit + 1);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const response: EventsResponse = {
        events: page.map(event),
        cursor: page.at(-1)?.event_row ?? after,
        hasMore,
      };
      return jsonResponse(response);
    }),
    settings: safely(() => jsonResponse({ settings: buildEffectiveConfig(options.config) } satisfies SettingsResponse)),
    adapters: safely(() => {
      const adapters: AdapterHealth[] = Object.entries(options.config.adapters).map(([id, entry]) => {
        const enabled = entry.enabled !== false;
        const blocked = entry.kind === "antigravity";
        return {
          id,
          kind: entry.kind,
          provider: entry.provider ?? null,
          enabled,
          status: !enabled ? "disabled" : blocked ? "blocked" : "configured",
          code: blocked ? "E_ADAPTER_UNVERIFIED" : null,
        };
      });
      return jsonResponse({ adapters } satisfies AdaptersResponse);
    }),
    archive: safely((_request, params) => {
      const sessionId = params.id ?? "";
      requireSession(readDb, sessionId);
      archiveDb ??= opener(options.dbPath);
      if (!setSessionArchived(archiveDb, sessionId)) {
        throw new ApiRequestError(404, "session-not-found", "session not found");
      }
      return jsonResponse({ archived: true } satisfies ArchiveResponse);
    }),
  };

  return {
    async dispatch(request): Promise<ApiResponse> {
      try {
        validateAuthority(request.headers);
        const segments = decodePathSegments(request.url);
        const pathMatches = API_ROUTE_TABLE.map((route) => ({ route, params: routeParams(route.path, segments) }))
          .filter((candidate) => candidate.params !== null);
        const match = pathMatches.find((candidate) => candidate.route.method === request.method);
        if (match !== undefined && match.params !== null) {
          return handlers[match.route.name](request, match.params);
        }
        if (pathMatches.length > 0) throw new ApiRequestError(405, "method-not-allowed", "method not allowed");
        throw new ApiRequestError(404, "not-found", "route not found");
      } catch (error) {
        return safely(() => { throw error; })(request, {});
      }
    },
    close(): void {
      readDb.close();
      archiveDb?.close();
    },
  };
}
