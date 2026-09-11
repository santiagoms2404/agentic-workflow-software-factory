import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  boardSections,
  clusterKeys,
  COLLAPSED_STACK_LIMIT,
  groupConnections,
  memberSpan,
  sectionSpan,
  type GroupableSession,
} from "../../../dashboard/src/session-clusters.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

interface Run extends GroupableSession {
  readonly sessionId: string;
}

function run(
  sessionId: string,
  taskId: string,
  attempt: number,
  groupId: string | null,
  startedAt: string,
  continuesTask: string | null = null,
): Run {
  return { sessionId, project: "p", taskId, continuesTask, attempt, groupId, startedAt, state: "LANDED" };
}

/** Task X attempt 1 in one session, attempt 2 in another: the cross-group edge. */
const spanning = [
  run("s1", "task-x", 1, "drive-a", "2026-09-08T10:00:00.000Z"),
  run("s2", "task-x", 2, "drive-b", "2026-09-09T10:00:00.000Z"),
];

test("a connection string is read out of the recorded relationships, never stored", () => {
  const connections = groupConnections(spanning);
  assert.deepEqual(connections, [{
    from: "drive-a", to: "drive-b", fromSessionId: "s1", toSessionId: "s2", kind: "same-task",
  }]);
  // A declared continuation across two sessions is the other edge, and it is
  // read from `continuesTask`, which the projector writes onto EVERY session of
  // the task rather than only its newest attempt.
  assert.deepEqual(
    groupConnections([
      run("s1", "task-a", 1, "drive-a", "2026-09-08T10:00:00.000Z"),
      run("s2", "task-b", 1, "drive-b", "2026-09-09T10:00:00.000Z", "task-a"),
    ]).map((connection) => [connection.from, connection.to, connection.kind]),
    [["drive-a", "drive-b", "continuation"]],
  );
  // Two runs in the same session are not a connection between sessions, and
  // two unrelated runs are not one at all.
  assert.deepEqual(groupConnections([
    run("s1", "task-x", 1, "drive-a", "2026-09-08T10:00:00.000Z"),
    run("s2", "task-x", 2, "drive-a", "2026-09-09T10:00:00.000Z"),
    run("s3", "task-y", 1, "drive-b", "2026-09-09T11:00:00.000Z"),
  ]), []);
  // Nothing in the module reads or writes a stored group-to-group link.
  const module = source("dashboard/src/session-clusters.ts");
  assert.doesNotMatch(module, /localStorage|fetch\(|sessionStorage/u);
});

test("a session with no connection is its own cluster, and the key does not depend on arrival order", () => {
  const connections = groupConnections(spanning);
  const forward = clusterKeys(["drive-a", "drive-b", "drive-c"], connections);
  const reversed = clusterKeys(["drive-c", "drive-b", "drive-a"], connections);
  assert.equal(forward.get("drive-a"), forward.get("drive-b"));
  assert.notEqual(forward.get("drive-c"), forward.get("drive-a"));
  assert.deepEqual([...forward.entries()].sort(), [...reversed.entries()].sort());
});

test("a projection where no run carries a driving session renders exactly the board it did before", () => {
  // The owner's real projection. Every section is a bare deck, no container is
  // drawn, and the order is the order the rows arrived in.
  const runs = [
    run("s3", "task-c", 1, null, "2026-09-09T12:00:00.000Z"),
    run("s2", "task-b", 2, null, "2026-09-09T11:00:00.000Z"),
    run("s1", "task-b", 1, null, "2026-09-08T11:00:00.000Z"),
  ];
  const sections = boardSections(runs, runs);
  assert.deepEqual(sections.map((section) => section.kind), ["run", "run"]);
  assert.deepEqual(sections.map((section) => section.members[0]?.stacks[0]?.sessions.map((s) => s.sessionId)), [
    ["s3"],
    ["s2", "s1"],
  ]);
  assert.deepEqual(sections.flatMap((section) => section.connections), []);
  assert.deepEqual(sections.flatMap((section) => section.hiddenBridges), []);
});

test("continuation-linked sessions sit adjacent in one container, and an unrelated newer run does not split them", () => {
  const runs = [
    run("newer", "task-unrelated", 1, "drive-c", "2026-09-10T09:00:00.000Z"),
    ...spanning,
    run("s3", "task-y", 1, "drive-a", "2026-09-08T09:00:00.000Z"),
  ];
  const sections = boardSections(runs, runs);
  assert.deepEqual(sections.map((section) => [section.kind, section.key]), [
    ["group", "cluster:drive-c"],
    ["cluster", "cluster:drive-a+drive-b"],
  ]);
  // The unrelated run is its own section and cannot land inside the cluster.
  assert.deepEqual(sections[0]?.members.map((member) => member.groupIds), [["drive-c"]]);
  // The cluster ranks by its newest visible run (s2, the 9th), so it reads
  // below the 10th and above everything older. Inside it, the deck that spans
  // both sessions ranks first for the same reason.
  assert.deepEqual(sections[1]?.members.map((member) => member.key), ["drive-a+drive-b", "drive-a"]);
  assert.equal(sections[1]?.connections.length, 1);
  // A deck spanning two sessions belongs to the seam, so it is not cut in half
  // to fit inside either one.
  assert.deepEqual(
    sections[1]?.members[0]?.stacks[0]?.sessions.map((session) => session.sessionId).sort(),
    ["s1", "s2"],
  );
});

test("a filtered-out bridge is reported rather than allowed to split the cluster", () => {
  // The rule: clusters derive from every run the board holds, never from the
  // filtered set. Hiding the only bridge would otherwise break the chain with
  // nothing on screen admitting it.
  const all = [...spanning, run("s3", "task-y", 1, "drive-a", "2026-09-08T09:00:00.000Z")];
  const visible = all.filter((session) => session.sessionId !== "s2");
  const sections = boardSections(all, visible);
  assert.deepEqual(sections.map((section) => section.kind), ["cluster"]);
  assert.deepEqual(sections[0]?.hiddenBridges, ["s2"]);
  // drive-b keeps its card and says it has nothing to show, rather than
  // vanishing and making the connection look like a session with no runs.
  const emptyMember = sections[0]?.members.find((member) => member.key === "drive-b");
  assert.deepEqual(emptyMember?.stacks, []);
  assert.equal(emptyMember?.rank, "");
});

test("a cluster with nothing visible leaves the board entirely", () => {
  assert.deepEqual(boardSections(spanning, []), []);
});

test("ordering is deterministic: newest visible run first, then the section key", () => {
  const sameInstant = "2026-09-09T10:00:00.000Z";
  const runs = [
    run("b", "task-b", 1, null, sameInstant),
    run("a", "task-a", 1, null, sameInstant),
  ];
  assert.deepEqual(boardSections(runs, runs).map((section) => section.key), ["a", "b"]);
  // And a poll that returns the same rows in a different order changes nothing.
  assert.deepEqual(boardSections([...runs].reverse(), [...runs].reverse()).map((section) => section.key), ["a", "b"]);
});

test("a card is as wide as its contents, with no hole left inside it", () => {
  const stacksOf = (counts: readonly number[]) => counts.map((runs, index) => ({
    key: `m${index}`, groupIds: ["g"], unsessioned: 0, rank: "",
    stacks: Array.from({ length: runs }, (_unused, stack) => ({ key: `s${index}-${stack}`, sessions: [] })),
  }));
  // One deck is one card wide, so it can share a row with a two-card session
  // rather than taking the row and leaving the space beside it empty.
  assert.equal(memberSpan({ stacks: stacksOf([1])[0]!.stacks }), 1);
  assert.equal(sectionSpan({ members: stacksOf([1]) }), 1);
  assert.equal(sectionSpan({ members: stacksOf([2]) }), 2);
  // A cluster is the SUM of its sessions, not the widest of them: they sit
  // beside each other, so a one-deck session next to a two-deck one makes a
  // three-column card with nothing empty in it. Taking the widest left the
  // narrower session's row half empty inside a card nothing could be placed in.
  assert.equal(sectionSpan({ members: stacksOf([1, 2]) }), 3);
  assert.equal(sectionSpan({ members: stacksOf([1, 1]) }), 2);
  // And it never eats more of the row than one session would.
  assert.equal(sectionSpan({ members: stacksOf([2, 2, 2]) }), COLLAPSED_STACK_LIMIT);
  assert.equal(sectionSpan({ members: stacksOf([9]) }), COLLAPSED_STACK_LIMIT);
  // A session whose runs are all filtered out still occupies a card.
  assert.equal(sectionSpan({ members: stacksOf([0]) }), 1);
  assert.equal(memberSpan({ stacks: [] }), 1);
});

test("the three levels are three depths in the shell's own grammar, and the nesting is refused when it stops fitting", () => {
  const board = source("dashboard/src/components/SessionBoardSection.vue");
  const shell = source("dashboard/src/styles/morphism.css");

  // A deck with no driving session takes no container at all.
  assert.match(board, /v-if="section\.kind === 'run'"/u);
  // Cluster = recessed panel; session = card standing on it; runs = cards on
  // that. Depth and room separate them — never a line.
  assert.match(board, /'board-cluster neu-well' : 'board-group-standalone'/u);
  assert.match(shell, /\.board-group \{[^}]*box-shadow:\s*var\(--neu-raised\)/su);
  assert.match(shell, /\.board-group\.empty \{[^}]*background:\s*var\(--neu-well\)[^}]*box-shadow:\s*none/su);
  // Every treatment is a token: a hardcoded colour or shadow works in exactly
  // one of the palettes and silently breaks the rest.
  const section = shell.split("--- The board:")[1]?.split("--- Driving sessions:")[0] ?? "";
  assert.ok(section.length > 0);
  assert.doesNotMatch(section, /#[0-9a-fA-F]{3,8}\b/u);
  assert.doesNotMatch(section, /box-shadow:\s*-?\d/u);
  // And no accent rule anywhere on these containers. The shell is light and
  // shadow; a coloured rail or ring on a card is a second design language.
  assert.doesNotMatch(section, /--accent/u);
  assert.doesNotMatch(section, /border-left|border-right|border-top|border-bottom/u);
  // Below the width where a run card stops sharing a row, two nested boxes cost
  // about seventy pixels of a four-hundred-pixel screen, so they are refused
  // rather than shrunk.
  const narrow = shell.split("@media (max-width: 720px)")[1] ?? "";
  assert.match(narrow, /\.board-cluster, \.board-group \{[^}]*box-shadow:\s*none/su);
  assert.match(narrow, /\.board-group-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/u);
  assert.match(narrow, /\.board-section \{ grid-column: span 1; \}/u);
});

test("a section takes the columns it needs, and its inner tracks are counted rather than fitted", () => {
  const shell = source("dashboard/src/styles/morphism.css");
  const board = source("dashboard/src/components/SessionBoardSection.vue");
  const grid = source("dashboard/src/components/SessionsGrid.vue");
  assert.match(shell, /\.board-section \{ grid-column: span var\(--board-span, 1\);/u);
  assert.match(board, /'--board-span': span/u);
  // An auto-fill floor inside a card that is already sized overflows it as soon
  // as the board column is narrower than the floor, so the tracks are counted.
  assert.match(shell, /\.board-group-grid \{[^}]*repeat\(var\(--member-columns, 1\), minmax\(0, 1fr\)\)/su);
  assert.match(board, /'--member-columns': columns\(member\)/u);
  assert.match(board, /'--member-span': columns\(member\)/u);
  // One column per deck the session shows, so a run card inside a session is
  // the same width as one outside it.
  assert.match(board, /return memberSpan\(member\);/u);
  // Sessions sit beside each other inside the cluster, each as wide as its own
  // decks, so the card's outline follows its contents and leaves no hole.
  assert.match(shell, /\.board-cluster \{[^}]*repeat\(var\(--board-span, 1\), minmax\(0, 1fr\)\)/su);
  assert.match(shell, /\.board-cluster > \.board-group \{ grid-column: span var\(--member-span, 1\); \}/u);
  assert.match(shell, /\.sessions-shell \.sessions-grid \{[^}]*repeat\(auto-fill, minmax\(360px, 1fr\)\)/su);
  // Sections are different widths, so a narrow one followed by a wide one would
  // leave columns of nothing. Dense backfills that gap; the order the sections
  // are handed over in, and the order a reader and the keyboard meet them in,
  // is unchanged.
  assert.match(shell, /\.sessions-shell \.sessions-grid \{[^}]*grid-auto-flow: row dense;/su);
  // The board is still a sibling of the context card: neither displaces the other.
  assert.match(grid, /<SessionGroupRow[\s\S]*?<SessionPlanRow[\s\S]*?class="sessions-grid"/u);
  assert.match(grid, /boardSections\(annotatedSessions\.value, visibleSessions\.value\)/u);
});

test("past three decks a session grows a control instead of eating the row", () => {
  const board = source("dashboard/src/components/SessionBoardSection.vue");
  assert.match(board, /isOpened\(member\) \? member\.stacks : member\.stacks\.slice\(0, COLLAPSED_STACK_LIMIT\)/u);
  assert.match(board, /v-if="member\.stacks\.length > COLLAPSED_STACK_LIMIT"/u);
  assert.match(board, /class="board-group-expand"[\s\S]*?:aria-expanded="isOpened\(member\)"/u);
  // The count of what is behind it is on the control, so the reader knows what
  // opening it costs before they open it.
  assert.match(board, /hiddenStacks\(member\)/u);
});

test("the control that opens a tree is inside the card it belongs to", () => {
  const board = source("dashboard/src/components/SessionBoardSection.vue");
  const strip = source("dashboard/src/components/SessionGroupRow.vue");
  const shell = source("dashboard/src/styles/morphism.css");
  const base = source("dashboard/src/styles/dashboard.css");
  // Absolutely positioned over the card's own top-right corner, with the
  // heading reserving the room, so a narrow card and a wide one put it in the
  // same place and neither has to be scrolled sideways to reach it.
  assert.match(shell, /\.board-group-head \{ position: relative;[^}]*padding-right: 44px; \}/u);
  assert.match(shell, /\.board-group-open \{[^}]*position: absolute;[^}]*right: 0;/su);
  assert.match(base, /\.session-group-open \{[^}]*position: absolute;/su);
  assert.match(base, /\.session-group-entry \{ position: relative;/u);
  // A box that scrolls in one axis computes `auto` in the other, which is how
  // the list grew a sideways scrollbar for a control sitting outside it.
  assert.match(shell, /\.session-group-entries \{[^}]*overflow-x: hidden;/su);
  // Both controls keep an accessible name, because the label is now an icon.
  assert.match(board, /:aria-label="`Open the decision tree for \$\{member\.groupIds\[0\]\}`"/u);
  assert.match(strip, /:aria-label="`Open the decision tree for \$\{entry\.summary\.group\}`"/u);
});
