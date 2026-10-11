import type { ClosureRecord } from "../contracts/closure-record.ts";
import type { AttemptStatus } from "../cli/commands/attempt.ts";

/** G03-C's commit time, fixed by T09 Handoff C2 (2026-10-09). No runtime override. */
export const CLOSURE_CUT = "2026-10-09T22:02:56Z";
export type ClosureState = "closed" | "open by the owner's choice" | "not closed";
export interface ClosureReadout {
  readonly state: ClosureState;
  readonly record: ClosureRecord | null;
}
export interface LandingClosureFact {
  readonly project: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly landedAt: string;
  readonly hasSelection: boolean;
  readonly closure: ClosureReadout;
}

export function hasTicketSelection(status: AttemptStatus): boolean {
  return ((status.shift ?? status.ticketSelection)?.tickets.length ?? 0) > 0;
}

/** A prepared commit or intent is not a closure record. Open rows still count. */
export function closureReadout(status: AttemptStatus, records: readonly ClosureRecord[]): ClosureReadout {
  const selection = status.shift ?? status.ticketSelection;
  const record = records.findLast(record => record.candidateSha === status.candidateSha &&
    selection != null && record.plan === selection.plan &&
    selection.tickets.every(ticket => record.tickets.includes(ticket.id))) ?? null;
  return { state: record === null ? "not closed" : record.rowsLeftOpen.length > 0 || record.notClosable.length > 0
    ? "open by the owner's choice" : "closed", record };
}

export function unclosedLandings(facts: readonly LandingClosureFact[]): readonly LandingClosureFact[] {
  return facts.filter(fact => Date.parse(fact.landedAt) > Date.parse(CLOSURE_CUT) && fact.hasSelection && fact.closure.record === null);
}

/** The owner runs this; callers only prepare and display it. */
export function closeArgv(fact: Pick<LandingClosureFact, "project" | "taskId" | "attempt">): readonly string[] {
  return ["awsf", "close", fact.taskId, "--project", fact.project, "--attempt", String(fact.attempt)];
}
