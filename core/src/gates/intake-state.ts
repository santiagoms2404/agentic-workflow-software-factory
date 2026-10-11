import { GateReport } from "./interface.ts";
import { parseStoredTicket } from "../persistence/ticket-store.ts";
import type { Ticket } from "../contracts/ticket.ts";

/** Intake never owns state: new files start todo, existing files retain their base state. */
export function intakeStateGate(path: string, before: string | null, ticket: Ticket): GateReport {
  const report = new GateReport("diff_matches_claims");
  if (before === null) return report.check("new ticket starts todo", ticket.state === "todo", `${path}: ${ticket.state}`);
  const prior = parseStoredTicket(before, path);
  report.check("base ticket validates", prior.ticket !== null, path);
  return report.check("refine preserves state", prior.ticket !== null && prior.ticket.state === ticket.state,
    `${path}: ${prior.ticket?.state ?? "invalid"} -> ${ticket.state}`);
}
