// T4 — call ceilings, reservations, composite cost, and workflow fit.
//
// T0 = 1 call, T1 = 3, T2 = 5. Checked BEFORE the spawn, counting reservations
// as well as spend, and counting spend carried across every attempt of the
// same task. A composite adapter declares its full cost in advance. A workflow
// whose minimum call count cannot fit its tier is rejected before execution,
// not discovered halfway through.
//
// RED until T5 writes `core/src/state/{task-machine,tiers,errors}.ts`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CALL_CEILINGS,
  SPAWN_SITE_EDGES,
  WORKFLOW_MINIMUM_CALLS,
  type Tier,
} from "./_lifecycle-tables.ts";
import {
  budget,
  errorClass,
  expectAccepted,
  expectRejection,
  tiers,
  validInput,
  withBudget,
  type TransitionInput,
} from "./_lifecycle-harness.ts";

const TIERS: readonly Tier[] = [0, 1, 2];

// ---------------------------------------------------------------------------
// The numbers.
// ---------------------------------------------------------------------------

test("the tier ceilings are exactly 1, 3 and 5", async () => {
  const { CALL_CEILINGS: ceilings, ceilingFor } = await tiers();
  assert.deepEqual({ ...ceilings }, { 0: 1, 1: 3, 2: 5 });
  assert.deepEqual({ ...ceilings }, { ...CALL_CEILINGS });
  assert.equal(ceilingFor(0), 1);
  assert.equal(ceilingFor(1), 3);
  assert.equal(ceilingFor(2), 5);
});

// ---------------------------------------------------------------------------
// The pre-spawn check.
// ---------------------------------------------------------------------------

/** Spawn-site edges that are legal at any tier — L11 and L16 are T2-only by guard. */
const TIER_FREE_SPAWN_EDGES = ["L4", "L10", "L19"] as const;

