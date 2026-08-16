import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { layoutTimeline } from "../../../dashboard/src/timeline.ts";

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

test("minimum-width timeline geometry remains ordered and non-overlapping", () => {
  const layout = layoutTimeline([
    { id: "request", start: 0, end: 0 },
    { id: "plan", start: 1_000, end: 1_001 },
    { id: "commit", start: 1_002, end: 1_002 },
    { id: "test", start: 1_003, end: 9_000 },
  ], { start: 0, end: 10_000, leadingZonePercent: 16, minimumWidthPercent: 3.5 });
  const rows = ["plan", "commit", "test"].map((id) => layout[id]!);
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(rows[index]!.left >= rows[index - 1]!.left + rows[index - 1]!.width);
  }
  assert.ok(rows.every((row) => row.width >= 3.5));
  assert.ok(rows.at(-1)!.left + rows.at(-1)!.width <= 100);
});

test("dashboard uses routed inline phase detail and keeps owner/state evidence", () => {
  const route = source("dashboard/src/components/SessionRoute.vue");
  const header = source("dashboard/src/components/SessionHeader.vue");
  const detail = source("dashboard/src/components/PhaseDetailDrawer.vue");
  assert.match(route, /#\/sessions\/\$\{encodeURIComponent\(props\.session\.sessionId\)\}\/phases\//);
  assert.match(header, /StateRibbon/);
  assert.match(header, /lifecycle-disclosure/);
  assert.match(route, /OwnerGateCard/);
  assert.match(source("dashboard/src/components/OwnerGateCard.vue"), /summary\.problem[\s\S]*summary\.changes[\s\S]*summary\.verification[\s\S]*summary\.risks/);
  assert.match(route, /PhaseDetailDrawer/);
  assert.doesNotMatch(detail, /aria-modal|role="dialog"|drawer-backdrop/);
  assert.match(detail, /Escape/);
  assert.match(detail, /inline-phase-detail/);
});

test("compact strip flows directly into waterfall with no duplicate standalone roster", () => {
  const route = source("dashboard/src/components/SessionRoute.vue");
  assert.ok(route.indexOf("<SessionHeader") < route.indexOf("<SwimlaneChart"));
  assert.doesNotMatch(route, /AgentRoster|<StateRibbon/);
  const between = route.slice(route.indexOf("<SessionHeader"), route.indexOf("<SwimlaneChart"));
  assert.doesNotMatch(between, /<section|Agent roster|Lifecycle/);
});

test("card footer uses a bounded two-column metrics grid and an accessible archive action", () => {
  const card = source("dashboard/src/components/SessionCard.vue");
  const css = source("dashboard/src/styles/dashboard.css");
  assert.match(card, /card-metrics-grid/);
  assert.match(card, /<dt>cost<\/dt>/);
  assert.match(card, /<dt>runtime<\/dt>/);
  assert.match(card, /<dt>usage<\/dt>/);
  assert.match(card, /<dt>calls<\/dt>/);
  assert.match(css, /\.card-metrics-grid[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.doesNotMatch(css, /\.card-metrics-grid[^}]*overflow(?:-x)?:\s*(?:hidden|auto)/s);
  assert.match(card, /aria-label="`Archive session/);
  assert.match(card, /method: "POST"/);
});

test("dashboard clamps requests, has 3/2/1 responsive cards, and a 16px floor", () => {
  const css = source("dashboard/src/styles/dashboard.css");
  assert.match(css, /font-size:\s*16px/);
  assert.match(css, /\.session-card[^}]*height:/s);
  assert.match(css, /\.card-request[^}]*white-space:\s*nowrap/s);
  assert.match(css, /grid-template-columns:\s*repeat\(3/);
  assert.match(css, /max-width:\s*1100px[^}]*repeat\(2/s);
  assert.match(css, /max-width:\s*720px[^}]*grid-template-columns:\s*1fr/s);
});

test("sandbox display consumes explicit evidence and never infers from adapter or platform text", () => {
  const card = source("dashboard/src/components/AgentCard.vue");
  assert.match(card, /agent\.sandboxBadge/);
  assert.match(card, /Sandbox evidence: not recorded/);
  assert.doesNotMatch(card, /adapterId\.includes|platform|includes\(["']sandbox|includes\(["']policy/);
});

test("strict local-only assets, accessibility hooks, and read-only route boundary remain explicit", () => {
  const css = source("dashboard/src/styles/dashboard.css");
  const security = source("core/src/api/security.ts");
  const routes = source("core/src/api/routes.ts");
  const dashboard = [source("dashboard/src/App.vue"), source("dashboard/src/styles/dashboard.css")].join("\n");
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(security, /default-src 'none'/);
  assert.match(security, /img-src 'self' data:/);
  assert.doesNotMatch(dashboard, /https?:\/\//);
  for (const forbidden of ["land", "approv", "retry", "cancel", "config-mutation"]) {
    assert.equal(JSON.stringify(routes.match(/API_ROUTE_TABLE[\s\S]*?\] as const/)?.[0] ?? "").toLowerCase().includes(forbidden), false);
  }
});
