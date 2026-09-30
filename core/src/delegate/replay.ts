// The historical replay (W19 task 7). It walks past attempt journals, rebuilds
// the stop facts at each historical stop, and runs the shadow policy there,
// with no Jev (numbers-only) or with one stop-judgment call per stop (live).
// Each result is one `delegate.replay` record. Paired with the act the journal
// shows next, it counts toward autonomy as source `replay`.
//
// A replay reads journals and never writes into a task: its records, and in
// live mode its decision records, live under the state root's delegate/.

import type { JournalRecord } from "../persistence/journal.ts";
import type { AttemptEvent } from "../cli/commands/attempt.ts";
import { allowedActsFor, proposeAct, PROPOSED_ACT_NAMES, RATIONALE_CODES, type JudgmentInput, type PhaseRoles, type ProposedAct, type RationaleCode } from "./policy.ts";
import { buildStopFacts, STOP_KINDS, type StopFacts, type StopFactsConfig, type StopFactsPhase, type StopKind } from "./stop-facts.ts";

export const DELEGATE_REPLAY_TYPE = "delegate.replay";
export const DELEGATE_REPLAY_SCHEMA_ID = "awsf.delegate-replay/v1";
export type ReplayMode = "numbers-only" | "live";

export interface DelegateReplayRecord {
  readonly schema: typeof DELEGATE_REPLAY_SCHEMA_ID;
  readonly type: typeof DELEGATE_REPLAY_TYPE;
  readonly id: string;
  /** One id per `awsf delegate replay` run. */
  readonly replayId: string;
  readonly mode: ReplayMode;
  readonly project: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly sessionId: string;
  readonly statusRevision: number;
  /** The historical stop's journal time, so the earning window orders by stop, not by replay. */
  readonly at: string;
  readonly replayedAt: string;
  readonly stopKind: StopKind;
  readonly edge: string | null;
  readonly checkpointId: string | null;
  readonly decision: { readonly recordId: string | null; readonly outcome: string };
  readonly proposal: { readonly act: ProposedAct; readonly rationale: RationaleCode; readonly executable: boolean };
  readonly allowedActs: readonly string[];
  readonly facts: StopFacts;
}

function fail(detail: string): never {
  throw new Error(`delegate replay record is invalid: ${detail}`);
}

export function assertDelegateReplay(value: unknown): asserts value is DelegateReplayRecord {
  if (typeof value !== "object" || value === null) fail("not an object");
  const record = value as Record<string, unknown>;
  if (record.schema !== DELEGATE_REPLAY_SCHEMA_ID || record.type !== DELEGATE_REPLAY_TYPE) fail("schema or type");
  for (const key of ["id", "replayId", "project", "taskId", "sessionId", "at", "replayedAt"] as const) {
    if (typeof record[key] !== "string" || (record[key] as string).length === 0) fail(key);
  }
  if (record.mode !== "numbers-only" && record.mode !== "live") fail("mode");
  if (!Number.isInteger(record.attempt) || !Number.isInteger(record.statusRevision)) fail("attempt or statusRevision");
  if (!(STOP_KINDS as readonly unknown[]).includes(record.stopKind)) fail("stopKind");
  const proposal = record.proposal as Record<string, unknown> | undefined;
  const act = proposal?.act as Record<string, unknown> | undefined;
  if (proposal === undefined || act === undefined || !(PROPOSED_ACT_NAMES as readonly unknown[]).includes(act.act)) fail("proposal.act");
  if (!(RATIONALE_CODES as readonly unknown[]).includes(proposal.rationale)) fail("proposal.rationale");
  if (typeof proposal.executable !== "boolean" || (proposal.executable && (act.act === "land-shadow" || act.act === "wait-for-owner"))) fail("proposal.executable");
}

/** One stop per attempt session and status revision: the key live proposals and replays share. */
export function stopKey(sessionId: string, statusRevision: number): string {
  return `${sessionId}:${String(statusRevision)}`;
}

/**
 * Journal indices where a stop begins: a parked checkpoint (ceiling-pause,
 * quota-pause, ticket-block) or a transition into AWAITING_OWNER or BLOCKED.
 * The record's `event.next` is the status at that stop.
 */
export function historicalStopIndices(records: readonly JournalRecord<AttemptEvent>[]): number[] {
  const indices: number[] = [];
  records.forEach((record, index) => {
    const evidence = record.event.evidence;
    if (evidence === undefined) return;
    if (evidence.type === "ceiling-pause" || evidence.type === "quota-pause" || evidence.type === "ticket-block" ||
        (evidence.type === "transition" && (evidence.to === "AWAITING_OWNER" || evidence.to === "BLOCKED"))) {
      indices.push(index);
    }
  });
  return indices;
}

