// W18 task 7: the metrics tab's lens, its URL encoding, the rail's options,
// the count tile and the summary row, over the synthetic payload in
// core/test/fixtures/metrics/payload.json. The views themselves are tasks 8
// and 9; the static checks at the end pin the shell's wiring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import type { MetricsResponse, MetricsRoleRow } from "../../../dashboard/shared/types.ts";
import { formatListEquivalent, listPrice, RATE_CARD } from "../../../dashboard/shared/rate-card.ts";
import { stats } from "../../../dashboard/shared/route-metrics.ts";
import {
  DEFAULT_METRICS_ROUTE,
  NULL_TOKEN,
  countTile,
  facetOptions,
  isMetricsRoute,
  lensOf,
  metricsRouteHash,
  observedModel,
  parseMetricsRoute,
  readRoleColors,
  resetLens,
  routeFocusNote,
  rowsInLens,
  runsInLens,
  selectedValues,
  summaryStats,
  withRun,
  withSelection,
  withView,
  type MetricsRouteState,
} from "../../../dashboard/src/metrics-lens.ts";
import { selectAllState, toggleAllFilterValues, toggleFilterValue } from "../../../dashboard/src/session-filters.ts";
import { MetricsResponseSchema } from "./_metrics-schemas.ts";
import { PAYLOAD_PATH, serializePayload, syntheticMetricsPayload } from "../fixtures/metrics/synthetic-payload.ts";

const payload = JSON.parse(readFileSync(PAYLOAD_PATH, "utf8")) as MetricsResponse;
const rows = payload.roleRows;
const context = { rateCard: RATE_CARD.rows, roleColors: { builder: "#22D3EE", reviewer: "#F43F5E" } };
const source = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("the fixture is schema-valid and is exactly what the payload builder serves", () => {
  assert.equal(Value.Check(MetricsResponseSchema, payload), true,
    JSON.stringify([...Value.Errors(MetricsResponseSchema, payload)].slice(0, 5)));
  assert.equal(readFileSync(PAYLOAD_PATH, "utf8"), serializePayload(syntheticMetricsPayload()),
    "payload.json drifted from the builder: node --experimental-strip-types core/test/fixtures/metrics/synthetic-payload.ts");
  // The shape the rest of this file relies on.
  assert.deepEqual(payload.runs.map((run) => [run.sessionId, run.workflow, run.stateGroup]).sort(), [
    ["f1", "shift", "LANDED"], ["f2", "build-review", "LANDED"], ["f3", "shift", "BLOCKED"], ["f4", "shift", "BLOCKED"], ["f5", "prove", "LANDED"],
  ]);
  assert.equal(rows.length, 7);
});

test("an untouched lens has a clean URL, and every part of the state round-trips through the hash", () => {
  assert.equal(metricsRouteHash(DEFAULT_METRICS_ROUTE), "#/metrics");
  assert.deepEqual(parseMetricsRoute("#/metrics"), DEFAULT_METRICS_ROUTE);

  const state: MetricsRouteState = {
    view: "frontier",
    run: null,
    route: "claude/opus@high",
    off: { source: ["proving-ground"], role: ["planner", "designer"], effort: [NULL_TOKEN], project: ["a,b"] },
    frontier: { role: "builder", y: "clean", x: "median-minutes" },
    untested: true,
    group: "run",
  };
  const hash = metricsRouteHash(state);
  assert.equal(hash, "#/metrics?view=frontier&route=claude/opus@high&x.role=planner,designer&x.effort=~&x.project=a%2Cb" +
    "&group=run&f.role=builder&f.y=clean&f.x=median-minutes&untested=1");
  assert.deepEqual(parseMetricsRoute(hash), state);

  const run = withRun(DEFAULT_METRICS_ROUTE, "f1");
  assert.equal(metricsRouteHash(run), "#/metrics/run/f1", "the run path carries the view");
  assert.deepEqual(parseMetricsRoute("#/metrics/run/f1"), run);
  assert.equal(parseMetricsRoute("#/metrics/run/f1?view=matrix").view, "run", "the path wins over a stray view");

  // Switching the proving ground on is a difference from the default, so it is written.
  const both = { ...DEFAULT_METRICS_ROUTE, off: { source: [] } };
  assert.equal(metricsRouteHash(both), "#/metrics?x.source=");
  assert.deepEqual(parseMetricsRoute("#/metrics?x.source=").off.source, []);

  assert.equal(parseMetricsRoute("#/metrics?view=pie").view, "matrix", "an unknown view falls back rather than blanking the board");
  for (const hash of ["#/metrics", "#/metrics?view=ledger", "#/metrics/run/abc"]) assert.equal(isMetricsRoute(hash), true, hash);
  for (const hash of ["#/metricsx", "#/canvas", "#/sessions/metrics"]) assert.equal(isMetricsRoute(hash), false, hash);
});

