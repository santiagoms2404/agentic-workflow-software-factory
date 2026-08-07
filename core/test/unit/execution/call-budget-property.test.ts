// T9 — the concurrency property.
//
//     N concurrent reservation attempts against a ceiling C
//     never yield spent + reserved > C.
//
// The interesting word is "concurrent". Node runs one turn at a time, so the
// hazard is not a data race — it is an INTERLEAVING: a launch reads the budget,
// awaits the barrier, and commits against a number that has since moved. Every
// attempt below therefore yields the event loop at least twice inside its own
// launch — once between reserving and settling — so the scheduler is free to
// braid the storm any way it likes.
//
// Randomness is seeded and reproduced from a constant list, not from
// `Math.random()`: a property test that cannot be re-run on the case that
// failed is a flake generator, and a seed printed in a failure message is the
// difference between a bug report and a shrug.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { CallBudget } from "../../../src/execution/call-budget.ts";
import { CallCeilingExceeded } from "../../../src/state/errors.ts";
import { CALL_CEILINGS, type Tier } from "../../../src/state/tiers.ts";

const TIERS: readonly Tier[] = [0, 1, 2];
const SEEDS: readonly number[] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];

/** mulberry32 — small, seedable, and dependency-free, which the allowlist requires. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  // `noUncheckedIndexedAccess` — the index is in range by construction, and an
  // assertion beats a non-null claim.
  assert.notEqual(value, undefined);
  return value as T;
}

/** Yield the event loop, sometimes across a macrotask, so interleavings vary. */
async function yieldTurn(random: () => number): Promise<void> {
  if (random() < 0.5) await Promise.resolve();
  else await delay(0);
}

/**
 * The invariant, asserted at an OBSERVABLE MOMENT — after every mutation any
 * attempt makes, not merely once at the end. A ledger that overshoots and
 * corrects itself before the storm settles has still overshot, and a
 * final-state-only assertion would not see it.
 */
function assertNeverOverruns(budget: CallBudget, ceiling: number, where: string): void {
  const committed = budget.callsSpent + budget.callsReserved;
  assert.ok(
    committed <= ceiling,
    `${where}: spent ${budget.callsSpent} + reserved ${budget.callsReserved} = ${committed} exceeds the ceiling ${ceiling}`,
  );
  assert.ok(budget.callsSpent >= 0 && budget.callsReserved >= 0, `${where}: a negative column is not a budget`);
}

interface StormOutcome {
  admitted: number;
  refused: number;
  spentCalls: number;
  releasedCalls: number;
}

/**
 * One storm: N launches racing for the same ledger. Each reserves, yields, and
 * then either receives GO (spend) or fails registration (release) — the two
 * real outcomes of the launcher barrier, plus the composite's partial landing.
 */
async function storm(options: {
  budget: CallBudget;
  ceiling: number;
  attempts: number;
  random: () => number;
  costs: readonly number[];
  label: string;
  /** Fraction of launches whose registration fails. */
  failureRate: number;
  allowPartial: boolean;
}): Promise<StormOutcome> {
  const { budget, ceiling, attempts, random, costs, label, failureRate, allowPartial } = options;
  const outcome: StormOutcome = { admitted: 0, refused: 0, spentCalls: 0, releasedCalls: 0 };

  const launches = Array.from({ length: attempts }, (_unused, index) => async () => {
    await yieldTurn(random);

    // Reserve-before-launch. Synchronous by contract: no `await` may sit
    // between the ceiling check and the commit, and this is the line that
    // would break if one ever did.
    let reservationId: string;
    let cost: number;
    try {
      const reservation = budget.reserve({ cost: pick(random, costs) });
      reservationId = reservation.id;
      cost = reservation.cost;
      outcome.admitted += 1;
    } catch (error) {
      assert.ok(error instanceof CallCeilingExceeded, `${label} #${index}: unexpected ${String(error)}`);
      outcome.refused += 1;
      assertNeverOverruns(budget, ceiling, `${label} #${index} after refusal`);
      return;
    }
    assertNeverOverruns(budget, ceiling, `${label} #${index} after reserving ${cost}`);

    // The barrier window: registration, journal, status, projection. Anything
    // may interleave here, which is the entire hazard.
    await yieldTurn(random);
    assertNeverOverruns(budget, ceiling, `${label} #${index} mid-launch`);

    if (random() < failureRate) {
      budget.releaseOnRegistrationFailure(reservationId);
      outcome.releasedCalls += cost;
    } else if (allowPartial && cost > 1 && random() < 0.5) {
      const spent = 1 + Math.floor(random() * (cost - 1));
      budget.settle(reservationId, spent);
      outcome.spentCalls += spent;
      outcome.releasedCalls += cost - spent;
    } else {
      budget.spendOnGo(reservationId);
      outcome.spentCalls += cost;
    }
    assertNeverOverruns(budget, ceiling, `${label} #${index} after settling`);
  });

  await Promise.all(launches.map((launch) => launch()));
  return outcome;
}

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

