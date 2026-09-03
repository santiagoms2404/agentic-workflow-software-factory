import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LIFECYCLE_STATES,
  filterSessions,
  selectAllState,
  stateFilterEntries,
  toggleAllFilterValues,
  toggleFilterValue,
  workflowFilterEntries,
  type FilterableSession,
} from "../../../dashboard/src/session-filters.ts";

interface TestSession extends FilterableSession {
  readonly id: string;
}

const sessions = [
  { id: "alpha-running", workflowId: "alpha", state: "RUNNING" },
  { id: "alpha-landed", workflowId: "alpha", state: "LANDED" },
  { id: "beta-running", workflowId: "beta", state: "RUNNING" },
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
    workflowFilterEntries(configuredWorkflows, sessions, LIFECYCLE_STATES),
    [
      { value: "alpha", count: 2 },
      { value: "beta", count: 1 },
      { value: "configured-without-runs", count: 0 },
    ],
  );
});

test("both menus retain every entry while counts reflect only the other filter", () => {
  const workflows = workflowFilterEntries(configuredWorkflows, sessions, ["LANDED"]);
  assert.deepEqual(workflows.map((entry) => entry.value), configuredWorkflows);
  assert.deepEqual(workflows.map((entry) => entry.count), [1, 0, 0]);

  const states = stateFilterEntries(sessions, ["beta"]);
  assert.deepEqual(states.map((entry) => entry.value), LIFECYCLE_STATES);
  assert.equal(states.find((entry) => entry.value === "RUNNING")?.count, 1);
  assert.equal(states.find((entry) => entry.value === "LANDED")?.count, 0);
  assert.equal(states.find((entry) => entry.value === "AWAITING_OWNER")?.count, 0);
});

test("sessions must satisfy the workflow and lifecycle selections", () => {
  const visible = filterSessions(sessions, ["alpha"], ["RUNNING"]);
  assert.deepEqual(visible.map((session) => session.id), ["alpha-running"]);
  assert.equal(visible.some((session) => session.id === "alpha-landed"), false);
  assert.equal(visible.some((session) => session.id === "beta-running"), false);
});

test("clearing either menu empties the session grid", () => {
  assert.deepEqual(filterSessions(sessions, [], LIFECYCLE_STATES), []);
  assert.deepEqual(filterSessions(sessions, configuredWorkflows, []), []);
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
