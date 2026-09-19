import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GroupSummary, SessionPlan } from "../../../dashboard/shared/types.ts";
import {
  buildCanvasGraph,
  planNodeId,
  runNodeId,
  sessionNodeId,
  type CanvasSession,
} from "../../../dashboard/src/canvas-graph.ts";
import {
  initialPositions,
  layoutGraph,
  retainedPins,
  settle,
} from "../../../dashboard/src/canvas-layout.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

/**
 * The source with its comments removed.
 *
 * These modules explain in prose exactly what they refuse to do — "no ticket is
 * inferred", "nothing calls Math.random" — so a scan that reads the comments
 * finds the very words it is checking are absent and fails on the explanation
 * rather than on the code.
 */
function code(path: string): string {
  return source(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

const counts = { stages: 4, inputs: 2, proposals: 2, applied: 1, notTaken: 1, alternatives: 3, unitRecords: 1, units: 1 };
const summaries: readonly GroupSummary[] = [
  { group: "drive-a", project: "p", revision: 4, closed: false, title: "The first ask.", at: "2026-09-08T00:00:00.000Z", counts },
  { group: "drive-b", project: "p", revision: 2, closed: true, title: null, at: "2026-09-07T00:00:00.000Z", counts },
];
const plans: readonly SessionPlan[] = [
  { id: "awsf-v2-plan", name: "AWSF v2", kind: "spine", parentSpine: null, parentSpineName: null },
];

function run(
  sessionId: string,
  taskId: string,
  attempt: number,
  groupId: string | null,
  startedAt: string,
  patch: Partial<CanvasSession> = {},
): CanvasSession {
  return {
    sessionId, project: "p", taskId, continuesTask: null, attempt, groupId, startedAt,
    state: "LANDED", planRef: null, ...patch,
  };
}

/** Task X attempt 1 in one session, attempt 2 in another: the cross-group edge. */
const spanning = [
  run("s2", "task-x", 2, "drive-b", "2026-09-09T10:00:00.000Z"),
  run("s1", "task-x", 1, "drive-a", "2026-09-08T10:00:00.000Z"),
];

test("a deck is one node, and its runs are ordered the way they ran", () => {
  const graph = buildCanvasGraph(spanning, [], []);
  const node = graph.nodes.find((candidate) => candidate.kind === "run");
  assert.equal(graph.nodes.filter((candidate) => candidate.kind === "run").length, 1);
  assert.deepEqual(node?.sessionIds, ["s1", "s2"], "oldest first: a deck opens as a pipeline");
  assert.equal(node?.weight, 2);
  // No run-to-run edge exists anywhere on this canvas: every recorded
  // relationship between two runs is inside a deck, and the wheel reads it.
  assert.equal(graph.edges.filter((edge) => edge.from.startsWith("run:") && edge.to.startsWith("run:")).length, 0);
});

test("a continuation never sorts ahead of the run it continues", () => {
  // Two runs seeded in the same second: the clock decides nothing and the
  // record decides everything. Sorting on time alone put the continuation
  // first, which made the wheel report the pair as unrelated, because the
  // relation only reads forwards.
  const instant = "2026-09-13T20:23:13.000Z";
  const graph = buildCanvasGraph(
    [
      run("g5", "untitled-drive-task", 1, null, instant, { continuesTask: "legacy-stack-tones" }),
      run("g8", "legacy-stack-tones", 1, null, instant),
    ],
    [],
    [],
  );
  const deck = graph.nodes.find((node) => node.kind === "run");
  assert.deepEqual(deck?.sessionIds, ["g8", "g5"], "what was continued comes first");
  assert.equal(deck?.label, "legacy-stack-tones → untitled-drive-task");
});

test("the node id does not move when the rows arrive in a different order", () => {
  // A node id that followed arrival order would break every stored position and
  // every URL naming a selection, on a page that polls.
  assert.equal(runNodeId(["s2", "s1"]), runNodeId(["s1", "s2"]));
  const forward = buildCanvasGraph(spanning, summaries, plans);
  const reversed = buildCanvasGraph([...spanning].reverse(), summaries, plans);
  assert.deepEqual(forward.nodes.map((node) => node.id), reversed.nodes.map((node) => node.id));
  assert.deepEqual(forward.edges, reversed.edges);
});

test("a deck naming two sessions is the connection string, drawn through the deck", () => {
  const graph = buildCanvasGraph(spanning, summaries, []);
  const id = runNodeId(["s1", "s2"]);
  assert.deepEqual(graph.edges, [
    { from: id, to: sessionNodeId("drive-a"), kind: "continuation" },
    { from: id, to: sessionNodeId("drive-b"), kind: "continuation" },
  ]);
  // And a deck inside one session takes the faint membership treatment instead.
  const single = buildCanvasGraph([run("s9", "task-y", 1, "drive-a", "2026-09-08T09:00:00.000Z")], summaries, []);
  assert.deepEqual(single.edges.map((edge) => edge.kind), ["membership"]);
});

test("a plan edge is recorded, and a ticket edge is never guessed", () => {
  const graph = buildCanvasGraph(
    [run("s1", "w01-marimba-contract-T04", 1, null, "2026-09-08T10:00:00.000Z", { planRef: "awsf-v2-plan" })],
    [],
    plans,
  );
  assert.deepEqual(
    graph.edges,
    [{ from: runNodeId(["s1"]), to: planNodeId("awsf-v2-plan"), kind: "plan" }],
  );
  // The task id names a ticket of that plan, and nothing joins them: a run
  // records `plan_ref` and no ticket, so a ticket edge could only come from
  // matching names — the guessing Task 5 was instructed to refuse.
  assert.doesNotMatch(code("dashboard/src/canvas-graph.ts"), /ticket/iu, "no ticket is read anywhere in the graph");
  // A plan the catalog does not register gets no node, so it gets no edge.
  const unregistered = buildCanvasGraph(
    [run("s1", "task-y", 1, null, "2026-09-08T10:00:00.000Z", { planRef: "retired-plan" })],
    [],
    plans,
  );
  assert.deepEqual(unregistered.edges, []);
});

test("a session or plan with no runs is kept, but off the map rather than adrift on it", () => {
  // Measured on the real projection: twelve registered plans and two recorded
  // sessions that no run names — fourteen of forty-seven dots, every one of
  // them connected to nothing. Dropping them would make a recorded session
  // unreachable, which is the failure 72e967f already fixed once; leaving them
  // in the drawing makes a third of the canvas look like a broken graph.
  const graph = buildCanvasGraph([], summaries, plans);
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.unplaced.map((node) => node.id), [
    planNodeId("awsf-v2-plan"), sessionNodeId("drive-a"), sessionNodeId("drive-b"),
  ]);
  assert.equal(graph.unplaced[1]?.label, "The first ask.");
  assert.equal(graph.unplaced[2]?.label, "no ask recorded in this group");
  // A run is never parked: it always has itself behind it.
  const withRuns = buildCanvasGraph(spanning, summaries, plans);
  assert.deepEqual(withRuns.unplaced.map((node) => node.id), [planNodeId("awsf-v2-plan")]);
  assert.equal(withRuns.nodes.filter((node) => node.kind === "run").length, 1);
  // Unconnected sessions are two dots, not two dots in a box.
  assert.deepEqual(buildCanvasGraph([], summaries, []).clusters, []);
  assert.deepEqual(withRuns.clusters, [{
    key: "drive-a",
    nodeIds: [sessionNodeId("drive-a"), sessionNodeId("drive-b")],
  }]);
});

test("the owner's real projection draws runs and nothing else", () => {
  // Forty-four runs, no group, no plan. The map is decks and no session or plan
  // dot at all — and the header's counts say so rather than looking broken.
  const runs = [
    run("s3", "task-c", 1, null, "2026-09-09T12:00:00.000Z"),
    run("s2", "task-b", 2, null, "2026-09-09T11:00:00.000Z"),
    run("s1", "task-b", 1, null, "2026-09-08T11:00:00.000Z"),
  ];
  const graph = buildCanvasGraph(runs, [], []);
  assert.deepEqual(graph.nodes.map((node) => node.kind), ["run", "run"]);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.clusters, []);
  assert.deepEqual(graph.unplaced, [], "nothing is parked when nothing was recorded");
});

