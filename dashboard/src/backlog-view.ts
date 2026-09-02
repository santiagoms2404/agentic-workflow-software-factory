import type { BacklogTicket, TicketsResponse } from "../shared/types.ts";

export const BUILD_PROMPT_HEADING = "## Build prompt";

export interface BuildPromptBlock {
  readonly headingOffset: number;
  readonly text: string;
}

export interface TicketSourceView {
  readonly source: string;
  readonly buildPrompt: BuildPromptBlock | null;
}

/** The blocked metric and ticket label deliberately share this one predicate. */
export function isBlockedTicket(ticket: Pick<BacklogTicket, "ready" | "state">): boolean {
  return !ticket.ready && ticket.state === "todo";
}

export function countBlockedTickets(tickets: readonly Pick<BacklogTicket, "ready" | "state">[]): number {
  return tickets.filter(isBlockedTicket).length;
}

/**
 * Resolves the contractual prompt section by its heading. The returned bytes
 * start after the heading's blank line and otherwise remain untouched.
 */
export function buildPromptBlock(source: string): BuildPromptBlock | null {
  const heading = /(?:^|\n)## Build prompt(?:\r?\n|$)/u.exec(source);
  if (heading === null) return null;
  const headingOffset = heading.index + (heading[0].startsWith("\n") ? 1 : 0);
  let contentOffset = headingOffset + BUILD_PROMPT_HEADING.length;
  if (source.startsWith("\r\n\r\n", contentOffset)) contentOffset += 4;
  else if (source.startsWith("\n\n", contentOffset)) contentOffset += 2;
  else return null;
  return { headingOffset, text: source.slice(contentOffset) };
}

/** Keeps the source bytes and the heading-anchored copy target in one view model. */
export function ticketSourceView(source: string): TicketSourceView {
  return { source, buildPrompt: buildPromptBlock(source) };
}

export function projectedCostText(cost: TicketsResponse["projectedCost"]): string | null {
  return cost.partial || cost.usd === null ? "Cost data unavailable" : null;
}
