// Risk tiers, call ceilings, and the reservation arithmetic.
//
// T0 = 1 call, T1 = 3, T2 = 5 — the DEFAULTS, and the same three the DDL's
// `CHECK (risk_tier IN (0,1,2))` admits tiers for. They are no longer the
// answer: `awsf.config.yaml`'s `risk.call_ceiling` is a real dial, and one
// attempt's ceiling can be raised above its configured value by an explicit
// owner act (`awsf raise`). Both arrive here the same way — as the `resolved`
// argument every function below takes — so this file still reads no config
// file, no quota, no clock, and no provider. Pure arithmetic, applied to a
// number somebody else resolved.
//
// The bound itself is not negotiable. `MAX_CALL_CEILING` caps the dial and the
// grant alike: a ceiling that can be raised is a checkpoint, and a ceiling that
// can be raised without limit is not a ceiling at all.

import { CallCeilingExceeded } from "./errors.ts";

/** `sessions.risk_tier INTEGER NOT NULL CHECK (risk_tier IN (0,1,2))`. */
export type Tier = 0 | 1 | 2;

export const TIERS: readonly Tier[] = [0, 1, 2];

/**
 * T0 read-only analysis gets one call and no second opinion; T1 localized
 * reversible mutation gets three; T2 — security, process control, persistent
 * data, cross-component or weakly-tested work — gets five, which is what pays
 * for the opposite-provider review T2 also mandates.
 *
 * These are the DOCUMENTED DEFAULTS: what `ceilingFor` answers when nothing
 * resolved a ceiling for it, and what `awsf.config.yaml` ships with. An
 * effective configuration overrides them per tier.
 */
export const DEFAULT_CALL_CEILINGS: Readonly<Record<Tier, number>> = { 0: 1, 1: 3, 2: 5 };

/** One ceiling per tier — the shape `risk.call_ceiling` resolves to. */
export type CallCeilings = Readonly<Record<Tier, number>>;

/**
 * Either a whole tier table (the effective configuration) or one already
 * resolved number (an attempt's own ceiling, including any owner grant). Both
 * are "somebody resolved this"; neither is read from a file here.
 */
export type ResolvedCeiling = CallCeilings | number;

/** The smallest honest ceiling: a tier that cannot make one call cannot work. */
export const MIN_CALL_CEILING = 1;

/**
 * The hard bound on every ceiling, configured or granted.
 *
 * Four times T2's default, which no shipped recipe comes near — so it never
 * obstructs an honest raise, and a fat-fingered `50` or a runaway sequence of
 * grants cannot turn a subscription into an unbounded budget. The number is
 * deliberately in code rather than in config: a bound the config could raise
 * would be a bound the config could remove.
 */
export const MAX_CALL_CEILING = 20;

/** Reads `risk.call_ceiling`'s `T0`/`T1`/`T2` keys into the tier-keyed table. */
export function callCeilingsOf(configured: {
  readonly T0: number;
  readonly T1: number;
  readonly T2: number;
}): CallCeilings {
  return { 0: configured.T0, 1: configured.T1, 2: configured.T2 };
}

/**
 * The one place a ceiling number is admitted. Returns it so a caller can write
 * `ceiling = assertCeiling(...)` and never hold an unchecked one.
 */
export function assertCeiling(ceiling: number, subject: string): number {
  if (!Number.isInteger(ceiling) || ceiling < MIN_CALL_CEILING || ceiling > MAX_CALL_CEILING) {
    throw new RangeError(
      `${subject}: a call ceiling is a whole number of calls from ${MIN_CALL_CEILING} through ${MAX_CALL_CEILING}, not ${ceiling}`,
    );
  }
  return ceiling;
}

/**
 * The ceiling for one tier, resolved from whatever the caller was given: the
 * effective configuration's table, one attempt's own effective ceiling, or —
 * when nothing was resolved — the documented default.
 */
export function ceilingFor(tier: Tier, resolved: ResolvedCeiling = DEFAULT_CALL_CEILINGS): number {
  return typeof resolved === "number" ? resolved : resolved[tier];
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
export function fitsCeiling(
  committed: number,
  requested: number,
  tier: Tier,
  resolved?: ResolvedCeiling,
): boolean {
  return committed + requested <= ceilingFor(tier, resolved);
}

/**
 * A workflow whose minimum call count cannot fit the selected tier is rejected
 * BEFORE execution — at compile time, not halfway through, when the refusal
 * would already have cost the calls it is refusing.
 */
export function assertWorkflowFitsTier(
  workflow: WorkflowCallSpec,
  tier: Tier,
  resolved?: ResolvedCeiling,
): void {
  const ceiling = ceilingFor(tier, resolved);
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
