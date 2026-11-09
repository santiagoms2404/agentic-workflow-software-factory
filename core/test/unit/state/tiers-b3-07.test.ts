import assert from "node:assert/strict";
import test from "node:test";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import { CallCeilingExceeded } from "../../../src/state/errors.ts";
import { ceilingFor, DEFAULT_CALL_CEILINGS } from "../../../src/state/tiers.ts";

test("B3-07: CallBudget preserves absent ceiling in snapshot when no explicit ceiling is provided", () => {
  const budget = new CallBudget({ taskId: "t1", tier: 2 });
  const snapshot = budget.snapshot();
  assert.equal(snapshot.ceiling, undefined, "snapshot.ceiling must be absent (undefined) when no ceiling was passed");
});

test("B3-07: CallBudget preserves explicit ceiling in snapshot", () => {
  const budget = new CallBudget({ taskId: "t2", tier: 2, ceiling: 3 });
  const snapshot = budget.snapshot();
  assert.equal(snapshot.ceiling, 3, "snapshot.ceiling must equal the explicit ceiling passed");
});

test("B3-07: CallBudget respects configured ceilings table without recording it as explicit ceiling", () => {
  const configuredCeilings = { 0: 1, 1: 2, 2: 2, 3: 10 } as const;
  const budget = new CallBudget({
    taskId: "t3",
    tier: 2,
    ceilings: configuredCeilings,
  });

  assert.equal(budget.ceiling, 2, "runtime ceiling must match the configured table");
  assert.equal(budget.snapshot().ceiling, undefined, "snapshot must keep ceiling absent");

  // Attempting to reserve 3 calls must exceed the configured ceiling of 2
  assert.throws(
    () => budget.reserve({ cost: 3 }),
    CallCeilingExceeded,
  );
});

test("B3-07: ceilingFor resolves absent resolved parameter to DEFAULT_CALL_CEILINGS", () => {
  assert.equal(ceilingFor(2), DEFAULT_CALL_CEILINGS[2]);
  assert.equal(ceilingFor(2, 4), 4);
  assert.equal(ceilingFor(2, { 0: 1, 1: 2, 2: 2, 3: 10 }), 2);
});
