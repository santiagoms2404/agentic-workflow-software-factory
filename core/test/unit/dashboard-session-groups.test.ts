import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GroupSummary } from "../../../dashboard/shared/types.ts";
import { assertGroupId } from "../../src/cli/commands/attempt.ts";
import {
  groupFilterEntries,
  groupFilterLabel,
  groupFilterValues,
  groupKeyOf,
  groupTitle,
  withGroupKey,
  NO_DRIVING_SESSION,
} from "../../../dashboard/src/session-groups.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

const counts = { stages: 4, inputs: 2, proposals: 2, applied: 1, notTaken: 1, alternatives: 3, unitRecords: 1, units: 1 };
const summaries: readonly GroupSummary[] = [
  { group: "drive-a", project: "p", revision: 4, closed: false, title: "The first ask.", at: "2026-09-08T00:00:00.000Z", counts },
  { group: "drive-b", project: "p", revision: 2, closed: true, title: null, at: "2026-09-07T00:00:00.000Z", counts },
];

const run = (id: string, groupId: string | null, patch: Record<string, unknown> = {}) => ({
  id, groupId, workflowId: "build-review", state: "LANDED" as const, planKind: "spine" as const, ...patch,
});

const WORKFLOWS = ["build-review", "build"];
const STATES = ["LANDED", "BLOCKED"];
const KINDS = ["spine", "deep", "unlinked"];

test("the no-driving-session bucket can never collide with a group a driver mints", () => {
  // The sentinel shares one selection array with real group ids, so a value a
  // driver could type would silently merge that session with every legacy run.
  assert.throws(() => assertGroupId(NO_DRIVING_SESSION), /not a path-safe identifier/u);
  assert.equal(assertGroupId("no-driving-session"), "no-driving-session");
  assert.equal(groupKeyOf(null), NO_DRIVING_SESSION);
  assert.equal(groupKeyOf("drive-a"), "drive-a");
});

test("the menu reads well at zero: every run NULL, every recorded session empty", () => {
  // This is the owner's real projection, not a hypothetical. All forty-four
  // runs predate `--group` and D7 forbids backfilling them, so the bucket that
  // holds the whole board is the one with no journal behind it.
  const sessions = withGroupKey([run("r1", null), run("r2", null), run("r3", null)]);
  const entries = groupFilterEntries(sessions, summaries, WORKFLOWS, STATES, KINDS);
  assert.deepEqual(entries.map((entry) => [entry.value, entry.count]), [
    [NO_DRIVING_SESSION, 3],
    ["drive-a", 0],
    ["drive-b", 0],
  ]);
  // And it is FIRST, because the list scrolls after two entries and a bucket
  // holding every visible run does not belong below the fold.
  assert.equal(entries[0]?.value, NO_DRIVING_SESSION);
  assert.equal(groupFilterLabel(entries[0]!), "no driving session");
  assert.equal(groupFilterLabel(entries[2]!), "no ask recorded in this group");
  // A session with no runs on the board still gets a control, so its recorded
  // decisions stay reachable from the screen rather than only from a URL.
  assert.equal(entries.length, 3);
});

test("group counts are constrained by the other three menus and never by their own", () => {
  const sessions = withGroupKey([
    run("r1", "drive-a"),
    run("r2", "drive-a", { state: "BLOCKED" }),
    run("r3", "drive-b", { workflowId: "build" }),
    run("r4", null),
  ]);
  const entries = groupFilterEntries(sessions, summaries, WORKFLOWS, ["LANDED"], KINDS);
  assert.deepEqual(entries.map((entry) => [entry.value, entry.count]), [
    [NO_DRIVING_SESSION, 1],
    ["drive-a", 1],
    ["drive-b", 1],
  ]);
  // The menu's own vocabulary is supplied in full inside the entry function, so
  // a caller cannot accidentally narrow these counts by their own selection.
  assert.equal(entries.reduce((total, entry) => total + entry.count, 0), 3);
});

test("a group a run names with no journal is offered as a control, not dropped", () => {
  const sessions = withGroupKey([run("r1", "drive-ghost"), run("r2", "drive-a")]);
  const entries = groupFilterEntries(sessions, summaries, WORKFLOWS, STATES, KINDS);
  assert.deepEqual(entries.map((entry) => entry.value), [NO_DRIVING_SESSION, "drive-a", "drive-b", "drive-ghost"]);
  assert.equal(entries.at(-1)?.unrecorded, true);
  assert.equal(groupFilterLabel(entries.at(-1)!), "no ask recorded under this id");
  // The value list drives the selection, so it holds the same four values.
  assert.deepEqual(groupFilterValues([{ groupId: "drive-ghost" }, { groupId: null }], summaries), [
    NO_DRIVING_SESSION, "drive-a", "drive-b", "drive-ghost",
  ]);
});

test("an entry that was filtered out keeps its control, so its runs stay reachable", () => {
  const sessions = withGroupKey([run("r1", "drive-a"), run("r2", null)]);
  const entries = groupFilterEntries(sessions, summaries, [], [], []);
  assert.deepEqual(entries.map((entry) => [entry.value, entry.count]), [
    [NO_DRIVING_SESSION, 0],
    ["drive-a", 0],
    ["drive-b", 0],
  ]);
});

test("one source names a driving session wherever it appears", () => {
  // The menu entry, the heading above a cluster and the tree's own screen read
  // one function, so the same session cannot read as three different things.
  assert.equal(groupTitle(summaries[0]), "The first ask.");
  assert.equal(groupTitle(summaries[1]), "no ask recorded in this group");
  assert.equal(groupTitle(null), "no ask recorded in this group");
  const strip = source("dashboard/src/components/SessionGroupRow.vue");
  const board = source("dashboard/src/components/SessionBoardSection.vue");
  assert.match(strip, /groupFilterLabel\(entry\)/u);
  assert.match(board, /groupTitle\(/u);
});

test("selecting a driving session and opening its tree are two controls", () => {
  const strip = source("dashboard/src/components/SessionGroupRow.vue");
  // Selection is not opening: the pill filters the board and the link leaves
  // for the tree's own screen. Both are keyboard-reachable on their own.
  assert.match(strip, /<button[^>]*class="session-group-toggle"[\s\S]*?:aria-pressed="selected\.includes\(entry\.value\)"/u);
  assert.match(strip, /toggleFilterValue\(selected, entry\.value\)/u);
  assert.match(strip, /<a[^>]*class="session-group-open session-filter-control"[\s\S]*?:href="`#\/groups\/\$\{encodeURIComponent\(entry\.summary\.group\)\}`"/u);
  // And the strip still never expands, so the run workspace below is never
  // displaced by anything on it.
  assert.doesNotMatch(strip, /session-group-panel|GroupDecisionTree|fetch\(/u);
});