/** Stands for an agent phase whose route the journal never recorded (it never started). */
export const UNRECORDED_ROUTE = "unrecorded";

/**
 * The phase list as the journal holds it: every phase is journaled QUEUED when
 * the run begins, with its key, ordinal, kind and owner. A route is the
 * adapter an `agent-start` recorded for that phase, or UNRECORDED_ROUTE for an
 * agent phase that never started. Tickets are not journaled on phases, so they
 * are null: a replay's ticket progress is empty.
 */
export function journalPhases(records: readonly JournalRecord<AttemptEvent>[]): { config: StopFactsConfig; roles: PhaseRoles } {
  const phases = new Map<string, { ordinal: number; kind: string; owner: string }>();
  const routes = new Map<string, string>();
  for (const record of records) {
    const evidence = record.event.evidence;
    if (evidence?.type === "phase") phases.set(evidence.phase.key, { ordinal: evidence.phase.ordinal, kind: evidence.phase.kind, owner: evidence.phase.owner });
    if (evidence?.type === "agent-start") routes.set(evidence.phaseId, evidence.adapterId);
  }
  const ordered = [...phases.entries()].sort(([, left], [, right]) => left.ordinal - right.ordinal);
  const roles: Record<string, string> = {};
  const list: StopFactsPhase[] = ordered.map(([id, phase]) => {
    if (phase.kind === "agent") roles[id] = phase.owner;
    return { id, ticket: null, route: phase.kind === "agent" ? routes.get(id) ?? UNRECORDED_ROUTE : null };
  });
  return { config: { phases: list }, roles };
}

/** What a replay asks at one stop. Numbers-only returns `{ outcome: "numbers-only" }` without a call. */
export type ReplayJudge = (facts: StopFacts, allowedActs: readonly string[]) => Promise<{
  readonly judgment: JudgmentInput;
  readonly decision: DelegateReplayRecord["decision"];
}>;

export const NUMBERS_ONLY_JUDGE: ReplayJudge = async () => ({
  judgment: { outcome: "numbers-only", result: null },
  decision: { recordId: null, outcome: "numbers-only" },
});

export interface ReplayAttemptInput {
  readonly project: string;
  readonly records: readonly JournalRecord<AttemptEvent>[];
  readonly phases: { readonly config: StopFactsConfig; readonly roles: PhaseRoles };
  readonly mode: ReplayMode;
  readonly judge: ReplayJudge;
  /** Stops to leave alone: those with a live proposal, and those this mode already replayed. */
  readonly skip: ReadonlySet<string>;
  readonly replayId: string;
  readonly replayedAt: string;
  readonly newId: () => string;
}

/** Replays one attempt's historical stops. Reads only the records it is given. */
export async function replayAttempt(input: ReplayAttemptInput): Promise<DelegateReplayRecord[]> {
  const out: DelegateReplayRecord[] = [];
  for (const index of historicalStopIndices(input.records)) {
    const record = input.records[index]!;
    const status = record.event.next;
    if (input.skip.has(stopKey(status.sessionId, status.revision))) continue;
    let facts: StopFacts | null;
    try {
      facts = buildStopFacts(status, input.records.slice(0, index + 1), input.phases.config);
    } catch {
      facts = null;
    }
    if (facts === null) continue;
    const allowedActs = allowedActsFor(facts);
    const { judgment, decision } = await input.judge(facts, allowedActs);
    const proposal = proposeAct({ facts, judgment, config: input.phases.config, roles: input.phases.roles });
    out.push({
      schema: DELEGATE_REPLAY_SCHEMA_ID,
      type: DELEGATE_REPLAY_TYPE,
      id: input.newId(),
      replayId: input.replayId,
      mode: input.mode,
      project: input.project,
      taskId: status.taskId,
      attempt: status.attempt,
      sessionId: status.sessionId,
      statusRevision: status.revision,
      at: record.recorded_at,
      replayedAt: input.replayedAt,
      stopKind: facts.stopKind,
      edge: facts.edge,
      checkpointId: facts.checkpointId,
      decision,
      proposal: { act: proposal.act, rationale: proposal.rationale, executable: proposal.executable },
      allowedActs: [...allowedActs],
      facts,
    });
  }
  return out;
}

/**
 * One replay per stop for pairing: a live replay wins over a numbers-only
 * one, and a later replay of the same mode over an earlier.
 */
export function effectiveReplays(records: readonly DelegateReplayRecord[]): DelegateReplayRecord[] {
  const chosen = new Map<string, DelegateReplayRecord>();
  for (const record of records) {
    const key = `${record.project}/${record.taskId}/${stopKey(record.sessionId, record.statusRevision)}`;
    const held = chosen.get(key);
    if (held === undefined || record.mode === "live" || held.mode === record.mode) chosen.set(key, record);
  }
  return [...chosen.values()];
}
