// W18 task 8: the Matrix and Frontier view models over the synthetic payload
// (core/test/fixtures/metrics/payload.json) and hand-built rows, the tile
// click's route state, and static checks that the two views only arrange
// what the shared module computed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MetricsResponse, MetricsRoleRow } from "../../../dashboard/shared/types.ts";
import { formatListEquivalent, listPrice, RATE_CARD } from "../../../dashboard/shared/rate-card.ts";
import { depth, frontier, routeCells, stats, verdicts, wilson } from "../../../dashboard/shared/route-metrics.ts";
import {
  DEFAULT_METRICS_ROUTE,
  focusTile,
  metricsRouteHash,
  parseMetricsRoute,
  rowsInLens,
  withFrontier,
  withSelection,
} from "../../../dashboard/src/metrics-lens.ts";
import { buildMatrix, depthLegend, roleColumns, routeTitle, rowsForRaised } from "../../../dashboard/src/metrics-matrix.ts";
import {
  PLOT_SIZE,
  frontierPlot,
  frontierRole,
  frontierRoles,
  routeNames,
  verdictCards,
  zoneLabels,
} from "../../../dashboard/src/metrics-frontier.ts";
import { intersects } from "../../../dashboard/src/metrics-chart.ts";
import { PAYLOAD_PATH } from "../fixtures/metrics/synthetic-payload.ts";

const payload = JSON.parse(readFileSync(PAYLOAD_PATH, "utf8")) as MetricsResponse;
const production = rowsInLens(payload.roleRows, DEFAULT_METRICS_ROUTE);
const source = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("columns follow the design's role order and list only observed roles", () => {
  assert.deepEqual(roleColumns(production), ["builder", "reviewer"]);
  const roles = ["documenter", "zeta", "intake", "builder", "alpha", "architecture-reviewer"].map((role) => ({ role }));
  assert.deepEqual(roleColumns(roles), ["intake", "architecture-reviewer", "builder", "documenter", "alpha", "zeta"]);
});

test("each tile is the module's stats and depth over its cell, and an empty cell is null", () => {
  const matrix = buildMatrix(production, payload, listPrice, false);
  assert.deepEqual(matrix.columns, ["builder", "reviewer"]);
  assert.deepEqual(matrix.rows.map((row) => row.key), ["claude/opus@high", "codex/gpt-6-sol@xhigh"], "Anthropic before OpenAI");
  for (const row of matrix.rows) {
    row.tiles.forEach((tile, index) => {
      const cell = routeCells(production).find((candidate) => candidate.key === row.key && candidate.role === matrix.columns[index]);
      if (cell === undefined) return assert.equal(tile, null, `${row.key} × ${matrix.columns[index]}`);
      const s = stats(cell.rows, listPrice);
      assert.deepEqual(tile, {
        role: cell.role,
        key: cell.key,
        n: s.n,
        settled: s.settled,
        landed: s.landed,
        firstPass: s.firstPass.p,
        blockedHere: s.blockedHere,
        depth: depth(s.firstPass, s.settled),
        perRow: `${formatListEquivalent(s.listPerRow)}/row`,
      });
    });
  }
  const builder = matrix.rows[1]!.tiles[0]!;
  assert.deepEqual([builder.n, builder.landed, builder.blockedHere, builder.depth], [3, 2, 1, "flat"], "the fixture's shape");
  assert.equal(matrix.rows[0]!.tiles[0], null, "the reviewer route never ran a builder");
});

