import { basename, dirname } from "node:path";
import type { CostAuthority } from "../../dashboard/shared/types.ts";
import { TICKET_STATES, type Ticket, type TicketState, type TicketWorkflow } from "./contracts/ticket.ts";
import type { PlanTicketReader } from "./persistence/plan-tickets.ts";
import { TicketDependencyCycleError, type StoredTicket, type TicketStore } from "./persistence/ticket-store.ts";
import type { PlanIdentity } from "./registry/plan-kind.ts";
import { lightTicketCycle } from "./registry/plan-agreement.ts";

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
  readonly plan?: string | null;
  readonly tickets: readonly BacklogTicket[];
  readonly ready: readonly BacklogTicket[];
  readonly counts: {
    readonly state: TicketStateCounts;
    readonly milestone: Readonly<Record<string, number>>;
    readonly tier: Readonly<Record<"T0" | "T1" | "T2", number>>;
    readonly invalid?: number;
  };
  readonly invalid?: readonly StoredTicket[];
  readonly invalidCount?: number;
  readonly projectedCost: ProjectedCost;
}

export type TicketStateCounts = Readonly<Record<TicketState, number> & { invalid?: number }>;

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

export function ticketBareId(ticket: { readonly uid: string; readonly id?: string }): string {
  if (ticket.id !== undefined && ticket.id !== "") return ticket.id;
  const lastSlash = ticket.uid.lastIndexOf("/");
  return lastSlash >= 0 ? ticket.uid.slice(lastSlash + 1) : ticket.uid;
}

export function planNameForStore(directory: string): string | null {
  const normalized = directory.replace(/[/\\]+$/, "");
  const dirName = basename(normalized);
  const parentName = basename(dirname(normalized));
  // The flat intake store (specs/tickets) belongs to no plan (AGENTS.md invariant 12).
  if (dirName === "tickets") return null;
  // A plan's ticket store lives under a tickets/ directory (e.g. specs/tickets/<plan-stem>).
  // An arbitrary directory (e.g. temporary directory) does not match known plan ticket structure.
  if (parentName === "tickets") return dirName;
  return null;
}

export function projectedCost(
  tickets: readonly { readonly uid: string; readonly id?: string }[],
  sessions: readonly BacklogSessionCost[],
): ProjectedCost {
  if (tickets.length === 0) {
    return { usd: null, authority: "unavailable", partial: true };
  }

  const bareIdCounts = new Map<string, number>();
  for (const ticket of tickets) {
    const bare = ticketBareId(ticket);
    bareIdCounts.set(bare, (bareIdCounts.get(bare) ?? 0) + 1);
  }

  const matchedSessions: BacklogSessionCost[] = [];
  const claimedSessions = new Set<BacklogSessionCost>();

  for (const ticket of tickets) {
    const bare = ticketBareId(ticket);
    // 1. Try exact UID match first
    let session = sessions.find((s) => !claimedSessions.has(s) && s.taskId === ticket.uid);
    // 2. If no exact match and bare id is unique across tickets, match bare ticket id or suffix after '/'
    if (session === undefined && bareIdCounts.get(bare) === 1) {
      session = sessions.find((s) => {
        if (claimedSessions.has(s)) return false;
        if (s.taskId === (ticket.id ?? bare) || s.taskId === bare) return true;
        const sessionBare = s.taskId.includes("/") ? s.taskId.slice(s.taskId.lastIndexOf("/") + 1) : s.taskId;
        return sessionBare === bare;
      });
    }
    if (session === undefined) {
      return { usd: null, authority: "unavailable", partial: true };
    }
    claimedSessions.add(session);
    matchedSessions.push(session);
  }

  if (
    matchedSessions.length !== tickets.length
    || matchedSessions.some((session) => session.estimatedCostUsd === null || session.costAuthority === "unavailable")
  ) {
    return { usd: null, authority: "unavailable", partial: true };
  }

  const authorities = new Set(matchedSessions.map((session) => session.costAuthority));
  if (authorities.size !== 1) return { usd: null, authority: "unavailable", partial: true };

  return {
    usd: matchedSessions.reduce((total, session) => total + session.estimatedCostUsd!, 0),
    authority: matchedSessions[0]!.costAuthority,
    partial: false,
  };
}

