import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SessionPlan, SessionsResponse } from "../../../dashboard/shared/types.ts";
import { buildCanvasGraph, pairNodeId, provingGroundNodeId, runNodeId } from "../../../dashboard/src/canvas-graph.ts";
import { initialPositions, layoutGraph, settle, type Point } from "../../../dashboard/src/canvas-layout.ts";
import { CANVAS_KINDS, filterGraph, openHref, parseCanvasRoute } from "../../../dashboard/src/canvas-view.ts";
import { parseMetricsRoute } from "../../../dashboard/src/metrics-lens.ts";
import { createApiRouter } from "../../src/api/routes.ts";
import { createSession } from "../../src/observability/projector.ts";
import { canvasReplays } from "../fixtures/canvas-replays.ts";
import { apiFixture } from "./api/_fixture.ts";

const sessions = canvasReplays();
const graph = buildCanvasGraph(sessions, [], []);
const gap = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function assertNearestPair(projects = sessions): void {
  const projection = buildCanvasGraph(projects, [], []);
  const layout = layoutGraph(projection);
  const pairs = projection.nodes.filter((node) => node.kind === "pair");
  for (const run of projects) {
    const at = layout.positions.get(runNodeId([run.sessionId]))!;
    const own = pairNodeId(run.project, run.replay!.itemId, run.replay!.repetition);
    const distance = gap(at, layout.positions.get(own)!);
    for (const pair of pairs) {
      if (pair.id !== own) assert.ok(distance < gap(at, layout.positions.get(pair.id)!), `${run.sessionId} is nearest its own pair`);
    }
  }
}

test("sixteen replays draw one hub, four pairs, twenty replay edges and one enclosing region", () => {
  assert.equal(graph.nodes.filter((node) => node.kind === "proving-ground").length, 1);
  assert.equal(graph.nodes.filter((node) => node.kind === "pair").length, 4);
  assert.equal(graph.nodes.filter((node) => node.kind === "run").length, 16);
  assert.equal(graph.edges.filter((edge) => edge.from.startsWith("run:")).length, 16);
  assert.equal(graph.edges.filter((edge) => edge.to === provingGroundNodeId("canvas-fixture")).length, 4);
  assert.ok(graph.edges.every((edge) => edge.kind === "replay"));
  assert.deepEqual(graph.clusters, [{ key: "proving-ground:canvas-fixture", nodeIds: graph.nodes.map((node) => node.id).sort() }]);
  assert.equal(graph.nodes.find((node) => node.kind === "proving-ground")?.label, "canvas-fixture · proving ground · 16 replays · 4 pairs");
  assert.ok(graph.nodes.filter((node) => node.kind === "pair").every((node) => node.weight === 4 && /^sample-[12] · rep [12]$/.test(node.label)));
  assert.deepEqual(graph.unplaced, []);
  assert.equal(graph.nodes.find((node) => node.id === runNodeId([sessions[0]!.sessionId]))?.label,
    "unrelated-1 · sample-1 · rep 1 · fixture/provider/model-1@high · place 4");
});

test("reordering the projection and renaming tasks never change replay relations", () => {
  assert.equal(JSON.stringify(buildCanvasGraph([...sessions].reverse(), [], [])), JSON.stringify(graph));
  const renamed = buildCanvasGraph(sessions.map((run, index) => ({ ...run, taskId: `same-round-prefix-${index}` })), [], []);
  assert.deepEqual(renamed.edges, graph.edges);
  assert.deepEqual(renamed.clusters, graph.clusters);
});

test("a deck of attempts on one replay has one pair edge, and weights count runs", () => {
  const first = sessions[0]!;
  const deck = buildCanvasGraph([first, { ...first, sessionId: "later-attempt", attempt: 2 }], [], []);
  assert.equal(deck.nodes.filter((node) => node.kind === "run").length, 1);
  assert.equal(deck.edges.filter((edge) => edge.from.startsWith("run:")).length, 1);
  assert.ok(deck.nodes.every((node) => node.weight === 2));
  assert.match(deck.nodes.find((node) => node.kind === "proving-ground")!.label, /2 replays · 1 pairs/);
});

