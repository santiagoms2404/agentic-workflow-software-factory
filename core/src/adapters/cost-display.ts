// What a run is allowed to say it cost.
//
// `costAuthority` and `usageAuthority` are separate fields on `ModelInfo` for
// one reason, and this file is where that reason becomes visible: Claude Pro
// measures tokens authoritatively and cannot price them at all, because what a
// subscription run cost is a share of a monthly fee and not a figure any
// provider can report. Rendering that as `$0.00` would be a measured-looking
// zero where there is no measurement — the single most misleading thing a cost
// chip can say, because it is indistinguishable from a genuinely free call.
//
// So `unavailable` renders as an em-dash and a word, never as a number: the
// dash says "not priced", the word says why.

import type { ModelInfo } from "./interface.ts";

/** A route whose price is a subscription, not a figure. */
export const SUBSCRIPTION_COST_DISPLAY = "— subscription";

/** An authority that has a figure but has not reported one yet. */
export const UNREPORTED_COST_DISPLAY = "—";

/**
 * Renders a run's cost with its authority visible.
 *
 * The amount is IGNORED for `unavailable` rather than merely unused: a caller
 * that has a number in hand — the Claude CLI does report a `total_cost_usd`
 * API-list-price estimate — must not be able to get it displayed by passing it
 * to a route that has already said it cannot price itself.
 */
export function formatCost(costAuthority: ModelInfo["costAuthority"], usd: number | null): string {
  if (costAuthority === "unavailable") return SUBSCRIPTION_COST_DISPLAY;
  if (usd === null || !Number.isFinite(usd)) return UNREPORTED_COST_DISPLAY;
  const amount = `$${usd.toFixed(2)}`;
  // An estimate is marked as one. A catalog price is arithmetic on a rate card,
  // not something the provider confirmed it charged.
  return costAuthority === "catalog-estimate" ? `≈ ${amount}` : amount;
}
