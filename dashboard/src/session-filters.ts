import type { LifecycleState, SessionCard } from "../shared/types.ts";

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
export type FilterableSession = Pick<SessionCard, "workflowId" | "state">;

export interface SessionFilterEntry {
  readonly value: string;
  readonly count: number;
}

export function filterSessions<Session extends FilterableSession>(
  sessions: readonly Session[],
  selectedWorkflows: readonly string[],
  selectedStates: readonly string[],
): readonly Session[] {
  const workflows = new Set(selectedWorkflows);
  const states = new Set(selectedStates);
  return sessions.filter((session) => workflows.has(session.workflowId) && states.has(session.state));
}

/** Workflow counts are constrained only by the other (lifecycle state) filter. */
export function workflowFilterEntries(
  configuredWorkflows: readonly string[],
  sessions: readonly FilterableSession[],
  selectedStates: readonly string[],
): readonly SessionFilterEntry[] {
  const states = new Set(selectedStates);
  return configuredWorkflows.map((workflow) => ({
    value: workflow,
    count: sessions.filter((session) => session.workflowId === workflow && states.has(session.state)).length,
  }));
}

/** State counts are constrained only by the other (workflow) filter. */
export function stateFilterEntries(
  sessions: readonly FilterableSession[],
  selectedWorkflows: readonly string[],
): readonly SessionFilterEntry[] {
  const workflows = new Set(selectedWorkflows);
  return LIFECYCLE_STATES.map((state) => ({
    value: state,
    count: sessions.filter((session) => session.state === state && workflows.has(session.workflowId)).length,
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
