// One row per role per run: every agent phase of one role in one session,
// folded into the outcomes the W18 metric catalog defines. Each outcome is a
// named pure function over that role's phases, gate rows and envelope rounds.
// `readRunFacts` is the only function here that queries SQLite, and it only
// reads: it imports the `DatabaseSync` type, never `node:sqlite` (invariant 6).
//
// Roles never mix. A row is built from its own role's phases and from the
// gates and envelopes of those phases alone, so a planner's corrections never
// reach a builder's row.
//
// Nothing here scores a review. A missing review, or one with no findings, is
// carried as the verdict the run recorded and never read as evidence of
// quality: a reviewer that misses defects produces the same clean review.

import type { DatabaseSync } from "../observability/sqlite.ts";
import type { EffortSource } from "../observability/phase-route.ts";
import type { ModelResolutionProvenance } from "../contracts/normalized-events.ts";
import type { RouteEffort } from "../contracts/route-selection.ts";
import { PHASE_TERMINAL_STATES } from "../state/phase-machine.ts";
import {
  blockedAgentPhase,
  heuristicAttribution,
  type Attribution,
  type AttributionRun,
  type RunPhase,
  type RunTransition,
} from "./attribution.ts";
import { readPhaseFacts, type PhaseFacts, type PhaseTokens, type RoleSessionFacts } from "./phase-facts.ts";
import { TOOL_CLASSES, type ToolClass } from "./tool-class.ts";

export const STATE_GROUPS = ["LANDED", "AWAITING_OWNER", "OPEN", "CANCELLED", "BLOCKED"] as const;
export type StateGroup = (typeof STATE_GROUPS)[number];

/** A failed one of these is a guardrail hit, never a refuted claim. */
export const GUARDRAIL_GATES: readonly string[] = Object.freeze(["writes_within_globs", "no_protected_paths"]);
/** Contract adherence: they judge the envelope's form, not what it claims. */
export const CONTRACT_GATES: readonly string[] = Object.freeze(["envelope_valid", "json_parses"]);

export interface GateFact {
  readonly phaseId: string;
  readonly round: number;
  readonly gateId: string;
  readonly passed: boolean;
}

/** One envelope round. `producerStatus` is `null` when no payload could be read from it. */
export interface EnvelopeFact {
  readonly phaseId: string;
  readonly round: number;
  readonly producerStatus: "success" | "failure" | null;
}

/** What the outcome definitions read of a phase. */
export type OutcomePhase = Pick<PhaseFacts, "phaseId" | "status" | "correctionCount" | "maxCorrections" | "errorCode">;

export interface RunFacts extends AttributionRun {
  readonly sessionId: string;
  readonly projectSlug: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly workflowId: string;
  readonly tier: number;
  readonly planRef: string | null;
  readonly reviewVerdict: string | null;
  readonly ownerReentries: number;
  readonly observabilityDegraded: boolean;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** The run's agent phases in ordinal order, as T01 reads them. */
  readonly agentPhases: readonly PhaseFacts[];
  readonly gates: readonly GateFact[];
  readonly envelopes: readonly EnvelopeFact[];
}

export interface RoleRoute {
  readonly adapter: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly effort: RouteEffort | null;
}

export interface RoleGates {
  readonly pass: number;
  readonly total: number;
  /** Distinct gate ids that failed on round 0 of any of the role's phases, sorted. */
  readonly firstRoundFail: readonly string[];
}

