// The route-metrics payload: `GET /api/v1/metrics` serves it, and `awsf
// metrics --json` prints it. It carries facts and data only: runs with their
// phases, role-rows, the rate card, the benchmark priors and the untested
// routes. Every statistic is computed from it by
// `dashboard/shared/route-metrics.ts`, so the API, the CLI and the tab cannot
// disagree about a number.
//
// Read-only: it queries the caller's connection and writes nothing. The shift
// task-class join also reads sealed status metadata and ticket bytes, using Git
// blobs at the recorded base when available. It imports the `DatabaseSync` type,
// never `node:sqlite` (invariant 6).

import type { DatabaseSync } from "../observability/sqlite.ts";
import type {
  LifecycleState,
  MetricsAgentPhase,
  MetricsResponse,
  MetricsRoleRow,
  MetricsRun,
  MetricsRunPhase,
  PhaseStatus,
} from "../../../dashboard/shared/types.ts";
import { RATE_CARD } from "../../../dashboard/shared/rate-card.ts";
import { BENCHMARK_PRIORS, UNTESTED_ROUTES } from "../../../dashboard/shared/benchmark-priors.ts";
import { effectiveAttribution } from "./attribution.ts";
import { summarizeCauses } from "./causes.ts";
import { minutesBetween, type PhaseFacts } from "./phase-facts.ts";
import { buildRoleRows, readRunFacts, stateGroup, type RoleRow, type RunFacts } from "./role-rows.ts";

export const METRICS_SCHEMA = "awsf.route-metrics/v1";

export interface MetricsPayloadOptions {
  /** When the payload was read; the caller owns the clock. */
  readonly extractedAt: string;
}

interface PhaseQueryRow {
  session_id: string;
  phase_id: string;
  phase_key: string;
  ordinal: number;
  kind: MetricsRunPhase["kind"];
  owner: string;
  status: string;
  correction_count: number;
  max_corrections: number;
  error_code: string | null;
  started_at: string | null;
  ended_at: string | null;
}

function agentPhase(fact: PhaseFacts): MetricsAgentPhase {
  const { route, identity, tokens, tools } = fact;
  return {
    route: { adapter: route.adapterId, provider: route.provider, model: route.model, effort: route.effort, effortSource: route.effortSource },
    requestedModel: identity.requestedModel,
    resolvedModel: identity.resolvedModel,
    modelProvenance: identity.modelProvenance,
    turns: fact.turns,
    tokens,
    tools: { calls: tools.calls, byClass: tools.byClass, errors: tools.errors },
  };
}

/** Every phase of every run, host phases included, keyed by session. */
function readRunPhases(db: DatabaseSync, facts: readonly RunFacts[]): Map<string, MetricsRunPhase[]> {
  const agentFacts = new Map<string, PhaseFacts>();
  for (const run of facts) for (const fact of run.agentPhases) agentFacts.set(fact.phaseId, fact);
  const rows = db.prepare(`SELECT session_id, phase_id, phase_key, ordinal, kind, owner, status, correction_count,
      max_corrections, error_code, started_at, ended_at
    FROM phases ORDER BY session_id, ordinal, phase_id`).all() as unknown as PhaseQueryRow[];
  const bySession = new Map<string, MetricsRunPhase[]>();
  for (const row of rows) {
    const fact = agentFacts.get(row.phase_id);
    const phase: MetricsRunPhase = {
      phaseId: row.phase_id,
      key: row.phase_key,
      ordinal: row.ordinal,
      kind: row.kind,
      owner: row.owner,
      status: row.status as PhaseStatus,
      correctionCount: row.correction_count,
      maxCorrections: row.max_corrections,
      errorCode: row.error_code,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      minutes: minutesBetween(row.started_at, row.ended_at),
      agent: fact === undefined ? null : agentPhase(fact),
    };
    const list = bySession.get(row.session_id);
    if (list === undefined) bySession.set(row.session_id, [phase]);
    else list.push(phase);
  }
  return bySession;
}

function run(facts: RunFacts, phases: readonly MetricsRunPhase[]): MetricsRun {
  const attribution = effectiveAttribution(facts, facts.ownerAttribution);
  return {
    sessionId: facts.sessionId,
    project: facts.projectSlug,
    taskId: facts.taskId,
    attempt: facts.attempt,
    workflow: facts.workflowId,
    tier: facts.tier,
    planRef: facts.planRef,
    lifecycleState: facts.lifecycleState as LifecycleState,
    stateGroup: stateGroup(facts.lifecycleState),
    reviewVerdict: facts.reviewVerdict,
    ownerReentries: facts.ownerReentries,
    observabilityDegraded: facts.observabilityDegraded,
    usageAuthority: facts.usageAuthority,
    startedAt: facts.startedAt,
    endedAt: facts.endedAt,
    ownerAttribution: facts.ownerAttribution,
    attribution: attribution.attribution,
    attributionSource: attribution.source,
    heuristicAttribution: attribution.heuristic,
    phases,
  };
}

/** The whole payload, from projection facts and the read-only shift task-class join. */
export function buildMetricsPayload(db: DatabaseSync, options: MetricsPayloadOptions): MetricsResponse {
  const facts = readRunFacts(db);
  const phases = readRunPhases(db, facts);
  // Assigned, not cast: this compiles only while core's `RoleRow` satisfies the payload's row type.
  const roleRows: readonly MetricsRoleRow[] = buildRoleRows(facts) satisfies readonly RoleRow[];
  const runs = facts.map((item) => run(item, phases.get(item.sessionId) ?? []));
  return {
    schema: METRICS_SCHEMA,
    extractedAt: options.extractedAt,
    runs,
    roleRows,
    causes: summarizeCauses(runs),
    rateCard: RATE_CARD,
    priors: BENCHMARK_PRIORS,
    untestedRoutes: UNTESTED_ROUTES,
  };
}
