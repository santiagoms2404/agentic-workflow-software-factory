import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { PlanTicketReader, type PlanTicketRecord } from "../../src/persistence/plan-tickets.ts";
import type { ResolvedPlanSource } from "../../src/registry/plan-source.ts";
import {
  selectShiftTickets,
  ShiftDependencyCycle,
  ShiftDependencyOutsideSelection,
  ShiftDuplicateTicketId,
  ShiftEmptyExpansion,
  ShiftMilestoneInProgress,
  ShiftMilestoneWithoutTickets,
  ShiftRepeatedMilestone,
  ShiftSelectionRefusal,
} from "../../src/workflow/shift/select.ts";

// Each fixture directory under shift-select/ is one plan's ticket set, and its
// directory name is the plan stem. Records come through the real frontmatter
// reader, so the expander is tested over the exact shape it will be given.
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "shift-select");

async function records(plan: string): Promise<readonly PlanTicketRecord[]> {
  const source: ResolvedPlanSource = {
    project: "fixture",
    repositoryId: "fixture",
    planPath: join(FIXTURES, `${plan}.html`),
    promptsPath: join(FIXTURES, `${plan}-build-prompts.md`),
    ticketsPath: join(FIXTURES, plan),
    format: "awsf-plan-html/v1",
  };
  const [group] = await new PlanTicketReader([source]).load();
  assert.ok(group !== undefined && group.records.length > 0, `fixture ${plan} has no readable tickets`);
  return group.records;
}

function ids(selection: { tickets: readonly PlanTicketRecord[] }): string[] {
  return selection.tickets.map((record) => record.ticket.id);
}

function refusedBy<T extends ShiftSelectionRefusal>(kind: abstract new (...args: never[]) => T, check: (error: T) => void) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof kind, `expected ${kind.name}, got ${String(error)}`);
    assert.ok(error instanceof ShiftSelectionRefusal);
    check(error);
    return true;
  };
}

test("the accepted case returns the exact topological order, todo only, with the tier derived", async () => {
  const plan = await records("accepted");
  // T02 waits on T03, so id order alone would be wrong; T01 is done and left out.
  const selection = selectShiftTickets("accepted", ["M1"], plan);
  assert.deepEqual(ids(selection), ["T03", "T02", "T04"]);
  assert.deepEqual(selection.milestones, ["M1"]);
  assert.equal(selection.plan, "accepted");
  assert.equal(selection.tier, 2);
  assert.equal(selection.tickets[0], plan.find((record) => record.ticket.id === "T03"));
  assert.ok(Object.isFrozen(selection) && Object.isFrozen(selection.tickets));

  assert.deepEqual(ids(selectShiftTickets("accepted", ["M1", "M2"], plan)), ["T03", "T02", "T04", "T05"]);
});

test("records from another plan are ignored, because dependencies are plan-scoped", async () => {
  const mixed = [...await records("three-milestones"), ...await records("accepted")];
  assert.deepEqual(ids(selectShiftTickets("accepted", ["M1"], mixed)), ["T03", "T02", "T04"]);
});

test("the same selection over the same records is the same order, whatever order the records arrive in", async () => {
  const plan = await records("three-milestones");
  const forward = ids(selectShiftTickets("three-milestones", ["M1", "M2", "M3"], plan));
  const reversed = ids(selectShiftTickets("three-milestones", ["M1", "M2", "M3"], [...plan].reverse()));
  assert.deepEqual(reversed, forward);
});

test("three milestones expand to one topological order, honouring cross-milestone edges", async () => {
  const plan = await records("three-milestones");
  const selection = selectShiftTickets("three-milestones", ["M1", "M2", "M3"], plan);
  // T03 (M2) waits on T01 (M1); T02 (M1) waits on T05 (M3); T06 (M3) waits on
  // T03 (M2). Ties break by list position, then id: T05 precedes T02 only
  // because T02 cannot start before it. T04 is done and not selected.
  assert.deepEqual(ids(selection), ["T01", "T03", "T05", "T02", "T06"]);
  assert.deepEqual(selection.milestones, ["M1", "M2", "M3"]);
  // T06 in M3 declares the highest tier; the maximum spans every milestone.
  assert.equal(selection.tier, 2);
});

test("list position is a tie-break, never an override of depends_on", async () => {
  const plan = await records("three-milestones");
  assert.deepEqual(ids(selectShiftTickets("three-milestones", ["M3", "M2", "M1"], plan)), ["T05", "T01", "T03", "T06", "T02"]);
});

