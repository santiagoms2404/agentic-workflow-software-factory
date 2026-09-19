import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { BacklogTicket, SessionCard } from "../../../dashboard/shared/types.ts";
import { planBoard, TICKET_STATES, waitingOn } from "../../../dashboard/src/canvas-plan.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

function code(path: string): string {
  return source(path).replace(/<!--[\s\S]*?-->/gu, "").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

function ticket(id: string, milestone: string, state: BacklogTicket["state"], patch: Partial<BacklogTicket> = {}): BacklogTicket {
  return {
    uid: `awsf-v2-plan:${id}`, plan: "awsf-v2-plan", id, title: `${id} title`,
    milestone, state, depends_on: [], ready: true, ...patch,
  };
}

function run(sessionId: string, planRef: string | null): SessionCard {
  return { sessionId, planRef, taskId: `task-${sessionId}` } as unknown as SessionCard;
}

const tickets: readonly BacklogTicket[] = [
  ticket("W03", "M3", "done"),
  ticket("W01", "M1", "done"),
  ticket("W02", "M1", "todo", { depends_on: ["W01"] }),
  ticket("W04", "M3", "todo", { depends_on: ["W03", "W02"], ready: false }),
  ticket("OTHER", "M1", "done", { plan: "another-plan", uid: "another-plan:OTHER" }),
];

test("a plan shows only its own tickets, and its milestones in the plan's own order", () => {
  const board = planBoard(tickets, [], "awsf-v2-plan");
  // First appearance sets the order. Sorting alphabetically would rewrite a
  // sequence the plan itself decided.
  assert.deepEqual(board.milestones.map((milestone) => milestone.name), ["M3", "M1"]);
  assert.equal(board.tickets, 4);
  assert.equal(board.milestones.flatMap((milestone) => milestone.tickets).some((held) => held.plan !== "awsf-v2-plan"), false);
  assert.deepEqual(board.counts, { todo: 2, wip: 0, done: 2, failed: 0 });
  assert.deepEqual(board.milestones[0]?.counts, { todo: 1, wip: 0, done: 1, failed: 0 });
});

test("a plan nothing was registered against renders as empty rather than as broken", () => {
  const board = planBoard(tickets, [], "retired-plan");
  assert.deepEqual(board.milestones, []);
  assert.equal(board.tickets, 0);
  assert.deepEqual(board.counts, { todo: 0, wip: 0, done: 0, failed: 0 });
  assert.deepEqual(board.runs, []);
  assert.deepEqual([...TICKET_STATES], ["todo", "wip", "done", "failed"]);
});

test("what a ticket waits on excludes what already finished", () => {
  // Naming a dependency that is done would make a ticket ready to start look
  // blocked, which is worse than saying nothing.
  const mine = tickets.filter((held) => held.plan === "awsf-v2-plan");
  assert.deepEqual(waitingOn(mine.find((held) => held.id === "W04")!, mine), ["W02"]);
  assert.deepEqual(waitingOn(mine.find((held) => held.id === "W02")!, mine), []);
  assert.deepEqual(waitingOn(mine.find((held) => held.id === "W01")!, mine), []);
});

test("runs sit beside the tickets, at the plan, because that is what is recorded", () => {
  const board = planBoard(tickets, [run("s1", "awsf-v2-plan"), run("s2", null), run("s3", "other")], "awsf-v2-plan");
  assert.deepEqual(board.runs.map((held) => held.sessionId), ["s1"]);
  // Nothing joins a ticket to a run: a run records `plan_ref` and no ticket, so
  // such a line could only come from matching a task id against a ticket id by
  // name — the guessing Task 5 was instructed to refuse.
  assert.doesNotMatch(code("dashboard/src/canvas-plan.ts"), /taskId.*ticket|ticket.*taskId/u);
  const board_ = source("dashboard/src/components/CanvasPlanBoard.vue");
  assert.match(board_, /recorded at the plan, not at a ticket/u);
});

test("the plan's own file is not served, and the way to its full text is the backlog", () => {
  const view = source("dashboard/src/components/CanvasPlanBoard.vue");
  // Rendering the plan's `.html` would need a route serving arbitrary local
  // files and a second stylesheet in a shell kept in one design language.
  assert.doesNotMatch(code("dashboard/src/canvas-plan.ts"), /\.html|readFile|fetch\(/u);
  assert.match(view, /:href="`#\/backlog\/\$\{encodeURIComponent\(plan\.id\)\}`"/u);
  // The board is built from data already served; opening a plan fetches the
  // ticket set and nothing else.
  assert.match(source("dashboard/src/routes/canvas.vue"), /fetch\("\/api\/v1\/tickets"\)/u);
});

test("a milestone is a recessed column and a ticket a pill standing on it, with done sitting flush", () => {
  const shell = source("dashboard/src/styles/morphism.css");
  const block = shell.split("--- The plan board")[1]?.split("--- Backlog:")[0] ?? "";
  assert.ok(block.includes(".plan-ticket"));
  assert.match(block, /\.plan-ticket \{[^}]*box-shadow: var\(--neu-raised-soft\)/su);
  // Finished work sits flush rather than standing up asking to be looked at.
  assert.match(block, /\.plan-ticket\.ticket-done \{[^}]*box-shadow: none/su);
  assert.match(block, /\.plan-ticket\.ready \{ box-shadow: var\(--neu-raised\); \}/u);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/u);
  assert.doesNotMatch(block, /border-left|border-right|border-top|border-bottom|--accent/u);
});