test("a projection without a replay keeps the original graph byte for byte", () => {
  const run = { ...sessions[0]!, replay: null };
  const plans: SessionPlan[] = [{ id: "unused", name: "Unused", kind: "spine", parentSpine: null, parentSpineName: null }];
  assert.equal(JSON.stringify(buildCanvasGraph([run], [], plans)), JSON.stringify({
    nodes: [{ id: runNodeId([run.sessionId]), kind: "run", label: run.taskId, weight: 1, sessionIds: [run.sessionId], ref: null }],
    edges: [], clusters: [],
    unplaced: [{ id: "plan:unused", kind: "plan", label: "Unused", weight: 0, sessionIds: [], ref: "unused" }],
  }));
  const plain = buildCanvasGraph([run], [], []);
  const mixed = buildCanvasGraph([run, ...canvasReplays("another-project")], [], []);
  assert.deepEqual(mixed.nodes.find((node) => node.id === plain.nodes[0]!.id), plain.nodes[0]);
  assert.deepEqual(layoutGraph(mixed).positions.get(plain.nodes[0]!.id), layoutGraph(plain).positions.get(plain.nodes[0]!.id), "replays exert no force on an ordinary run");
  const ordinary = canvasReplays("ordinary").map((session) => ({ ...session, replay: null }));
  const before = layoutGraph(buildCanvasGraph(ordinary, [], [])).positions;
  const combined = buildCanvasGraph([...ordinary, ...sessions], [], []);
  const after = layoutGraph(combined).positions;
  for (const [id, point] of before) assert.deepEqual(after.get(id), point);
  const region = combined.clusters[0]!.nodeIds.map((id) => after.get(id)!);
  assert.ok(Math.max(...[...before.values()].map((point) => point.x)) < Math.min(...region.map((point) => point.x)), "the replay formation is beside the unchanged ordinary drawing");
});

test("two projects with the same items and repetitions draw separate regions", () => {
  const all = [...sessions, ...canvasReplays("second-project")];
  const projection = buildCanvasGraph(all, [], []);
  assert.equal(projection.clusters.length, 2);
  assert.equal(projection.nodes.filter((node) => node.kind === "pair").length, 8);
  const first = new Set(projection.clusters[0]!.nodeIds);
  assert.ok(projection.clusters[1]!.nodeIds.every((id) => !first.has(id)));
  const layout = layoutGraph(projection);
  const xs = projection.clusters.map((cluster) => cluster.nodeIds.map((id) => layout.positions.get(id)!.x));
  assert.ok(Math.max(...xs[0]!) < Math.min(...xs[1]!), "the two regions do not overlap");
  assertNearestPair(all);
});

test("replay positions settle deterministically, nearest their own pair, also at D3 scale", () => {
  assert.deepEqual([...layoutGraph(graph).positions], [...layoutGraph(graph).positions]);
  assert.deepEqual([...layoutGraph(graph).positions], [...layoutGraph(buildCanvasGraph([...sessions].reverse(), [], [])).positions]);
  assertNearestPair();
  assertNearestPair(canvasReplays("eighty-replays", 5, 2, 8));
  const points = [...layoutGraph(graph).positions.values()];
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) assert.ok(gap(points[left]!, points[right]!) > 40, "dots remain distinct");
  }
});

test("replay dragging keeps pins and settling respects the nearest-pair boundary", () => {
  const run = runNodeId([sessions[0]!.sessionId]);
  const point = { x: -10, y: -20 };
  assert.deepEqual(layoutGraph(graph, { pinned: new Map([[run, point]]) }).positions.get(run), point);
  const displaced = new Map(initialPositions(graph));
  displaced.set(run, { x: 2000, y: 2000 });
  const settled = settle(graph, displaced).positions;
  const own = pairNodeId(sessions[0]!.project, "sample-1", 1);
  for (const pair of graph.nodes.filter((node) => node.kind === "pair" && node.id !== own)) {
    assert.ok(gap(settled.get(run)!, settled.get(own)!) < gap(settled.get(run)!, settled.get(pair.id)!));
  }
});

