// Risk tiers, call ceilings, and the reservation arithmetic.
//
// T0 = 1 call, T1 = 3, T2 = 5 — the same numbers `awsf.config.yaml` carries as
// `risk.tier_ceilings` and the same three the DDL's
// `CHECK (risk_tier IN (0,1,2))` admits. Pure arithmetic: nothing here reads a
// quota, a clock, or a provider.

import { CallCeilingExceeded } from "./errors.ts";

/** `sessions.risk_tier INTEGER NOT NULL CHECK (risk_tier IN (0,1,2))`. */
export type Tier = 0 | 1 | 2;

export const TIERS: readonly Tier[] = [0, 1, 2];

/**
 * T0 read-only analysis gets one call and no second opinion; T1 localized
 * reversible mutation gets three; T2 — security, process control, persistent
 * data, cross-component or weakly-tested work — gets five, which is what pays
 * for the opposite-provider review T2 also mandates.
 */
export const CALL_CEILINGS: Readonly<Record<Tier, number>> = { 0: 1, 1: 3, 2: 5 };

export function ceilingFor(tier: Tier): number {
  return CALL_CEILINGS[tier];
}

/**
 * A composite (fusion) adapter declares its FULL cost in advance: two workers
 * plus a fuser reserve three calls before any of the three launch. Discovering
 * the ceiling after the first two have already burned quota is the failure
 * this declaration exists to prevent.
 */
export function compositeCost(workerCount: number): number {
  return workerCount + 1;
}

export interface WorkflowCallSpec {
  id: string;
  /** PROVIDER calls only. `code` and `engineer` phases run on the host and reserve nothing. */
  minimumCalls: number;
}

/**
 * Reserve-before-launch, counted against spend AND outstanding reservations,
 * so two concurrent paths cannot both slip under the ceiling by reading a
 * spend counter that has not caught up yet.
 *
 * `committed` is task-lifetime, not attempt-lifetime: spend carries across
 * attempts, so a task cannot buy an unlimited budget by failing repeatedly.
 */
export function fitsCeiling(committed: number, requested: number, tier: Tier): boolean {
  return committed + requested <= ceilingFor(tier);
}

/**
 * A workflow whose minimum call count cannot fit the selected tier is rejected
 * BEFORE execution — at compile time, not halfway through, when the refusal
 * would already have cost the calls it is refusing.
 */
export function assertWorkflowFitsTier(workflow: WorkflowCallSpec, tier: Tier): void {
  const ceiling = ceilingFor(tier);
  if (workflow.minimumCalls > ceiling) {
    throw new CallCeilingExceeded({
      from: null,
      to: null,
      subject: `workflow ${workflow.id} at T${tier}`,
      tier,
      ceiling,
      requested: workflow.minimumCalls,
      committed: 0,
    });
  }
}
