import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertProvingGroundItem,
  PROVING_GROUND_ITEM_SCHEMA_ID,
  ProvingGroundItemSchema,
  SEEDED_DEFECT_CLASSES,
  type BuildItem,
  type ProvingGroundItem,
  type ReviewItem,
} from "../../src/contracts/proving-ground.ts";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS } from "../../src/contracts/registry.ts";
import {
  LINE_WINDOW,
  parseRouteArm,
  RouteArmSpecInvalid,
  scoreReviewFindings,
  scoreRouteArms,
  type RouteArmReplay,
} from "../../src/metrics/route-arm-score.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");
const CORPUS = join(REPO, "core", "src", "metrics", "proving-ground");

const OPUS = "claude/anthropic/claude:opus@high";
const SONNET = "claude/anthropic/claude:sonnet@high";
const SOL = "pi/openai/gpt-6-sol@high";
const SHA = "a".repeat(40);

// ---------------------------------------------------------------------------
// The committed corpus.
// ---------------------------------------------------------------------------

function corpus(): ProvingGroundItem[] {
  return readdirSync(CORPUS).filter((name) => name.endsWith(".json")).sort().map((name) => {
    const value: unknown = JSON.parse(readFileSync(join(CORPUS, name), "utf8"));
    assertProvingGroundItem(value);
    assert.equal(`${value.id}.json`, name, "an item's file is named by its id");
    return value;
  });
}

/** Post-image line numbers of every added line, per file, read from a unified diff. */
function addedLines(patch: string): Map<string, number[]> {
  const added = new Map<string, number[]>();
  let file: string | null = null;
  let line = 0;
  for (const text of patch.split("\n")) {
    if (text.startsWith("+++ ")) {
      file = text.slice(4).replace(/^b\//, "");
      added.set(file, []);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk !== null) {
      line = Number(hunk[1]);
      continue;
    }
    if (file === null || text.startsWith("--- ") || text.startsWith("diff ") || text.startsWith("index ")) continue;
    if (text.startsWith("+")) {
      added.get(file)!.push(line);
      line += 1;
    } else if (text.startsWith(" ")) {
      line += 1;
    }
  }
  return added;
}

test("the item schema is registered as a record and never as a wire envelope", () => {
  assert.equal(RECORD_SCHEMAS[PROVING_GROUND_ITEM_SCHEMA_ID], ProvingGroundItemSchema);
  assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, PROVING_GROUND_ITEM_SCHEMA_ID), false);
});

test("the corpus holds five review items, one per planted-defect class, at one pinned base", () => {
  const items = corpus();
  assert.equal(items.length, 5);
  const reviews = items.filter((item): item is ReviewItem => item.kind === "review");
  assert.equal(reviews.length, 5);
  assert.deepEqual(reviews.map((item) => item.seed.defectClass).sort(), [...SEEDED_DEFECT_CLASSES].sort());
  for (const item of reviews) {
    assert.equal(item.role, "reviewer");
    assert.equal(item.taskClass, "evidence-heavy-defect-review");
    assert.match(item.baseSha, /^[0-9a-f]{40}$/);
    assert.equal(item.seed.patch, `core/src/metrics/proving-ground/${item.id}.patch`);
  }
  // One base for the whole suite, so every arm and item reads the same tree.
  assert.equal(new Set(reviews.map((item) => item.baseSha)).size, 1);
});

test("every expected range covers a line its patch adds, in a file its patch touches", () => {
  for (const item of corpus()) {
    if (item.kind !== "review") continue;
    const path = join(REPO, ...item.seed.patch.split("/"));
    assert.ok(existsSync(path), `${item.id}: ${item.seed.patch} exists`);
    const added = addedLines(readFileSync(path, "utf8"));
    for (const range of item.seed.expected) {
      const lines = added.get(range.file);
      assert.ok(lines !== undefined, `${item.id}: the patch touches ${range.file}`);
      assert.ok(lines.some((line) => line >= range.lineStart && line <= range.lineEnd),
        `${item.id}: ${range.file}:${range.lineStart}-${range.lineEnd} covers an added line`);
    }
  }
});