test("N concurrent reservation attempts against ceiling C never yield spent + reserved > C", async () => {
  for (const seed of SEEDS) {
    for (const tier of TIERS) {
      const random = rng(seed);
      const ceiling = CALL_CEILINGS[tier];
      const attempts = 2 + Math.floor(random() * 39); // 2..40 racing launches
      const budget = new CallBudget({ taskId: `storm-${seed}-T${tier}`, tier });
      const label = `seed ${seed} · T${tier} · ${attempts} attempts`;

      const outcome = await storm({
        budget,
        ceiling,
        attempts,
        random,
        costs: [1, 1, 1, 2, 3],
        label,
        failureRate: 0.35,
        allowPartial: true,
      });

      assertNeverOverruns(budget, ceiling, `${label} at rest`);
      assert.equal(budget.callsReserved, 0, `${label}: every reservation settled`);
      assert.equal(budget.callsSpent, outcome.spentCalls, `${label}: the ledger agrees with the launches`);
      assert.ok(budget.callsSpent <= ceiling, `${label}: spend alone must fit the ceiling`);
      assert.equal(
        outcome.admitted + outcome.refused,
        attempts,
        `${label}: every attempt was either admitted or refused`,
      );
    }
  }
});

test("the storm actually pressures the ceiling — the property is not passing because nothing raced", async () => {
  // A property test that never reaches the ceiling proves only that the ledger
  // can count to three. This pins that the storms above genuinely refuse.
  const random = rng(4242);
  const budget = new CallBudget({ taskId: "pressure", tier: 1 });
  const outcome = await storm({
    budget,
    ceiling: CALL_CEILINGS[1],
    attempts: 40,
    random,
    costs: [1],
    label: "pressure",
    failureRate: 0,
    allowPartial: false,
  });
  assert.equal(outcome.admitted, 3, "exactly the ceiling is admitted when nothing is ever released");
  assert.equal(outcome.refused, 37);
  assert.equal(budget.callsSpent, 3);
});

test("with every launch reaching GO, exactly C of N concurrent attempts succeed — at every tier", async () => {
  for (const tier of TIERS) {
    const ceiling = CALL_CEILINGS[tier];
    for (const seed of [7, 99, 12345]) {
      const budget = new CallBudget({ taskId: `exact-${tier}-${seed}`, tier });
      const outcome = await storm({
        budget,
        ceiling,
        attempts: 25,
        random: rng(seed),
        costs: [1],
        label: `exact T${tier} seed ${seed}`,
        failureRate: 0,
        allowPartial: false,
      });
      assert.equal(outcome.admitted, ceiling, `T${tier}: ${outcome.admitted} admitted, expected exactly ${ceiling}`);
      assert.equal(outcome.refused, 25 - ceiling);
      assert.equal(budget.callsSpent, ceiling);
    }
  }
});

test("a storm of registration failures costs nothing, however it interleaves", async () => {
  // The claim that makes "kill it anywhere" financially safe: providers that
  // never ran never cost a call, no matter how many raced to not run.
  for (const seed of [3, 31, 314]) {
    const budget = new CallBudget({ taskId: `never-ran-${seed}`, tier: 0 });
    const outcome = await storm({
      budget,
      ceiling: CALL_CEILINGS[0],
      attempts: 30,
      random: rng(seed),
      costs: [1],
      label: `never-ran seed ${seed}`,
      failureRate: 1,
      allowPartial: false,
    });
    assert.equal(budget.callsSpent, 0, "not one call was spent");
    assert.equal(budget.callsReserved, 0);
    assert.equal(budget.remaining, 1, "the T0 ceiling is intact");
    assert.ok(outcome.releasedCalls > 0, "the storm did reserve and release, rather than being refused throughout");
  }
});

test("a composite storm never lets a partially-declared launch slip under the ceiling", async () => {
  // Every attempt declares three calls. At T2 (ceiling 5) exactly one can be
  // in flight at a time, and the second must be refused outright rather than
  // admitted at a discount.
  for (const seed of [11, 222, 3333]) {
    const random = rng(seed);
    const budget = new CallBudget({ taskId: `composite-${seed}`, tier: 2 });
    const results = await Promise.all(
      Array.from({ length: 12 }, async (_unused, index) => {
        await yieldTurn(random);
        try {
          const reservation = budget.reserveComposite(2);
          assert.equal(reservation.cost, 3);
          assertNeverOverruns(budget, CALL_CEILINGS[2], `composite seed ${seed} #${index}`);
          await yieldTurn(random);
          budget.spendOnGo(reservation.id);
          assertNeverOverruns(budget, CALL_CEILINGS[2], `composite seed ${seed} #${index} after GO`);
          return true;
        } catch (error) {
          assert.ok(error instanceof CallCeilingExceeded);
          assert.equal((error as CallCeilingExceeded).requested, 3, "the refusal names the full declared cost");
          return false;
        }
      }),
    );
    assert.equal(results.filter(Boolean).length, 1, "one composite fits in T2's five calls; a second does not");
    assert.equal(budget.callsSpent, 3);
  }
});

test("spend carried across attempts survives the storm — a retry buys no new ceiling", async () => {
  const random = rng(2718);
  const budget = new CallBudget({ taskId: "carried", tier: 2 });

  for (const attempt of [1, 2, 3, 4]) {
    if (attempt > 1) budget.beginAttempt(attempt);
    await storm({
      budget,
      ceiling: CALL_CEILINGS[2],
      attempts: 10,
      random,
      costs: [1],
      label: `carried attempt ${attempt}`,
      failureRate: 0,
      allowPartial: false,
    });
    assertNeverOverruns(budget, CALL_CEILINGS[2], `carried after attempt ${attempt}`);
  }

  assert.equal(budget.attempt, 4);
  assert.equal(budget.callsSpent, 5, "forty launches across four attempts still bought exactly T2's five calls");
  assert.equal(budget.remaining, 0);
});
