import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  groupSessionStacks,
  MAX_SESSION_STACK_BANDS,
  orderSessionStack,
  promoteSession,
  promoteSessionWithTone,
  removeSessionFromStack,
  SESSION_STACK_TONE_COUNT,
  sessionPeekWindow,
  sessionStackToneClass,
  sessionStackTones,
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

test("the comparator-selected default run stays untoned at rest and after a promotion", () => {
  const newest = run("newest", "task", 1, null, "2026-09-03T00:00:00.000Z");
  const published = run("published", "task", 2, null, "2026-09-02T00:00:00.000Z", "PUBLISHED");
  const defaultRun = run("landed", "task", 3, null, "2026-09-01T00:00:00.000Z", "LANDED");
  const ordered = orderSessionStack([newest, defaultRun, published]);

  assert.equal(ordered.at(-1), defaultRun, "the settled-first comparator chooses the default run");
  assert.equal(sessionStackTones(ordered).get(defaultRun.sessionId), undefined, "the default front is ordinary and untoned");

  const promotion = promoteSessionWithTone(ordered, published.sessionId);
  assert.equal(promotion.ordered.at(-2), defaultRun, "promotion displaces the default into the deck");
  assert.equal(sessionStackTones(promotion.ordered).get(defaultRun.sessionId), undefined, "the displaced default remains untoned");
});

test("four-run stacks assign consecutive tones around the untoned default without a gap", () => {
  const farthest = run("farthest", "task", 1);
  const middle = run("middle", "task", 2);
  const nearest = run("nearest", "task", 3);
  const defaultRun = run("default", "task", 4, null, undefined, "LANDED");
  const ordered = orderSessionStack([nearest, defaultRun, farthest, middle]);
  const restingTones = sessionStackTones(ordered);

  assert.deepEqual(ordered.map((session) => session.label), ["farthest", "middle", "nearest", "default"]);
  assert.equal(sessionStackToneClass(0), undefined, "depth zero is the ordinary, untoned card");
  assert.equal(restingTones.get(nearest.sessionId), "session-stack-tone-1");
  assert.equal(restingTones.get(middle.sessionId), "session-stack-tone-2");
  assert.equal(restingTones.get(farthest.sessionId), "session-stack-tone-3");
  assert.equal(restingTones.get(defaultRun.sessionId), undefined);

  const promoted = promoteSessionWithTone(ordered, farthest.sessionId);
  const promotedTones = sessionStackTones(promoted.ordered);
  assert.equal(promotedTones.get(defaultRun.sessionId), undefined);
  assert.equal(promotedTones.get(nearest.sessionId), "session-stack-tone-1", "the run beyond the skipped default takes tone one");
  assert.equal(promotedTones.get(middle.sessionId), "session-stack-tone-2", "the remaining peek follows without a gap");
});

test("a promoted peek carries its named positional tone to the front", () => {
  const ordered = [run("oldest", "task", 1), run("middle", "task", 2), run("default", "task", 3)];
  const selected = ordered[0]!;
  const defaultRun = ordered.at(-1)!;
  const toneBefore = sessionStackTones(ordered).get(selected.sessionId);
  const promotion = promoteSessionWithTone(ordered, selected.sessionId);
  const positionalTonesAfter = sessionStackTones(promotion.ordered);

  assert.equal(toneBefore, "session-stack-tone-2", "the selected run starts as the second peek");
  assert.equal(positionalTonesAfter.get(selected.sessionId), undefined, "a front card has no new positional tone");
  assert.equal(promotion.frontToneClass, "session-stack-tone-2", "the promoted front carries tone 2 from its peek");
  assert.equal(promotion.ordered.at(-1), selected);
  assert.equal(positionalTonesAfter.get(defaultRun.sessionId), undefined, "the displaced default does not take the nearest tone");
  assert.equal(positionalTonesAfter.get(ordered[1]!.sessionId), "session-stack-tone-1", "the remaining non-default peek takes the nearest tone");
});

const css = readFileSync(new URL("../../../dashboard/src/styles/dashboard.css", import.meta.url), "utf8");
const component = readFileSync(new URL("../../../dashboard/src/components/SessionStack.vue", import.meta.url), "utf8");
const cardComponent = readFileSync(new URL("../../../dashboard/src/components/SessionCard.vue", import.meta.url), "utf8");
const laneIconComponent = readFileSync(new URL("../../../dashboard/src/components/LaneIcon.vue", import.meta.url), "utf8");

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

