import { basename, resolve } from "node:path";
import type { ResolvedPlanSource } from "../../registry/plan-source.ts";
import { TicketStore, type StoredTicket } from "../../persistence/ticket-store.ts";

export type TicketAction = "new" | "refine" | "list" | "show";

export class TicketNotFound extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`ticket ${JSON.stringify(id)} was not found`);
    this.name = "TicketNotFound";
    this.id = id;
  }
}

export function ticketStoreFor(repository: string): TicketStore {
  return new TicketStore(resolve(repository, "specs", "tickets"));
}

/** Resolves one declared plan's store without changing TicketStore's file contract. */
export function ticketStoreForPlan(resolved: readonly ResolvedPlanSource[], planStem: string): TicketStore {
  const source = resolved.find((candidate) => basename(candidate.planPath, ".html") === planStem);
  if (source === undefined) throw new Error(`no resolved plan source named ${JSON.stringify(planStem)}`);
  return new TicketStore(source.ticketsPath);
}

function summary(record: StoredTicket): string {
  if (record.ticket === null) {
    return `${record.path} — invalid: ${record.violations.map((violation) => `${violation.path} ${violation.message}`).join("; ")}`;
  }
  return `${record.ticket.id}\t${record.ticket.state}\tT${String(record.ticket.tier)}\t${record.ticket.title}`;
}

/** Read commands deliberately expose invalid retained files instead of hiding them. */
export async function listTickets(store: TicketStore): Promise<readonly string[]> {
  return (await store.load()).map(summary);
}

export async function showTicket(store: TicketStore, id: string): Promise<readonly string[]> {
  const record = (await store.load()).find((candidate) => candidate.ticket?.id === id || candidate.path.endsWith(`/${id}.md`) || candidate.path.endsWith(`\\${id}.md`));
  if (record === undefined) throw new TicketNotFound(id);
  return [summary(record), record.body.trimEnd()];
}

/**
 * The request passed through the engineer phase. The model receives the prior
 * ticket for refine, but the write boundary is still config + T17 path policy.
 */
export function intakeRequest(action: "new" | "refine", id: string, intent: string, existing?: StoredTicket, path = `specs/tickets/${id}.md`): string {
  if (!/^T\d\d$/.test(id)) throw new Error(`ticket id must be zero-padded Tnn; got ${JSON.stringify(id)}`);
  if (intent.trim().length === 0) throw new Error(`awsf ticket ${action} requires an intent`);
  if (action === "refine" && (existing === undefined || existing.ticket === null)) throw new TicketNotFound(id);
  const ask = action === "new" ? `Create ticket ${id}. Owner intent: ${intent.trim()}` : [
    `Refine ticket ${id} without changing its id or state. Owner intent: ${intent.trim()}`,
    "Existing validated ticket:", JSON.stringify(existing!.ticket), "Existing body:", existing!.body,
  ].join("\n");
  return `Ask: ${ask}\nWhere: ${path}\nDone means: the ticket validates, matches the intake envelope and ${action === "new" ? "starts todo" : "retains its state"}.\nOut of scope: other tickets, paired plan sets and moving any existing ticket state.`;
}
