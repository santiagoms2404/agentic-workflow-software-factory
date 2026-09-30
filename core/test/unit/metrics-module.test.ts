import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EVIDENCE_SOURCES,
  LENS_FACETS,
  STATE_GROUPS,
  TOOL_CLASSES,
  applyLens,
  UNRANKABLE_REASONS,
  canonicalModel,
  depth,
  isRankable,
  flatColumns,
  frontier,
  fullLens,
  recommend,
  routeKey,
  stats,
  verdicts,
  wilson,
  type Interval,
  type LensFacet,
  type MetricsRoute,
  type MetricsRow,
  type PriorLookup,
  type RowPrice,
} from "../../../dashboard/shared/route-metrics.ts";
import { STATE_GROUPS as CORE_STATE_GROUPS, type RoleRow } from "../../src/metrics/role-rows.ts";
import { TOOL_CLASSES as CORE_TOOL_CLASSES } from "../../src/metrics/tool-class.ts";

// Core passes its role-rows straight in: this compiles only while `RoleRow` satisfies `MetricsRow`.
const acceptsRoleRows = (rows: readonly RoleRow[]): readonly MetricsRow[] => rows;
void acceptsRoleRows;

const OPUS_HIGH: MetricsRoute = { adapter: "claude", provider: "anthropic", model: "opus", effort: "high" };
const SONNET_HIGH: MetricsRoute = { adapter: "claude", provider: "anthropic", model: "sonnet", effort: "high" };
const SOL_HIGH: MetricsRoute = { adapter: "codex", provider: "openai-codex", model: "gpt-6-sol", effort: "high" };
const LUNA_LOW: MetricsRoute = { adapter: "codex", provider: "openai-codex", model: "gpt-6-luna", effort: "low" };

let sessions = 0;

type RowInput = Partial<Omit<MetricsRow, "tokens" | "tools" | "gates">> & {
  readonly tokens?: Partial<MetricsRow["tokens"]>;
  readonly tools?: Partial<MetricsRow["tools"]>;
  readonly gates?: Partial<MetricsRow["gates"]>;
  /** Test-only: the row's list-price equivalent, read by `PRICE`. */
  readonly usd?: number | null;
};

function row(input: RowInput = {}): MetricsRow & { readonly usd: number | null } {
  sessions += 1;
  const { tokens, tools, gates, usd, ...rest } = input;
  return {
    sessionId: `s${sessions}`,
    role: "builder",
    route: OPUS_HIGH,
    effortSource: "journal",
    identityProvenance: "stream-authoritative",
    resolvedModel: "claude-opus-5-5",
    calls: 3,
    turns: 3,
    minutes: 10,
    corrections: 0,
    settled: true,
    firstPass: true,
    cleanCompletion: true,
    blockedHere: false,
    costAuthority: "unavailable",
    toolErrors: 0,
    guardrailHits: 0,
    claims: 1,
    refuted: 0,
    honestStops: 0,
    recovered: 0,
    corrected: 0,
    stateGroup: "LANDED",
    workflow: "build",
    project: "awsf",
    reworkPhases: 0,
    observabilityDegraded: false,
    usageAuthority: "provider",
    ...rest,
    tokens: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 1000, cacheWriteTokens: 0, reasoningTokens: 5, ...tokens },
    tools: { read: 4, search: 2, edit: 1, exec: 3, other: 0, ...tools },
    gates: { pass: 2, total: 2, firstRoundFail: [], ...gates },
    usd: usd === undefined ? 1 : usd,
  };
}

/** `count` rows on one route, the first `passes` of them first pass. */
function rows(count: number, passes: number, input: RowInput = {}): Array<MetricsRow & { usd: number | null }> {
  return Array.from({ length: count }, (_, index) => row({ firstPass: index < passes, cleanCompletion: index < passes, ...input }));
}

const PRICE: RowPrice = (candidate) => (candidate as MetricsRow & { usd?: number | null }).usd ?? null;
const NO_PRIOR: PriorLookup = () => null;

