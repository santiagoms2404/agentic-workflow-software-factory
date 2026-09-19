// The decision tree: a read-only projection of one group's journal.
//
// The shape under test is the one the handoff measured on the live group: a
// spine of applied decisions, with proposals that were never applied, options
// written down and dropped, and superseded unit revisions hanging off it. A
// flat timeline of stages would hide most of that, so the assertions here are
// mostly about what must NOT be omitted.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decisionTree, listGroupIds, readGroupTree } from "../../src/planning/views.ts";
import { capture, hash, propose } from "../../src/planning/store.ts";
import { emptyGroup, reduceEvent, type Event, type Group, type Narrative, type Proposal, type Unit } from "../../src/planning/model.ts";

const PROJECT = "agentic-workflow-software-factory";

function narrative(patch: Partial<Narrative> = {}): Narrative {
  return {
    title: "a title", explanation: "an explanation", changes: "what changed",
    reason: "a reason", friction: "what hurt", tasks: [], references: [], ...patch,
  };
}

function unit(id: string, revision: number, patch: Partial<Unit> = {}): Unit {
  return {
    id, revision, title: `${id} title`, purpose: "a purpose", taskId: id,
    scope: ["the scope"], nonGoals: [], serves: [], acceptance: ["accepted when it lands"],
    prerequisites: [], decisions: [], references: [], completion: "landed",
    disposition: "active", reason: "", revisit: "", parents: [], ...patch,
  };
}

/**
 * A group built by reducing events directly. `store.ts` is the durable writer
 * and this is the reducer it uses, so the fixture exercises the same shape a
 * replayed journal produces without needing a state root on disk.
 */
function build(): Group {
  let group = emptyGroup(PROJECT, "fixture-group");
  let sequence = 0;
  const step = (operation: Event["operation"]): void => {
    sequence += 1;
    group = reduceEvent(group, {
      schema: "awsf/group-event/v1", group: group.id, project: group.project,
      id: `e${sequence}`, base: group.revision, at: `2026-09-0${sequence}T00:00:00.000Z`,
      previous: group.head, operation, digest: `d${sequence}`,
    });
  };
  const input = (id: string, text: string): void => {
    step({ kind: "capture", input: { id, text, sha256: hash(text), provenance: "owner terminal", attachments: [] }, narrative: narrative({ title: `capture ${id}` }) });
  };
  const proposal = (value: Proposal): void => { step({ kind: "propose", proposal: value }); };
  const apply = (id: string, ownerReason: string): void => {
    step({ kind: "apply", proposal: id, proposalHash: "unchecked-by-the-reducer", ownerReason });
  };

  input("ask-1", "Build the thing.\nAnd keep the old one working.");
  proposal({
    id: "p1", base: group.revision,
    narrative: narrative({ title: "Define the thing", tasks: ["task-one"] }),
    changes: [{ kind: "define", unit: unit("task-one", 1) }],
    alternatives: ["Do nothing; rejected because the old one is failing.", "Buy it; rejected on cost."],
  });
  apply("p1", "Accept the scope; no lifecycle authorization.");

  input("ask-2", "Actually, defer it.");
  proposal({
    id: "p2", base: group.revision,
    narrative: narrative({ title: "Defer the thing", tasks: ["task-one"] }),
    changes: [{ kind: "defer", unit: "task-one", reason: "the seam moved", revisit: "when the seam settles" }],
    alternatives: ["Split it instead; rejected because neither half stands alone."],
  });
  apply("p2", "Accept the deferral.");

  // Proposed, never applied, and still appliable: nobody has decided yet.
  proposal({
    id: "p3", base: group.revision,
    // `friction` is the one narrative field the schema admits empty, so it is
    // the realistic missing case and the one the renderer has to handle.
    narrative: narrative({ title: "Close the group", friction: "", tasks: [] }),
    changes: [{ kind: "close", reason: "the session is over" }],
    alternatives: ["Leave it open; rejected because a stale group invites a second capture."],
  });
  return group;
}

test("the tree is a spine of applied decisions, not a list of stages", () => {
  const tree = decisionTree(build());
  assert.deepEqual(tree.spine.map((decision) => decision.id), ["p1", "p2"]);
  assert.deepEqual(tree.spine.map((decision) => decision.ownerReason), [
    "Accept the scope; no lifecycle authorization.",
    "Accept the deferral.",
  ]);
  // Every applied decision traces back to the owner input in force when it was
  // proposed, which is how a displayed task reaches the original ask.
  assert.deepEqual(tree.spine.map((decision) => decision.ask), ["ask-1", "ask-2"]);
  assert.equal(tree.title?.text, "Build the thing.");
  assert.equal(tree.title?.full, "Build the thing.\nAnd keep the old one working.");
  assert.equal(tree.title?.inputId, "ask-1");
});