function emptyStateCounts(): Record<TicketState, number> {
  return Object.fromEntries(TICKET_STATES.map((name) => [name, 0])) as Record<TicketState, number>;
}

function withReadiness<T extends { readonly id: string; readonly state: TicketState; readonly depends_on: readonly string[] }>(
  tickets: readonly T[],
): (T & { readonly ready: boolean })[] {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return tickets.map((ticket) => ({ ...ticket,
    ready: ticket.state === "todo" && ticket.depends_on.every((id) => byId.get(id)?.state === "done"),
  }));
}

function tallyTickets(rows: readonly { readonly state: TicketState; readonly milestone: string; readonly tier?: 0 | 1 | 2 }[]) {
  const state = emptyStateCounts();
  const milestone: Record<string, number> = {};
  const tier: Record<"T0" | "T1" | "T2", number> = { T0: 0, T1: 0, T2: 0 };
  for (const row of rows) {
    state[row.state] += 1;
    milestone[row.milestone] = (milestone[row.milestone] ?? 0) + 1;
    if (row.tier !== undefined) tier[`T${row.tier}`] += 1;
  }
  return { state, milestone, tier };
}

/** Plan-aware dashboard projection; dependencies and duplicate ids stay plan-scoped. */
export async function queryPlanBacklog(
  reader: Pick<PlanTicketReader, "load">,
  sessions: readonly BacklogSessionCost[],
): Promise<PlanBacklog> {
  const groups = await reader.load();
  const tickets: PlanBacklogTicket[] = [];
  const plans: PlanBacklogPlan[] = [];

  for (const group of groups) {
    // Plan admission normally refuses cycles, but a read path must still fail
    // visibly if registered ticket files change after admission. Matching the
    // legacy TicketStore error keeps the dashboard response from looking like a
    // valid backlog with no ready tickets.
    const cycle = lightTicketCycle(
      group.records.map((record) => ({ id: record.ticket.id, depends_on: [...record.ticket.depends_on] })),
    );
    if (cycle !== null) throw new TicketDependencyCycleError(cycle);
    const rows = withReadiness(group.records.map((record) => {
      const ticket = record.ticket;
      return {
        uid: record.uid,
        plan: record.plan,
        id: ticket.id,
        title: ticket.title,
        milestone: ticket.milestone,
        state: ticket.state,
        depends_on: ticket.depends_on,
        ...(ticket.tier === undefined ? {} : { tier: ticket.tier }),
        ...(ticket.workflow === undefined ? {} : { workflow: ticket.workflow }),
      };
    }));
    tickets.push(...rows);
    plans.push({ ...group.plan, counts: tallyTickets(rows).state, ticketCount: group.records.length });
  }

  const totals = tallyTickets(tickets);
  return {
    plans,
    tickets,
    ready: tickets.filter((ticket) => ticket.ready),
    counts: { ...totals, invalid: 0 },
    projectedCost: projectedCost(tickets, sessions),
  };
}

/** The sole legacy backlog query. CLI renderers continue to use this result. */
export async function queryBacklog(store: TicketStore, sessions: readonly BacklogSessionCost[]): Promise<Backlog> {
  const records = await store.load();
  const invalidRecords = records.filter((record) => record.ticket === null);
  const tickets = records.flatMap((record) => record.ticket === null ? [] : [record.ticket]);
  const rows = withReadiness(tickets);
  const totals = tallyTickets(rows);
  const state: Record<TicketState, number> & { invalid?: number } = totals.state;
  if (invalidRecords.length > 0) {
    state.invalid = invalidRecords.length;
  }
  const plan = planNameForStore(store.directory);
  return {
    ...(plan !== null ? { plan } : {}),
    tickets: rows,
    ready: rows.filter((ticket) => ticket.ready),
    counts: {
      state,
      milestone: totals.milestone,
      tier: totals.tier,
      invalid: invalidRecords.length,
    },
    ...(invalidRecords.length > 0 ? { invalid: invalidRecords, invalidCount: invalidRecords.length } : {}),
    projectedCost: projectedCost(
      rows.map((ticket) => ({
        id: ticket.id,
        uid: plan !== null ? `${plan}/${ticket.id}` : ticket.id,
      })),
      sessions,
    ),
  };
}
