// T9 — the reservation ledger.
//
// Reserve before launch, spend on GO, release on registration failure. The
// claims this suite is responsible for, in the plan's words:
//
//   * a provider that never ran never costs a call;
//   * a composite declares its FULL cost in advance;
//   * a workflow whose minimum cannot fit the tier is rejected before execution;
//   * intra-phase corrections are budget-neutral and GATING → RUNNING is not;
//   * spend carries across attempts.
//
// The concurrency claim lives next door in `call-budget-property.test.ts`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CallBudget,
  InvalidSettlement,
  ReservationNotHeld,
  ReservationOutstanding,
  admitWorkflow,
} from "../../../src/execution/call-budget.ts";
import { CallCeilingExceeded } from "../../../src/state/errors.ts";
import type { PhaseSession } from "../../../src/state/phase-machine.ts";
import type { Tier } from "../../../src/state/tiers.ts";

const TIERS: readonly Tier[] = [0, 1, 2];
const CEILING: Readonly<Record<Tier, number>> = { 0: 1, 1: 3, 2: 5 };

function ledger(tier: Tier = 1, carried?: CallBudgetConstructorCarry): CallBudget {
  return new CallBudget(carried === undefined ? { taskId: "t-1", tier } : { taskId: "t-1", tier, carried });
}

type CallBudgetConstructorCarry = NonNullable<ConstructorParameters<typeof CallBudget>[0]["carried"]>;

const CANDIDATE = "b".repeat(40);

/** L10's guard in full: a correction carries the exact failed command and its output. */
const GATING_TO_RUNNING = {
  from: "GATING",
  to: "RUNNING",
  actor: "host",
  interactive: false,
  reason: {
    source: "gate",
    command: ["npm", "run", "test:unit"],
    output: "1 failing: envelope schema violation",
  },
  evidence: { candidateSha: CANDIDATE, gatesPass: false },
  spawn: { cost: 1 },
} as const;

/**
 * `assert.throws` proves the class and discards the instance, but half the
 * value of these refusals is in the fields they carry — a `CallCeilingExceeded`
 * that cannot say what the ceiling was and what the request cost leaves the
 * owner unable to decide. So: catch, assert the class, return the error.
 */
function refusal<E extends Error>(fn: () => unknown, expected: new (...args: never[]) => E): E {
  try {
    fn();
  } catch (error) {
    if (error instanceof expected) return error;
    throw new Error(`expected ${expected.name}, got ${String(error)}`);
  }
  throw new Error(`expected ${expected.name}, but nothing was thrown`);
}

const SESSION: PhaseSession = {
  adapter: "stub",
  provider: "stub",
  model: "stub-1",
  sessionId: "prov-session-1",
};

// ---------------------------------------------------------------------------
// Reserve → spend → release.
// ---------------------------------------------------------------------------

test("a fresh ledger has committed nothing and offers the whole ceiling", () => {
  for (const tier of TIERS) {
    const budget = ledger(tier);
    assert.equal(budget.ceiling, CEILING[tier]);
    assert.equal(budget.committed, 0);
    assert.equal(budget.remaining, CEILING[tier]);
    assert.deepEqual(budget.snapshot(), {
      attempt: 1,
      callsSpent: 0,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
      allowance: { auto: 1, owner: 1 },
    });
  }
});

test("a reservation counts against the ceiling the moment it is made, before any GO", () => {
  // The whole point of reserving before launch: the ceiling must move BEFORE
  // the provider exists, not when the bill arrives.
  const budget = ledger(1);
  const reservation = budget.reserve({ cost: 1, edge: "L4" });
  assert.equal(reservation.state, "held");
  assert.equal(reservation.spent, 0);
  assert.equal(budget.callsReserved, 1);
  assert.equal(budget.callsSpent, 0, "nothing is spent until GO");
  assert.equal(budget.committed, 1);
  assert.equal(budget.remaining, 2);
});

test("spend-on-GO converts the reservation and leaves the total committed unchanged", () => {
  const budget = ledger(1);
  const reservation = budget.reserve({ cost: 1 });
  const before = budget.committed;
  const settled = budget.spendOnGo(reservation.id);
  assert.equal(settled.state, "spent");
  assert.equal(settled.spent, 1);
  assert.equal(budget.callsReserved, 0);
  assert.equal(budget.callsSpent, 1);
  assert.equal(budget.committed, before, "GO moves money between columns; it does not create any");
});