test("views keep the lens, leaving the Run view drops its run, and Reset lens keeps the view", () => {
  const lensed: MetricsRouteState = { ...withRun(DEFAULT_METRICS_ROUTE, "f1"), route: "codex/gpt-6-sol@xhigh", off: { source: ["proving-ground"], role: ["reviewer"] } };
  const ledger = withView(lensed, "ledger");
  assert.equal(ledger.run, null);
  assert.deepEqual(ledger.off, lensed.off);
  assert.equal(withView(lensed, "run").run, "f1");
  const reset = resetLens(lensed);
  assert.deepEqual([reset.view, reset.run, reset.route, reset.off], ["run", "f1", null, DEFAULT_METRICS_ROUTE.off]);
});

test("the ladders drive the lens through the sessions board's own helpers", () => {
  const roles = facetOptions(rows, DEFAULT_METRICS_ROUTE, "role", context).map((option) => option.value);
  assert.deepEqual(roles, ["builder", "reviewer"], "design order: builder before reviewer");

  const selected = selectedValues(DEFAULT_METRICS_ROUTE, "role", roles);
  assert.equal(selectAllState(roles, selected), "all");
  const onlyBuilders = withSelection(DEFAULT_METRICS_ROUTE, "role", roles, toggleFilterValue(selected, "reviewer"));
  assert.deepEqual(onlyBuilders.off.role, ["reviewer"]);
  assert.deepEqual(rowsInLens(rows, onlyBuilders).map((row) => row.role), ["builder", "builder", "builder"]);

  const none = withSelection(DEFAULT_METRICS_ROUTE, "role", roles, toggleAllFilterValues(roles, selected));
  assert.deepEqual(rowsInLens(rows, none), []);
  assert.equal(selectAllState(roles, selectedValues(none, "role", roles)), "none");
  const all = withSelection(none, "role", roles, toggleAllFilterValues(roles, selectedValues(none, "role", roles)));
  assert.deepEqual(all.off.role, []);

  // A value the menu no longer shows stays off; one it has never seen is on.
  const stale = withSelection({ ...DEFAULT_METRICS_ROUTE, off: { role: ["planner"] } }, "role", roles, roles);
  assert.deepEqual(stale.off.role, ["planner"]);
  assert.equal(selectedValues(DEFAULT_METRICS_ROUTE, "role", ["intake"]).includes("intake"), true);

  // A facet change drops a route focus that no longer describes the lens.
  assert.equal(withSelection({ ...DEFAULT_METRICS_ROUTE, route: "claude/opus@high" }, "role", roles, ["builder"]).route, null);
});

test("the default lens is production evidence only, and the count tile reads runs, not rows", () => {
  const inLens = rowsInLens(rows, DEFAULT_METRICS_ROUTE);
  assert.deepEqual(inLens.map((row) => row.sessionId).sort(), ["f1", "f1", "f2", "f2", "f3"]);
  assert.deepEqual(countTile(payload.runs, rows, DEFAULT_METRICS_ROUTE), { inLens: 3, recorded: 4, neverReachedAgent: 1 });

  // The role facet narrows rows and runs in the lens, never the recorded runs.
  const reviewers = withSelection(DEFAULT_METRICS_ROUTE, "role", ["builder", "reviewer"], ["reviewer"]);
  assert.deepEqual(countTile(payload.runs, rows, reviewers), { inLens: 2, recorded: 4, neverReachedAgent: 1 });

  // With the proving ground on, its replay is recorded and in the lens.
  const both = { ...DEFAULT_METRICS_ROUTE, off: { source: [] } };
  assert.deepEqual(countTile(payload.runs, rows, both), { inLens: 4, recorded: 5, neverReachedAgent: 1 });

  const route = { ...DEFAULT_METRICS_ROUTE, route: "claude/opus@high" };
  assert.deepEqual(rowsInLens(rows, route).map((row) => row.role), ["reviewer", "reviewer"]);
  assert.equal(lensOf(rows, route).route, "claude/opus@high");
});

