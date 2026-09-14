import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GroupTree, TreeProposal } from "../../../dashboard/shared/types.ts";
import { askLine, decisionSlides, elsewhere } from "../../../dashboard/src/canvas-session.ts";
import { MAX_SHIFT, wheelShift, wheelSlots } from "../../../dashboard/src/canvas-wheel.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

/**
 * The source with its comments removed. These files explain in prose exactly
 * what they leave out, so a scan that reads the comments finds the very words
 * it is checking are absent and fails on the explanation.
 */
function code(path: string): string {
  return source(path).replace(/<!--[\s\S]*?-->/gu, "").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

const counts = { stages: 76, inputs: 31, proposals: 26, applied: 20, notTaken: 6, alternatives: 91, unitRecords: 29, units: 12 };

function narrative(title: string) {
  return { title, explanation: "read as", changes: "", reason: "", friction: "what hurt", tasks: [] as string[], references: [] };
}

function proposal(id: string, ask: string | null): TreeProposal {
  return {
    id, base: 1, proposedStageId: `s-${id}`, proposedAt: "2026-09-06T20:00:00.000Z",
    narrative: narrative(`decision ${id}`), alternatives: [], changes: [], status: "applied",
    appliable: false, decisionStageId: `d-${id}`, decidedAt: "2026-09-06T20:30:00.000Z",
    ownerReason: `because ${id}`, ask, tasks: [],
  };
}

function tree(patch: Partial<GroupTree> = {}): GroupTree {
  return {
    schema: "awsf/decision-tree/v1", group: "marimba-task-3-5", project: "p", revision: 78, head: "",
    closed: false, title: null, asks: [], spine: [], notTaken: [], units: [], byTask: {}, counts, ...patch,
  } as GroupTree;
}

const ask = (id: string, text: string) => ({
  stageId: `st-${id}`, at: "2026-09-06T19:00:00.000Z", inputId: id, text,
  provenance: "owner terminal", sha256: "0".repeat(64), narrative: narrative(`capture ${id}`),
});

test("the wheel walks the decisions that were taken, each with the ask behind it", () => {
  const slides = decisionSlides(tree({
    asks: [ask("a1", "the first ask\nsecond line"), ask("a2", "the second ask")],
    spine: [proposal("p1", "a1"), proposal("p2", "a2")],
    notTaken: [proposal("p9", "a1")],
  }));
  assert.deepEqual(slides.map((slide) => slide.key), ["p1", "p2"]);
  assert.equal(slides[0]?.ask, "the first ask\nsecond line");
  // A proposal nobody took is a branch off the sequence, not a step in it.
  // Putting it in the wheel would claim something was decided that never was.
  assert.equal(slides.some((slide) => slide.key === "p9"), false);
});

test("a decision with no recorded ask says so rather than borrowing one", () => {
  const slides = decisionSlides(tree({ spine: [proposal("p1", null), proposal("p2", "missing")] }));
  assert.equal(slides[0]?.ask, null);
  assert.equal(slides[1]?.ask, null, "an ask id the journal does not hold is not invented");
  assert.equal(askLine(null), null);
  assert.deepEqual(decisionSlides(null), []);
});

test("the pinned ask is one bounded line, and its own first line", () => {
  assert.equal(askLine("\n\n  the real first line  \nand more"), "the real first line");
  const long = "x".repeat(400);
  const line = askLine(long, 150);
  assert.equal(line?.length, 150);
  assert.ok(line?.endsWith("…"));
});

test("the wheel says what it is not showing, so it does not look like the whole record", () => {
  assert.equal(elsewhere(tree()), "6 proposed and not taken · 31 asks · 12 units — on the reading and the tree");
  assert.equal(
    elsewhere(tree({ counts: { ...counts, notTaken: 0, inputs: 0, units: 0 } })),
    null,
    "nothing elsewhere means no line at all, not an empty one",
  );
  assert.equal(elsewhere(null), null);
});

test("the wheel leans at its ends but never far enough to lose the middle card", () => {
  // Centring the drawn set exactly means sliding a whole slot at either end,
  // and a seat wide enough for a decision slide then walks off the stage.
  assert.equal(wheelShift(20, 0), MAX_SHIFT * -1);
  assert.equal(wheelShift(20, 19), MAX_SHIFT);
  assert.equal(wheelShift(20, 8), 0, "in the middle it is centred already");
  assert.ok(Math.abs(wheelShift(2, 0)) <= MAX_SHIFT);
  assert.equal(wheelShift(0, 0), 0);
  // And the window never draws a neighbour that does not exist.
  assert.deepEqual(wheelSlots(2, 0).map((slot) => slot.index).sort(), [0, 1]);
  assert.deepEqual(wheelSlots(1, 0).map((slot) => slot.offset), [0]);
});

test("a driving session opens on one three-position control, reusing both readings", () => {
  const route = source("dashboard/src/routes/canvas.vue");
  // One control with three positions, not two switches whose four states
  // include two that describe nothing.
  assert.match(route, /const view = ref<"slides" \| "reading" \| "tree">\("slides"\)/u);
  assert.match(route, /v-for="mode in \(\['slides', 'reading', 'tree'\] as const\)"/u);
  // The other two are the components that already exist: a third rendering of
  // one journal would be a third thing to keep true.
  assert.match(route, /<GroupDecisionTree v-else-if="view === 'reading'" :tree="tree" \/>/u);
  assert.match(route, /<GroupTreeGraph v-else :tree="tree" \/>/u);
  // The ask is pinned above the wheel and changes as it turns.
  assert.match(route, /class="canvas-ask"/u);
  assert.match(route, /askLine\(slide\?\.ask \?\? null\)/u);
  // A journal that cannot be read says so; it is never drawn as an empty one.
  assert.match(route, /No planning journal exists for this driving session\./u);
});

test("a slide is the reading's boxes seen differently, not a second design language", () => {
  const slide = source("dashboard/src/components/CanvasDecisionSlide.vue");
  for (const shared of ["decision-reason", "decision-fields", "decision-field", "decision-rows", "decision-row"]) {
    assert.ok(slide.includes(shared), shared);
  }
  // It drops "from the ask", because the ask is pinned above the wheel and
  // repeating it on every slide says the same thing twice on a card with no room.
  assert.doesNotMatch(code("dashboard/src/components/CanvasDecisionSlide.vue"), /from the ask/u);
  // What it cannot fit, it names rather than silently truncating.
  assert.match(slide, /more, on the reading/u);
});
