// One host-built record of the facts the owner reads at a stop (W19 DD4).
//
// `buildStopFacts` is pure. It reads the attempt status and the attempt's own
// journal records, plus the compiled phase list the caller already holds, and
// nothing else: no database, no live quota probe, no provider, no clock and no
// file. Each field is copied from a record that already exists. When the
// journal does not hold a fact, the field is null. Nothing is inferred and
// nothing is defaulted to a number that could pass for a measurement.
//
// The only prose it carries is the reviewer's findings, copied verbatim from
// the journaled review envelope. The builder's text, the status's
// `lastActivity`/`nextAction` sentences and blocker details stay out.

import type { JournalRecord } from "../persistence/journal.ts";
import type { AttemptEvent, AttemptStatus } from "../cli/commands/attempt.ts";
import type { AttemptEvidence } from "../observability/attempt-evidence.ts";
import type { PhaseRecovery } from "../contracts/phase-recovery.ts";
import {
  REVIEW_OUTPUT_SCHEMA_ID,
  type ReviewOutput,
  type ReviewSeverity,
  type ReviewVerdict,
} from "../contracts/review-output.ts";
import type { TaskState } from "../state/task-machine.ts";
import { MAX_CALL_CEILING, ceilingFor, type Tier } from "../state/tiers.ts";

export const STOP_FACTS_SCHEMA_ID = "awsf.stop-facts/v1";

/**
 * Every stop a run makes for its owner.
 *
 * The three parked checkpoints stay in RUNNING and move no edge. The three
 * AWAITING_OWNER holds are named by the edge that reached them: L12 after
 * gating, L15 after review, L26 at the quota stop. `blocked` is any edge into
 * BLOCKED, with its reason code.
 */
export const STOP_KINDS = [
  "ceiling-pause",
  "quota-pause",
  "ticket-block",
  "gating-hold",
  "review-hold",
  "quota-stop",
  "blocked",
] as const;
export type StopKind = (typeof STOP_KINDS)[number];

const PARKED_KINDS = ["ceiling-pause", "quota-pause", "ticket-block"] as const;
type ParkedKind = (typeof PARKED_KINDS)[number];

const AWAITING_BY_EDGE: Readonly<Record<string, StopKind>> = {
  L12: "gating-hold",
  L15: "review-hold",
  L26: "quota-stop",
};

/** One phase of the compiled recipe, as the caller already holds it. */
export interface StopFactsPhase {
  readonly id: string;
  /** The shift ticket this phase belongs to, or null outside a shift. */
  readonly ticket: string | null;
  /** The adapter id the phase is routed to, or null for a host-only phase. */
  readonly route: string | null;
}

export interface StopFactsConfig {
  /** The attempt's compiled phases, in order. */
  readonly phases: readonly StopFactsPhase[];
}

export interface GateRowFact {
  readonly name: string;
  readonly passed: boolean;
}

export interface GateRoundFact {
  readonly phaseId: string;
  readonly round: number;
  readonly rows: readonly GateRowFact[];
}

/** One review finding, every text field copied verbatim from the review envelope. */
export interface ReviewFindingFact {
  readonly id: string;
  readonly severity: ReviewSeverity;
  readonly file: string;
  readonly line: number | null;
  readonly title: string;
  readonly text: string;
}

export interface ReviewFact {
  readonly phaseId: string;
  readonly verdict: ReviewVerdict;
  readonly reviewedSha: string;
  readonly findingCount: number;
  /** Null when the journal holds no valid review envelope for that phase. */
  readonly findings: readonly ReviewFindingFact[] | null;
}

/**
 * The latest phase-boundary quota reading. The snapshot fields come from the
 * newest `quota-snapshot` record, and `observedAt` is that record's journal
 * stamp. Adapter, provider, window and threshold are journaled only on a
 * quota-pause checkpoint's binding, so they are null at every other stop.
 */
export interface QuotaFact {
  readonly completedPhaseKey: string;
  readonly nextPhaseKey: string;
  readonly percentRemaining: number | null;
  readonly minutesToReset: number | null;
  readonly reasonCode: string | null;
  readonly observedAt: string;
  readonly adapterId: string | null;
  readonly provider: string | null;
  readonly window: string | null;
  readonly thresholdMinutes: number | null;
}

export interface CorrectionFacts {
  readonly auto: number;
  readonly autoAllowance: number;
  readonly owner: number;
  readonly ownerAllowance: number;
  readonly ownerReentries: number;
  readonly ownerReentriesAllowance: number;
}