test("option counts are role-rows, constrained by every other facet and never by their own", () => {
  const onlyBuilders = withSelection(DEFAULT_METRICS_ROUTE, "role", ["builder", "reviewer"], ["builder"]);
  assert.deepEqual(facetOptions(rows, onlyBuilders, "role", context).map((option) => [option.value, option.count, option.dot]), [
    ["builder", 3, "#22D3EE"],
    ["reviewer", 2, "#F43F5E"],
  ], "the role ladder still says what turning reviewers back on adds");
  assert.deepEqual(facetOptions(rows, onlyBuilders, "model", context).map((option) => [option.label, option.count, option.provider]), [
    ["opus (selector)", 0, "anthropic"],
    ["GPT-6 Sol", 3, "openai"],
  ], "Anthropic before OpenAI; a value the lens empties stays listed at zero");
  assert.deepEqual(facetOptions(rows, DEFAULT_METRICS_ROUTE, "state", context).map((option) => [option.label, option.count, option.dot]), [
    ["landed", 4, "var(--green)"],
    ["blocked", 1, "var(--red)"],
  ]);
  assert.deepEqual(facetOptions(rows, DEFAULT_METRICS_ROUTE, "source", context).map((option) => [option.value, option.count]), [
    ["production", 5],
    ["proving-ground", 2],
  ]);
  assert.deepEqual(facetOptions(rows, DEFAULT_METRICS_ROUTE, "project", context).map((option) => option.value), ["awsf", "fusion-harness"]);
});

test("the Model facet keys on the model observed answering, and on the selector only when none was", () => {
  const [builder, reviewer] = rows as readonly MetricsRoleRow[];
  assert.equal(observedModel(builder!), "gpt-6-sol");
  assert.equal(observedModel(reviewer!), "opus", "the reviewer never reported a model");
  // One selector that answered as two models is two Model options.
  const split = [
    { ...reviewer!, sessionId: "a", resolvedModel: "claude-opus-5" },
    { ...reviewer!, sessionId: "b", resolvedModel: "claude-opus-5-5" },
  ];
  assert.deepEqual(facetOptions(split, DEFAULT_METRICS_ROUTE, "model", context).map((option) => option.label), ["Opus 5", "Opus 5.5"]);
  // A value nobody recorded travels as the null token and reads "unknown".
  const unknown = [{ ...builder!, route: { ...builder!.route, effort: null } }];
  assert.deepEqual(facetOptions(unknown, DEFAULT_METRICS_ROUTE, "effort", context).map((option) => [option.value, option.label]), [[NULL_TOKEN, "unknown"]]);
  assert.deepEqual(rowsInLens(unknown, { ...DEFAULT_METRICS_ROUTE, off: { effort: [NULL_TOKEN] } }), []);
});

test("the summary row is the module's stats over the lens, and every dollar comes through formatListEquivalent", () => {
  const inLens = rowsInLens(rows, DEFAULT_METRICS_ROUTE);
  const s = stats(inLens, listPrice);
  const summary = summaryStats(inLens, listPrice);
  assert.deepEqual(summary.map((stat) => stat.id), ["rows", "first-pass", "landed", "list-per-landed"]);
  assert.deepEqual(summary[0], { id: "rows", label: "Role-rows in lens", value: "5", caption: "3 runs · 5 settled" });
  assert.equal(summary[1]!.value, `${Math.round(s.firstPass.p! * 100)}%`);
  assert.equal(summary[1]!.caption, `95% CI ${Math.round(s.firstPass.lo * 100)}% to ${Math.round(s.firstPass.hi * 100)}%`);
  assert.deepEqual([summary[2]!.value, summary[2]!.caption], ["2/3", "1 role-rows blocked here, model-attributed"]);
  assert.equal(summary[3]!.value, formatListEquivalent(s.listPerLanded));
  assert.equal(summary[3]!.caption, "list-price equivalent, not spend");
  for (const stat of summary) {
    for (const text of [stat.label, stat.caption]) assert.doesNotMatch(text, /\$/, `${stat.id}: a bare $ outside the formatter`);
  }
  const empty = summaryStats([], listPrice);
  assert.deepEqual(empty.map((stat) => stat.value), ["0", "–", "0/0", "≈ list —"]);
  assert.equal(empty[1]!.caption, "no settled rows");
});