test("the hub opens the metrics lens with proving ground on, and a pair opens nothing", () => {
  const route = parseCanvasRoute("#/canvas?sel=anything&cam=10,20,1");
  const hub = graph.nodes.find((node) => node.kind === "proving-ground")!;
  const pair = graph.nodes.find((node) => node.kind === "pair")!;
  for (const carried of [route, undefined]) {
    const href = openHref(hub, carried)!;
    assert.ok(href.startsWith("#/metrics"));
    assert.deepEqual(parseMetricsRoute(href).off.source, []);
    assert.equal(openHref(pair, carried), null);
  }
  assert.ok(CANVAS_KINDS.includes("proving-ground") && CANVAS_KINDS.includes("pair"));
  assert.equal(filterGraph(graph, ["run", "pair"]).nodes.length, 20);
  assert.equal(filterGraph(graph, ["run", "pair"]).edges.length, 16);
  const hubHidden = filterGraph(graph, ["run", "pair"]);
  const positions = layoutGraph(hubHidden).positions;
  for (const session of sessions) {
    const own = pairNodeId(session.project, session.replay!.itemId, session.replay!.repetition);
    const run = positions.get(runNodeId([session.sessionId]))!;
    for (const pair of hubHidden.nodes.filter((node) => node.kind === "pair" && node.id !== own)) {
      assert.ok(gap(run, positions.get(own)!) < gap(run, positions.get(pair.id)!), "hiding the hub preserves pair neighbourhoods");
    }
  }
});

test("both replay dot classes and edges use existing palette tokens", () => {
  const css = readFileSync(new URL("../../../dashboard/src/styles/dashboard.css", import.meta.url), "utf8");
  assert.match(css, /\.canvas-dot-proving-ground\s*\{ background: var\(--green\); \}/);
  assert.match(css, /\.canvas-dot-pair\s*\{ background: var\(--blue\); \}/);
  assert.match(css, /\.canvas-edge\.edge-replay\s*\{[^}]*var\(--blue\)/);
});

test("GET sessions exposes only validated replay identity, with null for absent and malformed records", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config, planSources: fixture.planSources });
  try {
    const valid = { itemId: "sample-1", itemDigest: "a".repeat(64), arm: "fixture/provider/model@high", repetition: 2, order: 3, baseSha: "b".repeat(40) };
    const payloads = [JSON.stringify(valid), JSON.stringify({ ...valid, order: 0 }), "null", JSON.stringify({ ...valid, extra: true })];
    for (let index = 0; index < payloads.length; index += 1) {
      const id = `replay-${index}`;
      createSession(fixture.writer, {
        sessionId: id, projectSlug: "test-project", taskId: `arbitrary-${index}`, attempt: 1,
        continuesTask: null, groupId: null, planRef: null, workflowId: "prove", riskTier: 2,
        isProtected: false, requestText: "Synthetic replay", callCeiling: 3,
        configSnapshotJson: "{}", journalPath: "state://synthetic.jsonl", startedAt: "2026-01-01T00:00:00.000Z",
      });
      fixture.writer.prepare(`INSERT INTO events
        (event_id, session_id, first_source_seq, last_source_seq, type, payload_json, started_at)
        VALUES (?, ?, 1, 1, 'replay', ?, '2026-01-01T00:00:00.000Z')`).run(`${id}:replay`, id, payloads[index]!);
    }
    const response = await router.dispatch({ method: "GET", url: "/api/v1/sessions", headers: { host: "127.0.0.1:4600" } });
    assert.equal(response.status, 200);
    const cards = (response.body as SessionsResponse).sessions;
    assert.equal(cards.length, 5);
    assert.deepEqual(cards.find((card) => card.sessionId === "replay-0")?.replay,
      { itemId: "sample-1", arm: valid.arm, repetition: 2, order: 3 });
    assert.ok(cards.filter((card) => card.sessionId !== "replay-0").every((card) => card.replay === null));
    const malformed = cards.find((card) => card.sessionId === "replay-1")!;
    const plain = buildCanvasGraph([malformed], [], []);
    assert.deepEqual(plain.nodes.map((node) => node.kind), ["run"]);
    assert.deepEqual(plain.edges, []);
    assert.deepEqual(plain.clusters, []);
  } finally { router.close(); fixture.close(); }
});
