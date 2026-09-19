import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GroupSummary, SessionPlan } from "../../../dashboard/shared/types.ts";
import { buildCanvasGraph, runNodeId, type CanvasSession } from "../../../dashboard/src/canvas-graph.ts";
import { layoutGraph, retainedPins } from "../../../dashboard/src/canvas-layout.ts";
import { browserPins, PIN_STORE, readPins, writePins, type PinStore } from "../../../dashboard/src/canvas-pins.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

/** A store that keeps what it was given, which is the whole of what a reload does. */
function memoryStore(): PinStore & { readonly seen: Map<string, string> } {
  const seen = new Map<string, string>();
  return {
    seen,
    getItem: (key) => seen.get(key) ?? null,
    setItem: (key, value) => { seen.set(key, value); },
  };
}

const counts = { stages: 4, inputs: 2, proposals: 2, applied: 1, notTaken: 1, alternatives: 3, unitRecords: 1, units: 1 };
const summaries: readonly GroupSummary[] = [
  { group: "drive-a", project: "p", revision: 4, closed: false, title: "The first ask.", at: "2026-09-08T00:00:00.000Z", counts },
];
const plans: readonly SessionPlan[] = [
  { id: "awsf-v2-plan", name: "AWSF v2", kind: "spine", parentSpine: null, parentSpineName: null },
];

function run(sessionId: string, taskId: string, patch: Partial<CanvasSession> = {}): CanvasSession {
  return {
    sessionId, project: "p", taskId, continuesTask: null, attempt: 1,
    groupId: "drive-a", startedAt: "2026-09-08T10:00:00.000Z", state: "LANDED", planRef: "awsf-v2-plan",
    ...patch,
  };
}

const runs = [run("s1", "task-one"), run("s2", "task-two"), run("s3", "task-three")];

test("a dot dropped where the reader wanted it is still there after a reload", () => {
  const graph = buildCanvasGraph(runs, summaries, plans);
  const dropped = runNodeId(["s2"]);
  assert.ok(graph.nodes.some((node) => node.id === dropped), "the dot exists to be dropped");

  // The drop, as the map records it.
  const store = memoryStore();
  writePins(store, new Map([[dropped, { x: 640, y: -210 }]]));
  assert.ok(store.seen.has(PIN_STORE), "and it went to the store, under one key");

  // The reload: nothing in memory survives it, so the second read is the only
  // thing standing between the reader and a simulation that settles the graph
  // back to its deterministic start and silently undoes the arrangement.
  const afterReload = readPins(store);
  assert.deepEqual(afterReload.get(dropped), { x: 640, y: -210 });
  const kept = retainedPins(graph, afterReload);
  assert.deepEqual(kept.get(dropped), { x: 640, y: -210 });
  assert.deepEqual(layoutGraph(graph, { pinned: kept }).positions.get(dropped), { x: 640, y: -210 });
  // And the rest of the map is not frozen with it: the unpinned dots arranged
  // themselves around the one that was placed.
  const free = graph.nodes.filter((node) => node.id !== dropped);
  assert.ok(free.length > 0);
  const settled = layoutGraph(graph, { pinned: kept }).positions;
  assert.ok(free.every((node) => settled.has(node.id)));
});