test("a non-contiguous selection is accepted when the skipped milestone is not depended on", async () => {
  const plan = await records("non-contiguous");
  const selection = selectShiftTickets("non-contiguous", ["M1", "M3"], plan);
  assert.deepEqual(ids(selection), ["T01", "T03"]);
  assert.deepEqual(selection.milestones, ["M1", "M3"]);
  assert.equal(selection.tier, null);
  assert.deepEqual(ids(selectShiftTickets("non-contiguous", ["M3", "M1"], plan)), ["T01", "T03"]);
});

test("a non-contiguous selection that skips a depended-on milestone is refused by the leaving-the-selection check", async () => {
  const plan = await records("three-milestones");
  assert.throws(
    () => selectShiftTickets("three-milestones", ["M1", "M3"], plan),
    refusedBy(ShiftDependencyOutsideSelection, (error) => {
      assert.equal(error.ticket, "T06");
      assert.equal(error.dependency, "T03");
      assert.equal(error.dependencyState, "todo");
    }),
  );
});

test("a repeated milestone id is refused", async () => {
  const plan = await records("repeated-milestone");
  assert.throws(
    () => selectShiftTickets("repeated-milestone", ["M1", "M1"], plan),
    refusedBy(ShiftRepeatedMilestone, (error) => assert.equal(error.milestone, "M1")),
  );
});

test("a named milestone holding no tickets is refused by name", async () => {
  const plan = await records("milestone-without-tickets");
  assert.throws(
    () => selectShiftTickets("milestone-without-tickets", ["M1", "M2"], plan),
    refusedBy(ShiftMilestoneWithoutTickets, (error) => {
      assert.equal(error.milestone, "M2");
      assert.equal(error.plan, "milestone-without-tickets");
    }),
  );
});

test("a selected milestone holding a wip or failed ticket is refused, not skipped", async () => {
  const plan = await records("milestone-in-progress");
  assert.throws(
    () => selectShiftTickets("milestone-in-progress", ["M2", "M1"], plan),
    refusedBy(ShiftMilestoneInProgress, (error) => {
      assert.equal(error.milestone, "M1");
      assert.deepEqual(error.tickets, [{ id: "T02", state: "wip" }, { id: "T04", state: "failed" }]);
    }),
  );
  // An unselected half-done milestone is not the selection's concern.
  assert.deepEqual(ids(selectShiftTickets("milestone-in-progress", ["M2"], plan)), ["T05"]);
});

test("a depends_on edge leaving the selection is refused unless its target is done", async () => {
  const plan = await records("dependency-outside-selection");
  assert.throws(
    () => selectShiftTickets("dependency-outside-selection", ["M2"], plan),
    refusedBy(ShiftDependencyOutsideSelection, (error) => {
      assert.equal(error.ticket, "T02");
      assert.equal(error.dependency, "T01");
      assert.equal(error.dependencyState, "todo");
    }),
  );
  assert.throws(
    () => selectShiftTickets("dependency-outside-selection", ["M3"], plan),
    refusedBy(ShiftDependencyOutsideSelection, (error) => {
      assert.equal(error.dependency, "T09");
      assert.equal(error.dependencyState, "missing");
    }),
  );
  // Selecting the target's milestone too brings the edge inside the selection.
  assert.deepEqual(ids(selectShiftTickets("dependency-outside-selection", ["M2", "M1"], plan)), ["T01", "T02"]);
});

test("a depends_on cycle is refused and named", async () => {
  const plan = await records("dependency-cycle");
  assert.throws(
    () => selectShiftTickets("dependency-cycle", ["M1"], plan),
    refusedBy(ShiftDependencyCycle, (error) => assert.deepEqual(error.cycle, ["T01", "T03", "T02", "T01"])),
  );
});

test("an empty expansion is refused, whether every ticket is done or no milestone is named", async () => {
  const plan = await records("empty-expansion");
  assert.throws(
    () => selectShiftTickets("empty-expansion", ["M1"], plan),
    refusedBy(ShiftEmptyExpansion, (error) => assert.deepEqual(error.milestones, ["M1"])),
  );
  assert.throws(
    () => selectShiftTickets("empty-expansion", [], plan),
    refusedBy(ShiftEmptyExpansion, (error) => assert.deepEqual(error.milestones, [])),
  );
});

test("two ticket files declaring one id are refused, because depends_on cannot tell them apart", async () => {
  const plan = await records("duplicate-ticket-id");
  assert.throws(
    () => selectShiftTickets("duplicate-ticket-id", ["M1"], plan),
    refusedBy(ShiftDuplicateTicketId, (error) => assert.equal(error.ticket, "T01")),
  );
});
