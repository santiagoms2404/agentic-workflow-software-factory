// T4 — the 10 × 10 transition matrix.
//
// 100 ordered pairs. Exactly 25 accept. Exactly 75 throw, and each throws the
// error its class table row names: 27 TerminalAttempt · 10 AlreadyInState ·
// 6 HumanGateBypass · 32 IllegalTransition.
//
// The legal set is enumerated literally in `_lifecycle-tables.ts` and is never
// read back out of the implementation. RED until T5 writes
// `core/src/state/task-machine.ts`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALREADY_IN_STATE_PAIRS,
  HUMAN_GATE_BYPASS_PAIRS,
  ILLEGAL_TRANSITION_PAIRS,
  LEGAL_EDGES,
  REJECTION_CLASS_BY_PAIR,
  SPAWN_SITE_EDGES,
  TASK_STATES,
  TERMINAL_ATTEMPT_PAIRS,
  allOrderedPairs,
  edge,
  pairKey,
  type Pair,
  type RejectionName,
  type TaskState,
} from "./_lifecycle-tables.ts";
import {
  expectAccepted,
  expectRejection,
  matrixInput,
  rejectionNameOf,
  taskMachine,
  validInput,
} from "./_lifecycle-harness.ts";

// ---------------------------------------------------------------------------
// The transcription itself. These run without the implementation, on purpose:
// a mistake in the tables would otherwise surface only as a mystery in T5.
// ---------------------------------------------------------------------------

test("the four rejection classes partition the 75 illegal pairs exactly", () => {
  assert.equal(TERMINAL_ATTEMPT_PAIRS.length, 27, "terminal-source pairs");
  assert.equal(ALREADY_IN_STATE_PAIRS.length, 10, "self-transition pairs");
  assert.equal(HUMAN_GATE_BYPASS_PAIRS.length, 6, "human-gate-bypass pairs");
  assert.equal(ILLEGAL_TRANSITION_PAIRS.length, 32, "everything-else pairs");
  assert.equal(27 + 10 + 6 + 32, 75);

  // No pair is claimed by two classes, and none is claimed twice by one.
  assert.equal(REJECTION_CLASS_BY_PAIR.size, 75, "a pair appears in two classes");

  // 25 legal + 75 illegal = the whole 10 × 10 matrix, with no pair unaccounted for.
  const legal = new Set(LEGAL_EDGES.map((e) => pairKey(e.from, e.to)));
  assert.equal(legal.size, 25, "the L-table names a pair twice");
  const unclassified = allOrderedPairs()
    .map(([from, to]) => pairKey(from, to))
    .filter((key) => !legal.has(key) && !REJECTION_CLASS_BY_PAIR.has(key));
  assert.deepEqual(unclassified, [], "pairs in neither the legal set nor a rejection class");

  const bothLegalAndIllegal = [...legal].filter((key) => REJECTION_CLASS_BY_PAIR.has(key));
  assert.deepEqual(bothLegalAndIllegal, [], "pairs claimed as both legal and illegal");
});

test("the L-table names twenty-five edges, L1 through L25, with six spawn sites", () => {
  assert.equal(LEGAL_EDGES.length, 25);
  assert.deepEqual(
    LEGAL_EDGES.map((e) => e.id),
    Array.from({ length: 25 }, (_, i) => `L${i + 1}`),
  );
  // "spawn ⇔ entering an executing state" — the closure, not an enumeration.
  const bySpawnFlag = LEGAL_EDGES.filter((e) => e.spawnSite).map((e) => e.id);
  const byTarget = LEGAL_EDGES.filter((e) => e.to === "RUNNING" || e.to === "REVIEWING").map((e) => e.id);
  assert.deepEqual(bySpawnFlag, [...SPAWN_SITE_EDGES]);
  assert.deepEqual(byTarget, [...SPAWN_SITE_EDGES]);
});

