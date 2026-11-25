import { canonicalCheckoutDirt, systemGitRunner } from "../git/changes.ts";
import { assertSelectedTicketFiles } from "../persistence/ticket-bytes.ts";
import type { TicketSelection } from "../contracts/ticket-selection-record.ts";

export class CanonicalCheckoutNotClean extends Error {
  constructor(paths: string) {
    super(`canonical checkout is not clean: ${paths}`);
    this.name = "CanonicalCheckoutNotClean";
  }
}

/** Refuse before baseline gates, attempt worktree creation or provider contact. */
export async function assertPreparationCheckout(input: {
  readonly repository: string;
  readonly ticketSelection?: TicketSelection | null;
}): Promise<void> {
  if (input.ticketSelection != null) await assertSelectedTicketFiles(input.repository, input.ticketSelection.tickets);
  // trap-refusal-begin TR-23
  const dirty = canonicalCheckoutDirt(systemGitRunner(input.repository));
  if (dirty !== null) throw new CanonicalCheckoutNotClean(dirty);
  // trap-refusal-end TR-23
}
