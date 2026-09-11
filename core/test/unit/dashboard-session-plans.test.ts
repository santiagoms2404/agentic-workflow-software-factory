import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionCard, SessionPlan } from "../../../dashboard/shared/types.ts";
import {
  PLAN_KINDS,
  planKindLabel,
  planKindOf,
  planRunCost,
  sessionPlanCards,
  withPlanKind,
} from "../../../dashboard/src/session-plans.ts";
import { initialPlanSelection } from "../../../dashboard/src/backlog-selection.ts";
import type { BacklogPlan } from "../../../dashboard/shared/types.ts";

const plans: readonly SessionPlan[] = [
  { id: "fixture-plan", name: "fixture-plan", kind: "spine", parentSpine: null, parentSpineName: null },
  { id: "fixture-w01-deep", name: "fixture-w01-deep", kind: "deep", parentSpine: "fixture-plan", parentSpineName: "fixture-plan" },
];

function usage(estimatedCostUsd: number | null, costAuthority: SessionCard["usage"]["costAuthority"], costPartial = false): SessionCard["usage"] {
  return {
    inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    reasoningTokens: null, totalTokens: null, reasoningRelation: "unknown", usageAuthority: "none",
    estimatedCostUsd, costAuthority, costPartial,
  };
}

test("a run is spine, deep or unlinked, and a plan the catalog no longer lists is unlinked", () => {
  assert.equal(planKindOf("fixture-plan", plans), "spine");
  assert.equal(planKindOf("fixture-w01-deep", plans), "deep");
  assert.equal(planKindOf(null, plans), "unlinked");
  // Not a fourth bucket and not a crash: "unlinked" reads as "names no plan the
  // catalog lists", which is exactly what a dropped plan leaves behind.
  assert.equal(planKindOf("retired-plan", plans), "unlinked");
  assert.deepEqual([...PLAN_KINDS], ["spine", "deep", "unlinked"]);
  assert.equal(planKindLabel("unlinked"), "no registered plan");
  assert.equal(planKindLabel("spine"), "spine");
});

test("bucketing happens once, so the cards and the filter cannot disagree", () => {
  const annotated = withPlanKind(
    [{ planRef: "fixture-w01-deep" }, { planRef: null }, { planRef: "retired-plan" }],
    plans,
  );
  assert.deepEqual(annotated.map((session) => session.planKind), ["deep", "unlinked", "unlinked"]);
});

test("unknown costs stay unknown rather than becoming a confident partial sum", () => {
  assert.deepEqual(
    planRunCost([{ usage: usage(1.5, "provider") }, { usage: usage(2.25, "provider") }]),
    { usd: 3.75, authority: "provider", partial: false },
  );
  // One missing number makes the whole total unavailable.
  assert.deepEqual(
    planRunCost([{ usage: usage(1.5, "provider") }, { usage: usage(null, "unavailable") }]),
    { usd: null, authority: "unavailable", partial: true },
  );
  // So do two different authorities, and a row that declared itself partial.
  assert.equal(planRunCost([{ usage: usage(1, "provider") }, { usage: usage(2, "catalog-estimate") }]).usd, null);
  assert.equal(planRunCost([{ usage: usage(1, "provider", true) }]).usd, null);
  // And no rows is unknown, never zero.
  assert.deepEqual(planRunCost([]), { usd: null, authority: "unavailable", partial: true });
});

test("a plan card counts the runs it was given and no plan without runs gets a card", () => {
  const sessions = [
    { planRef: "fixture-plan", usage: usage(1, "provider") },
    { planRef: "fixture-plan", usage: usage(2, "provider") },
    { planRef: null, usage: usage(9, "provider") },
  ];
  const cards = sessionPlanCards(sessions, plans);
  assert.deepEqual(cards.map((card) => card.plan.id), ["fixture-plan"]);
  assert.equal(cards[0]?.runs, 2);
  assert.deepEqual(cards[0]?.cost, { usd: 3, authority: "provider", partial: false });
});

test("navigating from a plan card opens the backlog holding that plan alone", () => {
  const backlogPlans: readonly BacklogPlan[] = plans.map((plan) => ({
    ...plan, counts: { todo: 0, wip: 0, done: 0, failed: 0 }, ticketCount: 0,
  }));
  assert.deepEqual(initialPlanSelection(backlogPlans, "fixture-w01-deep"), ["fixture-w01-deep"]);
  // Reaching the backlog directly still opens every plan, as it always has.
  assert.deepEqual(initialPlanSelection(backlogPlans, null), ["fixture-plan", "fixture-w01-deep"]);
  assert.deepEqual(initialPlanSelection(backlogPlans, undefined), ["fixture-plan", "fixture-w01-deep"]);
  // A named plan the catalog does not list falls back rather than opening empty.
  assert.deepEqual(initialPlanSelection(backlogPlans, "retired-plan"), ["fixture-plan", "fixture-w01-deep"]);
});