// ---------------------------------------------------------------------------
// The machine.
// ---------------------------------------------------------------------------

test("the machine knows exactly the plan's ten states, in the plan's order", async () => {
  const { TASK_STATES: states } = await taskMachine();
  assert.deepEqual([...states], [...TASK_STATES]);
});

test("all twenty-five legal transitions are accepted with their guards satisfied", async () => {
  const failures: string[] = [];
  for (const e of LEGAL_EDGES) {
    try {
      const result = await expectAccepted(validInput(e.id));
      if (result.edge !== e.id) failures.push(`${e.id}: reported edge ${result.edge}`);
      if (result.from !== e.from) failures.push(`${e.id}: reported from ${result.from}`);
      if (result.to !== e.to) failures.push(`${e.id}: reported to ${result.to}`);
    } catch (error) {
      failures.push(`${e.id} (${e.from} -> ${e.to}): ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("exactly 25 of the 100 ordered pairs are accepted, and they are the L-table's 25", async () => {
  const accepted: string[] = [];
  for (const [from, to] of allOrderedPairs()) {
    if ((await rejectionNameOf(matrixInput(from, to))) === null) accepted.push(pairKey(from, to));
  }
  assert.deepEqual(
    accepted.sort(),
    LEGAL_EDGES.map((e) => pairKey(e.from, e.to)).sort(),
  );
  assert.equal(accepted.length, 25);
});

test("exactly 75 of the 100 ordered pairs are rejected", async () => {
  let rejected = 0;
  for (const [from, to] of allOrderedPairs()) {
    if ((await rejectionNameOf(matrixInput(from, to))) !== null) rejected += 1;
  }
  assert.equal(rejected, 75);
});

test("the class -> error mapping holds pair by pair across the whole matrix", async () => {
  const mismatches: string[] = [];
  for (const [from, to] of allOrderedPairs()) {
    const key = pairKey(from, to);
    const expected = REJECTION_CLASS_BY_PAIR.get(key) ?? null;
    const actual = await rejectionNameOf(matrixInput(from, to));
    if (actual !== expected) {
      mismatches.push(`${key}: expected ${expected ?? "accepted"}, got ${actual ?? "accepted"}`);
    }
  }
  assert.deepEqual(mismatches, []);
});

const CLASS_CASES: readonly (readonly [RejectionName, readonly Pair[], number])[] = [
  ["TerminalAttempt", TERMINAL_ATTEMPT_PAIRS, 27],
  ["AlreadyInState", ALREADY_IN_STATE_PAIRS, 10],
  ["HumanGateBypass", HUMAN_GATE_BYPASS_PAIRS, 6],
  ["IllegalTransition", ILLEGAL_TRANSITION_PAIRS, 32],
];

for (const [expected, pairs, count] of CLASS_CASES) {
  test(`all ${count} ${expected} pairs throw ${expected}`, async () => {
    assert.equal(pairs.length, count);
    const failures: string[] = [];
    for (const [from, to] of pairs) {
      try {
        await expectRejection(expected, matrixInput(from, to), { because: `class table: ${expected}` });
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
    assert.deepEqual(failures, []);
  });
}

test("every rejection names the ordered pair it refused", async () => {
  // A journal entry that says "illegal" without saying which pair is useless
  // to the human reading it at 2 a.m.
  const missing: string[] = [];
  const { transition } = await taskMachine();
  for (const [from, to] of allOrderedPairs()) {
    const key = pairKey(from, to);
    if (!REJECTION_CLASS_BY_PAIR.has(key)) continue;
    try {
      transition(matrixInput(from, to));
      missing.push(`${key}: accepted`);
    } catch (error) {
      const detailed = error as Error & Record<string, unknown>;
      if (detailed["from"] !== from || detailed["to"] !== to) {
        missing.push(`${key}: error carries ${String(detailed["from"])} -> ${String(detailed["to"])}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("`awsf retry` is not a transition — a sealed attempt cannot walk back to DRAFT", async () => {
  // The remedy for BLOCKED is attempt n+1 at DRAFT, minted outside the machine.
  for (const from of ["BLOCKED", "LANDED", "CANCELLED"] as const) {
    await expectRejection("TerminalAttempt", matrixInput(from, "DRAFT"), { because: "awsf retry" });
  }
});

// ---------------------------------------------------------------------------
// The spawn-site closure.
// ---------------------------------------------------------------------------

test("the six spawn-site edges accept a declared spawn and report spawnSite", async () => {
  const failures: string[] = [];
  for (const id of SPAWN_SITE_EDGES) {
    try {
      const result = await expectAccepted(validInput(id));
      if (result.spawnSite !== true) failures.push(`${id}: spawnSite ${String(result.spawnSite)}`);
      if (result.spends.calls !== 1) failures.push(`${id}: reserved ${result.spends.calls} calls, expected 1`);
    } catch (error) {
      failures.push(`${id}: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("the other nineteen legal edges report spawnSite false and reserve no call", async () => {
  const failures: string[] = [];
  const nonSpawn = LEGAL_EDGES.filter((e) => !e.spawnSite);
  assert.equal(nonSpawn.length, 19);
  for (const e of nonSpawn) {
    try {
      const result = await expectAccepted(validInput(e.id));
      if (result.spawnSite !== false) failures.push(`${e.id}: spawnSite ${String(result.spawnSite)}`);
      if (result.spends.calls !== 0) failures.push(`${e.id}: reserved ${result.spends.calls} calls`);
    } catch (error) {
      failures.push(`${e.id}: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("a spawn on any edge that does not enter RUNNING or REVIEWING throws IllegalSpawnSite", async () => {
  const failures: string[] = [];
  for (const e of LEGAL_EDGES.filter((x) => !x.spawnSite)) {
    try {
      await expectRejection(
        "IllegalSpawnSite",
        { ...validInput(e.id), spawn: { cost: 1 } },
        { because: `${e.id} is not a spawn site` },
      );
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  assert.deepEqual(failures, []);
});

test("a spawn-site edge that declares no spawn also throws IllegalSpawnSite", async () => {
  // The plan states the rule as a closure — spawn ⇔ entering an executing
  // state — so both directions are the same invariant. An edge into RUNNING
  // that reserves nothing would be a provider launched off the books.
  const failures: string[] = [];
  for (const id of SPAWN_SITE_EDGES) {
    const input = validInput(id);
    delete input.spawn;
    try {
      await expectRejection("IllegalSpawnSite", input, { because: `${id} entered without a reservation` });
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  assert.deepEqual(failures, []);
});

test("an illegal pair that also attempts a spawn still hears the pair complaint first", async () => {
  // IllegalSpawnSite must not mask the more fundamental defect: the pair.
  const cases: readonly (readonly [TaskState, TaskState, RejectionName])[] = [
    ["DRAFT", "RUNNING", "IllegalTransition"],
    ["RUNNING", "REVIEWING", "IllegalTransition"],
    ["LANDED", "RUNNING", "TerminalAttempt"],
    ["RUNNING", "RUNNING", "AlreadyInState"],
  ];
  for (const [from, to, expected] of cases) {
    await expectRejection(
      expected,
      { ...matrixInput(from, to), spawn: { cost: 1 } },
      { because: "spawn attempted on an illegal pair" },
    );
  }
});

test("the L-table's spawn column and the machine's report agree edge by edge", async () => {
  const failures: string[] = [];
  for (const id of LEGAL_EDGES.map((e) => e.id)) {
    try {
      const result = await expectAccepted(validInput(id));
      if (result.spawnSite !== edge(id).spawnSite) {
        failures.push(`${id}: machine says spawnSite=${String(result.spawnSite)}, L-table says ${String(edge(id).spawnSite)}`);
      }
    } catch (error) {
      failures.push(`${id}: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});
