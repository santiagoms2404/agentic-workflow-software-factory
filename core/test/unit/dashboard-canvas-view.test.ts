import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GroupSummary, SessionPlan } from "../../../dashboard/shared/types.ts";
import { buildCanvasGraph, planNodeId, runNodeId, sessionNodeId, type CanvasSession } from "../../../dashboard/src/canvas-graph.ts";
import { layoutGraph } from "../../../dashboard/src/canvas-layout.ts";
import {
  CANVAS_KINDS,
  canvasRouteHash,
  clampZoom,
  filterGraph,
  fitCamera,
  graphPoint,
  kindCounts,
  MAX_ZOOM,
  MIN_ZOOM,
  nodeRadius,
  openHref,
  parseCanvasRoute,
  screenPoint,
  zoomAbout,
} from "../../../dashboard/src/canvas-view.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

const counts = { stages: 4, inputs: 2, proposals: 2, applied: 1, notTaken: 1, alternatives: 3, unitRecords: 1, units: 1 };
const summaries: readonly GroupSummary[] = [
  { group: "drive-a", project: "p", revision: 4, closed: false, title: "The first ask.", at: "2026-09-08T00:00:00.000Z", counts },
];
const plans: readonly SessionPlan[] = [
  { id: "awsf-v2-plan", name: "AWSF v2", kind: "spine", parentSpine: null, parentSpineName: null },
];

function run(sessionId: string, groupId: string | null, planRef: string | null): CanvasSession {
  return {
    sessionId, project: "p", taskId: `task-${sessionId}`, continuesTask: null, attempt: 1,
    groupId, startedAt: "2026-09-08T10:00:00.000Z", state: "LANDED", planRef,
  };
}

const graph = buildCanvasGraph(
  [run("s1", "drive-a", "awsf-v2-plan"), run("s2", "drive-a", null)],
  summaries,
  plans,
);

test("the whole canvas state survives a reload and a back button, because it is the URL", () => {
  const route = parseCanvasRoute("#/canvas?kinds=run,plan&sel=run:s1&cam=120,-40,1.25");
  assert.deepEqual(route.kinds, ["run", "plan"]);
  assert.equal(route.selected, "run:s1");
  assert.deepEqual(route.camera, { x: 120, y: -40, zoom: 1.25 });
  // An address the reader reads: commas and colons are legal in a query, so
  // they are not spelled %2C and %3A here.
  assert.equal(canvasRouteHash(route), "#/canvas?kinds=run,plan&sel=run:s1&cam=120,-40,1.25");
  assert.deepEqual(parseCanvasRoute(canvasRouteHash(route)), route, "and it round-trips");
  // The encoded form a browser or an older link may carry still parses.
  assert.deepEqual(parseCanvasRoute("#/canvas?kinds=run%2Cplan&sel=run%3As1&cam=120%2C-40%2C1.25"), route);
  // Only what differs from the default is written, so an untouched canvas has a
  // clean URL and a reader can tell at a glance that nothing is filtered.
  assert.equal(canvasRouteHash({ kinds: CANVAS_KINDS, selected: null, camera: null, opened: null }), "#/canvas");
  // Opening a node is a place you went, so it is a path segment and the
  // browser's own Back leaves it — with the map's state riding in the query.
  const inside = parseCanvasRoute("#/canvas/run:s1?kinds=run&cam=0,0,1.00");
  assert.equal(inside.opened, "run:s1");
  assert.equal(canvasRouteHash(inside), "#/canvas/run:s1?kinds=run&cam=0,0,1.00");
  assert.equal(parseCanvasRoute("#/canvas?sel=run:s1").opened, null);
});

test("an unreadable or empty URL means every kind, never an empty map", () => {
  // A map showing nothing reads as a broken screen rather than as a filter, and
  // there would be no control left on it to undo the filter with.
  for (const hash of ["#/canvas", "#/canvas?kinds=", "#/canvas?kinds=nonsense", "#/canvas?cam=oops"]) {
    assert.deepEqual(parseCanvasRoute(hash).kinds, CANVAS_KINDS, hash);
  }
  assert.equal(parseCanvasRoute("#/canvas?cam=1,2").camera, null);
  assert.equal(parseCanvasRoute("#/canvas?sel=").selected, null);
  // The kind order is the menu's, not the URL's, so two URLs naming the same
  // kinds produce the same map.
  assert.deepEqual(parseCanvasRoute("#/canvas?kinds=plan,run").kinds, ["run", "plan"]);
});

