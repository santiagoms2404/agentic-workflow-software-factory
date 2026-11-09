import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIFECYCLE_STATES,
  admitNewFilterValues,
  filterSessions,
  workflowFilterEntries,
  workflowFilterValues,
  type FilterableSession,
} from "../../../dashboard/src/session-filters.ts";
import { PLAN_KINDS } from "../../../dashboard/src/session-plans.ts";

interface TestSession extends FilterableSession {
  readonly sessionId: string;
}

const configuredWorkflows = ["build", "scout"];

const sessions: readonly TestSession[] = [
  { sessionId: "s1", workflowId: "build", state: "LANDED", planKind: "unlinked", groupKey: "g1" },
  { sessionId: "s2", workflowId: "plan", state: "LANDED", planKind: "unlinked", groupKey: "g1" },
  { sessionId: "s3", workflowId: "scout", state: "BLOCKED", planKind: "unlinked", groupKey: "g1" },
  { sessionId: "s4", workflowId: "intake", state: "CANCELLED", planKind: "unlinked", groupKey: "g1" },
];

const states = [...LIFECYCLE_STATES];
const planKinds = [...PLAN_KINDS];
const groups = ["g1"];

test("workflowFilterValues includes unconfigured workflow IDs present in recorded sessions", () => {
  const values = workflowFilterValues(configuredWorkflows, sessions);
  assert.deepEqual(values, ["build", "scout", "plan", "intake"]);
});

test("workflowFilterEntries includes unconfigured workflows and counts runs unconstrained by own filter", () => {
  const entries = workflowFilterEntries(configuredWorkflows, sessions, states, planKinds, groups);
  assert.deepEqual(entries, [
    { value: "build", count: 1 },
    { value: "scout", count: 1 },
    { value: "plan", count: 1 },
    { value: "intake", count: 1 },
  ]);
});

test("unconfigured workflow runs remain visible on board when admitted via admitNewFilterValues", () => {
  const allWorkflowValues = workflowFilterValues(configuredWorkflows, sessions);
  const admitted = admitNewFilterValues(configuredWorkflows, allWorkflowValues, configuredWorkflows);
  const visible = filterSessions(sessions, admitted, states, planKinds, groups);
  assert.equal(visible.length, 4);
  assert.deepEqual(visible.map((s) => s.sessionId), ["s1", "s2", "s3", "s4"]);
});

test("a deselected unconfigured workflow stays deselected across subsequent polls", () => {
  const initialValues = workflowFilterValues(configuredWorkflows, sessions);
  const initialSelected = admitNewFilterValues([], initialValues, []);
  assert.ok(initialSelected.includes("plan"));

  // Reader switches off "plan"
  const userSelected = initialSelected.filter((id) => id !== "plan");
  assert.equal(userSelected.includes("plan"), false);

  // Next poll arrives with same or new sessions
  const nextSessions: readonly TestSession[] = [
    ...sessions,
    { sessionId: "s5", workflowId: "design-to-plan", state: "RUNNING", planKind: "spine", groupKey: "g1" },
  ];
  const nextValues = workflowFilterValues(configuredWorkflows, nextSessions);
  const reconciled = admitNewFilterValues(initialValues, nextValues, userSelected);

  assert.equal(reconciled.includes("plan"), false, "explicit deselection of plan survives");
  assert.ok(reconciled.includes("design-to-plan"), "fresh unconfigured workflow is admitted");
});
