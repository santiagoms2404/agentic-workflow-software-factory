import assert from "node:assert/strict";
import { test } from "node:test";
import { K1_FIELD_IDS } from "../../../src/contracts/driver-preflight.ts";
import { NO_TRAP_KINDS, NO_TRAPS, PENDING, TRAPS, TRAP_CUT } from "../../../src/traps/catalogue.ts";
import { SEED_CUT, isPopulationStop } from "../../../src/traps/population.ts";
import { SEEDS } from "../../../src/traps/seeds.ts";

test("trap ids are unique and contiguous from TR-01", () => {
  assert.equal(new Set(TRAPS.map(trap => trap.id)).size, TRAPS.length);
  assert.deepEqual(TRAPS.map(trap => trap.id),
    Array.from({ length: TRAPS.length }, (_, index) => `TR-${String(index + 1).padStart(2, "0")}`));
  for (const trap of TRAPS) {
    assert.ok(trap.family.trim());
    assert.ok(trap.title.trim());
    assert.ok(trap.refusal.trim());
    assert.ok(["k1-field", "start", "run-before-l4", "owner-act", "shift-admission"].includes(trap.refusalPoint));
  }
});

test("every confirmed seed is assigned exactly once, with no unknown keys", () => {
  const assigned = [...TRAPS.flatMap(trap => trap.seeds), ...NO_TRAPS.map(entry => entry.seed),
    ...PENDING.flatMap(entry => entry.seeds)];
  assert.equal(assigned.length, 62);
  assert.equal(new Set(assigned).size, assigned.length);
  assert.deepEqual([...assigned].sort(), SEEDS.map(seed => seed.id).sort());
  for (const seed of SEEDS) {
    if (seed.outcome === "refused") {
      assert.equal(TRAPS.filter(trap => trap.seeds.includes(seed.id)).length, 1, seed.id);
    } else if (seed.outcome === "gap") {
      assert.equal(PENDING.filter(entry => entry.task === seed.pendingTask && entry.seeds.includes(seed.id)).length, 1, seed.id);
    } else {
      assert.deepEqual(NO_TRAPS.find(entry => entry.seed === seed.id),
        { seed: seed.id, kind: seed.outcome, evidence: seed.evidence });
    }
  }
});

test("no-trap reasons use the closed vocabulary and retain the confirmed evidence", () => {
  assert.deepEqual(NO_TRAP_KINDS, ["fixed", "after-spend", "owner", "unexplained", "not-a-stop"]);
  const counts = Object.fromEntries(NO_TRAP_KINDS.map(kind => [kind, NO_TRAPS.filter(entry => entry.kind === kind).length]));
  assert.deepEqual(counts, { fixed: 4, "after-spend": 25, owner: 3, unexplained: 9, "not-a-stop": 7 });
  for (const entry of NO_TRAPS) {
    assert.ok((NO_TRAP_KINDS as readonly string[]).includes(entry.kind));
    assert.ok(entry.evidence.trim());
    if (entry.kind === "not-a-stop") assert.ok("gotcha" in SEEDS.find(seed => seed.id === entry.seed)!.source);
  }
});

test("pending gaps stay under the confirmed M4 tasks, not prematurely assigned trap ids", () => {
  assert.deepEqual(PENDING, [
    { task: "T11", seeds: ["S21", "S24"] },
    { task: "T12", seeds: ["C5-baseline", "C8-adopt", "C8-later-grant"] },
  ]);
  assert.equal(new Set(PENDING.map(entry => entry.task)).size, PENDING.length);
  assert.equal(PENDING.flatMap(entry => entry.seeds).length, 5);
});

test("TRAP_CUT parses as the same instant used by the one population rule", () => {
  assert.equal(TRAP_CUT, "2026-10-07T23:59:59Z");
  assert.equal(TRAP_CUT, SEED_CUT);
  assert.ok(Number.isFinite(Date.parse(TRAP_CUT)));
  const attempt = { project: "synthetic", taskId: "cut-boundary", attempt: 1,
    lifecycleState: "BLOCKED", workflow: "build-review", terminalAt: TRAP_CUT };
  assert.equal(isPopulationStop(attempt, new Set([attempt.project])), true);
  assert.equal(isPopulationStop({ ...attempt, terminalAt: "2026-10-08T00:00:00Z" }, new Set([attempt.project])), false);
});

test("the catalogue assigns all eight K1 fields and the four complementary existing refusals", () => {
  assert.deepEqual(TRAPS.slice(0, 8).map(trap => trap.family), K1_FIELD_IDS);
  assert.deepEqual(TRAPS.filter(trap => trap.refusalPoint !== "k1-field").map(trap => [trap.id, trap.refusal]), [
    ["TR-09", "ProtectedGrantRefused"], ["TR-10", "ProductionConfigSnapshotMismatch"],
    ["TR-11", "E_BACKEND_FAILURE"], ["TR-12", "AttemptWorktreeExists"],
    ["TR-13", "ProductionExecutableUnavailable"], ["TR-14", "ProductionQuotaRefused"],
    ["TR-15", "ProductionQuotaRefused"],
  ]);
  assert.deepEqual(TRAPS.flatMap(trap => trap.seeds).sort(), ["G02", "G09", "G11", "S11", "S17", "S27", "S34", "S36", "S42"]);
  // S34's two refusal points and S27's partial K1 coverage do not duplicate
  // their ledger assignment; S01/S15/S47 and G01 remain no-trap entries.
  for (const seed of ["S01", "S15", "S47", "G01"]) assert.ok(NO_TRAPS.some(entry => entry.seed === seed));
});

test("the ledger applies the dated G02-S corrections without changing its 62-row population", () => {
  assert.equal(SEEDS.length, 62);
  const row26 = SEEDS.find(seed => seed.id === "S26")!;
  assert.ok("task" in row26.source);
  assert.equal(row26.source.task, "task-8b-protected-quota-foundation-continuation");
  for (const id of ["S21", "S24"]) {
    const seed = SEEDS.find(row => row.id === id)!;
    assert.equal(seed.outcome, "gap");
    assert.equal(seed.pendingTask, "T11");
    assert.match(seed.evidence, /placement\.yaml/u);
  }
  const terminalDays = ["10-05", "10-05", "10-05", "10-06", "10-06", "10-06", "10-07", "10-07", "10-07", "08-15", "08-13"];
  terminalDays.forEach((day, index) => {
    const seed = SEEDS.find(row => row.id === `S${String(index + 37)}`)!;
    assert.equal(seed.date, `2026-${day}`, seed.id);
    assert.equal(seed.dateBasis, "terminal-day", seed.id);
  });
  assert.equal(SEEDS.filter(seed => "project" in seed.source && seed.dateBasis === "terminal-day").length, 47);
  const totals = Object.fromEntries(["refused", "gap", ...NO_TRAP_KINDS].map(kind =>
    [kind, SEEDS.filter(seed => seed.outcome === kind).length]));
  assert.deepEqual(totals, { refused: 9, gap: 5, fixed: 4, "after-spend": 25, owner: 3, unexplained: 9, "not-a-stop": 7 });
});
