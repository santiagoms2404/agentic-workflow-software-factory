import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  groupSessionStacks,
  orderSessionStack,
  promoteSession,
  type StackableSession,
} from "../../../dashboard/src/session-stacks.ts";

interface Run extends StackableSession {
  readonly label: string;
}

function run(
  label: string,
  taskId: string,
  attempt: number,
  continuesTask: string | null = null,
  startedAt = `2026-09-${String(attempt).padStart(2, "0")}T00:00:00.000Z`,
  state: Run["state"] = "RUNNING",
): Run {
  return { label, sessionId: `session-${label}`, taskId, attempt, continuesTask, startedAt, state };
}

function stackLabels(sessions: readonly Run[]): readonly (readonly string[])[] {
  return groupSessionStacks(sessions).map((stack) => stack.sessions.map((session) => session.label));
}

test("attempts of one task form one stack", () => {
  assert.deepEqual(stackLabels([
    run("first", "literal-task", 1),
    run("second", "literal-task", 2),
    run("other", "other-task", 1),
  ]), [["first", "second"], ["other"]]);
});

test("declared continuation grouping is transitive across three tasks", () => {
  assert.deepEqual(stackLabels([
    run("alpha", "task-alpha", 1),
    run("bravo", "task-bravo", 1, "task-alpha"),
    run("charlie", "task-charlie", 1, "task-bravo"),
  ]), [["alpha", "bravo", "charlie"]]);
});

test("an unrelated run remains a one-card stack in grid order", () => {
  const sessions = [
    run("chain-start", "chain-a", 1),
    run("standalone", "unrelated", 1),
    run("chain-end", "chain-b", 1, "chain-a"),
  ];
  const stacks = groupSessionStacks(sessions);
  assert.deepEqual(stacks.map((stack) => stack.sessions.map((session) => session.label)), [
    ["chain-start", "chain-end"],
    ["standalone"],
  ]);
  assert.equal(stacks[1]?.sessions[0], sessions[1], "the singleton remains the same card object at its stack position");
});

test("a cycle of declared task links terminates as one connected stack", () => {
  assert.deepEqual(stackLabels([
    run("alpha", "cycle-a", 1, "cycle-c"),
    run("bravo", "cycle-b", 1, "cycle-a"),
    run("charlie", "cycle-c", 1, "cycle-b"),
  ]), [["alpha", "bravo", "charlie"]]);
});

test("task ids are compared literally and never pattern-matched", () => {
  assert.deepEqual(stackLabels([
    run("plain", "release", 1),
    run("looks-like-retry", "release-retry-2", 1),
    run("numeric-suffix", "release.3", 1),
  ]), [["plain"], ["looks-like-retry"], ["numeric-suffix"]]);
});

test("the default deck is oldest-to-newest with LANDED, then PUBLISHED, selected for front", () => {
  const newest = run("newest", "one", 1, null, "2026-09-03T00:00:00.000Z");
  const published = run("published", "one", 2, null, "2026-09-02T00:00:00.000Z", "PUBLISHED");
  const landed = run("landed", "one", 3, null, "2026-09-01T00:00:00.000Z", "LANDED");
  assert.deepEqual(orderSessionStack([newest, landed, published]).map((session) => session.label), [
    "published", "newest", "landed",
  ]);
  assert.equal(orderSessionStack([newest, published]).at(-1), published);

  const tieB = run("b", "two", 1, null, "2026-09-04T00:00:00.000Z");
  const tieA = run("a", "two", 2, null, "2026-09-04T00:00:00.000Z");
  assert.equal(orderSessionStack([tieB, tieA]).at(-1)?.sessionId, "session-a");
});

test("promoting a peek puts the former front directly behind it", () => {
  const oldest = run("oldest", "task", 1);
  const middle = run("middle", "task", 2);
  const front = run("front", "task", 3);
  const firstPromotion = promoteSession([oldest, middle, front], oldest.sessionId);
  assert.deepEqual(firstPromotion.map((session) => session.label), ["middle", "front", "oldest"]);
  assert.equal(firstPromotion.at(-2), front);

  const secondPromotion = promoteSession(firstPromotion, middle.sessionId);
  assert.deepEqual(secondPromotion.map((session) => session.label), ["front", "oldest", "middle"]);
  assert.equal(secondPromotion.at(-2), oldest);
});