test("the item schema refuses a backwards range, a short sha and an unknown class, and admits a build item", () => {
  const [first] = corpus();
  assert.ok(first !== undefined && first.kind === "review");
  const backwards = { ...first, seed: { ...first.seed, expected: [{ file: "a.ts", lineStart: 9, lineEnd: 8 }] } };
  assert.throws(() => assertProvingGroundItem(backwards), /ends at line 8, before it starts at 9/);
  assert.throws(() => assertProvingGroundItem({ ...first, baseSha: "69711fd" }), /baseSha/);
  assert.throws(() => assertProvingGroundItem({ ...first, seed: { ...first.seed, defectClass: "typo" } }), /invalid/);
  const build: BuildItem = {
    schema: PROVING_GROUND_ITEM_SCHEMA_ID, id: "build-01", kind: "build", taskClass: "bounded-source-change",
    role: "builder", baseSha: SHA, request: "Add a flag.", gates: ["test", "typecheck"], acceptance: ["The flag is parsed."],
  };
  assertProvingGroundItem(build);
  assert.throws(() => assertProvingGroundItem({ ...build, seed: first.seed }), /invalid/);
});

// ---------------------------------------------------------------------------
// Synthetic suites.
// ---------------------------------------------------------------------------

function reviewItem(id: string, overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    schema: PROVING_GROUND_ITEM_SCHEMA_ID, id, kind: "review", taskClass: "evidence-heavy-defect-review", role: "reviewer",
    baseSha: SHA, request: "Review the change.",
    seed: { patch: `seeds/${id}.patch`, defectClass: "off-by-one", expected: [{ file: "src/page.ts", lineStart: 20, lineEnd: 22 }] },
    ...overrides,
  };
}

function buildItem(id: string): BuildItem {
  return {
    schema: PROVING_GROUND_ITEM_SCHEMA_ID, id, kind: "build", taskClass: "bounded-source-change", role: "builder",
    baseSha: SHA, request: "Build the change.", gates: ["test", "lint"], acceptance: ["It works."],
  };
}

function observedFor(arm: string): RouteArmReplay["observed"] {
  const parsed = parseRouteArm(arm);
  return { provider: parsed.provider, model: parsed.model };
}

function review(itemId: string, arm: string, repetition: number, order: number, lines: readonly (number | null)[], file = "src/page.ts"): RouteArmReplay {
  return {
    itemId, arm, repetition, order, observed: observedFor(arm), usageAuthority: "provider", envelopeValid: true, pausedAtCeiling: false,
    outcome: { kind: "review", findings: lines.map((line) => ({ file, line })) },
  };
}

test("an arm names adapter, provider, model and effort, and nothing is left to config", () => {
  assert.deepEqual({ ...parseRouteArm(OPUS) }, { spec: OPUS, adapter: "claude", provider: "anthropic", model: "claude:opus", effort: "high" });
  for (const spec of ["claude/anthropic/claude:opus", "claude//opus@high", "claude/opus@high", "claude/anthropic/opus@hot"]) {
    assert.throws(() => parseRouteArm(spec), RouteArmSpecInvalid, spec);
  }
});

test("a finding locates the defect within the expected range plus or minus three lines, and not one line further", () => {
  const expected = [{ file: "src/page.ts", lineStart: 20, lineEnd: 22 }];
  assert.equal(LINE_WINDOW, 3);
  for (const line of [17, 20, 22, 25]) assert.equal(scoreReviewFindings([{ file: "src/page.ts", line }], expected).located, true, `line ${line}`);
  for (const line of [16, 26]) {
    const score = scoreReviewFindings([{ file: "src/page.ts", line }], expected);
    assert.equal(score.located, false, `line ${line}`);
    assert.equal(score.falseAlarms, 1, `line ${line} is a false alarm`);
  }
  assert.equal(scoreReviewFindings([{ file: "src/other.ts", line: 21 }], expected).located, false, "the file must be equal");
});

test("a whole-file finding on the defect's file is file-only, apart from recall and from false alarms", () => {
  const expected = [{ file: "src/page.ts", lineStart: 20, lineEnd: 22 }];
  assert.deepEqual({ ...scoreReviewFindings([{ file: "src/page.ts", line: null }], expected) }, { located: false, fileOnly: true, falseAlarms: 0 });
  assert.deepEqual({ ...scoreReviewFindings([{ file: "src/page.ts", line: null }, { file: "src/page.ts", line: 21 }], expected) },
    { located: true, fileOnly: false, falseAlarms: 0 });
  assert.deepEqual({ ...scoreReviewFindings([{ file: "src/other.ts", line: null }], expected) }, { located: false, fileOnly: false, falseAlarms: 1 });
  assert.deepEqual({ ...scoreReviewFindings([], expected) }, { located: false, fileOnly: false, falseAlarms: 0 });
});

