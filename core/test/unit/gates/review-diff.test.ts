import { test } from "node:test";
import assert from "node:assert/strict";
import { boundReviewDiff, diffRemovesLines, type DiffFileSection } from "../../../src/gates/review-diff.ts";

// The rules this file exists to hold: whole hunks only, deletions before
// additions, and every entirely-omitted file named. A bounding pass that
// quietly emits half a hunk is worse than one that omits it, because half a
// hunk looks complete.

function hunk(marker: string, lines: readonly string[]): string {
  return `@@ ${marker} @@\n${lines.join("\n")}\n`;
}

function section(path: string, hunks: readonly string[]): DiffFileSection {
  return {
    path,
    text: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunks.join("")}`,
  };
}

/** Every `@@` line the bounded output emitted, so hunk identity is checkable. */
function hunkHeaders(diff: string): string[] {
  return diff.split("\n").filter((line) => line.startsWith("@@ "));
}

test("a diff inside the budget is emitted whole and claims no omission", () => {
  const sections = [section("a.ts", [hunk("-1,1 +1,2", [" keep", "+added"])])];
  const bounded = boundReviewDiff(sections, 10_000);
  assert.equal(bounded.diff, sections[0]!.text);
  assert.equal(bounded.truncated, false);
  assert.equal(bounded.omittedChars, 0);
  assert.deepEqual(bounded.omittedFiles, []);
});

test("no partial hunk is ever emitted, however tight the budget", () => {
  const big = hunk("-1,40 +1,40", Array.from({ length: 40 }, (_, index) => `+line ${String(index)}`));
  const small = hunk("-90,1 +90,2", [" context", "+one"]);
  const sections = [section("a.ts", [big, small]), section("b.ts", [big])];
  const whole = sections.map((one) => one.text).join("");

  for (let budget = 40; budget < whole.length; budget += 37) {
    const bounded = boundReviewDiff(sections, budget);
    assert.ok(bounded.diff.length <= budget, `budget ${String(budget)} exceeded: ${String(bounded.diff.length)}`);
    // Every emitted hunk is byte-identical to one of the originals: a truncated
    // hunk would fail this even though it would still contain a `@@` line.
    for (const header of hunkHeaders(bounded.diff)) {
      const emitted = bounded.diff.slice(bounded.diff.indexOf(header));
      const next = emitted.slice(header.length).search(/\n@@ |\n\*\*\* awsf:|\ndiff --git /);
      const body = next === -1 ? emitted : emitted.slice(0, header.length + next + 1);
      assert.ok(
        [big, small].some((original) => original.trimEnd() === body.trimEnd()),
        `budget ${String(budget)} emitted a hunk that is not one of the originals:\n${body}`,
      );
    }
  }
});

test("deletions are kept before additions when only one hunk fits", () => {
  const additions = hunk("-1,0 +1,20", Array.from({ length: 20 }, (_, index) => `+added ${String(index)}`));
  const removals = hunk("-90,20 +110,0", Array.from({ length: 20 }, (_, index) => `-removed ${String(index)}`));
  // Additions come FIRST in the file, so a naive "keep what fits in order"
  // pass would keep them and drop the removals — which is the one direction
  // this rule forbids, because removal is where the defects hide.
  const sections = [section("a.ts", [additions, removals])];
  const oneHunk = section("a.ts", [removals]).text.length + 60;
  assert.ok(oneHunk < sections[0]!.text.length, "the budget must genuinely force a choice");
  const bounded = boundReviewDiff(sections, oneHunk);

  assert.equal(bounded.truncated, true);
  assert.deepEqual(hunkHeaders(bounded.diff), hunkHeaders(removals));
  assert.ok(diffRemovesLines(bounded.diff), "the surviving hunk removes lines");
  assert.match(bounded.diff, /\*\*\* awsf: 1 of 2 hunk\(s\) omitted from a\.ts/);
  assert.deepEqual(bounded.omittedFiles, [], "the file itself survived, so it is not an omitted file");
});

test("an addition is never shown in the place of a deletion that would not fit", () => {
  // The awkward budget: the small addition-only hunk fits and the large
  // deletion-bearing one does not. Showing the addition alone would tell the
  // reviewer this candidate only added things, which is the exact false picture
  // the deletion rule exists to prevent — so the file is omitted and named.
  const additions = hunk("-1,0 +1,4", ["+a", "+b", "+c", "+d"]);
  const removals = hunk("-90,40 +94,0", Array.from({ length: 40 }, (_, index) => `-removed line number ${String(index)}`));
  const sections = [section("a.ts", [additions, removals])];
  const bounded = boundReviewDiff(sections, section("a.ts", [additions]).text.length + 60);

  assert.deepEqual(hunkHeaders(bounded.diff), []);
  assert.deepEqual(bounded.omittedFiles, ["a.ts"]);
  assert.equal(bounded.truncated, true);
});

test("a file that fits nowhere is named, not silently dropped", () => {
  const wide = hunk("-1,60 +1,60", Array.from({ length: 60 }, (_, index) => `+wide line ${String(index)}`));
  const sections = [section("kept.ts", [hunk("-1,1 +1,2", [" k", "+k"])]), section("dropped.ts", [wide])];
  const bounded = boundReviewDiff(sections, sections[0]!.text.length + 10);

  assert.equal(bounded.truncated, true);
  assert.deepEqual(bounded.omittedFiles, ["dropped.ts"]);
  assert.equal(bounded.diff.includes("dropped.ts"), false, "an omitted file contributes no content");
  assert.ok(bounded.omittedChars >= wide.length, "the omitted characters account for the whole file");
});

test("a deletion-only candidate still shows what it removed", () => {
  const removal = hunk("-1,3 +0,0", ["-alpha", "-beta", "-gamma"]);
  const sections: DiffFileSection[] = [{
    path: "gone.ts",
    text: `diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n${removal}`,
  }];
  const bounded = boundReviewDiff(sections, 10_000);
  assert.ok(diffRemovesLines(bounded.diff));
  assert.equal(bounded.truncated, false);
  assert.deepEqual(bounded.omittedFiles, []);
});

test("`---` and `+++` file headers are not mistaken for removed and added lines", () => {
  // The naive test for a deletion is a line starting with `-`, which every
  // unified diff's own `--- a/path` header satisfies. A file with only
  // additions would then claim to remove lines.
  const additionsOnly = section("new.ts", [hunk("-0,0 +1,2", ["+alpha", "+beta"])]);
  assert.equal(diffRemovesLines(additionsOnly.text), false);
  assert.equal(diffRemovesLines(`${additionsOnly.text}-real removal\n`), true);
});

test("an empty change-set produces an empty diff rather than an invented one", () => {
  const bounded = boundReviewDiff([], 10_000);
  assert.equal(bounded.diff, "");
  assert.equal(bounded.truncated, false);
  assert.deepEqual(bounded.omittedFiles, []);
});

test("a binary or mode-only section has no hunks and is kept or named whole", () => {
  const binary: DiffFileSection = {
    path: "logo.png",
    text: "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n",
  };
  const text = section("a.ts", [hunk("-1,1 +1,2", [" k", "+k"])]);

  assert.equal(boundReviewDiff([binary, text], 10_000).diff.includes("Binary files"), true);
  const tight = boundReviewDiff([text, binary], text.text.length + 4);
  assert.deepEqual(tight.omittedFiles, ["logo.png"]);
});