test("release-on-registration-failure returns the reservation — a provider that never ran costs nothing", () => {
  const budget = ledger(0); // T0: exactly one call, ever.
  const first = budget.reserve({ cost: 1, edge: "L4" });
  assert.equal(budget.remaining, 0, "the ceiling is fully committed while the launch is in flight");

  budget.releaseOnRegistrationFailure(first.id);
  assert.equal(budget.callsSpent, 0);
  assert.equal(budget.callsReserved, 0);
  assert.equal(budget.remaining, 1, "the whole ceiling is available again");

  // And the returned call is genuinely usable, not merely reported.
  const second = budget.reserve({ cost: 1, edge: "L4" });
  budget.spendOnGo(second.id);
  assert.equal(budget.callsSpent, 1);
});

test("a hundred registration failures never consume the ceiling", () => {
  const budget = ledger(0);
  for (let i = 0; i < 100; i += 1) {
    budget.releaseOnRegistrationFailure(budget.reserve({ cost: 1 }).id);
  }
  assert.equal(budget.callsSpent, 0);
  assert.equal(budget.remaining, 1);
});

test("the ceiling refuses the reservation that would exceed it, before anything mutates", () => {
  const budget = ledger(1);
  budget.spendOnGo(budget.reserve({ cost: 1 }).id);
  budget.reserve({ cost: 2, edge: "L10" });
  assert.equal(budget.committed, 3);

  const error = refusal(() => budget.reserve({ cost: 1, edge: "L4" }), CallCeilingExceeded);
  assert.equal(error.ceiling, 3);
  assert.equal(error.requested, 1);
  assert.equal(error.committed, 3);
  // A refused reservation leaves no trace to unwind.
  assert.equal(budget.committed, 3);
  assert.equal(budget.outstanding().length, 1);
});

test("a reservation that exactly fills the ceiling is admitted — the check is not off by one", () => {
  for (const tier of TIERS) {
    const budget = ledger(tier);
    budget.reserve({ cost: CEILING[tier] });
    assert.equal(budget.remaining, 0);
  }
});

test("reserve is synchronous by contract — the atomicity the concurrency property rests on", () => {
  // If `reserve` were async, or awaited anything between the ceiling check and
  // the increment, two concurrent launches could both pass the check. The
  // property test would then be proving a coincidence.
  assert.equal(CallBudget.prototype.reserve.constructor.name, "Function");
  assert.notEqual(CallBudget.prototype.reserve.constructor.name, "AsyncFunction");
  assert.equal(CallBudget.prototype.settle.constructor.name, "Function");
});

// ---------------------------------------------------------------------------
// Settling exactly once.
// ---------------------------------------------------------------------------

test("a reservation settles exactly once, whichever way it settled", () => {
  const budget = ledger(2);
  const spent = budget.reserve({ cost: 1 });
  budget.spendOnGo(spent.id);
  const doubleSpend = refusal(() => budget.spendOnGo(spent.id), ReservationNotHeld);
  assert.equal(doubleSpend.state, "spent");
  assert.throws(() => budget.releaseOnRegistrationFailure(spent.id), ReservationNotHeld);

  const released = budget.reserve({ cost: 1 });
  budget.releaseOnRegistrationFailure(released.id);
  const doubleRelease = refusal(() => budget.releaseOnRegistrationFailure(released.id), ReservationNotHeld);
  assert.equal(doubleRelease.state, "released");

  assert.equal(budget.callsSpent, 1, "the double settlements changed nothing");
});

test("an id the ledger never issued is a fault, not a no-op", () => {
  const budget = ledger(1);
  const error = refusal(() => budget.spendOnGo("r99"), ReservationNotHeld);
  assert.equal(error.state, "unknown");
});

test("a settlement outside the declared cost is refused and changes nothing", () => {
  const budget = ledger(2);
  const reservation = budget.reserve({ cost: 3 });
  assert.throws(() => budget.settle(reservation.id, 4), InvalidSettlement);
  assert.throws(() => budget.settle(reservation.id, -1), InvalidSettlement);
  assert.throws(() => budget.settle(reservation.id, 1.5), InvalidSettlement);
  assert.equal(budget.callsSpent, 0);
  assert.equal(budget.callsReserved, 3, "the reservation is still held after a refused settlement");
});