test("per arm: recall with its interval, file-only and false alarms over valid pairs", () => {
  const items = [reviewItem("r1"), reviewItem("r2")];
  const score = scoreRouteArms({ arms: [OPUS, SOL], repetitions: 2, items }, [
    review("r1", OPUS, 1, 1, [21]), review("r1", SOL, 1, 2, [null]),
    review("r1", OPUS, 2, 2, [21, 90]), review("r1", SOL, 2, 1, [19]),
    review("r2", OPUS, 1, 2, []), review("r2", SOL, 1, 1, [23, 4]),
    review("r2", OPUS, 2, 1, [22]), review("r2", SOL, 2, 2, [40]),
  ]);
  assert.equal(score.complete, true);
  assert.equal(score.byScope.length, 1);
  const [opus, sol] = score.byScope[0]!.arms;
  assert.equal(opus!.arm, OPUS);
  assert.deepEqual({ replays: opus!.review.replays, located: opus!.review.located, fileOnly: opus!.review.fileOnly, falseAlarms: opus!.review.falseAlarms },
    { replays: 4, located: 3, fileOnly: 0, falseAlarms: 1 });
  assert.equal(opus!.review.recall.p, 0.75);
  assert.ok(opus!.review.recall.lo > 0 && opus!.review.recall.hi < 1);
  assert.deepEqual({ located: sol!.review.located, fileOnly: sol!.review.fileOnly, falseAlarms: sol!.review.falseAlarms },
    { located: 2, fileOnly: 1, falseAlarms: 2 });
  assert.deepEqual(score.byItem.map((item) => item.arms.map((arm) => arm.review.located)), [[2, 1], [1, 1]]);
});

test("each repetition records its randomized order, and a non-permutation invalidates the pair", () => {
  const items = [reviewItem("r1")];
  const ordered = scoreRouteArms({ arms: [OPUS, SONNET, SOL], repetitions: 2, items }, [
    review("r1", OPUS, 1, 3, [21]), review("r1", SONNET, 1, 1, [21]), review("r1", SOL, 1, 2, [21]),
    review("r1", OPUS, 2, 1, [21]), review("r1", SONNET, 2, 2, [21]), review("r1", SOL, 2, 3, [21]),
  ]);
  assert.deepEqual(ordered.pairs.map((pair) => pair.order), [[SONNET, SOL, OPUS], [OPUS, SONNET, SOL]]);

  const clashing = scoreRouteArms({ arms: [OPUS, SOL], repetitions: 1, items }, [
    review("r1", OPUS, 1, 1, [21]), review("r1", SOL, 1, 1, [21]),
  ]);
  const [pair] = clashing.pairs;
  assert.equal(pair!.valid, false);
  assert.equal(pair!.order, null);
  assert.deepEqual(pair!.reasons.map((reason) => [reason.reason, reason.arm]), [["order-invalid", null]]);
});

test("every invalidation is named with its arm, and an invalid replay removes the pair from every arm's score", () => {
  const cases: readonly [string, Partial<RouteArmReplay>][] = [
    ["provider-mismatch", { observed: { provider: "openai", model: "claude:opus" } }],
    ["model-mismatch", { observed: { provider: "anthropic", model: "sonnet" } }],
    ["usage-authority-none", { usageAuthority: "none" }],
    ["envelope-invalid", { envelopeValid: false, outcome: null }],
    ["paused-at-ceiling", { pausedAtCeiling: true, outcome: null }],
    ["outcome-missing", { outcome: null }],
  ];
  for (const [reason, override] of cases) {
    const score = scoreRouteArms({ arms: [OPUS, SOL], repetitions: 1, items: [reviewItem("r1")] }, [
      { ...review("r1", OPUS, 1, 1, [21]), ...override }, review("r1", SOL, 1, 2, [21]),
    ]);
    const [pair] = score.pairs;
    assert.equal(pair!.valid, false, reason);
    assert.deepEqual(pair!.reasons.map((entry) => [entry.reason, entry.arm]), [[reason, OPUS]], reason);
    assert.equal(score.complete, false);
    const [opus, sol] = score.byScope[0]!.arms;
    assert.equal(opus!.invalidPairs, 1, reason);
    assert.equal(sol!.invalidPairs, 0, `${reason} is not charged to the arm that ran cleanly`);
    assert.equal(sol!.review.replays, 0, `${reason}: the clean arm is not scored on an unpaired replay`);
  }
});

