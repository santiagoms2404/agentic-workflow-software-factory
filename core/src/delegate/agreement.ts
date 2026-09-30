// Agreement, computed at read time (W19 task 6, DD6).
//
// Each proposal is paired with the next act taken on that attempt, by any
// actor, after the stop it was made at: match, mismatch, or none. Nothing is
// written when the owner acts. Every pair is recomputed from records that
// already exist: the task's delegate.jsonl and the attempt's journal.
//
// The table is exact. An act matches only the act it names. "Similar"
// outcomes are mismatches.

import type { JournalRecord } from "../persistence/journal.ts";
import type { AttemptEvent } from "../cli/commands/attempt.ts";
import type { ProposedActName } from "./policy.ts";

/** Where a pair came from. Replay pairs (task 7) count toward autonomy and keep their label. */
export type PairSource = "live" | "replay";

export type PairOutcome = "match" | "mismatch" | "none";

/**
 * The act the journal shows was taken. `land` is the owner's L20; it is what a
 * land-shadow proposal is compared with.
 */
export type ObservedAct = Exclude<ProposedActName, "land-shadow" | "wait-for-owner"> | "land";

export interface Pair {
  readonly proposalId: string;
  readonly source: PairSource;
  readonly taskId: string;
  readonly attempt: number;
  readonly at: string;
  readonly proposedAct: ProposedActName;
  readonly observedAct: ObservedAct | null;
  /** The journal position of the observed act, or null. */
  readonly observedAtSeq: number | null;
  readonly outcome: PairOutcome;
}

/** The parts of a proposal pairing reads; a live delegate.proposal and a replay record both have them. */
export interface PairableProposal {
  readonly id: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly sessionId: string;
  readonly statusRevision: number;
  readonly at: string;
  readonly proposal: { readonly act: { readonly act: ProposedActName } };
}

/**
 * The one act a journal record shows, or null when it shows none. The mapping
 * is closed: a record type not named here is never an act.
 */
export function actOf(record: JournalRecord<AttemptEvent>): ObservedAct | null {
  const evidence = record.event.evidence;
  if (evidence === undefined) return null;
  switch (evidence.type) {
    case "ceiling-grant": return "raise";
    case "resume-activation": return "resume";
    case "review-degradation": return "degrade-review";
    case "transition":
      if (evidence.to === "CANCELLED") return "cancel";
      if (evidence.edgeId === "L19") return "rework";
      if (evidence.edgeId === "L25") return "replacement-review";
      if (evidence.edgeId === "L20") return "land";
      return null;
    default:
      return null;
  }
}

/** The act a proposal matches, or null for wait-for-owner, which proposes no act. */
function expectedAct(act: ProposedActName): ObservedAct | null {
  if (act === "wait-for-owner") return null;
  if (act === "land-shadow") return "land";
  return act;
}

/** The journal index of the stop the proposal was made at, or -1. */
function stopIndex(proposal: PairableProposal, records: readonly JournalRecord<AttemptEvent>[]): number {
  return records.findIndex((record) =>
    record.event.next.sessionId === proposal.sessionId && record.event.next.revision === proposal.statusRevision);
}

/**
 * Pairs every proposal made on one attempt with that attempt's journal. The
 * next act is looked for after the proposal's stop and before the next
 * proposal's stop, so an act is never credited to two proposals.
 */
export function pairAttempt(
  proposals: readonly PairableProposal[],
  records: readonly JournalRecord<AttemptEvent>[],
  source: PairSource,
): Pair[] {
  const located = proposals
    .map((proposal) => ({ proposal, index: stopIndex(proposal, records) }))
    .sort((left, right) => left.index - right.index);
  return located.map(({ proposal, index }, position) => {
    const proposedAct = proposal.proposal.act.act;
    let observed: { act: ObservedAct; seq: number } | null = null;
    if (index >= 0) {
      const later = located.slice(position + 1).find((next) => next.index > index);
      const end = later === undefined ? records.length : later.index;
      for (let cursor = index + 1; cursor < end; cursor += 1) {
        const act = actOf(records[cursor]!);
        if (act !== null) {
          observed = { act, seq: records[cursor]!.source_seq };
          break;
        }
      }
    }
    const expected = expectedAct(proposedAct);
    const outcome: PairOutcome = observed === null || expected === null
      ? "none"
      : observed.act === expected ? "match" : "mismatch";
    return Object.freeze({
      proposalId: proposal.id,
      source,
      taskId: proposal.taskId,
      attempt: proposal.attempt,
      at: proposal.at,
      proposedAct,
      observedAct: observed?.act ?? null,
      observedAtSeq: observed?.seq ?? null,
      outcome,
    });
  });
}

/**
 * Pairs a task's proposals across its attempts. `journalFor` returns an
 * attempt's journal records (empty when it has none).
 */
export function pairTask(
  proposals: readonly PairableProposal[],
  journalFor: (attempt: number) => readonly JournalRecord<AttemptEvent>[],
  source: PairSource,
): Pair[] {
  const byAttempt = new Map<number, PairableProposal[]>();
  for (const proposal of proposals) {
    const list = byAttempt.get(proposal.attempt) ?? [];
    list.push(proposal);
    byAttempt.set(proposal.attempt, list);
  }
  return [...byAttempt.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([attempt, list]) => pairAttempt(list, journalFor(attempt), source));
}