test("a never-applied proposal is visible as not taken, and is not silently omitted", () => {
  const tree = decisionTree(build());
  assert.deepEqual(tree.notTaken.map((proposal) => proposal.id), ["p3"]);
  assert.equal(tree.notTaken[0]?.status, "not-taken");
  assert.equal(tree.notTaken[0]?.ownerReason, null);
  // Still appliable: no stage has overtaken it. The distinction matters because
  // "nobody has decided" and "this can no longer be taken" are different states.
  assert.equal(tree.notTaken[0]?.appliable, true);
  assert.equal(tree.counts.proposals, tree.counts.applied + tree.counts.notTaken);
  assert.equal(tree.counts.applied, 2);
  assert.equal(tree.counts.notTaken, 1);
});

test("recorded alternatives are readable and attributed to the proposal that weighed them", () => {
  const tree = decisionTree(build());
  assert.deepEqual(tree.spine[0]?.alternatives, [
    "Do nothing; rejected because the old one is failing.",
    "Buy it; rejected on cost.",
  ]);
  assert.deepEqual(tree.spine[1]?.alternatives, ["Split it instead; rejected because neither half stands alone."]);
  assert.deepEqual(tree.notTaken[0]?.alternatives, ["Leave it open; rejected because a stale group invites a second capture."]);
  assert.equal(tree.counts.alternatives, 4);
});

test("a superseded unit revision is retained beside the current one", () => {
  const tree = decisionTree(build());
  const task = tree.units.find((value) => value.id === "task-one");
  assert.equal(task?.current.revision, 2);
  assert.equal(task?.current.disposition, "deferred");
  assert.equal(task?.current.revisit, "when the seam settles");
  assert.deepEqual(task?.superseded.map((revision) => revision.revision), [1]);
  assert.equal(task?.superseded[0]?.disposition, "active");
  assert.equal(tree.counts.unitRecords, 2);
  assert.equal(tree.counts.units, 1);
});

test("missing narrative stays missing: an unwritten field is empty, never reconstructed", () => {
  const tree = decisionTree(build());
  const open = tree.notTaken[0]!;
  // `friction` is the only narrative field `schema.ts` admits empty, so it is
  // the one that can actually arrive unwritten. It arrives as "" and the
  // renderer turns that into an explicit absence rather than blank space.
  assert.equal(open.narrative.friction, "");
  // An undecided proposal has no owner reason, which is the other real absence:
  // null, never an invented sentence about why nobody decided.
  assert.equal(open.ownerReason, null);
  assert.equal(open.decidedAt, null);
  assert.equal(open.decisionStageId, null);
  // And a recorded field is passed through byte for byte.
  assert.equal(tree.spine[0]?.narrative.friction, "what hurt");
});

test("a displayed task traces back to the decisions and asks that name it", () => {
  const tree = decisionTree(build());
  assert.deepEqual(tree.byTask["task-one"], { proposals: ["p1", "p2"], asks: [] });
  assert.ok("task-one" in tree.byTask, "a unit's own task id is present even when no narrative named it");
});

test("the asks are the owner's exact bytes, kept apart from the assistant's reading of them", () => {
  const tree = decisionTree(build());
  assert.deepEqual(tree.asks.map((ask) => ask.inputId), ["ask-1", "ask-2"]);
  assert.equal(tree.asks[0]?.text, "Build the thing.\nAnd keep the old one working.");
  assert.equal(tree.asks[0]?.sha256, hash("Build the thing.\nAnd keep the old one working."));
  // The stage narrative is the assistant's explanation and is reported as a
  // separate field, so a renderer cannot show one in the other's voice.
  assert.equal(tree.asks[0]?.narrative.title, "capture ask-1");
  assert.equal(tree.counts.inputs, 2);
  // Two captures, three proposals and two decisions: seven stages, and the tree
  // shows all seven rather than the two the spine is made of.
  assert.equal(tree.counts.stages, 7);
});

test("the tree reads a real group from disk, and an absent groups directory is zero groups", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-tree-"));
  assert.deepEqual(await listGroupIds(stateRoot, PROJECT), []);

  const location = { stateRoot, project: PROJECT, group: "disk-group" };
  const text = "Ship the read surface.";
  await capture({ ...location, id: "c1", expected: 0 },
    { id: "in-1", text, sha256: hash(text), provenance: "owner terminal", attachments: [] },
    narrative({ title: "capture the ask" }));
  await propose({ ...location, id: "c2", expected: 1 }, {
    id: "only", base: 1, narrative: narrative({ title: "Define it", tasks: ["disk-task"] }),
    changes: [{ kind: "define", unit: unit("disk-task", 1) }],
    alternatives: ["Wait; rejected because the column is already dead."],
  });

  assert.deepEqual(await listGroupIds(stateRoot, PROJECT), ["disk-group"]);
  const tree = await readGroupTree(location);
  assert.equal(tree.schema, "awsf/decision-tree/v1");
  assert.equal(tree.title?.text, "Ship the read surface.");
  assert.deepEqual(tree.spine, []);
  assert.deepEqual(tree.notTaken.map((proposal) => proposal.id), ["only"]);
  assert.equal(tree.counts.stages, 2);
});