function near(actual: number, expected: number, tolerance = 5e-5): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

// ---------------------------------------------------------------------------

test("the module is pure: it imports nothing and touches no clock, network or process", () => {
  const source = readFileSync(new URL("../../../dashboard/shared/route-metrics.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /^\s*import\s/m);
  assert.doesNotMatch(code, /\b(fetch|Date|process|require|document|window|localStorage|globalThis)\b/);
});

test("the module's vocabularies match core's", () => {
  assert.deepEqual([...STATE_GROUPS], [...CORE_STATE_GROUPS]);
  assert.deepEqual([...TOOL_CLASSES], [...CORE_TOOL_CLASSES]);
  assert.deepEqual([...EVIDENCE_SOURCES], ["production", "proving-ground"]);
});

test("wilson reproduces Newcombe's (1998) textbook intervals at z 1.96", () => {
  for (const [k, n, lo, hi] of [[81, 263, 0.2553, 0.3662], [15, 148, 0.0624, 0.1605], [0, 20, 0, 0.1611], [1, 29, 0.0061, 0.1718]] as const) {
    const interval = wilson(k, n);
    assert.equal(interval.p, k / n);
    near(interval.lo, lo);
    near(interval.hi, hi);
  }
  const all = wilson(10, 10);
  assert.equal(all.hi, 1);
  near(all.lo, 0.7225);
});

test("wilson with no observations has no point estimate and spans [0, 1]", () => {
  assert.deepEqual(wilson(0, 0), { p: null, lo: 0, hi: 1 });
});

test("depth is sunk at n 0, raised at a half-width of exactly 0.15, flat just past it", () => {
  const tight: Interval = { p: 0.5, lo: 0.45, hi: 0.55 };
  assert.equal(depth(tight, 0), "sunk");
  assert.equal(depth(wilson(0, 0), 0), "sunk");
  // 0.65 - 0.35 is 0.30000000000000004 in binary; on paper it is exactly 0.3.
  assert.equal(depth({ p: 0.5, lo: 0.35, hi: 0.65 }, 40), "raised");
  assert.equal(depth({ p: 0.5, lo: 0.2, hi: 0.5 }, 40), "raised");
  assert.equal(depth({ p: 0.5, lo: 0.35, hi: 0.6501 }, 40), "flat");
  assert.equal(depth(wilson(3, 5), 5), "flat");
  assert.equal(depth(wilson(200, 400), 400), "raised");
});

test("routeKey reads the selector and the adapter form as one route and ignores a missing provider", () => {
  const journal: MetricsRoute = { adapter: "claude", provider: "anthropic", model: "opus", effort: "high" };
  const config: MetricsRoute = { adapter: "claude", provider: null, model: "claude:opus", effort: "high" };
  assert.equal(canonicalModel(config), "opus");
  assert.equal(routeKey(journal), "claude/opus@high");
  assert.equal(routeKey(config), routeKey(journal));
  // A prefix that is not the adapter's is part of the model id.
  assert.equal(canonicalModel({ adapter: "codex", provider: null, model: "claude:opus", effort: "high" }), "claude:opus");
  const mixed: MetricsRoute = { adapter: null, provider: null, model: null, effort: null };
  assert.equal(routeKey(mixed), null);
  assert.equal(routeKey({ ...journal, effort: null }), null);
});

test("stats folds every aggregate the prototype computes", () => {
  const blocked = row({
    stateGroup: "BLOCKED", blockedHere: true, minutes: 20, corrections: 2, corrected: 1, recovered: 1, toolErrors: 2,
    gates: { pass: 1, total: 3, firstRoundFail: ["tests", "lint"] }, guardrailHits: 1, cleanCompletion: false,
    costAuthority: "catalog-estimate", identityProvenance: "route-attributed", effortSource: null, reworkPhases: 1,
    tokens: { inputTokens: null, reasoningTokens: null }, usd: null,
  });
  const landed = row({ minutes: 30, gates: { pass: 2, total: 3, firstRoundFail: ["lint"] }, usd: 3 });
  const second = row({ sessionId: landed.sessionId, role: "reviewer", minutes: null, usd: 1 });
  const open = row({ stateGroup: "OPEN", settled: false, firstPass: false, cleanCompletion: false, minutes: 10, usd: 2 });
  const s = stats([blocked, landed, second, open], PRICE);

  assert.equal(s.n, 4);
  assert.equal(s.settled, 3);
  assert.equal(s.runs, 3);
  assert.equal(s.landed, 1);
  assert.deepEqual(s.states, { LANDED: 1, AWAITING_OWNER: 0, OPEN: 1, CANCELLED: 0, BLOCKED: 1 });
  // The blocked row stays first pass: first pass and blocked here are independent.
  assert.equal(s.firstPass.p, 1);
  assert.deepEqual(s.firstPass, wilson(3, 3));
  assert.deepEqual(s.clean, wilson(2, 3));
  assert.equal(s.blockedHere, 1);
  assert.equal(s.correctionsPerRow, 0.5);
  assert.equal(s.reworkRuns, 1);
  assert.equal(s.gateChecks, 10);
  assert.equal(s.gatePasses, 7);
  assert.equal(s.gatePassRate, 0.7);
  assert.deepEqual(s.topFirstRoundFail, { gate: "lint", rows: 2 });
  assert.equal(s.medianMinutes, 20);
  assert.equal(s.turnsPerRow, 3);
  assert.equal(s.callsPerRow, 3);
  assert.deepEqual(s.tools, { read: 16, search: 8, edit: 4, exec: 12, other: 0 });
  assert.equal(s.toolTotal, 40);
  assert.equal(s.toolsPerRow, 10);
  assert.equal(s.toolErrorRate, 2 / 40);
  assert.deepEqual(s.tokens, { input: 300, cacheRead: 4000, cacheWrite: 0, output: 40, reasoning: 15, total: 340 });
  assert.equal(s.priced, 3);
  assert.equal(s.listTotal, 6);
  assert.equal(s.listPerRow, 2);
  assert.equal(s.listPerLanded, 6);
  assert.deepEqual(s.costAuthority, { "catalog-estimate": 1, unavailable: 3 });
  assert.deepEqual(s.identity, { "route-attributed": 1, "stream-authoritative": 3 });
  assert.deepEqual(s.effortSource, { none: 1, journal: 3 });
  assert.equal(s.unrankable, 1);
  assert.deepEqual(s.unrankableReasons, { "route-attributed": 1, "partial-usage": 0, degraded: 0 });
  assert.equal(s.guardrailHits, 1);
  assert.equal(s.claims, 4);
  assert.equal(s.recovered, 1);
  assert.equal(s.corrected, 1);
  assert.equal(s.agentHours, 1);
  assert.equal(s.landedPerAgentHour, 1);
});

test("stats on no rows reports no rates rather than zeros", () => {
  const s = stats([], PRICE);
  assert.equal(s.firstPass.p, null);
  assert.equal(s.correctionsPerRow, null);
  assert.equal(s.gatePassRate, null);
  assert.equal(s.topFirstRoundFail, null);
  assert.equal(s.medianMinutes, null);
  assert.equal(s.toolErrorRate, null);
  assert.equal(s.listTotal, null);
  assert.equal(s.listPerRow, null);
  assert.equal(s.listPerLanded, null);
  assert.equal(s.landedPerAgentHour, null);
  assert.equal(s.tokens.total, null);
});

test("the lens filters by facet and route focus, and a new facet is one more entry of data", () => {
  const data = [
    row({ role: "builder", route: OPUS_HIGH }),
    row({ role: "reviewer", route: SOL_HIGH, workflow: "prove" }),
    row({ role: "builder", route: SOL_HIGH, stateGroup: "BLOCKED", taskClass: "ui" }),
  ];
  assert.deepEqual(LENS_FACETS.map((facet) => facet.id), ["role", "model", "effort", "state", "workflow", "project", "source"]);
  const all = fullLens(data);
  assert.equal(applyLens(data, all).length, 3);
  assert.deepEqual(applyLens(data, { ...all, facets: { ...all.facets, role: new Set(["builder"]) } }), [data[0], data[2]]);
  assert.deepEqual(applyLens(data, { ...all, facets: { ...all.facets, source: new Set(["proving-ground"]) } }), [data[1]]);
  assert.deepEqual(applyLens(data, { ...all, facets: { ...all.facets, model: new Set(["gpt-6-sol"]) } }), [data[1], data[2]]);
  assert.deepEqual(applyLens(data, { ...all, route: "codex/gpt-6-sol@high" }), [data[1], data[2]]);
  // A facet the lens has no entry for admits every row.
  assert.equal(applyLens(data, { facets: {}, route: null }).length, 3);

  const withClass: readonly LensFacet[] = [...LENS_FACETS, { id: "taskClass", title: "Task class", value: (candidate) => candidate.taskClass ?? null }];
  const classLens = fullLens(data, withClass);
  assert.deepEqual([...classLens.facets["taskClass"]!], [null, "ui"]);
  assert.deepEqual(applyLens(data, { ...classLens, facets: { ...classLens.facets, taskClass: new Set(["ui"]) } }, withClass), [data[2]]);
});

test("frontier: only routes with 5 settled rows shape the line, the rest are hollow, and exact ties both sit on it", () => {
  const data = [
    ...rows(8, 6, { route: OPUS_HIGH, usd: 4 }),
    ...rows(8, 6, { route: SONNET_HIGH, usd: 4 }), // ties opus exactly
    ...rows(8, 4, { route: SOL_HIGH, usd: 4 }), // same cost, lower yield: dominated
    ...rows(4, 4, { route: LUNA_LOW, usd: 0.1 }), // cheapest and best, but hollow
    ...rows(6, 6, { role: "reviewer", route: OPUS_HIGH }), // another role never enters
    ...rows(6, 6, { route: { adapter: null, provider: null, model: null, effort: null } }), // route-mixed: no key
  ];
  const front = frontier(data, "builder", "first-pass", "list-per-row", PRICE);
  assert.deepEqual(front.points.map((point) => [point.key, point.hollow, point.onFrontier]), [
    ["codex/gpt-6-luna@low", true, false],
    ["claude/opus@high", false, true],
    ["claude/sonnet@high", false, true],
    ["codex/gpt-6-sol@high", false, false],
  ]);
  assert.deepEqual(front.line.map((point) => point.key), ["claude/opus@high", "claude/sonnet@high"]);
  for (const point of front.points) assert.equal(point.role, "builder");

  const byMinutes = frontier(data, "builder", "landed", "median-minutes", PRICE);
  assert.equal(byMinutes.points.find((point) => point.key === "claude/opus@high")?.n, 8);
});

test("frontier y metrics: not blocked here and run landed use their own counts", () => {
  const data = [
    ...rows(4, 4, { route: OPUS_HIGH }),
    row({ route: OPUS_HIGH, blockedHere: true, stateGroup: "BLOCKED" }),
    row({ route: OPUS_HIGH, settled: false, stateGroup: "OPEN", firstPass: false }),
  ];
  const notBlocked = frontier(data, "builder", "not-blocked", "list-per-row", PRICE).points[0]!;
  assert.deepEqual(notBlocked.interval, wilson(4, 5));
  const landed = frontier(data, "builder", "landed", "list-per-row", PRICE).points[0]!;
  assert.deepEqual(landed.interval, wilson(4, 6));
  assert.equal(landed.n, 6);
});

test("verdicts: insufficient, underpowered, overkill candidate and frontier", () => {
  const data = [
    ...rows(20, 18, { route: OPUS_HIGH, usd: 6 }), // best: 90%, 95% CI about 70% to 97%
    ...rows(20, 17, { route: SONNET_HIGH, usd: 2 }), // overlaps opus and costs a third: opus is overkill
    ...rows(20, 4, { route: SOL_HIGH, usd: 1 }), // 20%: upper bound below opus's lower bound
    ...rows(3, 3, { route: LUNA_LOW, usd: 0.1 }),
  ];
  const result = verdicts(frontier(data, "builder", "first-pass", "list-per-row", PRICE));
  const byKey = Object.fromEntries(result.map((verdict) => [verdict.key, verdict]));
  assert.equal(byKey["codex/gpt-6-luna@low"]?.tag, "insufficient");
  assert.match(byKey["codex/gpt-6-luna@low"]!.text, /^Insufficient evidence: n 3, 95% CI/);
  assert.equal(byKey["codex/gpt-6-sol@high"]?.tag, "underpowered");
  assert.equal(byKey["codex/gpt-6-sol@high"]?.against, "claude/opus@high");
  assert.equal(byKey["claude/opus@high"]?.tag, "overkill");
  assert.equal(byKey["claude/opus@high"]?.against, "claude/sonnet@high");
  assert.equal(byKey["claude/opus@high"]?.ratio, 3);
  assert.match(byKey["claude/opus@high"]!.text, /Confirm on paired replays/);
  assert.equal(byKey["claude/sonnet@high"]?.tag, "frontier");
});

test("verdicts: overkill starts at exactly 1.5× the cheaper route's cost", () => {
  const at = (usd: number) => verdicts(frontier([
    ...rows(10, 8, { route: OPUS_HIGH, usd }),
    ...rows(10, 8, { route: SONNET_HIGH, usd: 2 }),
  ], "builder", "first-pass", "list-per-row", PRICE)).find((verdict) => verdict.key === "claude/opus@high")!;
  assert.equal(at(3).tag, "overkill");
  assert.equal(at(2.99).tag, "frontier");
});

test("recommend picks the cheapest route whose first-pass interval overlaps the best route's", () => {
  const data = [
    ...rows(20, 18, { route: OPUS_HIGH, usd: 6 }),
    ...rows(20, 16, { route: SONNET_HIGH, usd: 2 }),
    ...rows(20, 4, { route: SOL_HIGH, usd: 1 }), // cheapest, but its interval misses the best's
    ...rows(3, 3, { route: LUNA_LOW, usd: 0.1 }), // under 5 settled: not a candidate
    ...rows(20, 20, { route: LUNA_LOW, usd: 0.1, workflow: "prove" }), // another evidence source
  ];
  const advice = recommend(data, "builder", null, "production", { price: PRICE, prior: () => 0.99 })!;
  assert.equal(advice.basis, "local");
  assert.equal(advice.best.key, "claude/opus@high");
  assert.equal(advice.choice.key, "claude/sonnet@high");
  assert.deepEqual(advice.ranked.map((route) => route.key), ["claude/sonnet@high", "claude/opus@high", "codex/gpt-6-sol@high"]);
  // The prior is carried beside the local numbers, never folded into them.
  assert.deepEqual(advice.choice.firstPass, wilson(16, 20));
  assert.equal(advice.choice.prior, 0.99);
  assert.equal(advice.choice.priorScore, null);

  const proving = recommend(data, "builder", null, "proving-ground", { price: PRICE, prior: NO_PRIOR })!;
  assert.equal(proving.choice.key, "codex/gpt-6-luna@low");
  assert.equal(recommend(data, "planner", null, "production", { price: PRICE, prior: NO_PRIOR }), null);
});

test("recommend scopes to a declared task class", () => {
  const data = [
    ...rows(6, 6, { route: OPUS_HIGH, usd: 6, taskClass: "ui" }),
    ...rows(6, 6, { route: SONNET_HIGH, usd: 2, taskClass: "schema" }),
  ];
  const ui = recommend(data, "builder", "ui", "production", { price: PRICE, prior: NO_PRIOR })!;
  assert.deepEqual(ui.ranked.map((route) => route.key), ["claude/opus@high"]);
  assert.equal(recommend(data, "builder", null, "production", { price: PRICE, prior: NO_PRIOR })!.choice.key, "claude/sonnet@high");
});

test("recommend with no route at 5 settled rows ranks by a Beta prior of strength 4 and says prior only", () => {
  const data = [
    ...rows(4, 1, { route: OPUS_HIGH, usd: 6 }),
    ...rows(2, 2, { route: SONNET_HIGH, usd: 2 }),
    ...rows(1, 1, { route: LUNA_LOW, usd: 0.1 }),
  ];
  const means: Record<string, number> = { opus: 0.8, sonnet: 0.5 };
  const prior: PriorLookup = (role, route) => (role === "builder" ? means[canonicalModel(route) ?? ""] ?? null : null);
  const advice = recommend(data, "builder", null, "production", { price: PRICE, prior })!;
  assert.equal(advice.basis, "prior only");
  // opus: (1 + 4 × 0.8) / (4 + 4) = 0.525; sonnet: (2 + 4 × 0.5) / (2 + 4) = 0.667; luna has no prior and ranks last.
  assert.deepEqual(advice.ranked.map((route) => [route.key, route.priorScore]), [
    ["claude/sonnet@high", 4 / 6],
    ["claude/opus@high", 4.2 / 8],
    ["codex/gpt-6-luna@low", null],
  ]);
  assert.equal(advice.choice.key, "claude/sonnet@high");
  // Local intervals stay local.
  assert.deepEqual(advice.ranked[1]!.firstPass, wilson(1, 4));
  assert.equal(advice.ranked[1]!.prior, 0.8);
});

test("flatColumns marks a column identical across two or more groups", () => {
  const groups = [stats(rows(3, 3, { route: OPUS_HIGH }), PRICE), stats(rows(3, 1, { route: SONNET_HIGH }), PRICE)];
  const columns = [
    { id: "runs", value: (s: (typeof groups)[number]) => s.runs },
    { id: "first-pass", value: (s: (typeof groups)[number]) => s.firstPass.p },
    { id: "rework", value: (s: (typeof groups)[number]) => s.reworkRuns },
  ];
  assert.deepEqual(flatColumns(groups, columns), ["runs", "rework"]);
  assert.deepEqual(flatColumns(groups.slice(0, 1), columns), []);
  assert.deepEqual(flatColumns([], columns), []);
});

test("INV-3: route-attributed, partial-usage and degraded rows are counted but kept out of every ranking", () => {
  assert.deepEqual([...UNRANKABLE_REASONS], ["route-attributed", "partial-usage", "degraded"]);
  const attributed = rows(6, 6, { route: SOL_HIGH, usd: 0.5, identityProvenance: "route-attributed" });
  const partial = rows(6, 6, { route: LUNA_LOW, usd: 0.1, usageAuthority: "partial" });
  const degraded = rows(6, 6, { route: SONNET_HIGH, usd: 0.2, observabilityDegraded: true });
  const clean = rows(6, 5, { route: OPUS_HIGH, usd: 4 });
  const data = [...attributed, ...partial, ...degraded, ...clean];
  assert.equal(isRankable(clean[0]!), true);
  assert.equal(isRankable(degraded[0]!), false);

  const s = stats(data, PRICE);
  assert.equal(s.n, 24);
  assert.equal(s.unrankable, 18);
  assert.deepEqual(s.unrankableReasons, { "route-attributed": 6, "partial-usage": 6, degraded: 6 });

  const front = frontier(data, "builder", "first-pass", "list-per-row", PRICE);
  assert.deepEqual(front.points.map((point) => point.key), ["claude/opus@high"]);
  assert.equal(front.excluded, 12);
  assert.deepEqual(front.badged.map((point) => point.key), ["codex/gpt-6-sol@high"]);
  const advice = recommend(data, "builder", null, "production", { price: PRICE, prior: NO_PRIOR })!;
  assert.deepEqual(advice.ranked.map((route) => route.key), ["claude/opus@high"]);
});

test("identity-only routes are badged with the ranked geometry but never change points, line, verdicts or advice", () => {
  const clean = [...rows(6, 5, { route: OPUS_HIGH, usd: 4 }), ...rows(6, 4, { route: SONNET_HIGH, usd: 1 })];
  const attributed = rows(6, 6, { route: SOL_HIGH, usd: 0.5, minutes: 0.1, identityProvenance: "route-attributed" });
  const data = [...clean, ...attributed];
  for (const y of ["first-pass", "clean", "not-blocked", "landed"] as const) {
    for (const x of ["list-per-row", "median-minutes"] as const) {
      const before = frontier(clean, "builder", y, x, PRICE);
      const after = frontier(data, "builder", y, x, PRICE);
      assert.deepEqual(after.points, before.points);
      assert.deepEqual(after.line, before.line);
      assert.equal(JSON.stringify(verdicts(after)), JSON.stringify(verdicts(before)));
      assert.equal(after.excluded, 0);
      assert.equal(after.badged.length, 1);
      const badged = after.badged[0]!;
      const confirmed = frontier(attributed.map((row) => ({ ...row, identityProvenance: "stream-authoritative" })), "builder", y, x, PRICE).points[0]!;
      assert.deepEqual([badged.x, badged.interval, badged.n, badged.stats], [confirmed.x, confirmed.interval, confirmed.n, stats(attributed, PRICE)]);
      assert.equal(badged.hollow, true);
      assert.equal(badged.onFrontier, false);
    }
  }
  assert.deepEqual(recommend(data, "builder", null, "production", { price: PRICE, prior: NO_PRIOR }),
    recommend(clean, "builder", null, "production", { price: PRICE, prior: NO_PRIOR }));
});

test("a route with any rankable row is only a ranked candidate, even when that candidate is unplaced", () => {
  const clean = rows(2, 1, { route: SOL_HIGH, usd: 3 });
  const attributed = rows(6, 6, { route: SOL_HIGH, usd: 0.1, identityProvenance: "route-attributed" });
  const front = frontier([...attributed, ...clean], "builder", "first-pass", "list-per-row", PRICE);
  assert.deepEqual(front.points, frontier(clean, "builder", "first-pass", "list-per-row", PRICE).points);
  assert.deepEqual(front.badged, []);
  const unplaced = frontier([...attributed, ...clean.map((row) => ({ ...row, usd: null }))], "builder", "first-pass", "list-per-row", PRICE);
  assert.deepEqual(unplaced.badged, []);
  assert.equal(unplaced.unplaced[0]!.reason, "unpriced");
});

test("partial or degraded attributed rows are excluded, and never contaminate a badged point", () => {
  const identity = row({ route: SOL_HIGH, usd: 0.5, identityProvenance: "route-attributed" });
  const partial = row({ route: SOL_HIGH, usd: 100, minutes: 100, identityProvenance: "route-attributed", usageAuthority: "partial" });
  const degraded = row({ route: SOL_HIGH, usd: 100, identityProvenance: "route-attributed", observabilityDegraded: true });
  const both = row({ route: LUNA_LOW, identityProvenance: "route-attributed", usageAuthority: "partial", observabilityDegraded: true });
  const front = frontier([identity, partial, degraded, both], "builder", "first-pass", "list-per-row", PRICE);
  assert.equal(front.excluded, 3, "a multiply excluded row is counted once");
  assert.equal(front.badged.length, 1);
  assert.equal(front.badged[0]!.x, 0.5);
  assert.equal(front.badged[0]!.stats.n, 1);
  assert.deepEqual(frontier([partial, degraded, both], "builder", "first-pass", "list-per-row", PRICE).badged, []);
});

test("badged routes need observed axes, stay role/key scoped, and keep a zero x", () => {
  const identity = { identityProvenance: "route-attributed" };
  const data = [
    row({ ...identity, route: SOL_HIGH, usd: 0 }),
    row({ ...identity, route: LUNA_LOW, usd: null, minutes: null }),
    row({ ...identity, route: SONNET_HIGH, settled: false, stateGroup: "OPEN" }),
    row({ ...identity, route: OPUS_HIGH, role: "reviewer" }),
    row({ ...identity, route: { ...OPUS_HIGH, effort: null } }),
  ];
  const front = frontier(data, "builder", "first-pass", "list-per-row", PRICE);
  assert.deepEqual(front.badged.map((point) => [point.key, point.x]), [["codex/gpt-6-sol@high", 0]]);
  assert.deepEqual(front.points, []);
  assert.deepEqual(front.line, []);
  assert.deepEqual(front.unplaced, []);
  assert.deepEqual(verdicts(front), []);
  assert.equal(frontier(data, "builder", "first-pass", "median-minutes", PRICE).badged.length, 1);
});

test("frontier names each route it could not place, and why", () => {
  const data = [
    ...rows(6, 6, { route: OPUS_HIGH, usd: 4 }),
    ...rows(6, 6, { route: SONNET_HIGH, usd: null, minutes: null }),
    ...rows(2, 0, { route: SOL_HIGH, settled: false, stateGroup: "OPEN", firstPass: false }),
  ];
  const byCost = frontier(data, "builder", "first-pass", "list-per-row", PRICE);
  assert.deepEqual(byCost.points.map((point) => point.key), ["claude/opus@high"]);
  assert.deepEqual(byCost.unplaced.map((route) => [route.key, route.reason]), [
    ["claude/sonnet@high", "unpriced"],
    ["codex/gpt-6-sol@high", "no-observation"],
  ]);
  const byMinutes = frontier(data, "builder", "first-pass", "median-minutes", PRICE);
  assert.deepEqual(byMinutes.unplaced.map((route) => [route.key, route.reason]), [
    ["claude/sonnet@high", "no-minutes"],
    ["codex/gpt-6-sol@high", "no-observation"],
  ]);
});

test("untested routes join only the prior-only ranking, with no local evidence", () => {
  const prior: PriorLookup = (_role, route) => ({ opus: 0.6, "gpt-6-sol": 0.7 } as Record<string, number>)[canonicalModel(route) ?? ""] ?? null;
  const untested: MetricsRoute[] = [SOL_HIGH, { ...OPUS_HIGH, model: "claude:opus" }, { adapter: null, provider: null, model: "x", effort: "high" }];
  const cold = recommend(rows(2, 1, { route: OPUS_HIGH }), "builder", null, "production", { price: PRICE, prior, untested })!;
  assert.equal(cold.basis, "prior only");
  // opus is already observed, under its selector spelling too, so it is not added twice; a keyless route is dropped.
  assert.deepEqual(cold.ranked.map((route) => [route.key, route.settled, route.priorScore]), [
    ["codex/gpt-6-sol@high", 0, 0.7],
    ["claude/opus@high", 2, (1 + 4 * 0.6) / 6],
  ]);
  assert.deepEqual(cold.ranked[0]!.firstPass, wilson(0, 0));

  const empty = recommend([], "builder", null, "production", { price: PRICE, prior, untested: [SOL_HIGH] })!;
  assert.equal(empty.choice.key, "codex/gpt-6-sol@high");
  assert.equal(recommend([], "builder", null, "production", { price: PRICE, prior }), null);

  const warm = recommend(rows(6, 6, { route: OPUS_HIGH }), "builder", null, "production", { price: PRICE, prior, untested })!;
  assert.equal(warm.basis, "local");
  assert.deepEqual(warm.ranked.map((route) => route.key), ["claude/opus@high"]);
});