test("switching off a kind removes its dots and every line that ended on one", () => {
  assert.deepEqual(kindCounts(graph), new Map([["run", 2], ["session", 1], ["plan", 1]]));
  const withoutPlans = filterGraph(graph, ["run", "session"]);
  assert.deepEqual(withoutPlans.nodes.map((node) => node.kind), ["run", "run", "session"]);
  assert.equal(withoutPlans.edges.some((edge) => edge.kind === "plan"), false);
  // Only runs: both membership edges go with the session that held them.
  const onlyRuns = filterGraph(graph, ["run"]);
  assert.deepEqual(onlyRuns.edges, []);
  assert.deepEqual(onlyRuns.unplaced, []);
});

test("a region needs two surviving sessions, or it is a box drawn around one dot", () => {
  const connected = buildCanvasGraph(
    [
      { ...run("s1", "drive-a", null), taskId: "task-x", attempt: 1 },
      { ...run("s2", "drive-b", null), taskId: "task-x", attempt: 2, startedAt: "2026-09-09T10:00:00.000Z" },
    ],
    summaries,
    [],
  );
  assert.equal(connected.clusters.length, 1);
  assert.deepEqual(filterGraph(connected, ["run"]).clusters, []);
  assert.equal(filterGraph(connected, ["run", "session"]).clusters.length, 1);
});

test("the camera fits the whole drawing, and zoom stays inside its bounds", () => {
  const layout = layoutGraph(graph);
  const camera = fitCamera(layout, { width: 1200, height: 700 });
  assert.ok(camera.zoom >= MIN_ZOOM && camera.zoom <= MAX_ZOOM);
  for (const point of layout.positions.values()) {
    const screen = screenPoint(point, camera);
    assert.ok(screen.x >= 0 && screen.x <= 1200, `x ${screen.x}`);
    assert.ok(screen.y >= 0 && screen.y <= 700, `y ${screen.y}`);
  }
  assert.equal(clampZoom(99), MAX_ZOOM);
  assert.equal(clampZoom(0.001), MIN_ZOOM);
  assert.equal(clampZoom(Number.NaN), 1);
  // An empty drawing still gives a usable camera rather than a NaN one.
  const empty = fitCamera({ positions: new Map(), bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }, { width: 800, height: 600 });
  assert.ok(Number.isFinite(empty.x) && Number.isFinite(empty.y) && empty.zoom === 1);
});

test("zooming keeps the thing under the pointer under the pointer", () => {
  const camera = { x: 40, y: -20, zoom: 1 };
  const at = { x: 300, y: 220 };
  const before = graphPoint(at, camera);
  const after = graphPoint(at, zoomAbout(camera, at, 1.4));
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.001);
  // And screen and graph coordinates are each other's inverse.
  const point = { x: -123, y: 456 };
  const round = graphPoint(screenPoint(point, camera), camera);
  assert.ok(Math.hypot(round.x - point.x, round.y - point.y) < 0.001);
});

test("a dot's size comes from the runs behind it, and is bounded", () => {
  assert.ok(nodeRadius(1) < nodeRadius(3));
  assert.equal(nodeRadius(9), nodeRadius(6), "a very deep deck stops growing rather than swallowing the map");
  assert.ok(nodeRadius(0) > 0, "a session with no runs is still a dot you can click");
});

test("nothing on this canvas is a control that does nothing", () => {
  // The node-scoped views are the next slices. Until they exist, opening a dot
  // goes to the screen that already shows that thing.
  const session = graph.nodes.find((node) => node.kind === "session")!;
  const plan = graph.nodes.find((node) => node.kind === "plan")!;
  const deck = graph.nodes.find((node) => node.kind === "run")!;
  assert.equal(openHref(session), `#/groups/${encodeURIComponent("drive-a")}`);
  assert.equal(openHref(plan), `#/backlog/${encodeURIComponent("awsf-v2-plan")}`);
  assert.equal(openHref(deck), `#/sessions/${encodeURIComponent(deck.sessionIds.at(-1)!)}`);
  assert.equal(openHref({ kind: "run", ref: null, sessionIds: [] }), null);
  void [runNodeId, sessionNodeId, planNodeId];
});

