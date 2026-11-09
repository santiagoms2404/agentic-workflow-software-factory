import type { BacklogPlan, BacklogTicket } from "../shared/types.ts";
import {
  selectAllState as filterSelectAllState,
  toggleAllFilterValues,
  toggleFilterValue,
  type SelectAllState,
} from "./session-filters.ts";

export type PlanFilter = "both" | "spine" | "deep";
export type { SelectAllState } from "./session-filters.ts";

export interface BacklogGroup {
  readonly plan: BacklogPlan;
  readonly tickets: readonly BacklogTicket[];
}

export function visiblePlans(
  plans: readonly BacklogPlan[],
  filter: PlanFilter,
): readonly BacklogPlan[] {
  return filter === "both" ? plans : plans.filter((plan) => plan.kind === filter);
}

/** A group is visible only when its plan is selected and admitted by the active filter. */
export function visibleGroups(
  plans: readonly BacklogPlan[],
  tickets: readonly BacklogTicket[],
  selected: readonly string[],
  filter: PlanFilter,
): readonly BacklogGroup[] {
  const selectedIds = new Set(selected);
  return visiblePlans(plans, filter)
    .filter((plan) => selectedIds.has(plan.id))
    .map((plan) => ({
      plan,
      tickets: tickets.filter((ticket) => ticket.plan === plan.id),
    }));
}

/** Select-all state is defined only over cards admitted by the active filter. */
export function selectAllState(
  plans: readonly BacklogPlan[],
  selected: readonly string[],
  filter: PlanFilter,
): SelectAllState {
  return filterSelectAllState(visiblePlans(plans, filter).map((plan) => plan.id), selected);
}

/**
 * What the backlog opens with.
 *
 * Arriving from a sessions-view plan card names one plan, and only that plan is
 * selected: the context the reader was holding when they clicked survives the
 * navigation. Arriving at the backlog directly selects every plan, which is
 * what it has always done. A named plan the catalog does not list falls back to
 * the default rather than opening an empty board with no way to tell why.
 */
export function initialPlanSelection(
  plans: readonly BacklogPlan[],
  requested: string | null | undefined,
): readonly string[] {
  const named = requested !== null && requested !== undefined && plans.some((plan) => plan.id === requested);
  return named ? [requested] : plans.map((plan) => plan.id);
}

export function togglePlan(selected: readonly string[], planId: string): readonly string[] {
  return toggleFilterValue(selected, planId);
}

/** Adds or removes every visible card while preserving hidden selections. */
export function toggleAllPlans(
  plans: readonly BacklogPlan[],
  selected: readonly string[],
  filter: PlanFilter,
): readonly string[] {
  const visibleIds = visiblePlans(plans, filter).map((plan) => plan.id);
  return toggleAllFilterValues(visibleIds, selected);
}