test("a store that cannot be read or has been scribbled in loses the arrangement and nothing else", () => {
  // Private windows, cleared site data and a hand-edited store are ordinary
  // states on this path, not errors the canvas may refuse to draw over.
  assert.deepEqual([...readPins(null)], []);
  assert.deepEqual([...readPins({ getItem: () => "not json", setItem: () => {} })], []);
  assert.deepEqual([...readPins({ getItem: () => "[1,2]", setItem: () => {} })], []);
  // A coordinate that is not a finite number would put a dot at NaN and take
  // the whole drawing with it, so it is dropped rather than trusted.
  assert.deepEqual([...readPins({ getItem: () => '{"a":{"x":1,"y":null},"b":{"x":3,"y":4}}', setItem: () => {} })], [["b", { x: 3, y: 4 }]]);
  assert.doesNotThrow(() => writePins(null, new Map([["a", { x: 1, y: 2 }]])));
  assert.doesNotThrow(() => writePins({ getItem: () => null, setItem: () => { throw new Error("quota"); } }, new Map()));
  // Reaching for the store at all throws in some browsers, on the property and
  // not only on the call, so that reach is guarded too.
  assert.match(source("dashboard/src/canvas-pins.ts"), /export function browserPins\(\): PinStore \| null \{\s*try \{/u);
  assert.doesNotThrow(() => browserPins());
});

test("an archived run leaves the map, and takes its pin and its lines with it", () => {
  // Archiving is a write, and this surface makes none. A run leaves because
  // the projection stops serving it — `sessions` selects `archived = 0` — so
  // what the canvas owes is to draw only what it was handed, and to leave
  // nothing of the run behind when the next poll arrives without it.
  const before = buildCanvasGraph(runs, summaries, plans);
  const gone = runNodeId(["s3"]);
  assert.ok(before.nodes.some((node) => node.id === gone));

  const after = buildCanvasGraph(runs.filter((held) => held.sessionId !== "s3"), summaries, plans);
  assert.equal(after.nodes.some((node) => node.id === gone), false, "the dot is gone");
  assert.equal(after.unplaced.some((node) => node.id === gone), false, "and it did not fall into the parked rail");
  const ids = new Set([...after.nodes, ...after.unplaced].map((node) => node.id));
  assert.ok(after.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to)), "no line points at a dot that left");
  assert.ok(after.clusters.every((cluster) => cluster.nodeIds.every((id) => ids.has(id))), "no cluster holds it");
  // The driving session it ran under is still on the map: the run left, the
  // session did not, and two runs still stand behind it.
  assert.equal(after.nodes.filter((node) => node.kind === "run").length, 2);
  assert.ok(after.nodes.some((node) => node.kind === "session"));
  // A position for a dot nobody can see would sit in the store forever,
  // pinning empty space.
  const store = memoryStore();
  writePins(store, new Map([[gone, { x: 12, y: 34 }], [runNodeId(["s1"]), { x: 5, y: 6 }]]));
  const kept = retainedPins(after, readPins(store));
  assert.deepEqual([...kept.keys()], [runNodeId(["s1"])]);
});

test("focus follows the reader into an opened node and back to the dot they opened", () => {
  const route = source("dashboard/src/routes/canvas.vue");
  const map = source("dashboard/src/components/CanvasMap.vue");
  // Nothing traps focus inside an opened node, because there is nothing to
  // trap it against: the map is `v-else` in this chain and does not exist
  // while a node is open.
  assert.match(route, /<CanvasMap\n\s+v-else\n/u);
  // On the way in, the panel itself takes focus, so a screen reader announces
  // what opened and Tab walks forward into it rather than past it.
  assert.equal(route.match(/class="canvas-opened canvas-board neu-well"/gu)?.length, 3);
  assert.equal(route.match(/ref="panel" tabindex="-1" class="canvas-opened/gu)?.length, 3);
  assert.match(route, /if \(now !== null\) \{ panel\.value\?\.focus\(\); return; \}/u);
  // On the way back, to the dot that was opened — or to its entry in the rail
  // beside the map, for a node the map was never drawing.
  assert.match(route, /if \(map\.value\?\.focusNode\(before\) !== true\) parked\.get\(before\)\?\.focus\(\);/u);
  assert.match(map, /defineExpose\(\{ fit, reset, focusNode \}\);/u);
  assert.match(map, /function focusNode\(id: string\): boolean \{/u);
  assert.match(map, /:ref="\(element\) => holdDot\(node\.id, element\)"/u);
  assert.match(route, /:ref="\(element\) => holdParked\(node\.id, element\)"/u);
  // Awaited, so the panel the focus is going to has been rendered; and lazy,
  // so arriving with `opened` already in the address moves nothing.
  assert.match(route, /watch\(\(\) => props\.route\.opened, async \(now, before\) => \{\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*await nextTick\(\);/u);
});