test("a reservation costs at least one whole call", () => {
  const budget = ledger(2);
  assert.throws(() => budget.reserve({ cost: 0 }), RangeError);
  assert.throws(() => budget.reserve({ cost: -1 }), RangeError);
  assert.throws(() => budget.reserve({ cost: 1.5 }), RangeError);
});

// ---------------------------------------------------------------------------
// Composite adapters — full cost declared in advance.
// ---------------------------------------------------------------------------

test("a composite reserves workers-plus-fuser as one indivisible declaration", () => {
  const budget = ledger(2);
  const reservation = budget.reserveComposite(2, { edge: "L4" });
  assert.equal(reservation.cost, 3, "two workers plus a fuser");
  assert.equal(reservation.kind, "composite");
  assert.equal(budget.callsReserved, 3, "all three are committed before any of the three launch");
  assert.equal(budget.outstanding().length, 1, "one declaration, not three");
});

test("a composite that does not fit is refused before the first worker launches", () => {
  // T2 ceiling 5. Three fit on top of two; they do not fit on top of three —
  // and the refusal must arrive before any worker has burned quota.
  const fits = ledger(2, { callsSpent: 2 });
  fits.reserveComposite(2);
  assert.equal(fits.committed, 5);

  const overruns = ledger(2, { callsSpent: 3 });
  const error = refusal(() => overruns.reserveComposite(2), CallCeilingExceeded);
  assert.equal(error.requested, 3);
  assert.equal(error.committed, 3);
  assert.equal(overruns.callsReserved, 0, "no partial reservation survives the refusal");
});

test("a single call fitting is not evidence that the composite fits", () => {
  // The failure mode the advance declaration exists to prevent: reserving one
  // at a time, the first two workers succeed and the fuser discovers the
  // ceiling with two calls already spent.
  const oneAtATime = ledger(2, { callsSpent: 3 });
  oneAtATime.reserve({ cost: 1 });
  assert.equal(oneAtATime.committed, 4);

  const declared = ledger(2, { callsSpent: 3 });
  assert.throws(() => declared.reserveComposite(2), CallCeilingExceeded);
});

test("a composite that lands halfway spends what ran and returns what did not", () => {
  // Two workers reached GO; the fuser's registration failed. Spent plus
  // released always equals the declared cost — nothing evaporates, nothing
  // inflates.
  const budget = ledger(2);
  const reservation = budget.reserveComposite(2);
  const settled = budget.settle(reservation.id, 2);
  assert.equal(settled.state, "part-spent");
  assert.equal(settled.spent, 2);
  assert.equal(budget.callsSpent, 2);
  assert.equal(budget.callsReserved, 0);
  assert.equal(settled.spent + (settled.cost - settled.spent), reservation.cost);
});

// ---------------------------------------------------------------------------
// Workflow-minimum fit — the compiler's hook.
// ---------------------------------------------------------------------------

test("a workflow whose minimum cannot fit the tier is rejected before execution", () => {
  const cases: readonly { id: string; minimumCalls: number; tier: Tier }[] = [
    { id: "plan-build-test", minimumCalls: 2, tier: 0 },
    { id: "simple-sdlc", minimumCalls: 4, tier: 1 },
    { id: "hypothetical-six-phase", minimumCalls: 6, tier: 2 },
  ];
  for (const { id, minimumCalls, tier } of cases) {
    assert.throws(() => admitWorkflow({ id, minimumCalls }, tier), CallCeilingExceeded, `${id} at T${tier}`);
  }
});

test("a workflow that exactly fills the ceiling is admitted", () => {
  admitWorkflow({ id: "exactly-one", minimumCalls: 1 }, 0);
  admitWorkflow({ id: "exactly-three", minimumCalls: 3 }, 1);
  admitWorkflow({ id: "exactly-five", minimumCalls: 5 }, 2);
});

test("the hook measures against what the ledger has already committed, not only the tier", () => {
  // A retry of a T1 task with two calls behind it cannot admit a three-call
  // workflow, even though T1's ceiling would have fitted it at attempt 1.
  const fresh = ledger(1);
  fresh.admitWorkflow({ id: "build-review", minimumCalls: 3 });

  const retried = ledger(1, { attempt: 2, callsSpent: 2 });
  const error = refusal(() => retried.admitWorkflow({ id: "build-review", minimumCalls: 3 }), CallCeilingExceeded);
  assert.equal(error.committed, 2);
  assert.equal(error.requested, 3);
  retried.admitWorkflow({ id: "build", minimumCalls: 1 });
});