test("a partial usage authority and the adapter-prefixed model spelling both still count", () => {
  const score = scoreRouteArms({ arms: [OPUS, SOL], repetitions: 1, items: [reviewItem("r1")] }, [
    { ...review("r1", OPUS, 1, 1, [21]), usageAuthority: "partial", observed: { provider: "anthropic", model: "opus" } },
    review("r1", SOL, 1, 2, [21]),
  ]);
  assert.equal(score.complete, true);
});

test("a missing or duplicated replay is named, and replays outside the protocol are stray", () => {
  const score = scoreRouteArms({ arms: [OPUS, SOL], repetitions: 1, items: [reviewItem("r1"), reviewItem("r2")] }, [
    review("r1", OPUS, 1, 1, [21]), review("r1", OPUS, 1, 2, [21]),
    review("r2", OPUS, 1, 1, [21]),
    review("r2", SOL, 2, 1, [21]), review("r9", SOL, 1, 1, [21]), review("r2", SONNET, 1, 2, [21]),
  ]);
  assert.deepEqual(score.pairs.map((pair) => pair.reasons.map((reason) => [reason.reason, reason.arm])), [
    [["replay-duplicated", OPUS], ["replay-missing", SOL]],
    [["replay-missing", SOL]],
  ]);
  assert.deepEqual(score.stray.map((replay) => [replay.itemId, replay.arm, replay.repetition]),
    [["r2", SOL, 2], ["r9", SOL, 1], ["r2", SONNET, 1]]);
  assert.equal(score.complete, false);
});

test("build items score first pass on every one of their gates", () => {
  const items = [buildItem("b1")];
  const build = (arm: string, order: number, gates: Record<string, boolean>): RouteArmReplay => ({
    itemId: "b1", arm, repetition: 1, order, observed: observedFor(arm), usageAuthority: "provider", envelopeValid: true,
    pausedAtCeiling: false, outcome: { kind: "build", firstRoundGates: gates },
  });
  const score = scoreRouteArms({ arms: [OPUS, SOL], repetitions: 1, items }, [
    build(OPUS, 1, { test: true, lint: true, typecheck: false }), build(SOL, 2, { test: true, lint: false }),
  ]);
  const [opus, sol] = score.byScope[0]!.arms;
  assert.deepEqual([opus!.build.firstPass, opus!.build.replays, sol!.build.firstPass, sol!.build.replays], [1, 1, 0, 1]);
  assert.equal(opus!.review.replays, 0);

  const missing = scoreRouteArms({ arms: [OPUS, SOL], repetitions: 1, items }, [
    build(OPUS, 1, { test: true }), build(SOL, 2, { test: true, lint: true }),
  ]);
  assert.deepEqual(missing.pairs[0]!.reasons.map((reason) => [reason.reason, reason.arm]), [["outcome-missing", OPUS]]);
});

test("scores are kept within a role and a task class, never pooled across them", () => {
  const items = [reviewItem("r1"), reviewItem("r2", { taskClass: "contract-envelope-change" }), buildItem("b1")];
  const score = scoreRouteArms({ arms: [OPUS, SOL], repetitions: 1, items }, []);
  assert.deepEqual(score.byScope.map((scope) => [scope.role, scope.taskClass, scope.items]), [
    ["reviewer", "evidence-heavy-defect-review", ["r1"]],
    ["reviewer", "contract-envelope-change", ["r2"]],
    ["builder", "bounded-source-change", ["b1"]],
  ]);
  assert.deepEqual(score.byScope.map((scope) => scope.invalidPairs), [1, 1, 1]);
});

test("the protocol needs two or more distinct arms and a positive repetition count", () => {
  const items = [reviewItem("r1")];
  assert.throws(() => scoreRouteArms({ arms: [OPUS], repetitions: 1, items }, []), /two or more arms/);
  assert.throws(() => scoreRouteArms({ arms: [OPUS, "claude/anthropic/opus@high"], repetitions: 1, items }, []), /distinct routes/);
  assert.throws(() => scoreRouteArms({ arms: [OPUS, SOL], repetitions: 0, items }, []), /positive integer/);
  assert.throws(() => scoreRouteArms({ arms: [OPUS, SOL], repetitions: 1, items: [...items, ...items] }, []), /distinct/);
  assert.throws(() => scoreRouteArms({ arms: [OPUS, "opus"], repetitions: 1, items }, []), RouteArmSpecInvalid);
});
