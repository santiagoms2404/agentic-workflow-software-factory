import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LIFECYCLE_STATES,
  admitNewFilterValues,
  filterSessions,
  planKindFilterEntries,
  selectAllState,
  stateFilterEntries,
  toggleAllFilterValues,
  toggleFilterValue,
  workflowFilterEntries,
  type FilterableSession,
} from "../../../dashboard/src/session-filters.ts";
import { NO_DRIVING_SESSION } from "../../../dashboard/src/session-groups.ts";
import { PLAN_KINDS } from "../../../dashboard/src/session-plans.ts";

interface TestSession extends FilterableSession {
  readonly id: string;
}

const sessions = [
  { id: "alpha-running", workflowId: "alpha", state: "RUNNING", planKind: "spine", groupKey: "drive-a" },
  { id: "alpha-landed", workflowId: "alpha", state: "LANDED", planKind: "deep", groupKey: "drive-b" },
  { id: "beta-running", workflowId: "beta", state: "RUNNING", planKind: "unlinked", groupKey: NO_DRIVING_SESSION },
] satisfies readonly TestSession[];

const configuredWorkflows = ["alpha", "beta", "configured-without-runs"];
const allGroups = ["drive-a", "drive-b", NO_DRIVING_SESSION];

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
    workflowFilterEntries(configuredWorkflows, sessions, LIFECYCLE_STATES, PLAN_KINDS, allGroups),
    [
      { value: "alpha", count: 2 },
      { value: "beta", count: 1 },
      { value: "configured-without-runs", count: 0 },
    ],
  );
});

test("a fourth menu narrows the other three, and they narrow it back", () => {
  // The convention the first three already keep: a menu's own selection never
  // constrains its own counts, and every other selection does.
  const workflows = workflowFilterEntries(configuredWorkflows, sessions, LIFECYCLE_STATES, PLAN_KINDS, ["drive-a"]);
  assert.deepEqual(workflows.map((entry) => entry.count), [1, 0, 0]);
  const states = stateFilterEntries(sessions, configuredWorkflows, PLAN_KINDS, [NO_DRIVING_SESSION]);
  assert.equal(states.find((entry) => entry.value === "RUNNING")?.count, 1);
  assert.equal(states.find((entry) => entry.value === "LANDED")?.count, 0);
  const planKinds = planKindFilterEntries(sessions, configuredWorkflows, LIFECYCLE_STATES, ["drive-b"]);
  assert.deepEqual(planKinds.map((entry) => entry.count), [0, 1, 0]);

  assert.deepEqual(
    filterSessions(sessions, configuredWorkflows, LIFECYCLE_STATES, PLAN_KINDS, ["drive-a"]).map((session) => session.id),
    ["alpha-running"],
  );
  // Clearing the fourth menu empties the board exactly as clearing any other does.
  assert.deepEqual(filterSessions(sessions, configuredWorkflows, LIFECYCLE_STATES, PLAN_KINDS, []), []);
});

test("a driving session nobody has seen before defaults to selected, and a switched-off one stays off", () => {
  // The other three menus have a fixed vocabulary, so seeding once is enough.
  // Groups arrive while the board is open: a selection seeded once would hide
  // the runs naming a new one with no control on screen admitting to it.
  assert.deepEqual(admitNewFilterValues([], ["drive-a", "drive-b"], []), ["drive-a", "drive-b"]);
  assert.deepEqual(
    admitNewFilterValues(["drive-a", "drive-b"], ["drive-a", "drive-b", "drive-c"], ["drive-a"]),
    ["drive-a", "drive-c"],
    "drive-b was switched off by the reader and stays off; drive-c is new and is admitted",
  );
  // Nothing new means nothing changes, identity included, so a poll that adds
  // no session cannot churn the selection and reorder the board under a reader.
  const selected = ["drive-a"];
  assert.equal(admitNewFilterValues(["drive-a"], ["drive-a"], selected), selected);
});

test("all three menus retain every entry while counts reflect only the other filters", () => {
  const workflows = workflowFilterEntries(configuredWorkflows, sessions, ["LANDED"], PLAN_KINDS, allGroups);
  assert.deepEqual(workflows.map((entry) => entry.value), configuredWorkflows);
  assert.deepEqual(workflows.map((entry) => entry.count), [1, 0, 0]);

  const states = stateFilterEntries(sessions, ["beta"], PLAN_KINDS, allGroups);
  assert.deepEqual(states.map((entry) => entry.value), LIFECYCLE_STATES);
  assert.equal(states.find((entry) => entry.value === "RUNNING")?.count, 1);
  assert.equal(states.find((entry) => entry.value === "LANDED")?.count, 0);
  assert.equal(states.find((entry) => entry.value === "AWAITING_OWNER")?.count, 0);

  const planKinds = planKindFilterEntries(sessions, configuredWorkflows, LIFECYCLE_STATES, allGroups);
  assert.deepEqual(planKinds.map((entry) => entry.value), [...PLAN_KINDS]);
  assert.deepEqual(planKinds.map((entry) => entry.count), [1, 1, 1]);
});

test("spine, deep and unlinked counts agree with the rows each one filters", () => {
  for (const kind of PLAN_KINDS) {
    const entry = planKindFilterEntries(sessions, configuredWorkflows, LIFECYCLE_STATES, allGroups)
      .find((candidate) => candidate.value === kind);
    const rows = filterSessions(sessions, configuredWorkflows, LIFECYCLE_STATES, [kind], allGroups);
    assert.equal(entry?.count, rows.length, kind);
  }
  // And the three buckets partition the set: every run is in exactly one, so
  // the counts sum to the board rather than double-counting or dropping a run.
  const total = planKindFilterEntries(sessions, configuredWorkflows, LIFECYCLE_STATES, allGroups)
    .reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(total, sessions.length);
});

test("a plan-type count narrows with the workflow and state selections beside it", () => {
  const entries = planKindFilterEntries(sessions, ["alpha"], ["RUNNING"], allGroups);
  assert.deepEqual(entries.map((entry) => entry.count), [1, 0, 0]);
});

test("sessions must satisfy the workflow, lifecycle and plan-type selections", () => {
  const visible = filterSessions(sessions, ["alpha"], ["RUNNING"], PLAN_KINDS, allGroups);
  assert.deepEqual(visible.map((session) => session.id), ["alpha-running"]);
  assert.equal(visible.some((session) => session.id === "alpha-landed"), false);
  assert.equal(visible.some((session) => session.id === "beta-running"), false);
  assert.deepEqual(
    filterSessions(sessions, configuredWorkflows, LIFECYCLE_STATES, ["unlinked"], allGroups).map((session) => session.id),
    ["beta-running"],
  );
});

test("clearing any one menu empties the session grid", () => {
  assert.deepEqual(filterSessions(sessions, [], LIFECYCLE_STATES, PLAN_KINDS, allGroups), []);
  assert.deepEqual(filterSessions(sessions, configuredWorkflows, [], PLAN_KINDS, allGroups), []);
  assert.deepEqual(filterSessions(sessions, configuredWorkflows, LIFECYCLE_STATES, [], allGroups), []);
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