const css = readFileSync(new URL("../../../dashboard/src/styles/dashboard.css", import.meta.url), "utf8");
const component = readFileSync(new URL("../../../dashboard/src/components/SessionStack.vue", import.meta.url), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1];
  assert.ok(body, `missing CSS rule ${selector}`);
  return body;
}

test("card and stack wrappers use one shared fixed grid height", () => {
  const body = rule(".session-stack, .card-wrap");
  assert.match(body, /height:\s*var\(--session-card-height\)/u);
  assert.equal(body.match(/\bheight\s*:/gu)?.length, 1);
  assert.doesNotMatch(css, /\.card-wrap\s*\{[^}]*height:\s*420px/su);
});

test("peek cards use a flat palette-derived tone without accent or hard-coded color", () => {
  const body = rule(".session-stack-peek");
  assert.match(body, /background:\s*color-mix\([^;]*var\(--panel-2\)[^;]*var\(--faint\)/u);
  assert.doesNotMatch(body, /--accent/u);
  assert.doesNotMatch(body, /#[0-9a-f]{3,8}|\brgba?\(/iu);
});

test("the front is the complete SessionCard below normal-flow legible peeks", () => {
  const deckAt = component.indexOf("class=\"session-stack-deck\"");
  const frontAt = component.indexOf("class=\"session-stack-front\"");
  assert.ok(deckAt >= 0 && frontAt > deckAt, "the deck is rendered above the front card");
  assert.match(component, /<SessionCard v-if="sessions\.length === 1 && standalone" :session="standalone" \/>/u);
  assert.match(component, /class="session-stack-front"[\s\S]*<SessionCard :key="front\.sessionId" :session="front" \/>/u);
  assert.doesNotMatch(rule(".session-stack-deck"), /position:\s*absolute/u);
  assert.doesNotMatch(rule(".session-stack-front"), /position:\s*absolute/u);

  const fields = [
    "session-stack-peek-id",
    "session-stack-peek-workflow",
    "session-stack-peek-state",
    "session-stack-peek-calls",
    "session-stack-peek-usage",
  ];
  const positions = fields.map((field) => component.indexOf(field));
  assert.deepEqual(positions, positions.toSorted((a, b) => a - b));
  assert.match(rule(".session-stack-peek"), /min-height:\s*58px/u);
  for (const helper of ["shortSessionId", "stateLabel", "formatCalls", "formatUsage", "formatTokens"]) {
    assert.match(component, new RegExp(`${helper}\\(`));
  }
  assert.match(component, /<button[\s\S]*aria-expanded="false"[\s\S]*@click="promote\(session\.sessionId\)"/u);
});

test("clicking outside the stack restores its deterministic order", () => {
  assert.match(component, /document\.addEventListener\("click", restoreDefault\)/u);
  assert.match(component, /element\.value\?\.contains\(target\)/u);
  assert.match(component, /promotedIds\.value = null;/u);
  assert.match(component, /if \(promotedIds\.value === null\) return defaultOrder\.value;/u);
});

test("selected and mixed controls keep their unselected backgrounds and never use accent", () => {
  for (const selector of [
    ".session-filter-control.selected, .session-filter-option.selected",
    ".session-filter-control.partial",
    ".plan-control-button.selected",
    ".plan-control-button.partial",
    ".plan-card.selected",
  ]) {
    const body = rule(selector);
    assert.doesNotMatch(body, /\bbackground(?:-color)?\s*:/u, selector);
    assert.doesNotMatch(body, /--accent/u, selector);
    assert.match(body, /border-color:\s*color-mix\([^;]*var\(--(?:faint|border)\)/u, selector);
  }
  assert.match(rule(".session-filter-control, .session-filter-option"), /background:\s*var\(--panel-3\)/u);
  assert.match(rule(".plan-control-button"), /background:\s*var\(--surface\)/u);
  assert.match(rule(".plan-card"), /background:\s*var\(--surface\)/u);
});
