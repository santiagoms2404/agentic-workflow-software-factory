import type { LifecycleState, SessionCard } from "../shared/types.ts";
import type { GroupedSession } from "./session-groups.ts";
import { PLAN_KINDS, type PlanKindFilter, type PlannedSession } from "./session-plans.ts";

export const LIFECYCLE_STATES = [
  "DRAFT",
  "PREPARED",
  "RUNNING",
  "GATING",
  "REVIEWING",
  "AWAITING_OWNER",
  "LANDING",
  "LANDED",
  "PUBLISHED",
  "BLOCKED",
  "CANCELLED",
] as const satisfies readonly LifecycleState[];

type SameMembers<Left, Right> = [Exclude<Left, Right>, Exclude<Right, Left>] extends [never, never]
  ? true
  : false;
type Assert<T extends true> = T;
export type LifecycleStateMenuIsExhaustive = Assert<
  SameMembers<LifecycleState, (typeof LIFECYCLE_STATES)[number]>
>;

export type SelectAllState = "none" | "some" | "all";
/**
 * `planKind` is annotated rather than read off the row: the plan cards and this
 * filter both have to bucket a run the same way, and deriving it twice is how
 * the counts and the rows start to disagree. `withPlanKind` does it once.
 */
export type FilterableSession =
  Pick<SessionCard, "workflowId" | "state">
  & Pick<PlannedSession, "planKind">
  & Pick<GroupedSession, "groupKey">;

export interface SessionFilterEntry {
  readonly value: string;
  readonly count: number;
  /** Display text when the value itself is not what a reader should see. */
  readonly label?: string;
}

export function filterSessions<Session extends FilterableSession>(
  sessions: readonly Session[],
  selectedWorkflows: readonly string[],
  selectedStates: readonly string[],
  selectedPlanKinds: readonly string[],
  selectedGroups: readonly string[],
): readonly Session[] {
  const matches = matchesSelections(selectedWorkflows, selectedStates, selectedPlanKinds, selectedGroups);
  return sessions.filter((session) => matches(session));
}

/**
 * One predicate over the four menus, so a caller that needs "everything but my
 * own filter" composes it from the same source the board filters with. Four
 * menus is where restating the conjunction per entry function stops being
 * cheap and starts being a place for them to disagree.
 */
export function matchesSelections(
  selectedWorkflows: readonly string[],
  selectedStates: readonly string[],
  selectedPlanKinds: readonly string[],
  selectedGroups: readonly string[],
): (session: FilterableSession) => boolean {
  const workflows = new Set(selectedWorkflows);
  const states = new Set(selectedStates);
  const planKinds = new Set(selectedPlanKinds);
  const groups = new Set(selectedGroups);
  return (session) =>
    workflows.has(session.workflowId)
    && states.has(session.state)
    && planKinds.has(session.planKind)
    && groups.has(session.groupKey);
}

/**
 * A menu value nobody has seen before defaults to selected.
 *
 * The other three menus draw on a fixed vocabulary — configured workflows, the
 * eleven lifecycle states, the three plan buckets — so seeding the selection
 * once is enough. Driving sessions are not fixed: a run created while the
 * board is open carries a group id that was not in the first response, and a
 * selection seeded once would exclude it, hiding that run with no control on
 * screen that admits to hiding it.
 *
 * Admitting only values that are NEW keeps an explicit deselection: a value
 * the reader has already seen and switched off stays off across every poll.
 */
export function admitNewFilterValues(
  known: readonly string[],
  current: readonly string[],
  selected: readonly string[],
): readonly string[] {
  const seen = new Set(known);
  const fresh = current.filter((value) => !seen.has(value));
  return fresh.length === 0 ? selected : [...new Set([...selected, ...fresh])];
}

/** Workflow counts are constrained only by the OTHER filters, never by their own. */
export function workflowFilterEntries(
  configuredWorkflows: readonly string[],
  sessions: readonly FilterableSession[],
  selectedStates: readonly string[],
  selectedPlanKinds: readonly string[],
  selectedGroups: readonly string[],
): readonly SessionFilterEntry[] {
  const others = matchesSelections(configuredWorkflows, selectedStates, selectedPlanKinds, selectedGroups);
  return configuredWorkflows.map((workflow) => ({
    value: workflow,
    count: sessions.filter((session) => session.workflowId === workflow && others(session)).length,
  }));
}

/** State counts are constrained only by the other filters. */
export function stateFilterEntries(
  sessions: readonly FilterableSession[],
  selectedWorkflows: readonly string[],
  selectedPlanKinds: readonly string[],
  selectedGroups: readonly string[],
): readonly SessionFilterEntry[] {
  const others = matchesSelections(selectedWorkflows, LIFECYCLE_STATES, selectedPlanKinds, selectedGroups);
  return LIFECYCLE_STATES.map((state) => ({
    value: state,
    count: sessions.filter((session) => session.state === state && others(session)).length,
  }));
}

/**
 * Plan-type counts, constrained only by the other filters, over the same three
 * buckets every run falls into. Fixed rather than data-derived so a bucket that
 * is momentarily empty stays on screen as a zero instead of vanishing and
 * taking its runs' only route back with it.
 */
export function planKindFilterEntries(
  sessions: readonly FilterableSession[],
  selectedWorkflows: readonly string[],
  selectedStates: readonly string[],
  selectedGroups: readonly string[],
): readonly SessionFilterEntry[] {
  const others = matchesSelections(selectedWorkflows, selectedStates, PLAN_KINDS, selectedGroups);
  return PLAN_KINDS.map((kind: PlanKindFilter) => ({
    value: kind,
    count: sessions.filter((session) => session.planKind === kind && others(session)).length,
  }));
}

/** Select-all state is defined only over the supplied menu entries. */
export function selectAllState(
  entryValues: readonly string[],
  selected: readonly string[],
): SelectAllState {
  const entries = [...new Set(entryValues)];
  const selectedValues = new Set(selected);
  const count = entries.filter((value) => selectedValues.has(value)).length;
  if (count === 0) return "none";
  return count === entries.length ? "all" : "some";
}

export function toggleFilterValue(selected: readonly string[], value: string): readonly string[] {
  return selected.includes(value)
    ? selected.filter((selectedValue) => selectedValue !== value)
    : [...selected, value];
}

/** Adds or removes all supplied menu entries while preserving outside selections. */
export function toggleAllFilterValues(
  entryValues: readonly string[],
  selected: readonly string[],
): readonly string[] {
  const entries = [...new Set(entryValues)];
  const entrySet = new Set(entries);
  if (selectAllState(entries, selected) === "all") {
    return selected.filter((value) => !entrySet.has(value));
  }
  return [...new Set([...selected, ...entries])];
}
