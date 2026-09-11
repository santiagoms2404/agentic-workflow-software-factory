import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  boardSections,
  clusterKeys,
  groupConnections,
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

test("the three levels are three depths in the shell's own grammar, and the nesting is refused when it stops fitting", () => {
  const board = source("dashboard/src/components/SessionBoardSection.vue");
  const shell = source("dashboard/src/styles/morphism.css");

  // A deck with no driving session takes no container at all.
  assert.match(board, /v-if="section\.kind === 'run'"/u);
  // Cluster = recessed well; session = card standing on it; runs = raised
  // cards on that. The same raised-soft / raised pair the deck already uses.
  assert.match(board, /'board-cluster neu-well' : 'board-group-standalone'/u);
  assert.match(shell, /\.board-group \{[^}]*box-shadow:\s*var\(--neu-raised-soft\)/su);
  assert.match(shell, /\.board-group\.empty \{[^}]*background:\s*var\(--neu-well\)[^}]*box-shadow:\s*none/su);
  // Every treatment is a token: a hardcoded colour or shadow works in exactly
  // one of the palettes and silently breaks the rest.
  const section = shell.split("--- The board:")[1]?.split("--- Driving sessions:")[0] ?? "";
  assert.ok(section.length > 0);
  assert.doesNotMatch(section, /#[0-9a-fA-F]{3,8}\b/u);
  assert.doesNotMatch(section, /box-shadow:\s*-?\d/u);
  // Below the width where a run card stops sharing a row, two nested boxes cost
  // about seventy pixels of a four-hundred-pixel screen, so they are refused
  // rather than shrunk.
  const narrow = shell.split("@media (max-width: 720px)")[1] ?? "";
  assert.match(narrow, /\.board-cluster, \.board-group \{[^}]*box-shadow:\s*none/su);
  assert.match(narrow, /\.board-group-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/u);
});

test("the section spans the board row and the deck keeps the grid it already had", () => {
  const shell = source("dashboard/src/styles/morphism.css");
  const grid = source("dashboard/src/components/SessionsGrid.vue");
  assert.match(shell, /\.board-section \{ grid-column: 1 \/ -1;/u);
  // Same track rule inside a session as outside it, so the cards line up with
  // the ungrouped ones above and below rather than stretching to the band.
  assert.match(shell, /\.board-group-grid \{[^}]*repeat\(auto-fill, minmax\(360px, 1fr\)\)/su);
  assert.match(shell, /\.sessions-shell \.sessions-grid \{[^}]*repeat\(auto-fill, minmax\(360px, 1fr\)\)/su);
  // The board is still a sibling of the context card: neither displaces the other.
  assert.match(grid, /<SessionGroupRow[\s\S]*?<SessionPlanRow[\s\S]*?class="sessions-grid"/u);
  assert.match(grid, /boardSections\(annotatedSessions\.value, visibleSessions\.value\)/u);
});
