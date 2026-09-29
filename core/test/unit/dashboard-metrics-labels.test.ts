// W18 task 10: every dollar amount the metrics tab renders is a list-price
// equivalent from formatListEquivalent (D1, INV-3), except the two published
// prices task 8 requires on a Matrix row (T08 C6): the rate card's per-1M pair
// from formatRate and an untested route's prior. And the run card's metrics
// control sits outside the card's <a class="session-card">.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MetricsResponse } from "../../../dashboard/shared/types.ts";
import { listPrice, RATE_CARD } from "../../../dashboard/shared/rate-card.ts";
import { frontier, verdicts, FRONTIER_X, FRONTIER_Y } from "../../../dashboard/shared/route-metrics.ts";
import {
  COLUMN_FAMILIES,
  DEFAULT_METRICS_ROUTE,
  LEDGER_GROUPS,
  RAIL_FACETS,
  countTile,
  facetOptions,
  routeFocusNote,
  rowsInLens,
  summaryStats,
  withGroup,
} from "../../../dashboard/src/metrics-lens.ts";
import { buildMatrix, depthLegend, formatRate, tileLabel } from "../../../dashboard/src/metrics-matrix.ts";
import { X_PILLS, Y_PILLS, frontierPlot, frontierRoles, routeNames, verdictCards } from "../../../dashboard/src/metrics-frontier.ts";
import { buildLedger, terminalStrip } from "../../../dashboard/src/metrics-ledger.ts";
import { attributeCommand, attributionPanel, phaseStrip, roleLines, runFacts, runOptionLabel } from "../../../dashboard/src/metrics-run.ts";
import { METRICS_FILES, METRICS_TEMPLATES, code, elements, source, template } from "./_metrics-static.ts";
import { PAYLOAD_PATH } from "../fixtures/metrics/synthetic-payload.ts";

const payload = JSON.parse(readFileSync(PAYLOAD_PATH, "utf8")) as MetricsResponse;
const context = { rateCard: RATE_CARD.rows, priorLabels: payload.priors.modelLabels, roleColors: {} };

/** A dollar sign followed by an amount, or by the unpriced dash. */
const AMOUNT = /\$\s?[\d—]/;
/** formatListEquivalent's two shapes. */
const LIST_EQUIVALENT = /≈ list \$\d+\.\d{2}|≈ list —/g;

/** Every string reachable from a view model, calling nothing. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value instanceof Map) for (const [key, item] of value) strings([key, item], out);
  else if (value instanceof Set) for (const item of value) strings(item, out);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) strings(item, out);
  return out;
}

/** What the tab would print over the synthetic payload: every view, every group, every family, every axis. */
function renderedStrings(): { general: string[]; rowDetails: string[] } {
  const general: string[] = [];
  const rowDetails: string[] = [];
  const route = DEFAULT_METRICS_ROUTE;
  const rows = rowsInLens(payload.roleRows, route);
  general.push(...strings(summaryStats(rows, listPrice)), ...strings(countTile(payload.runs, payload.roleRows, route)));
  general.push(...strings(routeFocusNote({ ...route, route: "codex/gpt-6-sol@xhigh" }, payload.roleRows, RATE_CARD.rows)));
  for (const facet of RAIL_FACETS) general.push(...strings(facetOptions(payload.roleRows, route, facet, context)));
  for (const untested of [false, true]) {
    const matrix = buildMatrix(rows, payload, listPrice, untested);
    for (const row of matrix.rows) {
      rowDetails.push(row.detail);
      general.push(row.title);
      for (const tile of row.tiles) if (tile !== null) general.push(...strings(tile), tileLabel(row, tile));
    }
  }
  general.push(...strings(depthLegend()), ...strings(X_PILLS), ...strings(Y_PILLS));
  const names = routeNames(rows, RATE_CARD.rows, payload.priors.modelLabels);
  for (const role of frontierRoles(rows)) {
    for (const y of FRONTIER_Y) {
      for (const x of FRONTIER_X) {
        const front = frontier(rows, role, y, x, listPrice);
        if (front.points.length > 0) general.push(...strings(frontierPlot(front, names)));
        general.push(...strings(verdictCards(front, verdicts(front), names)));
      }
    }
  }
  for (const group of LEDGER_GROUPS) {
    const ledger = buildLedger(rows, withGroup({ ...route, families: [...COLUMN_FAMILIES] }, group), listPrice, context);
    general.push(...strings(ledger.headers), ...strings(ledger.families));
    for (const row of ledger.rows) {
      general.push(row.title, row.detail, ...strings(terminalStrip(row.stats)));
      for (const column of ledger.columns) general.push(...strings(column.cell(row.stats)));
    }
  }
  for (const run of payload.runs) {
    const own = payload.roleRows.filter((row) => row.sessionId === run.sessionId);
    general.push(runOptionLabel(run), ...strings(runFacts(run, own, listPrice)), ...strings(phaseStrip(run.phases)));
    general.push(...strings(roleLines(own, listPrice, { ...context, allRows: payload.roleRows })));
    general.push(...strings(attributionPanel(run)), attributeCommand(run, "factory", "flaky gate"));
  }
  return { general, rowDetails };
}