test("every spawn-site edge refuses to spawn once the tier's ceiling is reached", async () => {
  const failures: string[] = [];
  for (const id of TIER_FREE_SPAWN_EDGES) {
    for (const tier of TIERS) {
      const ceiling = CALL_CEILINGS[tier];
      const atCeiling: TransitionInput = {
        ...validInput(id),
        tier,
        budget: budget({ callsSpent: ceiling }),
      };
      try {
        await expectRejection("CallCeilingExceeded", atCeiling, {
          because: `${id} at T${tier} with ${ceiling}/${ceiling} spent`,
        });
      } catch (error) {
        failures.push((error as Error).message);
      }

      const oneBelow: TransitionInput = {
        ...validInput(id),
        tier,
        budget: budget({ callsSpent: ceiling - 1 }),
      };
      try {
        const result = await expectAccepted(oneBelow);
        if (result.spends.calls !== 1) {
          failures.push(`${id} at T${tier}: reserved ${result.spends.calls}, expected 1`);
        }
      } catch (error) {
        failures.push(`${id} at T${tier} with headroom: ${(error as Error).message}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("the T2-only spawn edges are ceiling-checked at T2", async () => {
  for (const id of ["L11", "L16"] as const) {
    await expectRejection("CallCeilingExceeded", { ...validInput(id), budget: budget({ callsSpent: 5 }) }, {
      because: `${id} at the T2 ceiling`,
    });
    const result = await expectAccepted({ ...validInput(id), budget: budget({ callsSpent: 4 }) });
    assert.equal(result.spends.calls, 1);
  }
});

test("a T0 task gets exactly one provider call, ever", async () => {
  // Read-only analysis: one call, no mutation, no second opinion.
  const first = await expectAccepted({ ...validInput("L4"), tier: 0, budget: budget({ callsSpent: 0 }) });
  assert.equal(first.spends.calls, 1);
  await expectRejection(
    "CallCeilingExceeded",
    { ...validInput("L10"), tier: 0, budget: budget({ callsSpent: 1 }) },
    { because: "T0 = 1" },
  );
});

test("the ceiling counts outstanding reservations, not only settled spend", async () => {
  // Reserve before launch, so two concurrent paths cannot both slip under the
  // ceiling by reading a spend counter that has not caught up yet.
  const failures: string[] = [];
  const cases: readonly { spent: number; reserved: number; accepts: boolean }[] = [
    { spent: 0, reserved: 0, accepts: true },
    { spent: 2, reserved: 0, accepts: true },
    { spent: 0, reserved: 2, accepts: true },
    { spent: 1, reserved: 1, accepts: true },
    { spent: 2, reserved: 1, accepts: false },
    { spent: 1, reserved: 2, accepts: false },
    { spent: 0, reserved: 3, accepts: false },
    { spent: 3, reserved: 0, accepts: false },
  ];
  for (const { spent, reserved, accepts } of cases) {
    const input = withBudget("L4", { callsSpent: spent, callsReserved: reserved });
    const label = `T1 with ${spent} spent + ${reserved} reserved`;
    try {
      if (accepts) await expectAccepted(input);
      else await expectRejection("CallCeilingExceeded", input, { because: label });
    } catch (error) {
      failures.push(`${label}: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("the ceiling is checked before the spawn, on a request that is otherwise perfect", async () => {
  // Nothing about the request is wrong except its price — which is exactly the
  // case the barrier must refuse before a child exists.
  const input = withBudget("L4", { callsSpent: 3 });
  const error = await expectRejection("CallCeilingExceeded", input);
  assert.equal(error["from"], "PREPARED");
  assert.equal(error["to"], "RUNNING");
  // The refusal must say what the ceiling was and what the request would have
  // cost, or the owner cannot decide whether to mint a new attempt.
  assert.equal(error["ceiling"], 3);
  assert.equal(error["requested"], 1);
});

// ---------------------------------------------------------------------------
// Composite adapters.
// ---------------------------------------------------------------------------

test("a composite adapter's declared cost is workers plus the fuser", async () => {
  const { compositeCost } = await tiers();
  assert.equal(compositeCost(2), 3, "two workers plus a fuser reserve three calls");
  assert.equal(compositeCost(1), 2);
  assert.equal(compositeCost(3), 4);
});

test("a composite spawn is measured at its full declared cost, in advance", async () => {
  // T2 ceiling 5. Three calls fit on top of two; they do not fit on top of
  // three — and the refusal happens before any of the three workers launch.
  const fits: TransitionInput = {
    ...validInput("L4"),
    tier: 2,
    budget: budget({ callsSpent: 2 }),
    spawn: { cost: 3 },
  };
  const result = await expectAccepted(fits);
  assert.equal(result.spends.calls, 3, "the composite reserves all three at once");

  const overruns: TransitionInput = { ...fits, budget: budget({ callsSpent: 3 }) };
  const error = await expectRejection("CallCeilingExceeded", overruns, {
    because: "3 spent + 3 declared exceeds the T2 ceiling of 5",
  });
  assert.equal(error["requested"], 3);
});

test("a single-call spawn that would fit is not evidence that a composite fits", async () => {
  // The whole point of declaring full cost in advance: the third worker must
  // not discover the ceiling after the first two have already burned quota.
  const budgetAtThree = budget({ callsSpent: 3 });
  await expectAccepted({ ...validInput("L4"), tier: 2, budget: budgetAtThree, spawn: { cost: 1 } });
  await expectRejection(
    "CallCeilingExceeded",
    { ...validInput("L4"), tier: 2, budget: budgetAtThree, spawn: { cost: 3 } },
  );
});

// ---------------------------------------------------------------------------
// Workflow fit — rejected before execution.
// ---------------------------------------------------------------------------

test("all six shipped workflows fit their tier's ceiling", async () => {
  const { assertWorkflowFitsTier } = await tiers();
  for (const workflow of WORKFLOW_MINIMUM_CALLS) {
    assert.ok(
      workflow.minimumCalls <= CALL_CEILINGS[workflow.tier],
      `${workflow.id} needs ${workflow.minimumCalls} at T${workflow.tier}`,
    );
    assertWorkflowFitsTier({ id: workflow.id, minimumCalls: workflow.minimumCalls }, workflow.tier);
  }
});

test("a workflow whose minimum cannot fit the selected tier is rejected before execution", async () => {
  const { assertWorkflowFitsTier } = await tiers();
  const CallCeilingExceeded = await errorClass("CallCeilingExceeded");
  const cases: readonly { id: string; minimumCalls: number; tier: Tier }[] = [
    { id: "plan-build-test", minimumCalls: 2, tier: 0 },
    { id: "simple-sdlc", minimumCalls: 4, tier: 1 },
    { id: "hypothetical-six-phase", minimumCalls: 6, tier: 2 },
  ];
  for (const { id, minimumCalls, tier } of cases) {
    assert.throws(
      () => assertWorkflowFitsTier({ id, minimumCalls }, tier),
      CallCeilingExceeded,
      `${id} (${minimumCalls} calls) must not be admitted at T${tier}`,
    );
  }
});

test("a workflow that exactly fills the ceiling is admitted — the check is not off by one", async () => {
  const { assertWorkflowFitsTier } = await tiers();
  assertWorkflowFitsTier({ id: "exactly-one", minimumCalls: 1 }, 0);
  assertWorkflowFitsTier({ id: "exactly-three", minimumCalls: 3 }, 1);
  assertWorkflowFitsTier({ id: "exactly-five", minimumCalls: 5 }, 2);
});

// ---------------------------------------------------------------------------
// Spend across attempts.
// ---------------------------------------------------------------------------

test("spend carries across attempts of the same task", async () => {
  // `awsf retry` mints attempt n+1 at DRAFT and carries the spend forward, so
  // a task cannot buy an unlimited budget by failing repeatedly.
  await expectRejection(
    "CallCeilingExceeded",
    withBudget("L4", { attempt: 3, callsSpent: 3 }),
    { because: "T1 lifetime spend is already 3" },
  );
  const result = await expectAccepted(withBudget("L4", { attempt: 3, callsSpent: 2 }));
  assert.equal(result.spends.calls, 1);
});

test("a fresh attempt number does not reset the ceiling", async () => {
  const failures: string[] = [];
  for (const attempt of [1, 2, 5, 12]) {
    try {
      await expectRejection("CallCeilingExceeded", withBudget("L4", { attempt, callsSpent: 3 }));
    } catch (error) {
      failures.push(`attempt ${attempt}: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});

// ---------------------------------------------------------------------------
// What costs a call and what does not.
// ---------------------------------------------------------------------------

test("GATING -> RUNNING costs one tier call; the nineteen non-spawn edges cost none", async () => {
  // Intra-phase corrections re-prompt the same provider session and never
  // reach `transition()` at all — they cost tokens, not calls. Crossing the
  // state edge is the expensive escalation, and it is counted here.
  const correction = await expectAccepted(validInput("L10"));
  assert.equal(correction.spends.calls, 1);
  assert.equal(correction.spends.correctionTranche, "auto");

  const failures: string[] = [];
  for (const id of ["L1", "L7", "L12", "L15", "L20", "L23"] as const) {
    const result = await expectAccepted(validInput(id));
    if (result.spends.calls !== 0) failures.push(`${id} charged ${result.spends.calls} calls`);
  }
  assert.deepEqual(failures, []);
});

test("the ceiling applies to spawn-site edges only", async () => {
  // A task at its ceiling must still be able to gate, review-record, land and
  // block — otherwise exhausting the budget would strand the attempt with no
  // way to reach a terminal state.
  const failures: string[] = [];
  for (const id of ["L7", "L12", "L15", "L20", "L23", "L13", "L21", "L24"] as const) {
    const base = validInput(id);
    try {
      // Only `callsSpent` moves: L13's own guard needs its tranches spent, so
      // replacing the whole budget would break the edge for the wrong reason.
      await expectAccepted({
        ...base,
        budget: { ...base.budget, callsSpent: CALL_CEILINGS[base.tier], callsReserved: 0 },
      });
    } catch (error) {
      failures.push(`${id} at the ceiling: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
  assert.deepEqual([...SPAWN_SITE_EDGES], ["L4", "L10", "L11", "L16", "L19"]);
});
