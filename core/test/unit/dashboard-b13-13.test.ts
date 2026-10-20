import test from "node:test";
import assert from "node:assert/strict";
import {
  flatColumns,
  LEDGER_COLUMNS,
  type LedgerRow,
} from "../../../dashboard/src/metrics-ledger.ts";
import type { Stats } from "../../../dashboard/shared/route-metrics.ts";

function mockStats(overrides: Partial<Stats> = {}): Stats {
  return {
    n: 1,
    settled: 1,
    runs: 1,
    landed: 1,
    states: {
      LANDED: 1,
      AWAITING_OWNER: 0,
      OPEN: 0,
      CANCELLED: 0,
      BLOCKED: 0,
    },
    firstPass: { p: 1, lo: 0.5, hi: 1 },
    clean: { p: 1, lo: 0.5, hi: 1 },
    blockedHere: 0,
    correctionsPerRow: 0,
    reworkRuns: 0,
    gateChecks: 1,
    gatePasses: 1,
    gatePassRate: 1,
    topFirstRoundFail: null,
    medianMinutes: 1,
    turnsPerRow: 1,
    callsPerRow: 1,
    toolsPerRow: 1,
    tools: { read: 1, search: 0, edit: 0, exec: 0, other: 0 },
    toolTotal: 1,
    toolErrorRate: 0,
    tokens: { input: 10, cacheRead: 0, cacheWrite: 0, output: 10, reasoning: 0, total: 20 },
    priced: 1,
    listTotal: 0.01,
    listPerRow: 0.01,
    listPerLanded: 0.01,
    costAuthority: { "catalog-estimate": 1 },
    identity: { "stream-authoritative": 1 },
    effortSource: { journal: 1 },
    unrankable: 0,
    unrankableReasons: { "partial-usage": 0, degraded: 0 },
    unconfirmed: 0,
    agentHours: 1,
    recovered: 0,
    corrected: 0,
    claims: 0,
    refuted: 0,
    honestStops: 0,
    guardrailHits: 0,
    landedPerAgentHour: 1,
    ...overrides,
  };
}

function mockRow(key: string, stats: Stats): LedgerRow {
  return {
    key,
    title: key,
    detail: "1 role-rows",
    provider: null,
    dot: null,
    run: null,
    stats,
  };
}

test("B13-13: two groups with equal sort values but different displayed text are NOT flat", () => {
  const topFailCol = LEDGER_COLUMNS.find((c) => c.id === "top-fail")!;
  assert.ok(topFailCol, "top-fail column exists");

  const rowA = mockRow("a", mockStats({ topFirstRoundFail: { gate: "gate-a", rows: 3 } }));
  const rowB = mockRow("b", mockStats({ topFirstRoundFail: { gate: "gate-b", rows: 3 } }));

  // Sort values match (3 vs 3), but displayed cells differ ('gate-a ×3' vs 'gate-b ×3')
  assert.equal(topFailCol.value(rowA.stats), 3);
  assert.equal(topFailCol.value(rowB.stats), 3);
  assert.notEqual(topFailCol.cell(rowA.stats).text, topFailCol.cell(rowB.stats).text);

  const flat = flatColumns([rowA, rowB], [topFailCol]);
  assert.equal(flat.has("top-fail"), false, "different gates with equal counts must NOT be marked flat");
});

test("B13-13: two groups with identical cells are correctly marked flat", () => {
  const topFailCol = LEDGER_COLUMNS.find((c) => c.id === "top-fail")!;

  const rowA = mockRow("a", mockStats({ topFirstRoundFail: { gate: "gate-a", rows: 3 } }));
  const rowB = mockRow("b", mockStats({ topFirstRoundFail: { gate: "gate-a", rows: 3 } }));

  assert.equal(topFailCol.value(rowA.stats), 3);
  assert.equal(topFailCol.value(rowB.stats), 3);
  assert.equal(topFailCol.cell(rowA.stats).text, topFailCol.cell(rowB.stats).text);

  const flat = flatColumns([rowA, rowB], [topFailCol]);
  assert.equal(flat.has("top-fail"), true, "identical sort values and cells must be marked flat");
});

test("B13-13: terminal strip column compares state counts across rows", () => {
  const stripCol = LEDGER_COLUMNS.find((c) => c.id === "strip")!;
  assert.ok(stripCol, "strip column exists");

  // Both have landed = 1, runs = 2 (ratio = 0.5, text is ""), but different state breakdowns
  const rowA = mockRow(
    "a",
    mockStats({
      landed: 1,
      runs: 2,
      states: { LANDED: 1, BLOCKED: 1, AWAITING_OWNER: 0, OPEN: 0, CANCELLED: 0 },
    }),
  );
  const rowB = mockRow(
    "b",
    mockStats({
      landed: 1,
      runs: 2,
      states: { LANDED: 1, CANCELLED: 1, AWAITING_OWNER: 0, OPEN: 0, BLOCKED: 0 },
    }),
  );

  assert.equal(stripCol.value(rowA.stats), stripCol.value(rowB.stats));
  assert.equal(stripCol.cell(rowA.stats).text, stripCol.cell(rowB.stats).text);

  const flatDiffStates = flatColumns([rowA, rowB], [stripCol]);
  assert.equal(flatDiffStates.has("strip"), false, "strip with differing state counts must NOT be flat");

  const rowC = mockRow(
    "c",
    mockStats({
      landed: 1,
      runs: 2,
      states: { LANDED: 1, BLOCKED: 1, AWAITING_OWNER: 0, OPEN: 0, CANCELLED: 0 },
    }),
  );

  const flatSameStates = flatColumns([rowA, rowC], [stripCol]);
  assert.equal(flatSameStates.has("strip"), true, "strip with identical state counts must be flat");
});

test("B13-13: columns with differing notes are NOT flat", () => {
  const fpCol = LEDGER_COLUMNS.find((c) => c.id === "fp")!;
  assert.ok(fpCol, "fp column exists");

  // Same rate p = 0.5, but different confidence intervals
  const rowA = mockRow("a", mockStats({ firstPass: { p: 0.5, lo: 0.2, hi: 0.8 } }));
  const rowB = mockRow("b", mockStats({ firstPass: { p: 0.5, lo: 0.1, hi: 0.9 } }));

  assert.equal(fpCol.value(rowA.stats), fpCol.value(rowB.stats));
  assert.equal(fpCol.cell(rowA.stats).text, fpCol.cell(rowB.stats).text);
  assert.notEqual(fpCol.cell(rowA.stats).note, fpCol.cell(rowB.stats).note);

  const flatDiffNote = flatColumns([rowA, rowB], [fpCol]);
  assert.equal(flatDiffNote.has("fp"), false, "differing notes must NOT be flat");

  const rowC = mockRow("c", mockStats({ firstPass: { p: 0.5, lo: 0.2, hi: 0.8 } }));
  const flatSameNote = flatColumns([rowA, rowC], [fpCol]);
  assert.equal(flatSameNote.has("fp"), true, "identical text and note must be flat");
});