test("selection dims and the filter removes, and the two are not drawn alike", () => {
  const map = source("dashboard/src/components/CanvasMap.vue");
  const css = source("dashboard/src/styles/morphism.css");
  // Selection: every other dot stays where it is, at reduced contrast.
  assert.match(map, /touching \? "adjacent" : "dimmed"/u);
  assert.match(css, /\.canvas-dot\.dimmed \{[^}]*opacity: \.26/su);
  // The filter is a control in the rail, and it takes the lines with it.
  const route = source("dashboard/src/routes/canvas.vue");
  assert.match(route, /toggleKind\(kind\)/u);
  // A selection is cleared only when the FILTER hid it, never on absence alone.
  // The group list resolves before the session list, so a guard that cleared on
  // absence fired once against an empty graph and threw away the selection
  // every reader arrived with in their URL.
  assert.match(route, /if \(recorded\(graph\.value\.nodes\) && !recorded\(next\.nodes\)\) go\(\{ selected: null \}\);/u);
  // Parked is not hidden: before any run has loaded, every recorded session is
  // parked, and a guard that counted that as "gone" cleared the selection the
  // reader arrived with — twice, in two different spellings.
  assert.doesNotMatch(route, /recorded\(graph\.value\.unplaced\)/u);
  assert.match(source("dashboard/src/canvas-view.ts"), /edges: graph\.edges\.filter\(\(edge\) => live\.has\(edge\.from\) && live\.has\(edge\.to\)\)/u);
});

test("the map is drawn in light and shadow, with colour spent only where it is information", () => {
  const shell = source("dashboard/src/styles/morphism.css");
  const base = source("dashboard/src/styles/dashboard.css");
  const block = shell.split("--- Canvas: the execution map")[1]?.split("--- Backlog:")[0] ?? "";
  assert.ok(block.includes(".canvas-dot"));
  // No hardcoded colour and no edge anywhere on the shell's half: a dot is a
  // raised pill like everything else standing on a well.
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/u);
  assert.doesNotMatch(block, /border-left|border-right|border-top|border-bottom|--accent/u);
  assert.match(block, /\.canvas-dot \{[^}]*box-shadow: var\(--neu-raised-soft\)/su);
  // Hue AND silhouette, because Forest is monochromatic and hue alone cannot
  // separate a run from a session on it.
  assert.match(base, /\.canvas-dot-run, \.canvas-kind-run \.canvas-kind-dot \{ border-radius: 50%; \}/u);
  assert.match(base, /\.canvas-dot-session, \.canvas-kind-session \.canvas-kind-dot \{ border-radius: 32%; \}/u);
  assert.match(base, /\.canvas-dot-plan, \.canvas-kind-plan \.canvas-kind-dot \{ border-radius: 14%; \}/u);
  // A recorded continuation is the only line spent a colour.
  assert.match(base, /\.canvas-edge\.edge-continuation \{ stroke: var\(--accent\)/u);
});

test("a drop stays where it was dropped, and only a reset undoes it", () => {
  const map = source("dashboard/src/components/CanvasMap.vue");
  const route = source("dashboard/src/routes/canvas.vue");
  // Recording a drop used to re-settle the whole graph from its deterministic
  // start, so the moment you released the mouse everything jumped elsewhere.
  assert.doesNotMatch(map, /watch\(\(\) => props\.pinned, relayout\)/u);
  assert.match(map, /function reset\(\): void \{\s*positions\.value = layoutGraph\(props\.graph\)\.positions;\s*emit\("update:pinned", new Map\(\)\);\s*fit\(\);/u);
  assert.match(map, /defineExpose\(\{ fit, reset \}\)/u);
  assert.match(route, /@click="map\?\.reset\(\)">reset the map</u);
});

test("selecting is one press and opening is two, and neither eats the other", () => {
  const map = source("dashboard/src/components/CanvasMap.vue");
  assert.match(map, /@dblclick\.stop\.prevent="open\(node\)"/u);
  assert.match(map, /@keydown\.enter\.stop\.prevent="open\(node\)"/u);
  // `PointerEvent.detail` is not a click count on `pointerup`, so the clock
  // tells the second press from a first.
  assert.match(map, /const second = finished\.id === lastRelease\.id && now - lastRelease\.at < 350;/u);
  // And a press on the label's own link must never reach the surface: clearing
  // the selection there unmounts the link before its click can land.
  assert.match(map, /class="canvas-label"[\s\S]*?@pointerdown\.stop[\s\S]*?@pointerup\.stop/u);
});

test("every action the mouse can reach has a key, and the surface says so", () => {
  const map = source("dashboard/src/components/CanvasMap.vue");
  for (const key of ["Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", '"0"']) {
    assert.ok(map.includes(key), key);
  }
  assert.match(map, /aria-label="Execution map\. Click a dot to select it and double-click to open it\./u);
  assert.match(map, /tabindex="0"/u);
  // Each dot is a button in the graph's sorted order, so Tab walks the map in
  // the order a reader meets it.
  assert.match(map, /v-for="node in graph\.nodes"[\s\S]*?type="button"/u);
  assert.match(map, /:aria-pressed="selected === node\.id"/u);
  assert.match(map, /prefers-reduced-motion/u.test(source("dashboard/src/styles/morphism.css")) ? /./u : /never/u);
});