export interface StopFacts {
  readonly schema: typeof STOP_FACTS_SCHEMA_ID;
  readonly project: string;
  readonly task: string;
  readonly attempt: number;
  readonly sessionId: string;
  readonly workflow: string;
  readonly tier: Tier;
  readonly lifecycle: TaskState;
  readonly stopKind: StopKind;
  /** The edge that reached the stop; null for a parked checkpoint, which moves none. */
  readonly edge: string | null;
  readonly reasonCode: string | null;
  /** The parked checkpoint's id; null for an edge stop. */
  readonly checkpointId: string | null;
  /** The shift ticket the checkpoint names; null when it names none. */
  readonly ticket: string | null;
  readonly callsSpent: number;
  readonly callsReserved: number;
  /** The effective ceiling, owner raises included. */
  readonly ceiling: number;
  readonly maxCallCeiling: number;
  readonly nextPhase: string | null;
  readonly nextRoute: string | null;
  readonly ticketsDone: readonly string[];
  readonly ticketsRemaining: readonly string[];
  readonly corrections: CorrectionFacts;
  readonly gates: GateRoundFact | null;
  readonly review: ReviewFact | null;
  readonly quota: QuotaFact | null;
}

type Evidence<K extends AttemptEvidence["type"]> = Extract<AttemptEvidence, { type: K }>;
type TransitionEvidence = Evidence<"transition">;

function evidenceOf<K extends AttemptEvidence["type"]>(
  records: readonly JournalRecord<AttemptEvent>[],
  type: K,
): { readonly record: JournalRecord<AttemptEvent>; readonly evidence: Evidence<K> }[] {
  const found: { record: JournalRecord<AttemptEvent>; evidence: Evidence<K> }[] = [];
  for (const record of records) {
    const evidence = record.event.evidence;
    if (evidence !== undefined && evidence.type === type) found.push({ record, evidence: evidence as Evidence<K> });
  }
  return found;
}

function lastTransitionInto(
  records: readonly JournalRecord<AttemptEvent>[],
  to: TaskState,
): TransitionEvidence | null {
  const into = evidenceOf(records, "transition").filter(({ evidence }) => evidence.to === to);
  return into.at(-1)?.evidence ?? null;
}

function isParked(kind: PhaseRecovery["kind"]): kind is ParkedKind {
  return (PARKED_KINDS as readonly string[]).includes(kind);
}

interface Stop {
  readonly kind: StopKind;
  readonly edge: string | null;
  readonly reasonCode: string | null;
  readonly checkpoint: PhaseRecovery | null;
}

function stopOf(status: AttemptStatus, records: readonly JournalRecord<AttemptEvent>[]): Stop | null {
  const state = status.lifecycleState;
  if (state === "RUNNING") {
    const checkpoint = status.recovery ?? null;
    if (checkpoint === null || !isParked(checkpoint.kind)) return null;
    // A parked checkpoint moves no edge. A ticket block names its reason on the
    // blocker; the two pauses carry none.
    return { kind: checkpoint.kind, edge: null, reasonCode: status.blocker?.code ?? null, checkpoint };
  }
  if (state === "AWAITING_OWNER") {
    const transition = lastTransitionInto(records, "AWAITING_OWNER");
    const kind = transition === null ? undefined : AWAITING_BY_EDGE[transition.edgeId];
    if (transition === null || kind === undefined) {
      throw new Error("stop facts: AWAITING_OWNER has no journaled L12, L15 or L26 transition");
    }
    return { kind, edge: transition.edgeId, reasonCode: transition.reasonCode, checkpoint: null };
  }
  if (state === "BLOCKED") {
    const transition = lastTransitionInto(records, "BLOCKED");
    if (transition === null) throw new Error("stop facts: BLOCKED has no journaled transition");
    return { kind: "blocked", edge: transition.edgeId, reasonCode: transition.reasonCode, checkpoint: null };
  }
  return null;
}

function latestGateRound(records: readonly JournalRecord<AttemptEvent>[]): GateRoundFact | null {
  const gates = evidenceOf(records, "gate");
  const last = gates.at(-1)?.evidence;
  if (last === undefined) return null;
  // One row per gate id for that phase and round; a re-recorded row replaces
  // the earlier one in place, so the order stays the order first measured.
  const rows = new Map<string, GateRowFact>();
  for (const { evidence } of gates) {
    if (evidence.phaseId === last.phaseId && evidence.round === last.round) {
      rows.set(evidence.gateId, { name: evidence.gateId, passed: evidence.passed });
    }
  }
  return { phaseId: last.phaseId, round: last.round, rows: [...rows.values()] };
}

function latestReview(records: readonly JournalRecord<AttemptEvent>[]): ReviewFact | null {
  const review = evidenceOf(records, "review").at(-1)?.evidence;
  if (review === undefined) return null;
  const envelope = evidenceOf(records, "envelope")
    .map(({ evidence }) => evidence.envelope)
    .filter((stored) => stored.phaseId === review.phaseId && stored.schemaId === REVIEW_OUTPUT_SCHEMA_ID &&
      stored.valid && stored.payload !== null)
    .at(-1);
  const payload = envelope?.payload as ReviewOutput | undefined;
  return {
    phaseId: review.phaseId,
    verdict: review.verdict,
    reviewedSha: review.reviewedSha,
    findingCount: review.findingCount,
    findings: payload === undefined
      ? null
      : payload.findings.map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        file: finding.file,
        line: finding.line,
        title: finding.title,
        text: finding.detail,
      })),
  };
}