test("the same graph settles into the same picture every time", () => {
  // The cost of a physics layout is usually that it can never be tested or
  // screenshotted. That cost is only paid by a simulation seeded with
  // randomness, and it is not paid here.
  const graph = buildCanvasGraph(spanning, summaries, plans);
  const once = layoutGraph(graph);
  const twice = layoutGraph(graph);
  assert.deepEqual([...once.positions.entries()], [...twice.positions.entries()]);
  assert.equal(code("dashboard/src/canvas-layout.ts").includes("Math.random"), false);
  // Every node lands somewhere real, and the bounds enclose all of them.
  for (const [, point] of once.positions) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.ok(point.x >= once.bounds.minX && point.x <= once.bounds.maxX);
    assert.ok(point.y >= once.bounds.minY && point.y <= once.bounds.maxY);
  }
});

test("a node keeps its own starting place when the graph grows around it", () => {
  // Adding one run should not re-seat every other dot and redraw a map the
  // reader had learned, so a start is derived from the node's own id.
  const small = buildCanvasGraph(spanning, summaries, []);
  const larger = buildCanvasGraph([...spanning, run("s9", "task-y", 1, null, "2026-09-01T10:00:00.000Z")], summaries, []);
  const shared = sessionNodeId("drive-a");
  const before = initialPositions(small).get(shared);
  const after = initialPositions(larger).get(shared);
  assert.ok(before && after);
  // Its index shifts by one, so it moves along the spiral rather than to an
  // unrelated place: the angle its own hash contributes is unchanged.
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 140);
});

