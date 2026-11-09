// B2-12, owner call O3: a code-decided act (raise, resume, wait-until, cancel)
// is live only under a lease that names it (AGENTS.md invariant 13, "a lease
// that names it", read as the act). An act the lease leaves out reports
// `not-leased`; naming it makes it live. The judgment acts degrade-review and
// route-fallback keep their earned / owner-all behaviour.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pair } from "../../../src/delegate/agreement.ts";
import { CODE_DECIDED_ACTS, autonomyFor } from "../../../src/delegate/autonomy.ts";
import type { ProposedActName } from "../../../src/delegate/policy.ts";

let serial = 0;
function matches(act: ProposedActName, count: number): Pair[] {
  return Array.from({ length: count }, () => {
    serial += 1;
    return {
      proposalId: `p-${String(serial).padStart(4, "0")}`, source: "live", taskId: "task-1", attempt: 1,
      at: `2026-09-01T00:${String(serial % 60).padStart(2, "0")}:00Z`,
      proposedAct: act, observedAct: null, observedAtSeq: null, outcome: "match",
    } satisfies Pair;
  });
}

test("B2-12: a code-decided act the lease does not name is not live, and says not-leased", () => {
  // The lease names only route-fallback; cancel is a code-decided act it leaves out.
  const report = autonomyFor("cancel", [], "earned", ["route-fallback"]);
  assert.deepEqual([report.live, report.basis], [false, "not-leased"]);
  // The owner's switch unlocks judgment acts, not unnamed owner acts.
  const underAll = autonomyFor("raise", [], "all", ["degrade-review"]);
  assert.deepEqual([underAll.live, underAll.basis], [false, "not-leased"]);
});

test("B2-12: each code-decided act is live when the lease names it, and only that act", () => {
  for (const act of CODE_DECIDED_ACTS) {
    for (const autonomy of ["earned", "all"] as const) {
      const named = autonomyFor(act, [], autonomy, [act]);
      assert.deepEqual([act, autonomy, named.live, named.basis], [act, autonomy, true, "code-decided"]);
      const others = CODE_DECIDED_ACTS.filter((other) => other !== act);
      const unnamed = autonomyFor(act, [], autonomy, others);
      assert.deepEqual([act, autonomy, unnamed.live, unnamed.basis], [act, autonomy, false, "not-leased"]);
    }
    // No lease still wins over any act list.
    assert.deepEqual([autonomyFor(act, [], null, [act]).basis], ["no-lease"]);
  }
});

test("B2-12: an empty act list leases no code-decided act, whatever the history", () => {
  const report = autonomyFor("resume", matches("resume", 8), "earned", []);
  assert.deepEqual([report.live, report.basis, report.matched], [false, "not-leased", 8]);
});

test("B2-12: degrade-review and route-fallback keep their earned and owner-all behaviour", () => {
  for (const act of ["degrade-review", "route-fallback"] as const) {
    const earned = autonomyFor(act, matches(act, 8), "earned", [act]);
    assert.deepEqual([act, earned.live, earned.basis], [act, true, "earned"]);
    const unearned = autonomyFor(act, matches(act, 3), "earned", [act]);
    assert.deepEqual([act, unearned.live, unearned.basis], [act, false, "not-earned"]);
    const ownerAll = autonomyFor(act, [], "all", [act]);
    assert.deepEqual([act, ownerAll.live, ownerAll.basis], [act, true, "owner-all"]);
    const noLease = autonomyFor(act, matches(act, 8), null, [act]);
    assert.deepEqual([act, noLease.live, noLease.basis], [act, false, "no-lease"]);
  }
});
