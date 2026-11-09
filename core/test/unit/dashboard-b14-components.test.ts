import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "./meta/_walk.ts";
import type { CanvasEdge, CanvasGraph, CanvasNode } from "../../../dashboard/src/canvas-graph.ts";
import { layoutGraph } from "../../../dashboard/src/canvas-layout.ts";

function source(path: string): string {
  return readFileSync(join(repoRoot(), path), "utf8");
}

function canvasNode(id: string): CanvasNode {
  return { id, kind: "run", label: id, weight: 1, sessionIds: [], ref: null };
}

function canvasGraph(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[]): CanvasGraph {
  return { nodes, edges, clusters: [], unplaced: [] };
}

test("B14-04: CanvasMap supports Enter/Space selection and navigation fallback", () => {
  const map = source("dashboard/src/components/CanvasMap.vue");
  assert.match(map, /function onDotKeydown\(event: KeyboardEvent, node: CanvasNode\): void/u);
  assert.match(map, /if \(event\.key === " " \|\| event\.key === "Spacebar"\)/u);
  assert.match(map, /emit\("update:selected", props\.selected === node\.id \? null : node\.id\)/u);
  assert.match(map, /@keydown="onDotKeydown\(\$event, node\)"/u);
  // open fallback when no href
  assert.match(map, /function open\(node: CanvasNode\): void \{\s*const href = openHref\(node, props\.route\);\s*if \(href !== null\) \{\s*location\.hash = href;\s*\} else \{\s*emit\("update:selected", props\.selected === node\.id \? null : node\.id\);\s*\}/u);
});

test("B14-05: CanvasWheel does not preventDefault when at sequence boundaries", () => {
  const wheel = source("dashboard/src/components/CanvasWheel.vue");
  assert.match(wheel, /const delta = event\.deltaY > 0 \|\| event\.deltaX > 0 \? 1 : -1;/u);
  assert.match(wheel, /if \(\(delta < 0 && atStart\.value\) \|\| \(delta > 0 && atEnd\.value\)\) return;/u);
});

test("B14-07: LiveIndicator uses reactive timer clock for staleness", () => {
  const live = source("dashboard/src/components/LiveIndicator.vue");
  assert.match(live, /setInterval/u);
  assert.match(live, /clearInterval/u);
  assert.match(live, /now\.value - props\.lastPollAt < 2 \* props\.pollMs/u);
});

test("B14-08: MetricsRun uses formatDate for run.startedAt", () => {
  const run = source("dashboard/src/components/MetricsRun.vue");
  assert.match(run, /formatDate\(run\.startedAt\)/u);
  assert.doesNotMatch(run, /run\.startedAt\.slice\(0, 10\)/u);
});

test("B14-12: StateRibbon includes BLOCKED and CANCELLED terminal states", () => {
  const ribbon = source("dashboard/src/components/StateRibbon.vue");
  assert.match(ribbon, /"BLOCKED"/u);
  assert.match(ribbon, /"CANCELLED"/u);
});

test("B14-13 & B14-14: TicketSourceOverlay handles backdrop mouse tracking and focus trap", () => {
  const overlay = source("dashboard/src/components/TicketSourceOverlay.vue");
  // B14-13: backdrop mousedown and mouseup
  assert.match(overlay, /@mousedown="onBackdropMousedown"/u);
  assert.match(overlay, /@mouseup="onBackdropMouseup"/u);
  assert.match(overlay, /mousedownOnOverlay = event\.target === event\.currentTarget/u);
  assert.match(overlay, /if \(mousedownOnOverlay && event\.target === event\.currentTarget\) \{\s*emit\("close"\);\s*\}/u);

  // B14-14: focus trap on Tab / Shift+Tab inside dialog
  assert.match(overlay, /event\.key === "Tab"/u);
  assert.match(overlay, /event\.shiftKey/u);
  assert.match(overlay, /ref="dialog"/u);
});

test("B14-29: EventLog keeps its error alert until the next result replaces it", () => {
  const events = source("dashboard/src/components/EventLog.vue");
  const load = events.match(/async function load\(\): Promise<void> \{([\s\S]*?)\n\}/u);
  assert.ok(load, "load defined");
  const body = load[1] ?? "";
  // The reset ran before every request, so a failing endpoint removed and
  // re-inserted the alert on each one-second tick.
  assert.doesNotMatch(body.slice(0, body.indexOf("try {")), /error\.value = null/u);
  // The message is cleared only once a response has actually come back.
  assert.match(body, /\} while \(more\);[\s\S]*?error\.value = null;\s*\} catch/u);
  // The empty-phase note holds through a poll: it hides only until the first
  // attempt has settled, not for the length of every request.
  assert.match(events, /v-if="!phaseEvents\.length && settled"/u);
  assert.doesNotMatch(events, /v-if="!phaseEvents\.length && !loading"/u);
});

test("B14-30: the shared ask line counts characters, so an astral character is never split", () => {
  const tree = source("dashboard/src/components/GroupDecisionTree.vue");
  const presentation = source("dashboard/src/presentation.ts");
  assert.match(tree, /askLine as formatAskLine/u);
  assert.match(presentation, /const characters = Array\.from\(first\);/u);
  assert.match(presentation, /characters\.length <= budget \? first/u);
});

test("B14-31: a failure class whose last failed phase goes away closes its panel", () => {
  const view = source("dashboard/src/components/RunFailures.vue");
  assert.match(view, /import \{ computed, ref, watch \} from "vue";/u);
  assert.match(
    view,
    /watch\(present, \(classes\) => \{\s*if \(open\.value !== null && !classes\.includes\(open\.value\)\) \{\s*open\.value = null;/u,
  );
});

test("B14-32: the sessions crumb is the current page only on the sessions list", () => {
  const nav = source("dashboard/src/components/TopNav.vue");
  assert.match(
    nav,
    /:aria-current="!sessionId && !settings && !backlog && !groups && !canvas && !metrics \? 'page' : false"/u,
  );
});

test("B14-34: the relayout key moves when an edge is added between nodes already drawn", () => {
  const map = source("dashboard/src/components/CanvasMap.vue");
  // The key carries the edges, because the layout's spring force reads them.
  assert.match(map, /const shape = computed\(\(\) => JSON\.stringify\(\[[\s\S]*?props\.graph\.edges/u);
  // An edge alone moves the settled layout, so a key that ignores edges goes stale.
  const ids = ["a", "b", "c", "d", "e", "f"];
  const nodes = ids.map((id) => canvasNode(`run:${id}`));
  const bare = layoutGraph(canvasGraph(nodes, []));
  const linked = layoutGraph(canvasGraph(nodes, [{ from: "run:a", to: "run:f", kind: "membership" }]));
  const moved = nodes.filter((node) => {
    const before = bare.positions.get(node.id);
    const after = linked.positions.get(node.id);
    return before?.x !== after?.x || before?.y !== after?.y;
  });
  assert.ok(moved.length > 0, "one extra edge moves at least one settled position");
});

test("B14-35: a late phase response scrolls only this route's own drawer", () => {
  const route = source("dashboard/src/components/SessionRoute.vue");
  assert.doesNotMatch(route, /document\.querySelector/u);
  assert.match(route, /<PhaseDetailDrawer [^>]*ref="drawer"/u);
  assert.match(route, /drawer\.value\?\.\$el/u);
});
