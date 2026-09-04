import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  groupSessionStacks,
  MAX_SESSION_STACK_BANDS,
  orderSessionStack,
  promoteSession,
  removeSessionFromStack,
  SESSION_STACK_TONE_COUNT,
  sessionPeekWindow,
  sessionStackToneClass,
  sessionVisiblePeeks,
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
  project = "project-a",
): Run {
  return { label, sessionId: `session-${label}`, project, taskId, attempt, continuesTask, startedAt, state };
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

test("the same task id and continuation target in two projects stay in separate stacks", () => {
  assert.deepEqual(stackLabels([
    run("alpha-original", "shared-task", 1, null, undefined, "RUNNING", "project-alpha"),
    run("bravo-original", "shared-task", 1, null, undefined, "RUNNING", "project-bravo"),
    run("alpha-continuation", "next-task", 1, "shared-task", undefined, "RUNNING", "project-alpha"),
    run("bravo-continuation", "next-task", 1, "shared-task", undefined, "RUNNING", "project-bravo"),
  ]), [
    ["alpha-original", "alpha-continuation"],
    ["bravo-original", "bravo-continuation"],
  ]);
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

test("every run keeps its identity-derived tone when the deck is reordered", () => {
  const ordered = [run("oldest", "task", 1), run("middle", "task", 2), run("front", "task", 3)];
  const promoted = promoteSession(ordered, ordered[0]!.sessionId);
  const tones = (sessions: readonly Run[]) => Object.fromEntries(
    sessions.map((session) => [session.sessionId, sessionStackToneClass(session.sessionId)]).toSorted(),
  );

  assert.deepEqual(tones(promoted), tones(ordered), "promotion changes no id-to-tone assignment");
  assert.equal(
    sessionStackToneClass(promoted.at(-1)!.sessionId),
    sessionStackToneClass(ordered[0]!.sessionId),
    "the promoted run carries its peek tone to the front",
  );
});

const css = readFileSync(new URL("../../../dashboard/src/styles/dashboard.css", import.meta.url), "utf8");
const component = readFileSync(new URL("../../../dashboard/src/components/SessionStack.vue", import.meta.url), "utf8");
const cardComponent = readFileSync(new URL("../../../dashboard/src/components/SessionCard.vue", import.meta.url), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1];
  assert.ok(body, `missing CSS rule ${selector}`);
  return body;
}

type Rgb = readonly [number, number, number];

function declaration(body: string, name: string): string {
  const value = body.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*([^;]+)`))?.[1]?.trim();
  assert.ok(value, `missing ${name}`);
  return value;
}

function resolveDefaultColor(expression: string, defaults: string): Rgb {
  if (/^#[0-9a-f]{6}$/iu.test(expression)) {
    return [1, 3, 5].map((offset) => Number.parseInt(expression.slice(offset, offset + 2), 16)) as unknown as Rgb;
  }
  const variable = expression.match(/^var\((--[a-z0-9-]+)\)$/iu)?.[1];
  if (variable !== undefined) return resolveDefaultColor(declaration(defaults, variable), defaults);
  const mix = expression.match(/^color-mix\(in srgb, var\((--[a-z0-9-]+)\) (\d+)%, var\((--[a-z0-9-]+)\)\)$/iu);
  assert.ok(mix, `unsupported color expression ${expression}`);
  const left = resolveDefaultColor(`var(${mix[1]})`, defaults);
  const right = resolveDefaultColor(`var(${mix[3]})`, defaults);
  const weight = Number(mix[2]) / 100;
  return left.map((channel, index) => channel * weight + right[index]! * (1 - weight)) as unknown as Rgb;
}

function luminance(rgb: Rgb): number {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

test("card and stack wrappers use one shared fixed grid height", () => {
  const body = rule(".session-stack, .card-wrap");
  assert.match(body, /height:\s*var\(--session-card-height\)/u);
  assert.equal(body.match(/\bheight\s*:/gu)?.length, 1);
  assert.doesNotMatch(css, /\.card-wrap\s*\{[^}]*height:\s*420px/su);
});

test("stack tones are lighter than the default surface and retain adaptive foregrounds", () => {
  const peek = rule(".session-stack-peek");
  assert.match(peek, /width:\s*100%/u);
  assert.match(peek, /margin:\s*0 0 calc\(-1 \* var\(--session-stack-card-tail\)\)/u);
  assert.match(peek, /border:\s*1px solid var\(--border-soft\)/u);
  assert.match(peek, /border-radius:\s*var\(--radius\)/u);
  assert.match(peek, /background:\s*var\(--session-stack-tone\)/u);
  assert.match(peek, /color:\s*var\(--session-stack-tone-text\)/u);
  assert.doesNotMatch(peek, /overflow:\s*hidden|margin-inline|--accent|#[0-9a-f]{3,8}|\brgba?\(/iu);
  assert.match(rule(".session-stack-deck"), /gap:\s*0/u);

  const defaults = rule(":root");
  const surface = declaration(defaults, "--surface");
  const surfaceStops = [...surface.matchAll(/color-mix\(in srgb, var\(--[a-z0-9-]+\) \d+%, var\(--[a-z0-9-]+\)\)/giu)];
  assert.equal(surfaceStops.length, 2);
  const surfaceLuminance = Math.max(...surfaceStops.map((match) => luminance(resolveDefaultColor(match[0], defaults))));
  const backgrounds: string[] = [];

  for (let step = 1; step <= SESSION_STACK_TONE_COUNT; step += 1) {
    const tone = rule(`.session-stack-tone-${step}`);
    const background = declaration(tone, "--session-stack-tone");
    const foreground = declaration(tone, "--session-stack-tone-text");
    backgrounds.push(background);
    assert.match(background, /^color-mix\(/u, `tone ${step} background`);
    assert.doesNotMatch(background, /^color-mix\([^;]*var\(--bg\)/u, `tone ${step} must not start from the darkest palette token`);
    assert.doesNotMatch(background, /--text|--accent|#[0-9a-f]{3,8}|\brgba?\(/iu, `tone ${step} background`);
    assert.match(foreground, /^color-mix\(/u, `tone ${step} foreground`);
    assert.doesNotMatch(tone, /--accent|#[0-9a-f]{3,8}|\brgba?\(/iu, `tone ${step}`);
    assert.ok(luminance(resolveDefaultColor(background, defaults)) > surfaceLuminance, `tone ${step} must be lighter than the brightest surface stop`);
  }

  assert.equal(new Set(backgrounds).size, SESSION_STACK_TONE_COUNT, "every tone is visibly distinct from the surface and the other tones");
  assert.match(declaration(rule(".session-stack-tone-1"), "--session-stack-tone-text"), /var\(--bg\)/u);
  assert.match(declaration(rule(".session-stack-tone-2"), "--session-stack-tone-text"), /var\(--bg\)/u);
});

test("the front is the complete SessionCard below normal-flow legible peeks", () => {
  const deckAt = component.indexOf("class=\"session-stack-deck\"");
  const frontAt = component.indexOf("class=\"session-stack-front\"");
  assert.ok(deckAt >= 0 && frontAt > deckAt, "the deck is rendered above the front card");
  assert.match(component, /<SessionCard v-if="activeSessions\.length === 1 && standalone" :session="standalone" \/>/u);
  assert.doesNotMatch(component.match(/<SessionCard v-if="activeSessions\.length === 1[^>]+>/u)?.[0] ?? "", /tone-class/u, "a one-run stack stays untoned");
  assert.match(component, /class="session-stack-front"[\s\S]*<SessionCard[\s\S]*:key="front\.sessionId"[\s\S]*:tone-class="frontTone"/u);
  assert.match(rule(".session-stack-front .session-card"), /background:\s*var\(--session-stack-tone\);\s*color:\s*var\(--session-stack-tone-text\)/u);
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
  assert.match(rule(".session-stack-peek"), /grid-template-rows:\s*repeat\(2/u);
  assert.match(rule(".session-stack-peek > span"), /text-overflow:\s*ellipsis/u);
  for (const helper of ["shortSessionId", "stateLabel", "formatCalls", "formatUsage", "formatTokens"]) {
    assert.match(component, new RegExp(`${helper}\\(`));
  }
  assert.match(component, /:aria-expanded="isFront\(session\)"/u);
});

test("a stack of five exposes every run through a keyboard-operable bounded deck", () => {
  const ordered = orderSessionStack(Array.from({ length: 5 }, (_item, index) => run(
    `run-${index + 1}`,
    "deep-task",
    index + 1,
  )));
  const window = sessionPeekWindow(ordered);
  const expandedPeeks = sessionVisiblePeeks(ordered, true);
  assert.equal(window.visible.length + (window.hiddenCount > 0 ? 1 : 0), MAX_SESSION_STACK_BANDS);
  assert.equal(window.hiddenCount, 2);
  assert.equal(ordered.at(-1)?.label, "run-5");
  assert.deepEqual(
    new Set([...expandedPeeks, ordered.at(-1)!].map((session) => session.sessionId)),
    new Set(ordered.map((session) => session.sessionId)),
    "the expanded controls plus the full front card identify every run",
  );
  assert.match(component, /<button[\s\S]*class="session-stack-overflow"[\s\S]*:aria-expanded="expanded"[\s\S]*@click="toggleExpanded"/u);
  assert.match(component, /sessionVisiblePeeks\(ordered\.value, expanded\.value\)/u);
  assert.match(component, /:tabindex="isFront\(session\) \|\| isHiddenPeek\(session\) \? -1 : 0"/u);
  assert.match(rule(".session-stack-deck"), /max-height:\s*calc\([^;]*--session-stack-band-height[^;]*--session-stack-band-height[^;]*--session-stack-band-height/u);
  assert.match(rule(".session-stack-deck.expanded"), /overflow-y:\s*auto/u);
  assert.match(cardComponent, /<dl class="card-metrics-grid">[\s\S]*cost[\s\S]*runtime[\s\S]*usage[\s\S]*calls[\s\S]*<\/dl>/u);
  assert.match(rule(".session-stack-front"), /min-height:\s*calc\(var\(--session-card-height\)/u);
});

test("archiving a stacked front removes it and promotes the run directly behind it", () => {
  const ordered = [run("oldest", "task", 1), run("next", "task", 2), run("front", "task", 3)];
  const remaining = removeSessionFromStack(ordered, ordered.at(-1)!.sessionId);
  assert.deepEqual(remaining.map((session) => session.label), ["oldest", "next"]);
  assert.equal(remaining.at(-1)?.label, "next");
  assert.match(component, /function archiveFront\(sessionId: string\)[\s\S]*removeSessionFromStack\(ordered\.value, sessionId\)/u);
  assert.match(component, /@archived="archiveFront"/u);
  assert.match(cardComponent, /emit\("archived", props\.session\.sessionId\)/u);
});

test("a promotion survives its own click, restores outside, and preserves keyboard focus", () => {
  assert.match(component, /document\.addEventListener\("click", restoreDefault\)/u);
  assert.match(component, /event\.composedPath\(\)\.includes\(stack\)/u);
  assert.match(component, /promotedIds\.value = null;/u);
  assert.match(component, /if \(promotedIds\.value === null\) return defaultOrder\.value;/u);
  assert.match(component, /event\.detail === 0/u);
  assert.match(component, /await nextTick\(\)/u);
  assert.match(component, /querySelector<HTMLElement>\("\.session-stack-front \.session-card"\)\?\.focus/u);
  assert.match(component, /class="session-stack-control"[\s\S]*:aria-expanded="isFront\(session\)"/u);
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
