import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCanvasGraph, type CanvasGraph, type CanvasSession } from "../../../dashboard/src/canvas-graph.ts";
import { filterGraph } from "../../../dashboard/src/canvas-view.ts";
import { retainedPins } from "../../../dashboard/src/canvas-layout.ts";

describe("B13-11: retainedPins across kind-filtered graph", () => {
  const graph: CanvasGraph = {
    nodes: [
      { id: "run:a", kind: "run", label: "a", weight: 1, sessionIds: ["a"], ref: null },
      { id: "session:g1", kind: "session", label: "g1", weight: 1, sessionIds: [], ref: "g1" },
      { id: "plan:p1", kind: "plan", label: "p1", weight: 1, sessionIds: [], ref: "p1" },
    ],
    edges: [
      { from: "run:a", to: "session:g1", kind: "membership" },
      { from: "run:a", to: "plan:p1", kind: "plan" },
    ],
    clusters: [],
    unplaced: [],
  };

  it("retains pins for hidden kinds when layout is updated on filtered graph", () => {
    // Stored pins for run and plan
    const stored = new Map([
      ["run:a", { x: 310, y: -42 }],
      ["plan:p1", { x: 5, y: 5 }],
      ["archived:old", { x: 99, y: 99 }],
    ]);

    // Filter out "run" kind
    const filtered = filterGraph(graph, ["session", "plan"]);
    assert.deepEqual(filtered.nodes.map((n) => n.id), ["session:g1", "plan:p1"]);

    // CanvasMap retains pins against the filtered graph
    const pins = retainedPins(filtered, stored);

    // Assert: run:a pin should be retained (not dropped due to kind filtering)
    assert.equal(pins.has("run:a"), true, "hidden kind pin 'run:a' must be retained");
    assert.deepEqual(pins.get("run:a"), { x: 310, y: -42 });

    // Assert: plan:p1 pin is retained
    assert.equal(pins.has("plan:p1"), true);
    assert.deepEqual(pins.get("plan:p1"), { x: 5, y: 5 });

    // Assert: archived/deleted node pin is dropped
    assert.equal(pins.has("archived:old"), false, "node missing from projection must be dropped");

    // Simulating CanvasMap emitting updated pins after dropping plan:p1
    const emitted = new Map([...pins, ["plan:p1", { x: 77, y: 9 }]]);
    assert.equal(emitted.has("run:a"), true, "run pin survives in emitted update");

    // Restoring all kinds preserves run:a pin
    const restored = filterGraph(graph, ["run", "session", "plan"]);
    const restoredPins = retainedPins(restored, emitted);
    assert.deepEqual(restoredPins.get("run:a"), { x: 310, y: -42 });
    assert.deepEqual(restoredPins.get("plan:p1"), { x: 77, y: 9 });
  });

  it("drops stored pins only for nodes absent from entire projection", () => {
    const unplacedNode = { id: "plan:parked", kind: "plan" as const, label: "parked", weight: 0, sessionIds: [], ref: "parked" };
    const graphWithUnplaced: CanvasGraph = {
      ...graph,
      unplaced: [unplacedNode],
    };

    const stored = new Map([
      ["run:a", { x: 10, y: 10 }],
      ["plan:parked", { x: 20, y: 20 }],
      ["gone:forever", { x: 30, y: 30 }],
    ]);

    // Retaining pins keeps placed and unplaced projection nodes, drops gone
    const pins = retainedPins(graphWithUnplaced, stored);
    assert.equal(pins.has("run:a"), true);
    assert.equal(pins.has("plan:parked"), true);
    assert.equal(pins.has("gone:forever"), false);
  });

  it("preserves positions across graph built with buildCanvasGraph and filtered twice", () => {
    const sessions: readonly CanvasSession[] = [
      {
        sessionId: "sess-1",
        taskId: "task-1",
        groupId: "grp-1",
        planRef: "plan-1",
        startedAt: "2026-10-01T00:00:00Z",
        attempt: 1,
        replay: null,
        project: "test",
      } as unknown as CanvasSession,
    ];
    const summaries = [{ group: "grp-1", title: "Group 1" } as any];
    const plans = [{ id: "plan-1", name: "Plan 1" } as any];

    const built = buildCanvasGraph(sessions, summaries, plans);
    const runId = "run:sess-1";
    const planId = "plan:plan-1";
    const sessionId = "session:grp-1";

    const initialPins = new Map([
      [runId, { x: 100, y: 100 }],
      [planId, { x: 200, y: 200 }],
      [sessionId, { x: 300, y: 300 }],
      ["run:vanished", { x: 400, y: 400 }],
    ]);

    // Filter to only plan
    const onlyPlan = filterGraph(built, ["plan"]);
    const retained1 = retainedPins(onlyPlan, initialPins);
    assert.equal(retained1.has(runId), true);
    assert.equal(retained1.has(planId), true);
    assert.equal(retained1.has(sessionId), true);
    assert.equal(retained1.has("run:vanished"), false);

    // Drop planId at new position
    const updated = new Map([...retained1, [planId, { x: 250, y: 250 }]]);

    // Filter to only session
    const onlySession = filterGraph(onlyPlan, ["session"]);
    const retained2 = retainedPins(onlySession, updated);
    assert.equal(retained2.has(runId), true);
    assert.deepEqual(retained2.get(planId), { x: 250, y: 250 });
    assert.equal(retained2.has(sessionId), true);
  });
});