test("an outstanding reservation counts against workflow admission too", () => {
  const budget = ledger(1);
  budget.reserve({ cost: 2 });
  assert.throws(() => budget.admitWorkflow({ id: "build-review", minimumCalls: 2 }), CallCeilingExceeded);
  budget.admitWorkflow({ id: "build", minimumCalls: 1 });
});

// ---------------------------------------------------------------------------
// What costs a call and what does not.
// ---------------------------------------------------------------------------

test("GATING -> RUNNING reserves exactly one call and draws a correction tranche", () => {
  const budget = ledger(1);
  const { result, reservation } = budget.authorize(GATING_TO_RUNNING);
  assert.equal(result.edge, "L10");
  assert.equal(result.spends.calls, 1);
  assert.notEqual(reservation, null);
  assert.equal(reservation?.cost, 1);
  assert.equal(reservation?.edge, "L10");
  assert.equal(budget.callsReserved, 1, "the escalation is booked before the provider launches");
  assert.equal(budget.snapshot().correctionsAuto, 1);
});

test("an intra-phase correction is budget-neutral — it costs tokens, not calls", () => {
  const budget = ledger(1);
  budget.spendOnGo(budget.reserve({ cost: 1, edge: "L4" }).id);
  const before = budget.snapshot();

  const toCorrecting = budget.recordPhaseTransition({
    phase: "build",
    from: "VALIDATING",
    to: "CORRECTING",
    session: SESSION,
    cause: "gate-violation",
    actor: "host",
  });
  assert.equal(toCorrecting.correctionTranche, "auto");

  const resumed = budget.recordPhaseTransition({
    phase: "build",
    from: "CORRECTING",
    to: "RUNNING",
    session: SESSION,
    resumeSession: SESSION,
  });
  assert.equal(resumed.correctionTranche, null);

  const after = budget.snapshot();
  assert.equal(after.callsSpent, before.callsSpent, "a correction spends no call");
  assert.equal(after.callsReserved, before.callsReserved, "and reserves none either");
  assert.equal(after.correctionsAuto, before.correctionsAuto + 1, "it draws the allowance instead");
  assert.equal(budget.outstanding().length, 0, "the correction issued no reservation");
});

test("a whole phase of corrections at the ceiling still costs nothing", () => {
  // A task with its calls fully spent must still be able to correct in-session:
  // if it could not, the two-tier economics would collapse into one.
  const budget = ledger(1, { callsSpent: 3 });
  assert.equal(budget.remaining, 0);
  budget.recordPhaseTransition({
    phase: "build",
    from: "VALIDATING",
    to: "CORRECTING",
    session: SESSION,
    cause: "schema-violation",
    actor: "host",
  });
  assert.equal(budget.callsSpent, 3);
  assert.equal(budget.callsReserved, 0);
});

test("the non-spawn task edges reserve nothing", () => {
  const budget = ledger(1);
  const { result, reservation } = budget.authorize({
    from: "DRAFT",
    to: "PREPARED",
    actor: "host",
    interactive: false,
    reason: { source: "git" },
    evidence: {
      worktreeCreated: true,
      configValid: true,
      preflight: { adapter: true, sandbox: true, observability: true },
      baseSha: "a".repeat(40),
    },
  });
  assert.equal(result.spends.calls, 0);
  assert.equal(reservation, null);
  assert.equal(budget.committed, 0);
});

test("authorize refuses the edge the live ledger cannot afford, and books nothing", () => {
  const budget = ledger(1, { callsSpent: 3 });
  assert.throws(() => budget.authorize(GATING_TO_RUNNING), CallCeilingExceeded);
  assert.equal(budget.callsReserved, 0);
  assert.equal(budget.snapshot().correctionsAuto, 0, "a refused edge draws no allowance either");
});

// ---------------------------------------------------------------------------
// Phase and attempt boundaries.
// ---------------------------------------------------------------------------

test("a new phase refreshes the correction allowance and leaves the call ledger alone", () => {
  // The allowance is per phase; the ceiling is per task. A five-phase workflow
  // gets five allowances and exactly one ceiling.
  const budget = ledger(1);
  budget.spendOnGo(budget.reserve({ cost: 1 }).id);
  budget.recordPhaseTransition({
    phase: "plan",
    from: "VALIDATING",
    to: "CORRECTING",
    session: SESSION,
    cause: "gate-violation",
    actor: "host",
  });
  assert.equal(budget.snapshot().correctionsAuto, 1);

  budget.beginPhase();
  assert.equal(budget.snapshot().correctionsAuto, 0, "the next phase gets its own allowance");
  assert.equal(budget.callsSpent, 1, "and not its own ceiling");
});