test("role colours come from the config's agents, and nothing else", () => {
  assert.deepEqual(readRoleColors({ agents: [{ name: "builder", color: "#22D3EE" }, { name: "x", color: "red" }, { name: 3 }] }), { builder: "#22D3EE" });
  assert.deepEqual(readRoleColors(null), {});
  assert.deepEqual(readRoleColors({ agents: "no" }), {});
});

test("the run picker lists the lens's runs newest first, and the focus note names the route", () => {
  assert.deepEqual(runsInLens(payload, DEFAULT_METRICS_ROUTE).map((run) => run.sessionId), ["f2", "f1", "f3"]);
  assert.equal(routeFocusNote(DEFAULT_METRICS_ROUTE, rows, RATE_CARD.rows), null);
  assert.equal(routeFocusNote({ ...DEFAULT_METRICS_ROUTE, route: "codex/gpt-6-sol@xhigh" }, rows, RATE_CARD.rows), "route GPT-6 Sol · xhigh");
  assert.equal(routeFocusNote({ ...DEFAULT_METRICS_ROUTE, route: "nope/x@y" }, rows, RATE_CARD.rows), "route nope/x@y");
});

test("the run card's metrics control is a lucide link beside the archive control, outside the card's anchor", () => {
  const card = source("dashboard/src/components/SessionCard.vue");
  const template = card.slice(card.indexOf("<template>"));
  const anchor = template.slice(template.indexOf('<a class="session-card"'), template.indexOf("</a>") + 4);
  assert.doesNotMatch(anchor, /metrics-control|ChartColumn/);
  const after = template.slice(template.indexOf("</a>") + 4);
  const control = after.indexOf('class="metrics-control"'), archive = after.indexOf('class="archive-control"');
  assert.ok(control > 0 && archive > control, "the metrics control follows the card's closing </a> and precedes the archive control");
  assert.match(after, /:href="`#\/metrics\/run\/\$\{encodeURIComponent\(session\.sessionId\)\}`"/);
  assert.match(after, /:aria-label="`Open run \$\{shortSessionId\(session\.sessionId\)\} in metrics`"/);
  assert.match(card, /import \{ ChartColumn \} from "lucide-vue-next";/);
  assert.match(after, /aria-label="`Archive session/, "the archive control is unchanged");
});

test("the shell routes #/metrics, lists it between settings and canvas, and the tab only reads", () => {
  const app = source("dashboard/src/App.vue");
  assert.match(app, /metricsRoute\.value = isMetricsRoute\(location\.hash\)/);
  assert.match(app, /parseMetricsRoute\(location\.hash\)/);
  const nav = source("dashboard/src/components/TopNav.vue");
  const settings = nav.indexOf('href="#/settings"'), metrics = nav.indexOf('href="#/metrics"'), canvas = nav.indexOf('href="#/canvas"');
  assert.ok(settings > 0 && settings < metrics && metrics < canvas, "Settings, Metrics, Canvas");

  const tab = source("dashboard/src/routes/metrics.vue");
  assert.deepEqual([...tab.matchAll(/fetch\(([^)]*)\)/g)].map((match) => match[1]), ['"/api/v1/metrics"']);
  assert.doesNotMatch(tab, /method:|localStorage|sessionStorage/);
  assert.match(tab, /usePolling\(load,/);
  assert.match(tab, /<SessionFilterRow/);
  const lens = source("dashboard/src/metrics-lens.ts");
  assert.doesNotMatch(lens, /function (toggleFilterValue|selectAllState|toggleAllFilterValues)/, "the ladder helpers are reused, not forked");
});
