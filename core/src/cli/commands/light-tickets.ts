import { relative, sep } from "node:path";
import { queryBacklog } from "../../backlog.ts";
import type { TicketStore } from "../../persistence/ticket-store.ts";
import { renderBacklog } from "./backlog.ts";
import { lightTicketStore } from "./ticket-selection.ts";
import { findStoredTicket, ticketSummary } from "./ticket.ts";

function storePath(repository: string, store: TicketStore): string {
  return relative(repository, store.directory).split(sep).join("/");
}

export function lightTierLabel(repository: string, store: TicketStore): string {
  return `light tier: the flat ${storePath(repository, store)} set, which belongs to no plan`;
}

export async function lightCountLine(repository: string): Promise<string | null> {
  try {
    const store = await lightTicketStore(repository);
    const backlog = await queryBacklog(store, []);
    if (backlog.tickets.length === 0 && !backlog.invalidCount) return null;
    const counts = Object.entries(backlog.counts.state).map(([key, value]) => `${key}=${value}`).join(" ");
    return `light tier: ${counts} in ${storePath(repository, store)}, which belongs to no plan; read them with --light`;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").trim();
    return `light tier: unreadable (${message}); read them with --light`;
  }
}

export async function lightBacklogLines(store: TicketStore): Promise<readonly string[]> {
  // Bare-id cost attribution can match a plan's ticket; do not use it here.
  const backlog = await queryBacklog(store, []);
  return [...renderBacklog(backlog), ...(backlog.invalid ?? []).map(ticketSummary)];
}

export async function alsoLightLine(repository: string, plan: string, id: string): Promise<string | null> {
  try {
    if (await findStoredTicket(await lightTicketStore(repository), id) !== undefined) {
      return `shown: plan ${plan}'s ${id}; the light tier also has ${id}: awsf ticket show ${id} --light`;
    }
  } catch { /* A failed secondary lookup must not obscure the selected ticket. */ }
  return null;
}

export async function alsoPlanLine(store: TicketStore, plan: string, id: string): Promise<string | null> {
  if (await findStoredTicket(store, id) === undefined) return null;
  return `shown: the light tier's ${id}; plan ${plan} also has ${id}: awsf ticket show ${id} --plan ${plan}`;
}
