import type { BacklogTicket, SessionCard, TicketState } from "../shared/types.ts";

/**
 * A plan, as the work it asks for and the runs that came out of it.
 *
 * Built from the ticket data the dashboard already serves. The alternative was
 * to render the plan's own `.html` file, which would need a route serving
 * arbitrary local files and would drop a second stylesheet into a shell kept
 * deliberately in one design language. Every registered plan parses to the same
 * ticket shape, so a marimba plan draws exactly like a spine plan and there is
 * nothing special to devise for either.
 *
 * Nothing here joins a TICKET to a run. A run records which plan it came from
 * and no ticket, so a ticket-to-run line could only come from matching a task
 * id against a ticket id by name — the guessing Task 5 was instructed to
 * refuse. The runs sit beside the tickets rather than on them.
 */

export const TICKET_STATES = ["todo", "wip", "done", "failed"] as const;

export interface PlanMilestone {
  readonly name: string;
  readonly tickets: readonly BacklogTicket[];
  readonly counts: Readonly<Record<TicketState, number>>;
}

export interface PlanBoard {
  readonly milestones: readonly PlanMilestone[];
  readonly counts: Readonly<Record<TicketState, number>>;
  readonly tickets: number;
  /** Runs that named this plan. Plan-level, because that is what is recorded. */
  readonly runs: readonly SessionCard[];
}

function emptyCounts(): Record<TicketState, number> {
  return { todo: 0, wip: 0, done: 0, failed: 0 };
}

export function planBoard(
  tickets: readonly BacklogTicket[],
  sessions: readonly SessionCard[],
  planId: string,
): PlanBoard {
  const mine = tickets.filter((ticket) => ticket.plan === planId);
  const counts = emptyCounts();
  const byMilestone = new Map<string, BacklogTicket[]>();
  for (const ticket of mine) {
    counts[ticket.state] += 1;
    // First appearance sets the order: a plan's milestones are a sequence the
    // plan itself decided, and sorting them alphabetically would rewrite it.
    byMilestone.set(ticket.milestone, [...(byMilestone.get(ticket.milestone) ?? []), ticket]);
  }
  const milestones = [...byMilestone.entries()].map(([name, held]) => {
    const milestoneCounts = emptyCounts();
    for (const ticket of held) milestoneCounts[ticket.state] += 1;
    return { name, tickets: held, counts: milestoneCounts };
  });
  return {
    milestones,
    counts,
    tickets: mine.length,
    runs: sessions.filter((session) => session.planRef === planId),
  };
}

/**
 * What a ticket is waiting on, out of the dependencies already recorded on it.
 *
 * Only the ones that are not done: naming a dependency that finished would
 * make a ticket that is ready to start look blocked.
 */
export function waitingOn(ticket: BacklogTicket, tickets: readonly BacklogTicket[]): readonly string[] {
  const done = new Set(tickets.filter((candidate) => candidate.state === "done").map((candidate) => candidate.id));
  return ticket.depends_on.filter((id) => !done.has(id));
}
