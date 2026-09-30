// Earned autonomy, computed at read time (W19 task 6, DD6, Q8).
//
// Code-decided acts (raise, resume, wait-until, cancel) are live from the
// first lease. A judgment act (rework, replacement-review, degrade-review,
// route-fallback, continue) unlocks on its own when at least 7 of its last 8
// paired proposals matched, live shadow and replay pairs both counted and
// labeled. The owner's `autonomy all` switch unlocks every judgment act for
// that lease and is reported as owner-all, never as earned. land-shadow never
// unlocks. No tally is stored: every number here comes from the pairs passed in.

import type { Pair, PairSource } from "./agreement.ts";
import type { ProposedActName } from "./policy.ts";

export const CODE_DECIDED_ACTS = ["raise", "resume", "wait-until", "cancel"] as const;
export const JUDGMENT_ACTS = ["rework", "replacement-review", "degrade-review", "route-fallback", "continue"] as const;
export type CodeDecidedAct = (typeof CODE_DECIDED_ACTS)[number];
export type JudgmentAct = (typeof JUDGMENT_ACTS)[number];

/** The window and the bar: at least EARN_MATCHES of the last EARN_WINDOW paired proposals. */
export const EARN_WINDOW = 8;
export const EARN_MATCHES = 7;

/** A lease's autonomy setting. `null` means no lease: nothing is live. */
export type LeaseAutonomy = "earned" | "all" | null;

export type AutonomyBasis =
  | "no-lease"
  | "code-decided"
  | "earned"
  | "owner-all"
  | "not-earned"
  | "never";

export interface AutonomyReport {
  readonly act: ProposedActName;
  readonly live: boolean;
  readonly basis: AutonomyBasis;
  /** The act's last paired proposals (at most EARN_WINDOW, outcome match or mismatch), oldest first. */
  readonly window: readonly Pair[];
  readonly matched: number;
  /** How many of the window came from each source. */
  readonly sources: Readonly<Record<PairSource, number>>;
}

function isCodeDecided(act: ProposedActName): act is CodeDecidedAct {
  return (CODE_DECIDED_ACTS as readonly string[]).includes(act);
}

function isJudgment(act: ProposedActName): act is JudgmentAct {
  return (JUDGMENT_ACTS as readonly string[]).includes(act);
}

/** The act's last EARN_WINDOW paired proposals, ordered by proposal time, then source and id for ties. */
export function earningWindow(act: ProposedActName, pairs: readonly Pair[]): Pair[] {
  return pairs
    .filter((pair) => pair.proposedAct === act && pair.outcome !== "none")
    .sort((left, right) => left.at.localeCompare(right.at) || left.source.localeCompare(right.source) || left.proposalId.localeCompare(right.proposalId))
    .slice(-EARN_WINDOW);
}

/**
 * Whether the Delegate may take `act` under a lease with `leaseAutonomy`, and
 * why. The window is reported for every act, so the owner sees the evidence
 * even where it does not decide anything.
 *
 * Earning needs a full window: seven matches among fewer than eight pairs is
 * not "7 of the last 8".
 */
export function autonomyFor(act: ProposedActName, pairs: readonly Pair[], leaseAutonomy: LeaseAutonomy): AutonomyReport {
  const window = earningWindow(act, pairs);
  const matched = window.filter((pair) => pair.outcome === "match").length;
  const sources = {
    live: window.filter((pair) => pair.source === "live").length,
    replay: window.filter((pair) => pair.source === "replay").length,
  };
  const report = (live: boolean, basis: AutonomyBasis): AutonomyReport =>
    Object.freeze({ act, live, basis, window: Object.freeze(window), matched, sources: Object.freeze(sources) });

  // Never first: no lease, switch or history reaches these.
  if (act === "land-shadow" || act === "wait-for-owner") return report(false, "never");
  if (leaseAutonomy === null) return report(false, "no-lease");
  if (isCodeDecided(act)) return report(true, "code-decided");
  if (!isJudgment(act)) return report(false, "never");
  if (leaseAutonomy === "all") return report(true, "owner-all");
  return window.length === EARN_WINDOW && matched >= EARN_MATCHES ? report(true, "earned") : report(false, "not-earned");
}