test("a dragged node stays where it was dropped and the rest arrange around it", () => {
  const graph = buildCanvasGraph(spanning, summaries, plans);
  const dropped = { x: 640, y: -420 };
  const pinned = new Map([[sessionNodeId("drive-a"), dropped]]);
  const settled = layoutGraph(graph, { pinned });
  assert.deepEqual(settled.positions.get(sessionNodeId("drive-a")), dropped);
  // Everything else moved: a pin that froze the whole graph would be a bug.
  const free = layoutGraph(graph);
  const moved = [...settled.positions].filter(([id, point]) => {
    const loose = free.positions.get(id)!;
    return Math.hypot(point.x - loose.x, point.y - loose.y) > 1;
  });
  assert.ok(moved.length >= graph.nodes.length - 1);
  // And settling again from where it already is leaves the pin untouched.
  const again = settle(graph, settled.positions, { pinned, steps: 40 });
  assert.deepEqual(again.positions.get(sessionNodeId("drive-a")), dropped);
});

test("a stored position for a node the graph no longer has is dropped on read", () => {
  // A layout outlives the runs it was drawn around; a pin on a node nobody can
  // see would otherwise hold empty space open forever.
  const graph = buildCanvasGraph(spanning, summaries, []);
  const stored = new Map([
    [sessionNodeId("drive-a"), { x: 10, y: 10 }],
    [sessionNodeId("drive-gone"), { x: 99, y: 99 }],
  ]);
  assert.deepEqual([...retainedPins(graph, stored).keys()], [sessionNodeId("drive-a")]);
});

test("an empty graph lays out to nothing rather than to a phantom dot", () => {
  const graph = buildCanvasGraph([], [], []);
  const layout = layoutGraph(graph);
  assert.equal(layout.positions.size, 0);
  assert.deepEqual(layout.bounds, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
});

test("two nodes never settle on top of each other", () => {
  const runs = Array.from({ length: 12 }, (_unused, index) =>
    run(`s${index}`, `task-${index}`, 1, null, `2026-09-0${(index % 9) + 1}T10:00:00.000Z`));
  const layout = layoutGraph(buildCanvasGraph(runs, summaries, plans));
  const points = [...layout.positions.values()];
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const gap = Math.hypot(points[left]!.x - points[right]!.x, points[left]!.y - points[right]!.y);
      assert.ok(gap > 40, `two dots settled ${gap.toFixed(1)}px apart`);
    }
  }
});
