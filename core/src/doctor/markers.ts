import type { DoctorRow } from "../contracts/doctor-readout.ts";
import type { TicketState } from "../contracts/ticket.ts";

export interface MarkerFact {
  readonly attempt: string;
  readonly plan: string;
  readonly tickets: readonly { readonly id: string; readonly state: TicketState | "not measured" }[] | null;
}

/** No task-name or directory-adjacency inference: only the sealed selection maps a landing. */
export function markersRow(facts: readonly MarkerFact[], notes: readonly string[] = []): DoctorRow {
  const unmapped = facts.filter(fact => fact.tickets === null);
  const open = facts.flatMap(fact => (fact.tickets ?? []).filter(ticket => ticket.state !== "done")
    .map(ticket => `${fact.attempt}: ${fact.plan}/${ticket.id}=${ticket.state}`));
  return { status: unmapped.length > 0 || open.length > 0 || notes.length > 0 ? "warn" : "ok", detail: [
    `landed attempts with plan ref=${facts.length}; open selected tickets=${open.length}; unmapped=${unmapped.length}`,
    ...open, ...unmapped.map(fact => `${fact.attempt}: ${fact.plan}: unmapped (no usable ticket selection)`), ...notes,
  ] };
}