test("every rendered dollar amount is formatListEquivalent's, except a Matrix row's published price", () => {
  const { general, rowDetails } = renderedStrings();
  assert.ok(general.length > 200, `the render walk reached ${general.length} strings`);
  const listed = general.filter((text) => AMOUNT.test(text));
  assert.ok(listed.length > 10, "the walk reaches priced text");
  for (const text of listed) {
    assert.doesNotMatch(text.replace(LIST_EQUIVALENT, ""), AMOUNT, `a bare dollar amount: ${JSON.stringify(text)}`);
  }
  // A row's detail may carry the rate card's per-1M pair and an untested route's prior, nothing else priced.
  const published = [
    ...RATE_CARD.rows.map(formatRate),
    ...payload.untestedRoutes.map((route) => route.prior),
  ].sort((a, b) => b.length - a.length);
  assert.ok(rowDetails.some((detail) => AMOUNT.test(detail)), "the fixture shows a published price");
  for (const detail of rowDetails) {
    const rest = published.reduce((text, price) => text.split(price).join(""), detail);
    assert.doesNotMatch(rest.replace(LIST_EQUIVALENT, ""), AMOUNT, `row detail ${JSON.stringify(detail)}`);
  }
});

test("no metrics file builds a dollar amount of its own; formatRate is the one named exception", () => {
  for (const file of METRICS_FILES.filter((path) => !path.endsWith(".css"))) {
    let text = code(source(file));
    if (file === "dashboard/src/metrics-matrix.ts") {
      const rate = /export function formatRate\([^)]*\): string \{\n\s*return `\$\$\{card\.input\} \/ \$\$\{card\.output\}`;\n\}/;
      assert.match(text, rate, "formatRate is the rate card's per-1M pair (T08 C6)");
      text = text.replace(rate, "");
    }
    // A literal "$" before an interpolation, a digit, or a Vue mustache.
    assert.doesNotMatch(text, /\$\$\{|\$\s?\d|\$\s?\{\{/, `${file} builds a dollar amount`);
  }
  for (const file of METRICS_TEMPLATES) {
    assert.doesNotMatch(template(source(file)).replace(/"[^"]*"/g, ""), /\$(?!\{)/, `${file} prints a literal "$" in its markup`);
  }
});

test("the summary names the list equivalent as not spend, and the tab never says spend or cost for a figure", () => {
  const summary = summaryStats(rowsInLens(payload.roleRows, DEFAULT_METRICS_ROUTE), listPrice);
  const list = summary.find((stat) => stat.id === "list-per-landed")!;
  assert.equal(list.caption, "list-price equivalent, not spend");
  assert.match(list.value, /^≈ list (\$\d+\.\d{2}|—)$/);
  for (const text of renderedStrings().general) {
    assert.doesNotMatch(text, /\b(spent|spend|cost)\b[^,]*\$\d/i, `${JSON.stringify(text)} presents a figure as spend`);
  }
});

test("the run card's metrics control sits outside <a class=\"session-card\">, and no link nests in another", () => {
  const card = template(source("dashboard/src/components/SessionCard.vue"));
  const anchors = elements(card, "a", "SessionCard.vue");
  const sessionCard = anchors.find((element) => /class="session-card"/.test(element.attrs));
  assert.ok(sessionCard, "the card is one anchor");
  assert.doesNotMatch(sessionCard!.inner, /metrics-control|ChartColumn|<a[\s>]/, "nothing interactive inside the card's anchor");
  const control = anchors.find((element) => /class="metrics-control"/.test(element.attrs));
  assert.ok(control, "the metrics control is a link");
  assert.ok(card.indexOf(control!.attrs) > card.indexOf(sessionCard!.inner) + sessionCard!.inner.length, "it follows the card's </a>");
  const controls = elements(card, "div", "SessionCard.vue").find((element) => /class="card-controls"/.test(element.attrs));
  assert.ok(controls && /class="metrics-control"/.test(controls.inner) && /class="archive-control"/.test(controls.inner),
    "the metrics control and the archive control are siblings in .card-controls");

  // The Run view's miniature follows the same rule.
  const run = template(source("dashboard/src/components/MetricsRun.vue"));
  const link = elements(run, "a", "MetricsRun.vue").find((element) => /class="run-card-link"/.test(element.attrs))!;
  assert.doesNotMatch(link.inner, /metrics-control|archive-control|<a[\s>]|<button/);

  for (const file of METRICS_TEMPLATES) {
    for (const anchor of elements(template(source(file)), "a", file)) {
      assert.doesNotMatch(anchor.inner, /<a[\s>]|<button[\s>]/, `${file}: an interactive element nested in a link`);
    }
  }
});
