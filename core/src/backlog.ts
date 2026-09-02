import { basename } from "node:path";
import type { CostAuthority } from "../../dashboard/shared/types.ts";
import { TICKET_STATES, type Ticket, type TicketState, type TicketWorkflow } from "./contracts/ticket.ts";
import type { PlanTicketReader } from "./persistence/plan-tickets.ts";
import type { TicketStore } from "./persistence/ticket-store.ts";
import type { PlanIdentity } from "./registry/plan-kind.ts";

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

export type TicketStateCounts = Readonly<Record<TicketState, number>>;

export interface PlanBacklogTicket {
  readonly uid: string;
  readonly plan: string;
  readonly id: string;
  readonly title: string;
  readonly milestone: string;
  readonly state: TicketState;
  readonly depends_on: readonly string[];
  readonly ready: boolean;
  readonly tier?: 0 | 1 | 2;
  readonly workflow?: TicketWorkflow;
}

export interface PlanBacklogPlan extends PlanIdentity {
  readonly counts: TicketStateCounts;
  readonly ticketCount: number;
}

export interface PlanBacklog {
  readonly plans: readonly PlanBacklogPlan[];
  readonly tickets: readonly PlanBacklogTicket[];
  readonly ready: readonly PlanBacklogTicket[];
  readonly counts: Backlog["counts"];
  readonly projectedCost: ProjectedCost;
}

function projectedCost(tickets: readonly Pick<PlanBacklogTicket, "uid">[], sessions: readonly BacklogSessionCost[]): ProjectedCost {
  const ticketUids = new Set(tickets.map((ticket) => ticket.uid));
  const matched = sessions.filter((session) => ticketUids.has(session.taskId));
  if (matched.length === 0
    || new Set(matched.map((session) => session.taskId)).size !== ticketUids.size
    || matched.some((session) => session.estimatedCostUsd === null || session.costAuthority === "unavailable")) {
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

function emptyStateCounts(): Record<TicketState, number> {
  return Object.fromEntries(TICKET_STATES.map((name) => [name, 0])) as Record<TicketState, number>;
}

/** Plan-aware dashboard projection; dependencies and duplicate ids stay plan-scoped. */
export async function queryPlanBacklog(
  reader: Pick<PlanTicketReader, "load">,
  sessions: readonly BacklogSessionCost[],
): Promise<PlanBacklog> {
  const groups = await reader.load();
  const tickets: PlanBacklogTicket[] = [];
  const plans: PlanBacklogPlan[] = [];
  const state = emptyStateCounts();
  const milestone: Record<string, number> = {};
  const tier: Record<"T0" | "T1" | "T2", number> = { T0: 0, T1: 0, T2: 0 };

  for (const group of groups) {
    const byId = new Map(group.records.map((record) => [record.ticket.id, record.ticket]));
    const counts = emptyStateCounts();
    for (const record of group.records) {
      const ticket = record.ticket;
      const row: PlanBacklogTicket = {
        uid: record.uid,
        plan: record.plan,
        id: ticket.id,
        title: ticket.title,
        milestone: ticket.milestone,
        state: ticket.state,
        depends_on: ticket.depends_on,
        ready: ticket.state === "todo" && ticket.depends_on.every((id) => byId.get(id)?.state === "done"),
        ...(ticket.tier === undefined ? {} : { tier: ticket.tier }),
        ...(ticket.workflow === undefined ? {} : { workflow: ticket.workflow }),
      };
      tickets.push(row);
      counts[row.state] += 1;
      state[row.state] += 1;
      milestone[row.milestone] = (milestone[row.milestone] ?? 0) + 1;
      if (row.tier !== undefined) tier[`T${row.tier}`] += 1;
    }
    plans.push({ ...group.plan, counts, ticketCount: group.records.length });
  }

  return {
    plans,
    tickets,
    ready: tickets.filter((ticket) => ticket.ready),
    counts: { state, milestone, tier },
    projectedCost: projectedCost(tickets, sessions),
  };
}

/** The sole legacy backlog query. CLI renderers continue to use this result. */
export async function queryBacklog(store: TicketStore, sessions: readonly BacklogSessionCost[]): Promise<Backlog> {
  const tickets = (await store.load()).flatMap((record) => record.ticket === null ? [] : [record.ticket]);
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const rows = tickets.map((ticket) => ({
    ...ticket,
    ready: ticket.state === "todo" && ticket.depends_on.every((id) => byId.get(id)?.state === "done"),
  }));
  const state = emptyStateCounts();
  const milestone: Record<string, number> = {};
  const tier: Record<"T0" | "T1" | "T2", number> = { T0: 0, T1: 0, T2: 0 };
  for (const ticket of rows) {
    state[ticket.state] += 1;
    milestone[ticket.milestone] = (milestone[ticket.milestone] ?? 0) + 1;
    tier[`T${ticket.tier}`] += 1;
  }
  const plan = basename(store.directory);
  return {
    tickets: rows,
    ready: rows.filter((ticket) => ticket.ready),
    counts: { state, milestone, tier },
    projectedCost: projectedCost(rows.map((ticket) => ({ uid: `${plan}/${ticket.id}` })), sessions),
  };
}
