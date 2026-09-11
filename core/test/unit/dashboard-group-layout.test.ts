import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GroupTree, TreeProposal, TreeUnit } from "../../../dashboard/shared/types.ts";
import { layoutTree } from "../../../dashboard/src/group-layout.ts";

const counts = { stages: 0, inputs: 0, proposals: 0, applied: 0, notTaken: 0, alternatives: 0, unitRecords: 0, units: 0 };

function narrative(title: string, explanation = "an explanation") {
  return { title, explanation, changes: "", reason: "", friction: "", tasks: [] as string[], references: [] };
}

function proposal(id: string, ask: string | null, patch: Partial<TreeProposal> = {}): TreeProposal {
  return {
    id, base: 1, proposedStageId: `s-${id}`, proposedAt: "2026-09-08T00:00:00.000Z",
    narrative: narrative(`title ${id}`), alternatives: [], changes: [], status: "applied",
    appliable: false, decisionStageId: `d-${id}`, decidedAt: "2026-09-08T01:00:00.000Z",
    ownerReason: `reason ${id}`, ask, tasks: [], ...patch,
  };
}

const unit: TreeUnit = {
  id: "u1", taskId: "task-one",
  current: { revision: 2, title: "u1 now", disposition: "active", reason: "", revisit: "" },
  superseded: [{ revision: 1, title: "u1 before", disposition: "active", reason: "the seam moved", revisit: "" }],
};

function tree(patch: Partial<GroupTree> = {}): GroupTree {
  return {
    schema: "awsf/decision-tree/v1", group: "g", project: "p", revision: 4, head: "", closed: false,
    title: null, asks: [], spine: [], notTaken: [], units: [], byTask: {}, counts, ...patch,
  } as GroupTree;
}

const ask = (id: string, text: string) => ({
  stageId: `st-${id}`, at: "2026-09-08T00:00:00.000Z", inputId: id, text,
  provenance: "owner terminal", sha256: "0".repeat(64), narrative: narrative(`capture ${id}`),
});

test("each ask is followed by what came out of it, not by every other ask", () => {
  // The failure this ordering replaced: laying every ask out first put 31 asks
  // above the first decision on the real group, which is the flat timeline the
  // tree exists to replace.
  const layout = layoutTree(tree({
    asks: [ask("a1", "first ask"), ask("a2", "second ask")],
    spine: [proposal("p1", "a1"), proposal("p2", "a2")],
  }));
  assert.deepEqual(layout.nodes.map((node) => node.id), [
    "ask:a1", "decision:p1", "ask:a2", "decision:p2",
  ]);
  // Rows advance monotonically, so no edge ever points back up the page.
  assert.deepEqual(layout.nodes.map((node) => node.row), [0, 1, 2, 3]);
  for (const edge of layout.edges) {
    const from = layout.nodes.find((node) => node.id === edge.from)!;
    const to = layout.nodes.find((node) => node.id === edge.to)!;
    assert.ok(from.row < to.row, `${edge.from} -> ${edge.to}`);
  }
});

test("a decision gets both edges: the trunk from the one before it and a branch to its ask", () => {
  const layout = layoutTree(tree({
    asks: [ask("a1", "first ask"), ask("a2", "second ask")],
    spine: [proposal("p1", "a1"), proposal("p2", "a2")],
  }));
  assert.deepEqual(
    layout.edges.map((edge) => `${edge.kind} ${edge.from} -> ${edge.to}`),
    [
      "branch ask:a1 -> decision:p1",
      "branch ask:a2 -> decision:p2",
      "spine decision:p1 -> decision:p2",
    ],
  );
});

test("alternatives and superseded revisions hang off the decision that weighed them", () => {
  const layout = layoutTree(tree({
    asks: [ask("a1", "the ask")],
    spine: [proposal("p1", "a1", {
      alternatives: ["Do nothing; rejected on risk.", "Buy it; rejected on cost."],
      tasks: ["task-one"],
    })],
    units: [unit],
  }));
  const branches = layout.nodes.filter((node) => node.parent === "decision:p1");
  assert.deepEqual(branches.map((node) => node.kind), ["alternative", "alternative", "superseded"]);
  assert.equal(branches[0]?.detail, "Do nothing; rejected on risk.");
  assert.match(branches[2]?.label ?? "", /u1 r1 superseded/u);
  assert.match(branches[2]?.detail ?? "", /the seam moved/u);
  // Branches sit one column out from the spine, never on it.
  assert.deepEqual([...new Set(branches.map((node) => node.column))], [2]);
});

test("a proposal nobody took is a node on the tree, never an omission", () => {
  const layout = layoutTree(tree({
    asks: [ask("a1", "the ask")],
    notTaken: [proposal("p9", "a1", {
      status: "not-taken", appliable: true, decidedAt: null, decisionStageId: null, ownerReason: null,
      alternatives: ["Leave it open; rejected because a stale group invites a second capture."],
    })],
  }));
  const node = layout.nodes.find((candidate) => candidate.id === "not-taken:p9");
  assert.equal(node?.kind, "not-taken");
  assert.equal(node?.parent, "ask:a1");
  // Its own alternatives hang off it, so a dropped option under a dropped
  // proposal is still readable rather than collapsing into the proposal.
  assert.equal(layout.nodes.filter((candidate) => candidate.parent === "not-taken:p9").length, 1);
  // And it is NOT on the spine: no trunk edge reaches it.
  assert.deepEqual(layout.edges.filter((edge) => edge.kind === "spine"), []);
});

test("a proposal with no recorded ask still appears, hanging from nothing", () => {
  const layout = layoutTree(tree({ asks: [], spine: [proposal("p1", null)] }));
  const node = layout.nodes.find((candidate) => candidate.id === "decision:p1");
  assert.equal(node?.parent, null);
  assert.deepEqual(layout.edges, [], "no parent means no edge, never an invented one");
});

test("an empty group lays out to nothing rather than to a phantom node", () => {
  const layout = layoutTree(tree());
  assert.deepEqual(layout.nodes, []);
  assert.deepEqual(layout.edges, []);
  assert.equal(layout.rows, 0);
  assert.equal(layout.columns, 1);
});

test("the drawing and the nodes read one geometry, and every node opens", () => {
  const graph = readFileSync(new URL("../../../dashboard/src/components/GroupTreeGraph.vue", import.meta.url), "utf8");
  // Columns and rows come from the layout, not from two independent guesses in
  // the SVG and the HTML — that is what keeps an edge pointing at its node.
  assert.match(graph, /left: `\$\{x\(node\)\}px`, top: `\$\{y\(node\)\}px`/u);
  assert.match(graph, /:d="path\(edge\.from, edge\.to\)"/u);
  // A node whose field was never written still opens, and says so.
  assert.match(graph, /:aria-expanded="opened === node\.id"/u);
  assert.match(graph, /<p v-else class="absent">not recorded<\/p>/u);
});
