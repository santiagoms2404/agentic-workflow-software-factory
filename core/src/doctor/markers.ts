import type { ClosureState } from "../closure/readout.ts";
import type { DoctorRow } from "../contracts/doctor-readout.ts";
import type { TicketState } from "../contracts/ticket.ts";

export interface MarkerFact {
  readonly attempt: string;
  readonly plan: string;
  readonly closure?: ClosureState;
  readonly tickets: readonly { readonly id: string; readonly state: TicketState | "not measured" }[] | null;
}

/** No task-name or directory-adjacency inference: only the sealed selection maps a landing. */
export function markersRow(facts: readonly MarkerFact[], notes: readonly string[] = []): DoctorRow {
  const unmapped = facts.filter(fact => fact.tickets === null);
  const open = facts.flatMap(fact => (fact.tickets ?? []).filter(ticket => ticket.state !== "done")
    .map(ticket => `${fact.attempt}: ${fact.plan}/${ticket.id}=${ticket.state}`));
  const closed = facts.filter(fact => fact.closure === "closed");
  const chosenOpen = facts.filter(fact => fact.closure === "open by the owner's choice");
  const notClosed = facts.filter(fact => fact.closure === "not closed");
  return { status: unmapped.length > 0 || open.length > 0 || notClosed.length > 0 || notes.length > 0 ? "warn" : "ok", detail: [
    `landed attempts with plan ref=${facts.length}; open selected tickets=${open.length}; unmapped=${unmapped.length}`,
    `closure: closed=${closed.length}; open by the owner's choice=${chosenOpen.length}; not closed=${notClosed.length}`,
    ...facts.filter(fact => fact.closure !== undefined).map(fact => `${fact.attempt}: ${fact.closure}`),
    ...open, ...unmapped.map(fact => `${fact.attempt}: ${fact.plan}: unmapped (no usable ticket selection)`), ...notes,
  ] };
}
