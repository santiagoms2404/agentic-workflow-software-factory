import type { CostAuthority, PlanKind, SessionCard, SessionPlan } from "../shared/types.ts";

/**
 * The three buckets a run falls into on the sessions view.
 *
 * `unlinked` is "this run names no plan the catalog lists", which covers both a
 * run created without `--plan` and one whose recorded plan the catalog no longer
 * registers. One bucket rather than two on purpose: the filter's contract is
 * that its counts add up to the rows it filters, and a fourth bucket that is
 * empty on every real projection would be a control nobody can exercise.
 */
export const PLAN_KINDS = ["spine", "deep", "unlinked"] as const;

export type PlanKindFilter = (typeof PLAN_KINDS)[number];

export interface PlannedSession {
  readonly planRef: string | null;
  readonly planKind: PlanKindFilter;
}

export interface SessionPlanCard {
  readonly plan: SessionPlan;
  readonly runs: number;
  readonly cost: PlanRunCost;
}

/** Same disclosure rule the backlog's projected cost uses, applied to runs. */
export interface PlanRunCost {
  readonly usd: number | null;
  readonly authority: CostAuthority;
  /** A missing or mixed source is disclosed, never rendered as zero. */
  readonly partial: boolean;
}

export function planKindOf(planRef: string | null, plans: readonly SessionPlan[]): PlanKindFilter {
  if (planRef === null) return "unlinked";
  const plan = plans.find((candidate) => candidate.id === planRef);
  return plan === undefined ? "unlinked" : plan.kind;
}

/** Annotates each run with its bucket once, so every count reads the same field. */
export function withPlanKind<Session extends Pick<SessionCard, "planRef">>(
  sessions: readonly Session[],
  plans: readonly SessionPlan[],
): readonly (Session & PlannedSession)[] {
  return sessions.map((session) => ({
    ...session,
    planRef: session.planRef,
    planKind: planKindOf(session.planRef, plans),
  }));
}

/**
 * Unknown stays unknown. One run without a provider or catalog number, or two
 * runs whose numbers came from different authorities, make the total
 * unavailable rather than a confident sum of the rows that happened to have one.
 */
export function planRunCost(
  sessions: readonly Pick<SessionCard, "usage">[],
): PlanRunCost {
  if (sessions.length === 0) return { usd: null, authority: "unavailable", partial: true };
  const authorities = new Set(sessions.map((session) => session.usage.costAuthority));
  if (
    authorities.size !== 1
    || authorities.has("unavailable")
    || sessions.some((session) => session.usage.estimatedCostUsd === null || session.usage.costPartial)
  ) {
    return { usd: null, authority: "unavailable", partial: true };
  }
  return {
    usd: sessions.reduce((total, session) => total + (session.usage.estimatedCostUsd ?? 0), 0),
    authority: [...authorities][0] as CostAuthority,
    partial: false,
  };
}

/**
 * One card per registered plan that has runs, plus nothing for the ones that do
 * not: a card claiming zero runs for a plan is backlog information, and the
 * backlog already renders it against the tickets it actually knows about.
 */
export function sessionPlanCards(
  sessions: readonly (Pick<SessionCard, "planRef" | "usage">)[],
  plans: readonly SessionPlan[],
): readonly SessionPlanCard[] {
  return plans.flatMap((plan) => {
    const runs = sessions.filter((session) => session.planRef === plan.id);
    return runs.length === 0 ? [] : [{ plan, runs: runs.length, cost: planRunCost(runs) }];
  });
}

export function planKindLabel(kind: PlanKindFilter): string {
  return kind === "unlinked" ? "no registered plan" : kind;
}

export type { PlanKind };
