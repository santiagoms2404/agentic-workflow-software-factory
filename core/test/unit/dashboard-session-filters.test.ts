import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LIFECYCLE_STATES,
  filterSessions,
  planKindFilterEntries,
  selectAllState,
  stateFilterEntries,
  toggleAllFilterValues,
  toggleFilterValue,
  workflowFilterEntries,
  type FilterableSession,
} from "../../../dashboard/src/session-filters.ts";
import { PLAN_KINDS } from "../../../dashboard/src/session-plans.ts";

interface TestSession extends FilterableSession {
  readonly id: string;
}

const sessions = [
  { id: "alpha-running", workflowId: "alpha", state: "RUNNING", planKind: "spine" },
  { id: "alpha-landed", workflowId: "alpha", state: "LANDED", planKind: "deep" },
  { id: "beta-running", workflowId: "beta", state: "RUNNING", planKind: "unlinked" },
] satisfies readonly TestSession[];

const configuredWorkflows = ["alpha", "beta", "configured-without-runs"];

test("the lifecycle menu has all eleven states and exactly matches LifecycleState", () => {
  const source = readFileSync(new URL("../../../dashboard/shared/types.ts", import.meta.url), "utf8");
  const declaration = source.match(/export type LifecycleState\s*=([\s\S]*?);/);
  const unionBody = declaration?.[1];
  assert.ok(unionBody);
  const unionMembers = [...unionBody.matchAll(/\|\s*"([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(LIFECYCLE_STATES, unionMembers);
  assert.equal(LIFECYCLE_STATES.length, 11);
  assert.equal(new Set(LIFECYCLE_STATES).size, 11);
});

test("workflow entries come from configuration and retain workflows with zero sessions", () => {
  assert.deepEqual(
    workflowFilterEntries(configuredWorkflows, sessions, LIFECYCLE_STATES, PLAN_KINDS),
    [
      { value: "alpha", count: 2 },
      { value: "beta", count: 1 },
      { value: "configured-without-runs", count: 0 },
    ],
  );
});

test("all three menus retain every entry while counts reflect only the other filters", () => {
  const workflows = workflowFilterEntries(configuredWorkflows, sessions, ["LANDED"], PLAN_KINDS);
  assert.deepEqual(workflows.map((entry) => entry.value), configuredWorkflows);
  assert.deepEqual(workflows.map((entry) => entry.count), [1, 0, 0]);

  const states = stateFilterEntries(sessions, ["beta"], PLAN_KINDS);
  assert.deepEqual(states.map((entry) => entry.value), LIFECYCLE_STATES);
  assert.equal(states.find((entry) => entry.value === "RUNNING")?.count, 1);
  assert.equal(states.find((entry) => entry.value === "LANDED")?.count, 0);
  assert.equal(states.find((entry) => entry.value === "AWAITING_OWNER")?.count, 0);

  const planKinds = planKindFilterEntries(sessions, configuredWorkflows, LIFECYCLE_STATES);
  assert.deepEqual(planKinds.map((entry) => entry.value), [...PLAN_KINDS]);
  assert.deepEqual(planKinds.map((entry) => entry.count), [1, 1, 1]);
});

test("spine, deep and unlinked counts agree with the rows each one filters", () => {
  for (const kind of PLAN_KINDS) {
    const entry = planKindFilterEntries(sessions, configuredWorkflows, LIFECYCLE_STATES)
      .find((candidate) => candidate.value === kind);
    const rows = filterSessions(sessions, configuredWorkflows, LIFECYCLE_STATES, [kind]);
    assert.equal(entry?.count, rows.length, kind);
  }
  // And the three buckets partition the set: every run is in exactly one, so
  // the counts sum to the board rather than double-counting or dropping a run.
  const total = planKindFilterEntries(sessions, configuredWorkflows, LIFECYCLE_STATES)
    .reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(total, sessions.length);
});

test("a plan-type count narrows with the workflow and state selections beside it", () => {
  const entries = planKindFilterEntries(sessions, ["alpha"], ["RUNNING"]);
  assert.deepEqual(entries.map((entry) => entry.count), [1, 0, 0]);
});

test("sessions must satisfy the workflow, lifecycle and plan-type selections", () => {
  const visible = filterSessions(sessions, ["alpha"], ["RUNNING"], PLAN_KINDS);
  assert.deepEqual(visible.map((session) => session.id), ["alpha-running"]);
  assert.equal(visible.some((session) => session.id === "alpha-landed"), false);
  assert.equal(visible.some((session) => session.id === "beta-running"), false);
  assert.deepEqual(
    filterSessions(sessions, configuredWorkflows, LIFECYCLE_STATES, ["unlinked"]).map((session) => session.id),
    ["beta-running"],
  );
});

test("clearing any one menu empties the session grid", () => {
  assert.deepEqual(filterSessions(sessions, [], LIFECYCLE_STATES, PLAN_KINDS), []);
  assert.deepEqual(filterSessions(sessions, configuredWorkflows, [], PLAN_KINDS), []);
  assert.deepEqual(filterSessions(sessions, configuredWorkflows, LIFECYCLE_STATES, []), []);
});

test("select-all reports none, some, and all over its own entries", () => {
  const entries = ["alpha", "beta"];
  assert.equal(selectAllState(entries, ["outside"]), "none");
  assert.equal(selectAllState(entries, ["alpha", "outside"]), "some");
  assert.equal(selectAllState(entries, ["alpha", "beta", "outside"]), "all");
});

test("individual and select-all toggles preserve literal menu selection", () => {
  assert.deepEqual(toggleFilterValue([], "alpha"), ["alpha"]);
  assert.deepEqual(toggleFilterValue(["alpha"], "alpha"), []);
  assert.deepEqual(toggleAllFilterValues(["alpha", "beta"], ["outside"]), ["outside", "alpha", "beta"]);
  assert.deepEqual(toggleAllFilterValues(["alpha", "beta"], ["outside", "alpha", "beta"]), ["outside"]);
});