function latestQuota(records: readonly JournalRecord<AttemptEvent>[], checkpoint: PhaseRecovery | null): QuotaFact | null {
  const latest = evidenceOf(records, "quota-snapshot").at(-1);
  if (latest === undefined) return null;
  const { record, evidence } = latest;
  const binding = checkpoint?.kind === "quota-pause" ? checkpoint.quota : null;
  return {
    completedPhaseKey: evidence.completedPhaseKey,
    nextPhaseKey: evidence.nextPhaseKey,
    percentRemaining: evidence.effectivePercentRemaining,
    minutesToReset: evidence.minutesToReset,
    reasonCode: evidence.reasonCode,
    observedAt: record.recorded_at,
    adapterId: binding?.adapterId ?? null,
    provider: binding?.provider ?? null,
    window: binding?.scope ?? null,
    thresholdMinutes: binding?.threshold ?? null,
  };
}

/** Phase keys the journal records as accepted, in the checkpoint's prefix or as phase-accepted evidence. */
function acceptedPhases(records: readonly JournalRecord<AttemptEvent>[], checkpoint: PhaseRecovery | null): ReadonlySet<string> {
  const accepted = new Set<string>(checkpoint?.prefix.map((entry) => entry.phaseKey) ?? []);
  for (const { evidence } of evidenceOf(records, "phase-accepted")) accepted.add(evidence.accepted.phaseKey);
  return accepted;
}

function ticketProgress(config: StopFactsConfig, accepted: ReadonlySet<string>): { done: string[]; remaining: string[] } {
  const order: string[] = [];
  const complete = new Map<string, boolean>();
  for (const phase of config.phases) {
    if (phase.ticket === null) continue;
    if (!complete.has(phase.ticket)) order.push(phase.ticket);
    complete.set(phase.ticket, (complete.get(phase.ticket) ?? true) && accepted.has(phase.id));
  }
  return {
    done: order.filter((ticket) => complete.get(ticket) === true),
    remaining: order.filter((ticket) => complete.get(ticket) !== true),
  };
}

function nextPhaseOf(stop: Stop, config: StopFactsConfig, quota: QuotaFact | null): StopFactsPhase | null {
  if (stop.checkpoint !== null) {
    // The phase after the accepted prefix: the unstarted build a pause holds
    // back, or the gate phase a ticket block re-measures on resume.
    return config.phases[stop.checkpoint.prefix.length] ?? null;
  }
  if (stop.kind === "quota-stop" && quota !== null) {
    return config.phases.find((phase) => phase.id === quota.nextPhaseKey) ?? null;
  }
  return null;
}

/**
 * The facts for the stop `status` is at, or null when the attempt is not at a
 * stop (it is running, landing, landed, published or cancelled).
 *
 * Throws when the status names an edge stop the journal cannot account for,
 * because a record built from a status alone would be a guess.
 */
export function buildStopFacts(
  status: AttemptStatus,
  records: readonly JournalRecord<AttemptEvent>[],
  config: StopFactsConfig,
): StopFacts | null {
  const stop = stopOf(status, records);
  if (stop === null) return null;
  const quota = latestQuota(records, stop.checkpoint);
  const next = nextPhaseOf(stop, config, quota);
  const tickets = ticketProgress(config, acceptedPhases(records, stop.checkpoint));
  const budget = status.budget;
  return {
    schema: STOP_FACTS_SCHEMA_ID,
    project: status.project,
    task: status.taskId,
    attempt: status.attempt,
    sessionId: status.sessionId,
    workflow: status.workflow,
    tier: status.tier,
    lifecycle: status.lifecycleState,
    stopKind: stop.kind,
    edge: stop.edge,
    reasonCode: stop.reasonCode,
    checkpointId: stop.checkpoint?.id ?? null,
    ticket: stop.checkpoint?.ticket ?? null,
    callsSpent: budget.callsSpent,
    callsReserved: budget.callsReserved,
    ceiling: ceilingFor(status.tier, budget.ceiling),
    maxCallCeiling: MAX_CALL_CEILING,
    nextPhase: next?.id ?? null,
    nextRoute: next?.route ?? null,
    ticketsDone: tickets.done,
    ticketsRemaining: tickets.remaining,
    corrections: {
      auto: budget.correctionsAuto,
      autoAllowance: budget.allowance.auto,
      owner: budget.correctionsOwner,
      ownerAllowance: budget.allowance.owner,
      ownerReentries: budget.ownerReentries,
      ownerReentriesAllowance: budget.allowance.ownerReentries,
    },
    gates: latestGateRound(records),
    review: latestReview(records),
    quota,
  };
}
