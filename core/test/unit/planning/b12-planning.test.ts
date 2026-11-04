import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checklist } from "../../../src/planning/evidence.ts";
import { emptyGroup, applyChanges, validateGraph, type Proposal, type Unit } from "../../../src/planning/model.ts";
import { decisionTree } from "../../../src/planning/views.ts";
import { reference } from "../../../src/planning/store.ts";

function makeUnit(id: string, taskId: string, revision = 1): Unit {
  return {
    id,
    revision,
    title: `Unit ${id}`,
    purpose: "Testing purpose",
    taskId,
    scope: ["scope"],
    nonGoals: ["nonGoals"],
    serves: ["R1"],
    acceptance: ["acceptance"],
    prerequisites: [],
    decisions: [],
    references: [],
    completion: "landed",
    disposition: "active",
    reason: "",
    revisit: "",
    parents: [],
  };
}

async function makeFixture(t: TestContext): Promise<{ stateRoot: string; project: string }> {
  const stateRoot = await mkdtemp(join(tmpdir(), "awsf-b12-planning-"));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  return { stateRoot, project: "sample" };
}

test("B12-09: missing tasks directory (ENOENT) does not pre-empt owner-accepted unit delivery", async (t) => {
  const { stateRoot, project } = await makeFixture(t);
  // Do NOT create projects/sample/tasks directory.
  // When checklist() runs on a group whose tasks root is missing, an owner-accepted unit
  // is evaluated without throwing ENOENT or marking delivery unknown.
  const file = join(stateRoot, "evidence.txt");
  await writeFile(file, "verified content");
  const ref = await reference(file, project, "ev-1", "all", "text");

  let group = emptyGroup(project, "g1");
  const proposal: Proposal = {
    id: "p1",
    base: 0,
    narrative: { title: "N", explanation: "E", changes: "C", reason: "R", friction: "", tasks: [], references: [] },
    changes: [
      { kind: "requirements", values: [{ id: "R1", text: "Req 1" }] },
      { kind: "define", unit: { ...makeUnit("u1", "T01"), completion: "owner-accepted" } },
      { kind: "accept-delivery", unit: "u1", revision: 1, evidence: [ref] },
    ],
    alternatives: [],
  };
  group = applyChanges(group, proposal);

  const result = await checklist(group, stateRoot, "2026-01-01T00:00:00.000Z");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.delivery, "done");
  assert.equal(result.rows[0]?.conditions.length, 0);
});

test("B12-10: interface-prerequisite check uses latest matching acceptance (.at(-1))", async (t) => {
  const { stateRoot, project } = await makeFixture(t);
  await mkdir(join(stateRoot, "projects", project, "tasks"), { recursive: true });

  const file1 = join(stateRoot, "old-evidence.txt");
  await writeFile(file1, "stale content");
  const ref1 = await reference(file1, project, "ev-1", "all", "text");

  const file2 = join(stateRoot, "new-evidence.txt");
  await writeFile(file2, "fresh content");
  const ref2 = await reference(file2, project, "ev-2", "all", "text");

  // Create group with:
  // u1: interface target
  // u2: depends on u1@1 interface "contract-A"
  let group = emptyGroup(project, "g1");
  const u1 = makeUnit("u1", "T01");
  const u2: Unit = {
    ...makeUnit("u2", "T02"),
    prerequisites: [{ unit: "u1", revision: 1, kind: "interface", contract: "contract-A" }],
  };

  const p1: Proposal = {
    id: "p1",
    base: 0,
    narrative: { title: "N1", explanation: "E1", changes: "C1", reason: "R1", friction: "", tasks: [], references: [] },
    changes: [
      { kind: "requirements", values: [{ id: "R1", text: "Req 1" }] },
      { kind: "define", unit: u1 },
      { kind: "define", unit: u2 },
      // First acceptance with ref1
      { kind: "accept-interface", unit: "u1", revision: 1, contract: "contract-A", evidence: [ref1] },
      // Second acceptance (superseding) with ref2
      { kind: "accept-interface", unit: "u1", revision: 1, contract: "contract-A", evidence: [ref2] },
    ],
    alternatives: [],
  };
  group = applyChanges(group, p1);

  // Now invalidate ref1 by changing file1, but keep file2 valid
  await writeFile(file1, "mutated content");

  // Since ref2 is the latest matching acceptance, checklist should verify ref2 (which succeeds)
  // rather than the first acceptance (ref1) which now fails verification.
  const result = await checklist(group, stateRoot, "2026-01-01T00:00:00.000Z");
  const u2Row = result.rows.find((r) => r.id === "u2");
  assert.ok(u2Row);
  assert.equal(u2Row.delivery, "todo");
  assert.ok(!u2Row.conditions.some((c) => c.includes("blocked prerequisite: interface u1@1: contract-A")));
});

test("B12-11: validateGraph verifies distinct taskId across units", () => {
  const group = emptyGroup("sample", "g1");
  group.requirements = [{ id: "R1", text: "Req 1" }];
  group.order = ["u1", "u2"];
  // Two distinct unit ids sharing the same taskId
  group.units = [
    makeUnit("u1", "T01"),
    makeUnit("u2", "T01"),
  ];

  assert.throws(
    () => validateGraph(group),
    /duplicate taskId across units/u,
  );

  // Changing u2's taskId to T02 makes validateGraph pass
  group.units[1] = makeUnit("u2", "T02");
  assert.doesNotThrow(() => validateGraph(group));
});

test("B12-12: decisionTree handles prototype property names in tasks without TypeError", () => {
  const group = emptyGroup("sample", "g1");
  group.requirements = [{ id: "R1", text: "Req 1" }];
  group.order = ["u1"];
  group.units = [makeUnit("u1", "constructor")];

  const proposal: Proposal = {
    id: "p1",
    base: 0,
    narrative: {
      title: "Title",
      explanation: "Expl",
      changes: "Changes",
      reason: "Reason",
      friction: "",
      tasks: ["constructor", "toString", "valueOf"],
      references: [],
    },
    changes: [],
    alternatives: [],
  };
  group.proposals.push(proposal);

  // Group has an ask naming prototype properties
  group.inputs.push({
    id: "inp1",
    text: "Owner message",
    sha256: "abc",
    provenance: "test",
    attachments: [],
  });
  group.stages.push({
    id: "s1",
    at: "2026-01-01T00:00:00.000Z",
    authority: "owner-input",
    narrativeAuthority: "assistant-explanation",
    narrative: {
      title: "Ask Title",
      explanation: "",
      changes: "",
      reason: "",
      friction: "",
      tasks: ["hasOwnProperty", "isPrototypeOf"],
      references: [],
    },
    input: "inp1",
    proposal: null,
  });

  // Calling decisionTree must not throw TypeError: Cannot read properties of undefined (reading 'push')
  let tree: ReturnType<typeof decisionTree>;
  assert.doesNotThrow(() => {
    tree = decisionTree(group);
  });

  assert.ok(tree!.byTask["constructor"]);
  assert.deepEqual(tree!.byTask["constructor"]?.proposals, ["p1"]);
  assert.ok(tree!.byTask["hasOwnProperty"]);
  assert.deepEqual(tree!.byTask["hasOwnProperty"]?.asks, ["inp1"]);
});