test("a row is labelled by the model observed answering, with its card price and prior, or says why it has none", () => {
  const matrix = buildMatrix(production, payload, listPrice, false);
  assert.deepEqual(matrix.rows.map((row) => [row.title, row.detail, row.provider]), [
    ["opus (selector) · high", "not on the rate card", "anthropic"],
    ["GPT-6 Sol · xhigh", "$2 / $10 · AA index up to 48", "openai"],
  ]);
  const opus = { adapter: "claude", provider: "anthropic", model: "opus", effort: "high" };
  assert.deepEqual(routeTitle(opus, [{ resolvedModel: "claude-opus-5" }], RATE_CARD.rows, payload.priors.modelLabels),
    { title: "Opus 5 · high", detail: "$5 / $25 · TB 4.0 52.3", card: RATE_CARD.rows.find((row) => row.model === "claude-opus-5"),
      cards: [RATE_CARD.rows.find((row) => row.model === "claude-opus-5")] });
  const pooled = routeTitle(opus, [{ resolvedModel: "claude-opus-5" }, { resolvedModel: "claude-opus-5-5" }], RATE_CARD.rows, {});
  assert.equal(pooled.title, "Opus 5 / Opus 5.5 · high", "a selector-based key can pool two models (T06 C10)");
  assert.equal(pooled.card, null);
  assert.deepEqual(pooled.cards.map((card) => card.model), ["claude-opus-5", "claude-opus-5-5"]);
});

test("a pooled route sorts by its dearest model, so it stays among its own family", () => {
  const cheap = { ...payload.roleRows[0]!, sessionId: "p1", role: "builder",
    route: { adapter: "claude", provider: "anthropic", model: "claude-sonnet-5", effort: "low" }, resolvedModel: "claude-sonnet-5" };
  const pooled = ["claude-opus-5", "claude-opus-5-5"].map((model, index) => ({ ...cheap, sessionId: `p${index + 2}`,
    route: { adapter: "claude", provider: "anthropic", model: "opus", effort: "high" }, resolvedModel: model }));
  const matrix = buildMatrix([cheap, ...pooled], payload, listPrice, false);
  assert.deepEqual(matrix.rows.map((row) => row.title), ["Opus 5 / Opus 5.5 · high", "Sonnet 5 · low"]);
});

test("untested routes join only on request, after the tested ones, dearer first within a provider", () => {
  const hidden = buildMatrix(production, payload, listPrice, false);
  assert.equal(hidden.untestedAvailable, 4);
  assert.equal(hidden.rows.some((row) => !row.tested), false);
  const shown = buildMatrix(production, payload, listPrice, true);
  assert.deepEqual(shown.rows.filter((row) => !row.tested).map((row) => [row.title, row.detail]), [
    ["Opus 5.5 · medium", "untested · TB 4.0 66.4 at xhigh"],
    ["Sonnet 5 · medium", "untested · $2 / $10"],
    ["GPT-5.6 Terra · medium", "untested · $2 / $12"],
    ["GPT-6 Sol · high", "untested · AA index 28 to 48 by effort"],
  ]);
  assert.ok(shown.rows.slice(0, 2).every((row) => row.tested));
  assert.ok(shown.rows.filter((row) => !row.tested).every((row) => row.tiles.every((tile) => tile === null)), "an untested row reads no runs");
});

test("the depth legend's ≈N is where the module first calls a 50% yield raised", () => {
  const n = rowsForRaised();
  assert.equal(depth(wilson(Math.floor(n / 2), n), n), "raised");
  assert.equal(depth(wilson(Math.floor((n - 1) / 2), n - 1), n - 1), "flat");
  assert.deepEqual(depthLegend().map((entry) => entry.depth), ["raised", "flat", "sunk"]);
  assert.match(depthLegend()[0]!.text, new RegExp(`^raised · 95% CI within ±15 pts \\(≈${n} settled rows\\)$`));
});

test("a tile click narrows the role, focuses the route and opens the Ledger grouped by run, all in the hash", () => {
  const focused = focusTile(DEFAULT_METRICS_ROUTE, "builder", "codex/gpt-6-sol@xhigh", ["builder", "reviewer"]);
  assert.deepEqual([focused.view, focused.route, focused.group, focused.off.role], ["ledger", "codex/gpt-6-sol@xhigh", "run", ["reviewer"]]);
  const hash = metricsRouteHash(focused);
  assert.equal(hash, "#/metrics?view=ledger&route=codex/gpt-6-sol@xhigh&x.role=reviewer&group=run");
  assert.deepEqual(parseMetricsRoute(hash), focused);
  assert.deepEqual(rowsInLens(payload.roleRows, focused).map((row) => row.sessionId).sort(), ["f1", "f2", "f3"]);
  // A later facet choice drops the focus, as it always has.
  assert.equal(withSelection(focused, "effort", ["xhigh"], ["xhigh"]).route, null);
  assert.deepEqual(parseMetricsRoute("#/metrics?group=pie&f.y=vibes&f.x=").frontier, DEFAULT_METRICS_ROUTE.frontier, "unknown values fall back");
  assert.equal(parseMetricsRoute("#/metrics?group=pie").group, "route");
});

