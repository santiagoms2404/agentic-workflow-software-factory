import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GroupSummary, TreeProposal } from "../../../dashboard/shared/types.ts";
import {
  field,
  groupsForRuns,
  narrativeFields,
  notTakenReason,
  traceTask,
  unrecordedGroupIds,
  VOICE_LABEL,
} from "../../../dashboard/src/group-tree.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

const counts = { stages: 1, inputs: 1, proposals: 0, applied: 0, notTaken: 0, alternatives: 0, unitRecords: 0, units: 0 };
const summaries: readonly GroupSummary[] = [
  { group: "drive-a", project: "p", revision: 3, closed: false, title: "The first ask.", at: "2026-09-08T00:00:00.000Z", counts },
  { group: "drive-b", project: "p", revision: 1, closed: true, title: null, at: null, counts },
];

test("every recorded driving session gets a title, and the ones with runs here sort first", () => {
  // The strict join this replaced showed nothing at all on a real projection:
  // no run created before `--group` carries one, and legacy rows are never
  // backfilled, so the whole recorded history was unreachable from the screen.
  assert.deepEqual(
    groupsForRuns(summaries, ["drive-a", null, "drive-a"]).map((heading) => [heading.summary.group, heading.runs]),
    [["drive-a", 2], ["drive-b", 0]],
  );
  assert.deepEqual(
    groupsForRuns(summaries, ["drive-b"]).map((heading) => [heading.summary.group, heading.runs]),
    [["drive-b", 1], ["drive-a", 0]],
    "a group with runs on this board reads before one without",
  );
  // A board where nothing names a group still lists both, each saying zero.
  assert.deepEqual(
    groupsForRuns(summaries, [null, null]).map((heading) => [heading.summary.group, heading.runs]),
    [["drive-a", 0], ["drive-b", 0]],
  );
  // And a group nobody recorded is still not invented from a run's id.
  assert.deepEqual(groupsForRuns([], ["drive-ghost"]), []);
});

test("a group a run names with no planning journal is reported, not hidden", () => {
  assert.deepEqual(unrecordedGroupIds(summaries, ["drive-a", "drive-ghost", null, "drive-ghost"]), ["drive-ghost"]);
  assert.deepEqual(unrecordedGroupIds(summaries, ["drive-a", null]), []);
});

test("an unwritten field becomes an explicit absence, never blank space or invented prose", () => {
  assert.deepEqual(field(""), { recorded: false, text: "not recorded" });
  assert.deepEqual(field("   "), { recorded: false, text: "not recorded" });
  assert.deepEqual(field("what hurt"), { recorded: true, text: "what hurt" });
  const fields = narrativeFields({
    title: "t", explanation: "an explanation", changes: "", reason: "  ", friction: "what hurt",
    tasks: [], references: [],
  });
  assert.equal(fields.explanation.recorded, true);
  assert.equal(fields.changes.recorded, false);
  assert.equal(fields.reason.recorded, false);
  assert.equal(fields.friction.text, "what hurt");
});

test("not-taken separates a proposal nobody decided from one a later stage overtook", () => {
  const proposal = (appliable: boolean): TreeProposal => ({
    id: "p", base: 1, proposedStageId: "s", proposedAt: "2026-09-08T00:00:00.000Z",
    narrative: { title: "t", explanation: "", changes: "", reason: "", friction: "", tasks: [], references: [] },
    alternatives: [], changes: [], status: "not-taken", appliable,
    decisionStageId: null, decidedAt: null, ownerReason: null, ask: null, tasks: [],
  });
  assert.match(notTakenReason(proposal(true)), /not yet decided/u);
  assert.match(notTakenReason(proposal(false)), /overtook it/u);
});

test("a task with no recorded decision traces to nothing rather than to a guess", () => {
  const tree = {
    schema: "awsf/decision-tree/v1", group: "g", project: "p", revision: 1, head: "", closed: false,
    title: null, asks: [], spine: [], notTaken: [], units: [],
    byTask: { known: { proposals: ["p1"], asks: ["a1"] } }, counts,
  } as const;
  assert.deepEqual(traceTask(tree, "known"), { proposals: ["p1"], asks: ["a1"] });
  assert.deepEqual(traceTask(tree, "never-mentioned"), { proposals: [], asks: [] });
});

test("the three voices are distinguished in the markup, and the owner's words take their own treatment", () => {
  const tree = source("dashboard/src/components/GroupDecisionTree.vue");
  const css = source("dashboard/src/styles/dashboard.css");
  // The authority field already carries this, so the component labels rather
  // than re-derives; each of the three has a class the stylesheet answers.
  assert.equal(VOICE_LABEL["owner-input"], "the owner asked");
  assert.equal(VOICE_LABEL["owner-decision"], "the owner decided");
  for (const voice of ["voice-owner-input", "voice-owner-decision", "voice-not-taken"]) {
    assert.match(tree, new RegExp(voice, "u"), voice);
  }
  assert.match(tree, /<pre class="owner-words">\{\{ ask\.text \}\}<\/pre>/u, "the ask is the owner's exact bytes");
  assert.match(css, /\.decision-node\.voice-owner-decision \{[^}]*border-left:[^}]*var\(--accent\)/su);
  assert.match(css, /\.decision-node\.voice-not-taken \{[^}]*dashed/su);
  // Every treatment is a token, so all seven palettes inherit it.
  assert.doesNotMatch(css.split("--- The decision tree")[1] ?? "", /#[0-9a-fA-F]{3,8}\b/u, "no hardcoded colour in the tree styles");
});

test("the spine reads before the asks: the tree is of decisions, not of messages", () => {
  const tree = source("dashboard/src/components/GroupDecisionTree.vue");
  const decided = tree.indexOf('aria-label="What was decided"');
  const notTaken = tree.indexOf('aria-label="What was proposed and not taken"');
  const asked = tree.indexOf('aria-label="What was asked"');
  assert.ok(decided > 0 && notTaken > 0 && asked > 0);
  assert.ok(decided < notTaken && notTaken < asked, "decisions, then what was dropped, then the asks behind them");
});

test("a group with no runs on this board says so rather than looking like a session that produced nothing", () => {
  const row = source("dashboard/src/components/SessionGroupRow.vue");
  assert.match(row, /no runs on this board/u);
  assert.match(row, /run\(s\) here/u);
  // The zero case takes the same absence treatment every unwritten field does.
  assert.match(row, /:class="\{ absent: heading\.runs === 0 \}"/u);
});

test("expanding preserves scroll and focus, and never unmounts the run workspace", () => {
  const row = source("dashboard/src/components/SessionGroupRow.vue");
  const grid = source("dashboard/src/components/SessionsGrid.vue");
  // The offset is captured before the DOM updates and restored after it, so a
  // collapse under a scrolled viewport does not throw the reader to the top.
  assert.match(row, /const offset = window\.scrollY;[\s\S]*?await nextTick\(\);[\s\S]*?window\.scrollTo\(\{ top: offset/u);
  // `hidden` rather than v-if: the panel and its fetched tree stay mounted, and
  // the toggle keeps focus because it is never replaced.
  assert.match(row, /class="session-group-panel" :hidden="!expanded\.includes/u);
  assert.doesNotMatch(row, /v-if="expanded\.includes/u);
  // And the board is a sibling of the group row, so neither toggle touches it.
  assert.match(grid, /<SessionGroupRow[\s\S]*?<SessionPlanRow[\s\S]*?class="sessions-grid"/u);
});