test("spend carries across attempts of the same task", () => {
  // `awsf retry` mints attempt n+1 at DRAFT. A task cannot buy an unlimited
  // budget by failing repeatedly.
  const budget = ledger(1);
  budget.spendOnGo(budget.reserve({ cost: 1 }).id);
  budget.spendOnGo(budget.reserve({ cost: 1 }).id);

  budget.beginAttempt(2);
  assert.equal(budget.attempt, 2);
  assert.equal(budget.callsSpent, 2, "the new attempt inherits the spend");
  assert.equal(budget.remaining, 1);

  budget.spendOnGo(budget.reserve({ cost: 1 }).id);
  budget.beginAttempt(3);
  assert.throws(() => budget.reserve({ cost: 1 }), CallCeilingExceeded);
});

test("a fresh attempt number does not reset the ceiling", () => {
  const budget = ledger(1, { callsSpent: 3 });
  for (const attempt of [2, 3, 5, 12]) {
    budget.beginAttempt(attempt);
    assert.equal(budget.remaining, 0, `attempt ${attempt} still has no headroom`);
    assert.throws(() => budget.reserve({ cost: 1 }), CallCeilingExceeded);
  }
});

test("attempt numbers are monotonic", () => {
  const budget = ledger(1);
  budget.beginAttempt(2);
  assert.throws(() => budget.beginAttempt(2), RangeError);
  assert.throws(() => budget.beginAttempt(1), RangeError);
});

test("an attempt boundary with a reservation in flight is refused, never guessed", () => {
  // Releasing would forgive a call that may have been spent; spending would
  // bill one that may never have launched. Neither is knowable here.
  const budget = ledger(2);
  const reservation = budget.reserve({ cost: 1 });
  const error = refusal(() => budget.beginAttempt(2), ReservationOutstanding);
  assert.deepEqual(error.reservationIds, [reservation.id]);

  budget.releaseOnRegistrationFailure(reservation.id);
  budget.beginAttempt(2);
  assert.equal(budget.attempt, 2);
});

// ---------------------------------------------------------------------------
// The ledger as a record.
// ---------------------------------------------------------------------------

test("every reservation is recoverable by id with how it settled", () => {
  const budget = ledger(2);
  const spent = budget.reserve({ cost: 1, edge: "L4" });
  const released = budget.reserve({ cost: 1, edge: "L19" });
  budget.spendOnGo(spent.id);
  budget.releaseOnRegistrationFailure(released.id);

  assert.equal(budget.reservation(spent.id)?.state, "spent");
  assert.equal(budget.reservation(released.id)?.state, "released");
  assert.equal(budget.reservation("r404"), undefined);
  assert.deepEqual(
    budget.history().map((r) => [r.id, r.edge, r.state, r.spent]),
    [
      [spent.id, "L4", "spent", 1],
      [released.id, "L19", "released", 0],
    ],
  );
});

test("reservation ids are host-minted and monotonic, so a replay reproduces them", () => {
  const budget = ledger(2);
  const ids = [budget.reserve({ cost: 1 }).id, budget.reserve({ cost: 1 }).id, budget.reserve({ cost: 1 }).id];
  assert.deepEqual(ids, ["r1", "r2", "r3"]);

  const replayed = ledger(2);
  assert.deepEqual(
    [replayed.reserve({ cost: 1 }).id, replayed.reserve({ cost: 1 }).id, replayed.reserve({ cost: 1 }).id],
    ids,
  );
});

test("a snapshot handed to the pure machine is a copy, not the ledger's own state", () => {
  const budget = ledger(1);
  const snapshot = budget.snapshot();
  snapshot.callsSpent = 99;
  snapshot.allowance.auto = 99;
  assert.equal(budget.callsSpent, 0);
  assert.equal(budget.snapshot().allowance.auto, 1);

  const outstanding = budget.outstanding();
  budget.reserve({ cost: 1 });
  assert.equal(outstanding.length, 0, "a snapshot of the outstanding set does not grow behind the caller");
});