// ---------------------------------------------------------------------------
// The Frontier.
// ---------------------------------------------------------------------------

const template = payload.roleRows.find((row) => row.sessionId === "f1" && row.role === "builder")!;
let serial = 0;
function row(role: string, model: string, adapter: string, provider: string, effort: string, firstPass: boolean, output: number, extra: Partial<MetricsRoleRow> = {}): MetricsRoleRow {
  serial += 1;
  return {
    ...template,
    sessionId: `s${serial}`,
    role,
    route: { ...template.route, adapter, provider, model, effort },
    resolvedModel: model,
    settled: true,
    firstPass,
    cleanCompletion: firstPass,
    blockedHere: false,
    minutes: output / 1000,
    tokens: { ...template.tokens, inputTokens: 10_000, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
    ...extra,
  } as MetricsRoleRow;
}
const many = (count: number, passes: number, make: (pass: boolean) => MetricsRoleRow) =>
  Array.from({ length: count }, (_, index) => make(index < passes));
const builders = [
  ...many(6, 5, (pass) => row("builder", "claude-opus-5", "claude", "anthropic", "high", pass, 40_000)),
  ...many(6, 5, (pass) => row("builder", "gpt-6-sol", "codex", "openai-codex", "xhigh", pass, 20_000)),
  ...many(2, 2, (pass) => row("builder", "claude-sonnet-5", "claude", "anthropic", "low", pass, 5_000)),
  ...many(3, 3, (pass) => row("reviewer", "claude-opus-5", "claude", "anthropic", "high", pass, 8_000)),
];

test("the Frontier shows one role: the picked one while the lens has it, else the busiest", () => {
  assert.deepEqual(frontierRoles(builders), ["builder", "reviewer"]);
  assert.equal(frontierRole(null, builders), "builder");
  assert.equal(frontierRole("reviewer", builders), "reviewer");
  assert.equal(frontierRole("planner", builders), "builder", "a role the lens lost falls back");
  assert.equal(frontierRole(null, []), null);
  const picked = withFrontier(DEFAULT_METRICS_ROUTE, { role: "reviewer", x: "median-minutes" });
  assert.equal(metricsRouteHash(picked), "#/metrics?f.role=reviewer&f.x=median-minutes");
});

test("the plot places the module's points: log x, percentage y, Wilson whiskers, hollow marks and the Pareto line", () => {
  const front = frontier(builders, "builder", "first-pass", "list-per-row", listPrice);
  const names = routeNames(builders, RATE_CARD.rows, payload.priors.modelLabels);
  const plot = frontierPlot(front, names);
  assert.equal(plot.marks.length, front.points.length);
  assert.ok(plot.marks.every((mark) => mark.key.startsWith("claude/") ? mark.provider === "anthropic" : mark.provider === "openai"));
  const bottom = PLOT_SIZE.top + plot.plot.height;
  for (const [index, mark] of plot.marks.entries()) {
    const point = front.points[index]!;
    assert.equal(mark.hollow, point.hollow);
    assert.equal(mark.onFrontier, point.onFrontier);
    assert.ok(Math.abs(mark.cy - (bottom - point.interval.p! * plot.plot.height)) < 1e-9);
    assert.ok(Math.abs(mark.whiskerTop - (bottom - point.interval.hi * plot.plot.height)) < 1e-9);
    assert.ok(Math.abs(mark.whiskerBottom - (bottom - point.interval.lo * plot.plot.height)) < 1e-9);
    assert.ok(mark.cx >= plot.plot.x && mark.cx <= plot.plot.x + plot.plot.width);
  }
  const xs = plot.marks.map((mark) => mark.cx);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), "cheapest first, as the module sorts");
  assert.equal(plot.marks.find((mark) => mark.key === "claude/claude-sonnet-5@low")?.hollow, true);
  assert.equal(plot.line.split(" ").length, front.line.length);
  assert.ok(front.line.length >= 1);
  assert.deepEqual(plot.yTicks.map((tick) => tick.text), ["0%", "25%", "50%", "75%", "100%"]);
  assert.ok(plot.xTicks.length >= 2);
  assert.equal(plot.xTitle, "≈ list $ per role-row (log scale)");
  assert.deepEqual(plot.zones.map((zone) => zone.text), ["cheap and strong", "costly and weak"]);
  const placed = plot.marks.filter((mark) => mark.label !== null).map((mark) => mark.label!.box);
  for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) assert.ok(!intersects(placed[i]!, placed[j]!));
  assert.match(plot.marks[0]!.ariaLabel, /First-pass yield \d+% · 95% CI \d+% to \d+%/);
  assert.deepEqual(zoneLabels("median-minutes"), { good: "fast and strong", bad: "slow and weak" });
});

