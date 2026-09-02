import assert from "node:assert/strict";
import { test } from "node:test";
import type { BacklogPlan, BacklogTicket, TicketState } from "../../../dashboard/shared/types.ts";
import {
  selectAllState,
  toggleAllPlans,
  visibleGroups,
  visiblePlans,
} from "../../../dashboard/src/backlog-selection.ts";

const counts = (todo: number): Readonly<Record<TicketState, number>> => ({ todo, wip: 0, done: 0, failed: 0 });
const plans: readonly BacklogPlan[] = [
  { id: "spine", name: "Spine", kind: "spine", parentSpine: null, parentSpineName: null, counts: counts(1), ticketCount: 1 },
  { id: "deep-a", name: "Deep A", kind: "deep", parentSpine: "spine", parentSpineName: "Spine", counts: counts(1), ticketCount: 1 },
  { id: "deep-b", name: "Deep B", kind: "deep", parentSpine: "spine", parentSpineName: "Spine", counts: counts(1), ticketCount: 1 },
];
const tickets: readonly BacklogTicket[] = plans.map((plan) => ({
  uid: `${plan.id}/T01`,
  plan: plan.id,
  id: "T01",
  title: `${plan.name} ticket`,
  milestone: "M1",
  state: "todo",
  depends_on: [],
  ready: true,
}));

test("no selection renders no tickets and two selected plans remain separate groups", () => {
  assert.deepEqual(visibleGroups(plans, tickets, [], "both"), []);
  const groups = visibleGroups(plans, tickets, ["deep-a", "spine"], "both");
  assert.deepEqual(groups.map((group) => group.plan.id), ["spine", "deep-a"]);
  assert.deepEqual(groups.map((group) => group.tickets.map((ticket) => ticket.uid)), [
    ["spine/T01"],
    ["deep-a/T01"],
  ]);
});

test("switching from selected deep plans to the spine filter removes every deep ticket group", () => {
  const selected = ["deep-a", "deep-b"];
  assert.deepEqual(visiblePlans(plans, "deep").map((plan) => plan.id), selected);
  assert.equal(selectAllState(plans, selected, "deep"), "all");
  assert.equal(visibleGroups(plans, tickets, selected, "deep").length, 2);

  assert.deepEqual(visibleGroups(plans, tickets, selected, "spine"), []);
  assert.equal(selectAllState(plans, selected, "spine"), "none");
  assert.deepEqual(toggleAllPlans(plans, selected, "spine"), ["deep-a", "deep-b", "spine"]);
  assert.equal(selectAllState(plans, ["deep-a", "deep-b", "spine"], "spine"), "all");
});
