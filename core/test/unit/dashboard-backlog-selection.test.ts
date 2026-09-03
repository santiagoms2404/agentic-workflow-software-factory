import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { queryPlanBacklog } from "../../src/backlog.ts";
import { PlanTicketReader } from "../../src/persistence/plan-tickets.ts";
import { loadCatalog } from "../../src/registry/catalog.ts";
import { resolvePlanSources } from "../../src/registry/plan-source.ts";
import type { BacklogPlan, BacklogTicket, TicketState } from "../../../dashboard/shared/types.ts";
import {
  selectAllState,
  toggleAllPlans,
  togglePlan,
  visibleGroups,
  visiblePlans,
  type PlanFilter,
} from "../../../dashboard/src/backlog-selection.ts";
import { countBlockedTickets } from "../../../dashboard/src/backlog-view.ts";
import { repoRoot } from "./meta/_walk.ts";

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

async function repositoryBacklog() {
  const catalogPath = join(repoRoot(), "awsf.project.yaml");
  const sources = resolvePlanSources(catalogPath, loadCatalog(readFileSync(catalogPath, "utf8")));
  return queryPlanBacklog(new PlanTicketReader(sources), []);
}

test("no selection renders no groups for every filter; full selection drives current-corpus metrics", async () => {
  const backlog = await repositoryBacklog();
  for (const filter of ["both", "spine", "deep"] satisfies readonly PlanFilter[]) {
    assert.deepEqual(visibleGroups(backlog.plans, backlog.tickets, [], filter), []);
  }

  const fullSelection = backlog.plans.map((plan) => plan.id);
  const groups = visibleGroups(backlog.plans, backlog.tickets, fullSelection, "both");
  const metricTickets = groups.flatMap((group) => group.tickets);
  assert.equal(metricTickets.filter((ticket) => ticket.ready).length, 4);
  assert.equal(countBlockedTickets(metricTickets), 5);

  assert.deepEqual(
    groups.map((group) => group.plan.id),
    fullSelection,
  );
});

test("selecting one card renders exactly its group and deselecting it empties the board", () => {
  const selected = togglePlan([], "deep-a");
  assert.deepEqual(visibleGroups(plans, tickets, selected, "both").map((group) => group.plan.id), ["deep-a"]);

  const deselected = togglePlan(selected, "deep-a");
  assert.deepEqual(deselected, []);
  assert.deepEqual(visibleGroups(plans, tickets, deselected, "both"), []);
});

test("visible groups and select-all state agree for every filter and plan selection", () => {
  const filters = ["both", "spine", "deep"] satisfies readonly PlanFilter[];
  const planIds = plans.map((plan) => plan.id);
  const selections = Array.from(
    { length: 2 ** planIds.length },
    (_, mask) => planIds.filter((_, index) => (mask & (1 << index)) !== 0),
  );

  for (const filter of filters) {
    const visibleIds = visiblePlans(plans, filter).map((plan) => plan.id);
    for (const selected of selections) {
      const intersection = visibleIds.filter((id) => selected.includes(id));
      const groupIds = visibleGroups(plans, tickets, selected, filter).map((group) => group.plan.id);
      const state = selectAllState(plans, selected, filter);

      assert.deepEqual(groupIds, intersection, `${filter}: ${selected.join(",")}`);
      assert.equal(state === "all", intersection.length > 0 && intersection.length === visibleIds.length);
      assert.equal(state === "none", intersection.length === 0);
    }
  }
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