test("badged routes expand the log axis, carry provider shapes and identity labels, and never get verdict cards", () => {
  const attributed = row("builder", "gpt-6-luna", "codex", "openai-codex", "xhigh", true, 100,
    { identityProvenance: "route-attributed" });
  const data = [...builders, attributed];
  const names = routeNames(data, RATE_CARD.rows, payload.priors.modelLabels);
  const before = frontier(builders, "builder", "first-pass", "list-per-row", listPrice);
  const after = frontier(data, "builder", "first-pass", "list-per-row", listPrice);
  const beforePlot = frontierPlot(before, names);
  const plot = frontierPlot(after, names);
  assert.equal(plot.marks.length, after.points.length + after.badged.length);
  assert.ok(Number(plot.xTicks[0]!.text) < Number(beforePlot.xTicks[0]!.text), "the near-zero list equivalent expands the axis");
  const mark = plot.marks.find((mark) => mark.badged)!;
  assert.equal(mark.provider, "openai");
  assert.equal(mark.hollow, true);
  assert.equal(mark.onFrontier, false);
  assert.match(mark.labelText, /GPT-6 Luna · xhigh.*identity unconfirmed/);
  assert.notEqual(mark.label, null);
  assert.match(mark.ariaLabel, /Identity unconfirmed: route-attributed, plotted but not ranked/);
  assert.doesNotMatch(mark.ariaLabel, /Hollow: fewer than|On the Pareto line/);
  assert.deepEqual(verdictCards(after, verdicts(after), names), verdictCards(before, verdicts(before), names));
  assert.equal(plot.line.split(" ").length, after.line.length);
  const point = after.badged[0]!;
  assert.equal(mark.cy, plot.plot.y + plot.plot.height - point.interval.p! * plot.plot.height);
});

test("a sub-floor x stays at the axis floor and is flagged in the mark, label and tooltip", () => {
  const zero = row("builder", "gpt-6-luna", "codex", "openai-codex", "xhigh", true, 0,
    { identityProvenance: "route-attributed", tokens: { ...template.tokens, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } });
  const front = frontier([zero], "builder", "first-pass", "list-per-row", listPrice);
  assert.equal(front.badged[0]!.x, 0);
  const plot = frontierPlot(front, routeNames([zero], RATE_CARD.rows, {}));
  assert.equal(plot.marks.length, 1, "a badged-only Frontier is drawable");
  const mark = plot.marks[0]!;
  assert.equal(mark.cx, plot.plot.x);
  assert.equal(mark.belowFloor, true);
  assert.match(mark.labelText, /↓ at axis floor/);
  assert.match(mark.ariaLabel, /≈ list \$0.00 per row.*At axis floor/);
  assert.notEqual(mark.label, null);
  assert.equal(plot.line, "");
  assert.deepEqual(verdictCards(front, verdicts(front), new Map()), []);
});