export interface RoleRow {
  readonly sessionId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly role: string;
  /** All null when `routeMixed`: a row keyed to one route must have run on one. */
  readonly route: RoleRoute;
  /** `null` when the phases' effort sources disagree, or on rows projected before migration 0007. */
  readonly effortSource: EffortSource | null;
  readonly routeMixed: boolean;
  /** `stream-authoritative` only when every phase is; `route-attributed` when any phase is. */
  readonly identityProvenance: ModelResolutionProvenance | null;
  readonly calls: number;
  readonly turns: number;
  readonly phases: number;
  readonly minutes: number | null;
  readonly corrections: number;
  readonly settled: boolean;
  readonly firstPass: boolean;
  readonly cleanCompletion: boolean;
  readonly failedHere: boolean;
  /** Failed here, and the effective attribution is `model`. Only this counts against a route. */
  readonly blockedHere: boolean;
  readonly tokens: PhaseTokens;
  readonly costAuthority: RoleSessionFacts["costAuthority"];
  readonly tools: Readonly<Record<ToolClass, number>>;
  readonly toolErrors: number;
  readonly gates: RoleGates;
  readonly guardrailHits: number;
  readonly claims: number;
  readonly refuted: number;
  readonly honestStops: number;
  /** Phases that recovered by correction. */
  readonly recovered: number;
  /** Phases that took at least one correction. */
  readonly corrected: number;
  readonly stateGroup: StateGroup;
  readonly workflow: string;
  readonly tier: number;
  readonly project: string;
  readonly planRef: string | null;
  readonly reviewVerdict: string | null;
  readonly ownerReentries: number;
  readonly reworkPhases: number;
  readonly observabilityDegraded: boolean;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

// ---------------------------------------------------------------------------
// Definitions. One function each, and one test each.
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(PHASE_TERMINAL_STATES);

/** PUBLISHED is a landed run pushed afterwards. Every other state is OPEN: the run is in flight. */
export function stateGroup(lifecycleState: string): StateGroup {
  switch (lifecycleState) {
    case "LANDED":
    case "PUBLISHED":
      return "LANDED";
    case "AWAITING_OWNER":
    case "CANCELLED":
    case "BLOCKED":
      return lifecycleState;
    default:
      return "OPEN";
  }
}

/**
 * The role's phases in a row: those the run reached. A phase still QUEUED, a
 * SKIPPED one and one cancelled before it started carry no evidence.
 */
export function phaseRan(phase: Pick<PhaseFacts, "status" | "startedAt">): boolean {
  if (phase.status === "QUEUED" || phase.status === "SKIPPED") return false;
  return !(phase.status === "CANCELLED" && phase.startedAt === null);
}

/** settled: every phase of the role is terminal and the run is not in flight. */
export function isSettled(phases: readonly OutcomePhase[], group: StateGroup): boolean {
  return group !== "OPEN" && phases.length > 0 && phases.every((phase) => TERMINAL_STATUSES.has(phase.status));
}

/** first pass: settled, every phase SUCCEEDED, each with no correction. */
export function isFirstPass(phases: readonly OutcomePhase[], group: StateGroup): boolean {
  return isSettled(phases, group) && phases.every((phase) => phase.status === "SUCCEEDED" && phase.correctionCount === 0);
}

/** guardrail hit: a failed `writes_within_globs` or `no_protected_paths` gate on the phase, or a `PermissionBreach`. */
export function isGuardrailHit(phase: OutcomePhase, gates: readonly GateFact[]): boolean {
  return phase.errorCode === "PermissionBreach" ||
    gates.some((gate) => gate.phaseId === phase.phaseId && !gate.passed && GUARDRAIL_GATES.includes(gate.gateId));
}

/** Counted per phase, so a breach whose path gate also failed is one hit, not two. */
export function guardrailHits(phases: readonly OutcomePhase[], gates: readonly GateFact[]): number {
  return phases.filter((phase) => isGuardrailHit(phase, gates)).length;
}

/** clean completion: first pass with zero guardrail hits. */
export function isCleanCompletion(phases: readonly OutcomePhase[], gates: readonly GateFact[], group: StateGroup): boolean {
  return isFirstPass(phases, group) && guardrailHits(phases, gates) === 0;
}

/** A claim gate judges what the envelope claims: every gate except contract adherence and the guardrails. */
export function isClaimGate(gateId: string): boolean {
  return !CONTRACT_GATES.includes(gateId) && !GUARDRAIL_GATES.includes(gateId);
}

/** claim: an envelope round with a producer status. */
export function claims(envelopes: readonly EnvelopeFact[]): number {
  return envelopes.filter((envelope) => envelope.producerStatus !== null).length;
}

/** refuted claim: `success` on a round where a claim gate of the same phase and round failed. */
export function refutedClaims(envelopes: readonly EnvelopeFact[], gates: readonly GateFact[]): number {
  return envelopes.filter((envelope) => envelope.producerStatus === "success" && gates.some((gate) =>
    gate.phaseId === envelope.phaseId && gate.round === envelope.round && !gate.passed && isClaimGate(gate.gateId))).length;
}

/** honest stop: the producer said `failure` itself. It counts neither for nor against a route. */
export function honestStops(envelopes: readonly EnvelopeFact[]): number {
  return envelopes.filter((envelope) => envelope.producerStatus === "failure").length;
}

/**
 * recovered by correction: a round-0 gate failed, and the phase SUCCEEDED on
 * a final round, within `max_corrections`, whose gates all passed.
 */
export function isRecovered(phase: OutcomePhase, gates: readonly GateFact[]): boolean {
  const own = gates.filter((gate) => gate.phaseId === phase.phaseId);
  const final = phase.correctionCount;
  const finalGates = own.filter((gate) => gate.round === final);
  return phase.status === "SUCCEEDED" && final > 0 && final <= phase.maxCorrections &&
    own.some((gate) => gate.round === 0 && !gate.passed) &&
    finalGates.length > 0 && finalGates.every((gate) => gate.passed);
}

/** corrected: the phase took at least one correction. */
export function isCorrected(phase: OutcomePhase): boolean {
  return phase.correctionCount > 0;
}

/**
 * failed here: the run is BLOCKED in one of this role's phases. A host phase
 * judges the agent phase before it, so a block there lands on that agent's
 * role: without this, `CommandPhaseFailure` after a build could never count
 * against the builder's route.
 */
export function failedHere(run: AttributionRun, role: string): boolean {
  return blockedAgentPhase(run)?.owner === role;
}

/** blocked here: failed here, and the effective attribution is `model`. */
export function blockedHere(failed: boolean, attribution: Attribution | null): boolean {
  return failed && attribution === "model";
}

// ---------------------------------------------------------------------------
// Folding a role's phases into its row.
// ---------------------------------------------------------------------------

const TOKEN_KINDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"] as const;

function sumTokens(phases: readonly PhaseFacts[]): PhaseTokens {
  const sums = Object.fromEntries(TOKEN_KINDS.map((kind) => {
    const reported = phases.map((phase) => phase.tokens[kind]).filter((value): value is number => value !== null);
    return [kind, reported.length === 0 ? null : reported.reduce((total, value) => total + value, 0)];
  })) as Record<(typeof TOKEN_KINDS)[number], number | null>;
  // Phases with no usage events said nothing about the relation, so they do not dilute it to `unknown`.
  const relations = new Set(phases.filter((phase) => phase.tokens.usageEvents > 0).map((phase) => phase.tokens.reasoningRelation));
  const [relation] = relations;
  return {
    ...sums,
    reasoningRelation: relations.size === 1 && relation !== undefined ? relation : "unknown",
    usageEvents: phases.reduce((total, phase) => total + phase.tokens.usageEvents, 0),
  };
}

function routeOf(phases: readonly PhaseFacts[]): Pick<RoleRow, "route" | "effortSource" | "routeMixed"> {
  const first = phases[0]!.route;
  const same = phases.every(({ route }) => route.adapterId === first.adapterId && route.provider === first.provider &&
    route.model === first.model && route.effort === first.effort);
  if (!same) {
    return { route: { adapter: null, provider: null, model: null, effort: null }, effortSource: null, routeMixed: true };
  }
  return {
    route: { adapter: first.adapterId, provider: first.provider, model: first.model, effort: first.effort },
    effortSource: phases.every(({ route }) => route.effortSource === first.effortSource) ? first.effortSource : null,
    routeMixed: false,
  };
}

function provenanceOf(phases: readonly PhaseFacts[]): ModelResolutionProvenance | null {
  const values = phases.map((phase) => phase.identity.modelProvenance);
  if (values.includes("route-attributed")) return "route-attributed";
  return values.every((value) => value === "stream-authoritative") ? "stream-authoritative" : null;
}

function sum(phases: readonly PhaseFacts[], value: (phase: PhaseFacts) => number): number {
  return phases.reduce((total, phase) => total + value(phase), 0);
}

function roleRow(run: RunFacts, role: string, phases: readonly PhaseFacts[], attribution: Attribution | null): RoleRow {
  const ids = new Set(phases.map((phase) => phase.phaseId));
  const gates = run.gates.filter((gate) => ids.has(gate.phaseId));
  const envelopes = run.envelopes.filter((envelope) => ids.has(envelope.phaseId));
  const group = stateGroup(run.lifecycleState);
  const minutes = phases.map((phase) => phase.minutes).filter((value): value is number => value !== null);
  const failed = failedHere(run, role);
  const tools = Object.fromEntries(TOOL_CLASSES.map((name) => [name, sum(phases, (phase) => phase.tools.byClass[name])]));
  // `agent_sessions` is keyed by session and role, so every phase of the role shares one row.
  const session = phases[0]!.role;
  return {
    sessionId: run.sessionId,
    taskId: run.taskId,
    attempt: run.attempt,
    role,
    ...routeOf(phases),
    identityProvenance: provenanceOf(phases),
    calls: session?.callCount ?? sum(phases, (phase) => phase.turns),
    turns: sum(phases, (phase) => phase.turns),
    phases: phases.length,
    minutes: minutes.length === 0 ? null : minutes.reduce((total, value) => total + value, 0),
    corrections: sum(phases, (phase) => phase.correctionCount),
    settled: isSettled(phases, group),
    firstPass: isFirstPass(phases, group),
    cleanCompletion: isCleanCompletion(phases, gates, group),
    failedHere: failed,
    blockedHere: blockedHere(failed, attribution),
    tokens: sumTokens(phases),
    costAuthority: session?.costAuthority ?? "unavailable",
    tools: Object.freeze(tools) as Readonly<Record<ToolClass, number>>,
    toolErrors: sum(phases, (phase) => phase.tools.errors),
    gates: {
      pass: gates.filter((gate) => gate.passed).length,
      total: gates.length,
      firstRoundFail: [...new Set(gates.filter((gate) => gate.round === 0 && !gate.passed).map((gate) => gate.gateId))].sort(),
    },
    guardrailHits: guardrailHits(phases, gates),
    claims: claims(envelopes),
    refuted: refutedClaims(envelopes, gates),
    honestStops: honestStops(envelopes),
    recovered: phases.filter((phase) => isRecovered(phase, gates)).length,
    corrected: phases.filter(isCorrected).length,
    stateGroup: group,
    workflow: run.workflowId,
    tier: run.tier,
    project: run.projectSlug,
    planRef: run.planRef,
    reviewVerdict: run.reviewVerdict,
    ownerReentries: run.ownerReentries,
    reworkPhases: run.phases.filter((phase) => phase.kind === "agent" && phase.key.startsWith("owner-rework-")).length,
    observabilityDegraded: run.observabilityDegraded,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
  };
}

/** One row per role that ran in each run, roles in the order their first phase ran. A role that never ran has no row. */
export function buildRoleRows(runs: readonly RunFacts[]): RoleRow[] {
  return runs.flatMap((run) => {
    const byRole = new Map<string, PhaseFacts[]>();
    for (const phase of [...run.agentPhases].sort((a, b) => a.ordinal - b.ordinal)) {
      if (phaseRan(phase)) append(byRole, phase.owner, phase);
    }
    // T03's owner override takes precedence over the heuristic; until then the heuristic is effective.
    const attribution = heuristicAttribution(run);
    return [...byRole].map(([role, phases]) => roleRow(run, role, phases, attribution));
  });
}

// ---------------------------------------------------------------------------
// Reading the projection.
// ---------------------------------------------------------------------------

interface SessionQueryRow {
  session_id: string;
  project_slug: string;
  task_id: string;
  attempt: number;
  workflow_id: string;
  risk_tier: number;
  plan_ref: string | null;
  lifecycle_state: string;
  review_verdict: string | null;
  owner_reentries: number;
  observability_degraded: number;
  started_at: string;
  ended_at: string | null;
}

function append<T>(grouped: Map<string, T[]>, key: string, value: T): void {
  const values = grouped.get(key);
  if (values === undefined) grouped.set(key, [value]);
  else values.push(value);
}

function groupBy<T extends { session_id: string }, R>(rows: readonly T[], map: (row: T) => R): Map<string, R[]> {
  const grouped = new Map<string, R[]>();
  for (const row of rows) append(grouped, row.session_id, map(row));
  return grouped;
}

/** Reads every run as `RunFacts`, sessions in start order. Read-only SQL on the caller's connection. */
export function readRunFacts(db: DatabaseSync): RunFacts[] {
  const sessions = db.prepare(`SELECT session_id, project_slug, task_id, attempt, workflow_id, risk_tier, plan_ref,
      lifecycle_state, review_verdict, owner_reentries, observability_degraded, started_at, ended_at
    FROM sessions ORDER BY started_at, session_id`).all() as unknown as SessionQueryRow[];
  const phases = groupBy(db.prepare(`SELECT session_id, phase_key, ordinal, kind, owner, status, error_code
      FROM phases ORDER BY session_id, ordinal`).all() as unknown as Array<{
    session_id: string; phase_key: string; ordinal: number; kind: string; owner: string; status: string; error_code: string | null;
  }>, (row): RunPhase => ({
    key: row.phase_key, ordinal: row.ordinal, kind: row.kind, owner: row.owner, status: row.status, errorCode: row.error_code,
  }));
  const transitions = groupBy(db.prepare(`SELECT session_id, seq, to_state, reason_code
      FROM transitions ORDER BY session_id, seq`).all() as unknown as Array<{
    session_id: string; seq: number; to_state: string; reason_code: string | null;
  }>, (row): RunTransition => ({ seq: row.seq, toState: row.to_state, reasonCode: row.reason_code }));
  const gates = groupBy(db.prepare(`SELECT session_id, phase_id, correction_round, gate_id, passed
      FROM gate_results ORDER BY session_id, phase_id, correction_round, gate_id`).all() as unknown as Array<{
    session_id: string; phase_id: string; correction_round: number; gate_id: string; passed: number;
  }>, (row): GateFact => ({ phaseId: row.phase_id, round: row.correction_round, gateId: row.gate_id, passed: row.passed === 1 }));
  const envelopes = groupBy(db.prepare(`SELECT session_id, phase_id, correction_round, producer_status
      FROM envelopes ORDER BY session_id, phase_id, correction_round`).all() as unknown as Array<{
    session_id: string; phase_id: string; correction_round: number; producer_status: "success" | "failure" | null;
  }>, (row): EnvelopeFact => ({ phaseId: row.phase_id, round: row.correction_round, producerStatus: row.producer_status }));
  const agentPhases = new Map<string, PhaseFacts[]>();
  for (const fact of readPhaseFacts(db)) append(agentPhases, fact.sessionId, fact);

  return sessions.map((session): RunFacts => ({
    sessionId: session.session_id,
    projectSlug: session.project_slug,
    taskId: session.task_id,
    attempt: session.attempt,
    workflowId: session.workflow_id,
    tier: session.risk_tier,
    planRef: session.plan_ref,
    lifecycleState: session.lifecycle_state,
    reviewVerdict: session.review_verdict,
    ownerReentries: session.owner_reentries,
    observabilityDegraded: session.observability_degraded === 1,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    phases: phases.get(session.session_id) ?? [],
    transitions: transitions.get(session.session_id) ?? [],
    agentPhases: agentPhases.get(session.session_id) ?? [],
    gates: gates.get(session.session_id) ?? [],
    envelopes: envelopes.get(session.session_id) ?? [],
  }));
}

/** Every role-row in the projection. */
export function readRoleRows(db: DatabaseSync): RoleRow[] {
  return buildRoleRows(readRunFacts(db));
}
