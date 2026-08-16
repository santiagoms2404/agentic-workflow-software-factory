import type { CostAuthority } from "../../dashboard/shared/types.ts";
import { TICKET_STATES, type Ticket, type TicketState } from "./contracts/ticket.ts";
import type { TicketStore } from "./persistence/ticket-store.ts";

export interface BacklogSessionCost {
  readonly taskId: string;
  readonly estimatedCostUsd: number | null;
  readonly costAuthority: CostAuthority;
}

export interface ProjectedCost {
  readonly usd: number | null;
  readonly authority: CostAuthority;
  /** A missing or mixed source must be disclosed, never rendered as zero. */
  readonly partial: boolean;
}

export interface BacklogTicket extends Ticket {
  readonly ready: boolean;
}

export interface Backlog {
  readonly tickets: readonly BacklogTicket[];
  readonly ready: readonly BacklogTicket[];
  readonly counts: {
    readonly state: Readonly<Record<TicketState, number>>;
    readonly milestone: Readonly<Record<string, number>>;
    readonly tier: Readonly<Record<"T0" | "T1" | "T2", number>>;
  };
  readonly projectedCost: ProjectedCost;
}

function projectedCost(tickets: readonly Ticket[], sessions: readonly BacklogSessionCost[]): ProjectedCost {
  const ticketIds = new Set(tickets.map((ticket) => ticket.id));
  const matched = sessions.filter((session) => ticketIds.has(session.taskId));
  if (matched.length === 0 || new Set(matched.map((session) => session.taskId)).size !== ticketIds.size || matched.some((session) => session.estimatedCostUsd === null || session.costAuthority === "unavailable")) {
    return { usd: null, authority: "unavailable", partial: true };
  }
  const authorities = new Set(matched.map((session) => session.costAuthority));
  if (authorities.size !== 1) return { usd: null, authority: "unavailable", partial: true };
  return {
    usd: matched.reduce((total, session) => total + session.estimatedCostUsd!, 0),
    authority: matched[0]!.costAuthority,
    partial: false,
  };
}

/** The sole backlog query. CLI and API only render this result. */
export async function queryBacklog(store: TicketStore, sessions: readonly BacklogSessionCost[]): Promise<Backlog> {
  const tickets = (await store.load()).flatMap((record) => record.ticket === null ? [] : [record.ticket]);
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const rows = tickets.map((ticket) => ({
    ...ticket,
    ready: ticket.state === "todo" && ticket.depends_on.every((id) => byId.get(id)?.state === "done"),
  }));
  const state = Object.fromEntries(TICKET_STATES.map((name) => [name, 0])) as Record<TicketState, number>;
  const milestone: Record<string, number> = {};
  const tier: Record<"T0" | "T1" | "T2", number> = { T0: 0, T1: 0, T2: 0 };
  for (const ticket of rows) {
    state[ticket.state] += 1;
    milestone[ticket.milestone] = (milestone[ticket.milestone] ?? 0) + 1;
    tier[`T${ticket.tier}`] += 1;
  }
  return { tickets: rows, ready: rows.filter((ticket) => ticket.ready), counts: { state, milestone, tier }, projectedCost: projectedCost(rows, sessions) };
}