test("the Frontier component draws badged-only charts, dashed hollow marks, floor markers and separate exclusion notes", () => {
  const view = source("dashboard/src/components/MetricsFrontier.vue");
  const css = source("dashboard/src/styles/metrics.css");
  assert.match(view, /front\.value\.points\.length === 0 && front\.value\.badged\.length === 0/);
  assert.match(view, /hollow: mark\.hollow, badged: mark\.badged/);
  assert.match(view, /mark\.belowFloor.*frontier-floor-marker/);
  assert.match(view, /routes plotted.*but not ranked: identity unconfirmed/);
  assert.match(view, /not plotted: partial usage or degraded observability/);
  assert.match(css, /\.frontier-mark\.badged[^\n]+stroke-dasharray: 4 3/);
});

test("verdict cards carry the module's verdicts word for word, dearest first, with the x value through formatListEquivalent", () => {
  const front = frontier(builders, "builder", "first-pass", "list-per-row", listPrice);
  const names = routeNames(builders, RATE_CARD.rows, payload.priors.modelLabels);
  const judged = verdicts(front);
  const cards = verdictCards(front, judged, names);
  assert.deepEqual(cards.map((card) => card.key), [...front.points].reverse().map((point) => point.key));
  for (const card of cards) {
    const verdict = judged.find((candidate) => candidate.key === card.key)!;
    assert.equal(card.text, verdict.text);
    assert.equal(card.tag, verdict.tag);
    const point = front.points.find((candidate) => candidate.key === card.key)!;
    assert.equal(card.value, `${formatListEquivalent(point.x)} per row`);
  }
  assert.deepEqual([...new Set(cards.map((card) => card.tagText))].sort(), [...new Set(judged.map((verdict) =>
    ({ frontier: "frontier", overkill: "overkill?", underpowered: "underpowered", insufficient: null })[verdict.tag]))].sort());
  const minutes = verdictCards(frontier(builders, "builder", "first-pass", "median-minutes", listPrice),
    verdicts(frontier(builders, "builder", "first-pass", "median-minutes", listPrice)), names);
  assert.match(minutes[0]!.value, /^\d+\.\d min per row$/);
});

// ---------------------------------------------------------------------------
// Static checks: the views arrange, they do not compute, and the tab only reads.
// ---------------------------------------------------------------------------

const VIEW_FILES = [
  "dashboard/src/components/MetricsMatrix.vue",
  "dashboard/src/components/MetricsFrontier.vue",
  "dashboard/src/metrics-chart.ts",
  "dashboard/src/metrics-matrix.ts",
  "dashboard/src/metrics-frontier.ts",
  "dashboard/src/components/MetricsLedger.vue",
  "dashboard/src/components/MetricsRun.vue",
  "dashboard/src/metrics-ledger.ts",
  "dashboard/src/metrics-run.ts",
  "dashboard/src/styles/metrics.css",
];

test("the views write nothing, fetch nothing and hard-code no colour", () => {
  for (const file of VIEW_FILES) {
    const text = source(file);
    assert.doesNotMatch(text, /fetch\(|localStorage|sessionStorage|method:/, file);
    assert.doesNotMatch(text, /#[0-9A-Fa-f]{3,8}\b(?![-\w])/, `${file} carries a literal colour`);
  }
});

test("the views import no chart library and take icons only from lucide-vue-next", () => {
  for (const file of VIEW_FILES.filter((path) => !path.endsWith(".css"))) {
    const imports = [...source(file).matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
    assert.ok(imports.every((name) => name.startsWith(".") || name === "vue" || name === "lucide-vue-next"), `${file}: ${imports}`);
  }
});

test("no statistic is computed in a component: Wilson, depth and stats are the module's", () => {
  for (const file of ["dashboard/src/components/MetricsMatrix.vue", "dashboard/src/components/MetricsFrontier.vue",
    "dashboard/src/components/MetricsLedger.vue", "dashboard/src/components/MetricsRun.vue"]) {
    const text = source(file);
    assert.doesNotMatch(text, /\bwilson\(|\bstats\(|\bdepth\(|Math\.sqrt|\.reduce\(/, file);
  }
  const frontierView = source("dashboard/src/components/MetricsFrontier.vue");
  assert.match(frontierView, /frontier\(props\.rows, role\.value, props\.state\.y, props\.state\.x, listPrice\)/, "one role per chart");
});