function contrastRatio(left: Rgb, right: Rgb): number {
  const [lighter, darker] = [luminance(left), luminance(right)].toSorted((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

test("card and stack wrappers use one shared fixed grid height", () => {
  const body = rule(".session-stack, .card-wrap");
  assert.match(body, /height:\s*var\(--session-card-height\)/u);
  assert.equal(body.match(/\bheight\s*:/gu)?.length, 1);
  assert.doesNotMatch(css, /\.card-wrap\s*\{[^}]*height:\s*420px/su);
});

test("the mode-specific tone ramps recede in opposite directions without blending into the surface", () => {
  const peek = rule(".session-stack-peek");
  assert.match(peek, /width:\s*100%/u);
  assert.match(peek, /margin:\s*0 0 calc\(-1 \* var\(--session-stack-card-tail\)\)/u);
  assert.match(peek, /border:\s*1px solid var\(--border-soft\)/u);
  assert.match(peek, /border-radius:\s*var\(--radius\)/u);
  assert.match(peek, /background:\s*var\(--session-stack-tone, var\(--surface\)\)/u, "an untoned default peek uses the ordinary surface");
  assert.match(peek, /color:\s*var\(--session-stack-tone-text, var\(--text\)\)/u);
  assert.doesNotMatch(peek, /overflow:\s*hidden|margin-inline|--accent|#[0-9a-f]{3,8}|\brgba?\(/iu);
  assert.match(rule(".session-stack-deck"), /gap:\s*0/u);

  const defaults = rule(":root");
  const surface = declaration(defaults, "--surface");
  const surfaceStops = [...surface.matchAll(/color-mix\(in srgb, var\(--[a-z0-9-]+\) \d+%, var\(--[a-z0-9-]+\)\)/giu)];
  const surfaceTokens = new Set([...surface.matchAll(/var\((--[a-z0-9-]+)\)/giu)].map((match) => match[1]));
  const slopes: number[] = [];
  assert.equal(surfaceStops.length, 2);

  for (const mode of ["dark", "light"] as const) {
    const palette = `${rule(`:root[data-theme="forest"][data-mode="${mode}"]`)}\n${defaults}`;
    const surfaceColors = surfaceStops.map((match) => resolveDefaultColor(match[0], palette));
    const surfaceExtreme = surfaceColors.toSorted((left, right) => mode === "dark"
      ? luminance(right) - luminance(left)
      : luminance(left) - luminance(right))[0]!;
    const backgrounds: string[] = [];
    const backgroundColors: Rgb[] = [];
    let previousLuminance = luminance(surfaceExtreme);

    for (let step = 1; step <= SESSION_STACK_TONE_COUNT; step += 1) {
      const tone = rule(`:root[data-mode="${mode}"] .session-stack-tone-${step}`);
      const background = declaration(tone, "--session-stack-tone");
      const foreground = declaration(tone, "--session-stack-tone-text");
      const backgroundColor = resolveDefaultColor(background, palette);
      const foregroundColor = resolveDefaultColor(foreground, palette);
      const backgroundTokens = [...background.matchAll(/var\((--[a-z0-9-]+)\)/giu)].map((match) => match[1]);
      const currentLuminance = luminance(backgroundColor);
      backgrounds.push(background);
      backgroundColors.push(backgroundColor);

      assert.match(background, /^color-mix\(/u, `${mode} tone ${step} background`);
      assert.ok(backgroundTokens.some((token) => !surfaceTokens.has(token)), `${mode} tone ${step} must not mix only tokens used to build --surface`);
      assert.doesNotMatch(background, /--text|--accent|#[0-9a-f]{3,8}|\brgba?\(/iu, `${mode} tone ${step} background`);
      assert.match(foreground, /^color-mix\(/u, `${mode} tone ${step} foreground`);
      assert.doesNotMatch(tone, /--accent|#[0-9a-f]{3,8}|\brgba?\(/iu, `${mode} tone ${step}`);
      assert.ok(mode === "dark" ? currentLuminance > previousLuminance : currentLuminance < previousLuminance,
        `${mode} tone ${step} must recede ${mode === "dark" ? "lighter" : "darker"} than the card in front`);
      assert.ok(contrastRatio(backgroundColor, surfaceExtreme) > 1.25, `${mode} tone ${step} must remain distinct from the untoned surface`);
      assert.ok(contrastRatio(backgroundColor, foregroundColor) >= 4.5, `${mode} tone ${step} foreground must remain readable`);
      previousLuminance = currentLuminance;
    }

    for (let index = 1; index < backgroundColors.length; index += 1) {
      const distance = Math.hypot(...backgroundColors[index]!.map((channel, channelIndex) => channel - backgroundColors[index - 1]![channelIndex]!));
      assert.ok(distance > 10, `${mode} adjacent tones ${index} and ${index + 1} must remain visibly distinct`);
    }
    assert.equal(new Set(backgrounds).size, SESSION_STACK_TONE_COUNT);
    slopes.push(luminance(backgroundColors.at(-1)!) - luminance(backgroundColors[0]!));
  }

  assert.ok(slopes[0]! > 0 && slopes[1]! < 0, "dark and light ramps must run in opposite directions");
});

test("the front is the complete SessionCard below normal-flow legible peeks", () => {
  const deckAt = component.indexOf("class=\"session-stack-deck\"");
  const frontAt = component.indexOf("class=\"session-stack-front\"");
  assert.ok(deckAt >= 0 && frontAt > deckAt, "the deck is rendered above the front card");
  assert.match(component, /<SessionCard v-if="activeSessions\.length === 1 && standalone" :session="standalone" \/>/u);
  assert.doesNotMatch(component.match(/<SessionCard v-if="activeSessions\.length === 1[^>]+>/u)?.[0] ?? "", /tone-class/u, "a one-run stack stays untoned");
  assert.match(component, /class="session-stack-front"[\s\S]*<SessionCard[\s\S]*:key="front\.sessionId"[\s\S]*:tone-class="frontTone"/u);
  assert.match(component, /const frontTone = computed\([\s\S]*promoted\.sessionId === front\.value\?\.sessionId \? promoted\.toneClass : undefined/u);
  assert.doesNotMatch(component, /sessionStackToneClass\(front\.value\.sessionId\)/u, "the resting front must not derive a tone from its identity");
  assert.doesNotMatch(css, /\.session-stack-front\s+\.session-card\s*\{/u, "the front card has no unconditional tone background or foreground");
  assert.match(rule(".session-stack-front .session-card-toned .session-card"), /background:\s*var\(--session-stack-tone\);\s*color:\s*var\(--session-stack-tone-text\)/u);
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
  assert.match(component, /if \(isHiddenPeek\(session\)\) return \["session-stack-hidden-control"\];[\s\S]*tone === undefined \? \["session-stack-peek"\]/u,
    "a visible untoned default remains an ordinary clickable peek after displacement");
  assert.match(component, /toneById\.value\.get\(ordered\.value\[index\]!\.sessionId\)/u,
    "the overflow band follows the compressed no-gap tone assignment");
});

test("toned cards darken inline lane labels and activity dots without collapsing their colors", () => {
  assert.match(cardComponent, /class="card-wrap" :class="\[toneClass, \{ 'session-card-toned': toneClass \}\]"/u);
  assert.match(rule(".session-stack-front .session-card-toned .session-card :where(*)"), /color:\s*inherit/u, "tone foreground covers all card descendants, not an enumerated subset");

  const stateChip = rule(".session-stack-front .session-card-toned .state-chip");
  assert.match(stateChip, /background:\s*transparent/u);
  assert.match(stateChip, /color:\s*var\(--session-stack-tone-text\)/u);
  assert.match(stateChip, /font-weight:\s*700/u);

  const laneMix = cardComponent.match(/return `color-mix\(in srgb, \$\{color\} (\d+)%, var\(--session-stack-lane-anchor\)\)`/u);
  assert.ok(laneMix, "toned inline lane colors must mix toward the mode's dark palette anchor");
  assert.doesNotMatch(cardComponent, /\$\{color\} \d+%, var\(--session-stack-tone-text\)/u, "lane colors do not mix toward the card foreground");
  const sourceWeight = Number(laneMix[1]) / 100;
  assert.ok(sourceWeight >= 0.4 && sourceWeight < 0.48, "the mix must be darker than the prior treatment without erasing each identifying hue");
  assert.match(cardComponent, /:style="\{ color: displayLaneColor\(lane\.color\) \}"/u, "lane labels and currentColor icons compute the adapted inline color");
  assert.match(cardComponent, /:style="\{ left: pointLeft\(point\), background: pointColor\(point, lane\) \}"/u, "activity dots compute their adapted inline background");
  assert.match(cardComponent, /return displayLaneColor\(color\);/u, "activity dots use the same adapted color path");
  assert.match(laneIconComponent, /stroke="currentColor"/u);
  assert.match(rule(".session-stack-front .session-card-toned .mini-agent"), /opacity:\s*1;\s*font-weight:\s*750/u);
  assert.match(rule(".session-stack-front .session-card-toned .activity-dot"), /opacity:\s*1;\s*box-shadow:\s*none/u);

  const defaults = rule(":root");
  const palettes = ["forest", "lavender-slate", "earthy-obsidian", "navy-sky", "warm-rust", "sunset"] as const;
  for (const paletteId of palettes) {
    for (const mode of ["dark", "light"] as const) {
      const palette = `${rule(`:root[data-theme="${paletteId}"][data-mode="${mode}"]`)}\n${defaults}`;
      const anchorRule = mode === "dark" ? rule(":root[data-mode=\"dark\"]") : rule(":root[data-mode=\"light\"]");
      const anchor = resolveDefaultColor(declaration(anchorRule, "--session-stack-lane-anchor"), palette);
      const toneLuminances = Array.from({ length: SESSION_STACK_TONE_COUNT }, (_item, index) => {
        const tone = rule(`:root[data-mode="${mode}"] .session-stack-tone-${index + 1}`);
        return luminance(resolveDefaultColor(declaration(tone, "--session-stack-tone"), palette));
      });
      const laneSources = new Map<string, Rgb>([
        ["engineer", resolveDefaultColor("var(--amber)", palette)],
        ["planner", resolveDefaultColor("#A78BFA", palette)],
        ["builder", resolveDefaultColor("#22D3EE", palette)],
        ["documenter", resolveDefaultColor("#C084FC", palette)],
        ["code / git", resolveDefaultColor("var(--green)", palette)],
      ]);
      const adapted = [...laneSources].map(([name, source]) => {
        const color = source.map((channel, index) => channel * sourceWeight + anchor[index]! * (1 - sourceWeight)) as unknown as Rgb;
        assert.ok(luminance(color) < luminance(source), `${paletteId} ${mode} ${name} must be darker than its source color`);
        assert.ok(toneLuminances.every((toneLuminance) => luminance(color) < toneLuminance),
          `${paletteId} ${mode} ${name} must stay dark against every stack tone`);
        return { name, color };
      });
      for (let left = 0; left < adapted.length; left += 1) {
        for (let right = left + 1; right < adapted.length; right += 1) {
          const distance = Math.hypot(...adapted[left]!.color.map((channel, index) => channel - adapted[right]!.color[index]!));
          assert.ok(distance > 11, `${paletteId} ${mode} ${adapted[left]!.name} and ${adapted[right]!.name} remain distinguishable`);
        }
      }
    }
  }
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
  assert.match(component, /promotedFront\.value = null;[\s\S]*archivedIds\.value/u, "an archive does not transfer a promoted tone to the revealed front");
  assert.match(component, /@archived="archiveFront"/u);
  assert.match(cardComponent, /emit\("archived", props\.session\.sessionId\)/u);
});

test("a stack with no active sessions renders no empty full-height cell", () => {
  assert.match(component, /<div v-else-if="activeSessions\.length > 1"[^>]*class="session-stack"/u);
  assert.doesNotMatch(component, /<div v-else[^>]*class="session-stack"/u);
});

test("a promotion survives its own click, restores outside, and preserves keyboard focus", () => {
  assert.match(component, /document\.addEventListener\("click", restoreDefault\)/u);
  assert.match(component, /event\.composedPath\(\)\.includes\(stack\)/u);
  assert.match(component, /promotedIds\.value = null;\s*promotedFront\.value = null;/u, "outside clicks restore the untoned default front");
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
