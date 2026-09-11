import type { LifecycleState, SessionCard } from "../shared/types.ts";
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
export type FilterableSession = Pick<SessionCard, "workflowId" | "state"> & Pick<PlannedSession, "planKind">;

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
): readonly Session[] {
  const workflows = new Set(selectedWorkflows);
  const states = new Set(selectedStates);
  const planKinds = new Set(selectedPlanKinds);
  return sessions.filter((session) =>
    workflows.has(session.workflowId) && states.has(session.state) && planKinds.has(session.planKind));
}

/** Workflow counts are constrained only by the OTHER filters, never by their own. */
export function workflowFilterEntries(
  configuredWorkflows: readonly string[],
  sessions: readonly FilterableSession[],
  selectedStates: readonly string[],
  selectedPlanKinds: readonly string[],
): readonly SessionFilterEntry[] {
  const states = new Set(selectedStates);
  const planKinds = new Set(selectedPlanKinds);
  return configuredWorkflows.map((workflow) => ({
    value: workflow,
    count: sessions.filter((session) =>
      session.workflowId === workflow && states.has(session.state) && planKinds.has(session.planKind)).length,
  }));
}

/** State counts are constrained only by the other filters. */
export function stateFilterEntries(
  sessions: readonly FilterableSession[],
  selectedWorkflows: readonly string[],
  selectedPlanKinds: readonly string[],
): readonly SessionFilterEntry[] {
  const workflows = new Set(selectedWorkflows);
  const planKinds = new Set(selectedPlanKinds);
  return LIFECYCLE_STATES.map((state) => ({
    value: state,
    count: sessions.filter((session) =>
      session.state === state && workflows.has(session.workflowId) && planKinds.has(session.planKind)).length,
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
): readonly SessionFilterEntry[] {
  const workflows = new Set(selectedWorkflows);
  const states = new Set(selectedStates);
  return PLAN_KINDS.map((kind: PlanKindFilter) => ({
    value: kind,
    count: sessions.filter((session) =>
      session.planKind === kind && workflows.has(session.workflowId) && states.has(session.state)).length,
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
