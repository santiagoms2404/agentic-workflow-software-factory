import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import {
  ENVELOPE_SCHEMAS,
  REVIEW_CONTEXT_DIFF_MAX_CHARS,
  REVIEW_CONTEXT_STAT_MAX_CHARS,
  type ReviewContext,
} from "../../../src/contracts/index.ts";
import {
  reviewEvidenceFitness,
  reviewEvidencePresent,
  type ReviewEvidenceExpectation,
} from "../../../src/gates/review.ts";
import { validReviewContext } from "../contracts/fixtures.ts";

// The defect this gate exists for: a review with no evidence used to pass every
// gate it had, because `verdict_consistent`'s four checks are all vacuous for an
// empty findings array and findings were empty because nothing was inspectable.
// Two matching fields do not close that. These tests are the negatives that say
// so — each one is a context that is VALID and still could not be, or was not,
// evidence.

const SHA_CANDIDATE = "a".repeat(40);
const SHA_BASE = "b".repeat(40);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const FULL_DIFF = [
  "diff --git a/core/src/contracts/index.ts b/core/src/contracts/index.ts",
  "--- a/core/src/contracts/index.ts",
  "+++ b/core/src/contracts/index.ts",
  "@@ -1,2 +1,3 @@",
  ' export * from "./typebox.ts";',
  '-export * from "./old.ts";',
  '+export * from "./envelope-base.ts";',
  '+export * from "./registry.ts";',
  "",
].join("\n");

function context(patch: Partial<ReviewContext> = {}): ReviewContext {
  return { ...validReviewContext(), diff: FULL_DIFF, diffSha256: sha256(FULL_DIFF), ...patch };
}

function expectation(patch: Partial<ReviewEvidenceExpectation> = {}): ReviewEvidenceExpectation {
  return {
    baseSha: SHA_BASE,
    candidateSha: SHA_CANDIDATE,
    changedFiles: ["core/src/contracts/index.ts"],
    fullDiffSha256: sha256(FULL_DIFF),
    fullDiffRemovesLines: true,
    ...patch,
  };
}

/** The compiler's own substitution, so "in the prompt" means the same thing here as there. */
function promptCarrying(value: ReviewContext): string {
  return `Host evidence:\n${JSON.stringify(value, null, 2)}\n\nReturn only an envelope.`;
}

function failedItems(report: { checks: readonly { item: string; ok: boolean }[] }): string[] {
  return report.checks.filter((check) => !check.ok).map((check) => check.item);
}

test("fitness passes for evidence a review could actually be made from", () => {
  const report = reviewEvidenceFitness(context(), expectation());
  assert.deepEqual(failedItems(report), []);
  assert.equal(report.passed, true);
  assert.ok(report.checks.length >= 8, "a passing gate still states what it verified");
});

test("an empty diff with a non-empty changed-file list is refused before any call", () => {
  // The exact shape revision 1's two-field check waved through: right SHA,
  // right filenames, nothing to read.
  const empty = context({ diff: "" });
  assert.equal(Value.Check(ENVELOPE_SCHEMAS["awsf.review-context/v1"], empty), true, "it is a VALID envelope");
  const report = reviewEvidenceFitness(empty, expectation());
  assert.equal(report.passed, false);
  assert.ok(failedItems(report).includes("a changed candidate carries at least one hunk"));
});

test("a diff whose hunks were all omitted is refused", () => {
  const allOmitted = context({
    diff: "*** awsf: 1 of 1 hunk(s) omitted from core/src/contracts/index.ts\n",
    diffTruncated: true,
    diffOmittedChars: FULL_DIFF.length,
  });
  const report = reviewEvidenceFitness(allOmitted, expectation());
  assert.equal(report.passed, false);
  assert.ok(failedItems(report).includes("a changed candidate carries at least one hunk"));
});

test("a bounded diff that dropped every deletion is refused", () => {
  const additionsOnly = context({
    diff: [
      "diff --git a/core/src/contracts/index.ts b/core/src/contracts/index.ts",
      "--- a/core/src/contracts/index.ts",
      "+++ b/core/src/contracts/index.ts",
      "@@ -1,2 +1,3 @@",
      '+export * from "./registry.ts";',
      "",
    ].join("\n"),
    diffTruncated: true,
  });
  const report = reviewEvidenceFitness(additionsOnly, expectation({ fullDiffRemovesLines: true }));
  assert.equal(report.passed, false);
  assert.deepEqual(failedItems(report), ["deletions survived bounding"]);
});

test("a deletion-only candidate is fit, and its removals are the evidence", () => {
  const deletionDiff = [
    "diff --git a/gone.ts b/gone.ts",
    "deleted file mode 100644",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-alpha",
    "-beta",
    "",
  ].join("\n");
  const report = reviewEvidenceFitness(
    context({ changedFiles: ["gone.ts"], diff: deletionDiff, diffSha256: sha256(deletionDiff), insertions: 0, deletions: 2 }),
    expectation({ changedFiles: ["gone.ts"], fullDiffSha256: sha256(deletionDiff) }),
  );
  assert.deepEqual(failedItems(report), []);
});

test("a changed-file list that does not match git is refused, in both directions", () => {
  const missing = reviewEvidenceFitness(context({ changedFiles: [] }), expectation());
  assert.ok(failedItems(missing).includes("changed files are the host-observed set"));

  const extra = reviewEvidenceFitness(
    context({ changedFiles: ["core/src/contracts/index.ts", "README.md"] }),
    expectation(),
  );
  assert.ok(failedItems(extra).includes("changed files are the host-observed set"));
});

test("a digest that does not match the full diff on disk is refused", () => {
  // The digest is the only thing tying a bounded rendering to the diff it is a
  // rendering OF, so a digest of something else is not a smaller claim, it is a
  // different one.
  const report = reviewEvidenceFitness(context({ diffSha256: sha256("some other diff") }), expectation());
  assert.equal(report.passed, false);
  assert.deepEqual(failedItems(report), ["diff digest matches the full diff on disk"]);
});

test("a context missing the request or the acceptance criteria is refused", () => {
  // Without these the reviewer can judge code quality and cannot judge whether
  // this is the change that was asked for — the only thing a T2 review is
  // mandatory for. A blank request is rejected by the contract itself; an empty
  // criteria list is valid and is refused here.
  assert.equal(Value.Check(ENVELOPE_SCHEMAS["awsf.review-context/v1"], context({ request: "" })), false);

  const report = reviewEvidenceFitness(context({ acceptanceCriteria: [] }), expectation());
  assert.equal(report.passed, false);
  assert.deepEqual(failedItems(report), ["acceptance criteria are recorded"]);
});

test("gate evidence that lost its output tail is not a valid context at all", () => {
  const { outputTail: _tail, ...withoutTail } = validReviewContext().testOutput;
  const curated = { ...context(), testOutput: withoutTail };
  assert.equal(Value.Check(ENVELOPE_SCHEMAS["awsf.review-context/v1"], curated), false);
});

test("gate evidence measured against another tree is refused", () => {
  const stale = context({ testOutput: { ...validReviewContext().testOutput, candidateSha: "c".repeat(40) } });
  const report = reviewEvidenceFitness(stale, expectation());
  assert.equal(report.passed, false);
  assert.deepEqual(failedItems(report), ["gate evidence is of this candidate and passed"]);
});

test("evidence bound to a different candidate or base is refused", () => {
  assert.ok(failedItems(reviewEvidenceFitness(context({ candidateSha: "c".repeat(40) }), expectation()))
    .includes("candidate SHA exact"));
  assert.ok(failedItems(reviewEvidenceFitness(context({ baseSha: "d".repeat(40) }), expectation()))
    .includes("base SHA exact"));
});

test("the gate passes when the composed context was serialized into the prompt", () => {
  const composed = context();
  const report = reviewEvidencePresent({
    ...expectation(),
    context: composed,
    compiledPrompt: promptCarrying(composed),
    digest: sha256,
  });
  assert.deepEqual(failedItems(report), []);
  assert.equal(report.passed, true);
});

test("a valid context that was composed but never rendered fails the gate", () => {
  // The half two matching fields could never prove. Everything about this
  // context is correct; the model simply never saw it.
  const composed = context();
  const report = reviewEvidencePresent({
    ...expectation(),
    context: composed,
    compiledPrompt: "Host evidence:\nnull\n\nReturn only an envelope.",
    digest: sha256,
  });
  assert.equal(report.passed, false);
  assert.deepEqual(failedItems(report), ["the composed context was serialized into the compiled prompt"]);
});

test("a prompt carrying a DIFFERENT context fails the gate", () => {
  const composed = context();
  const other = context({ diff: `${FULL_DIFF}+one more line\n` });
  const report = reviewEvidencePresent({
    ...expectation(),
    context: composed,
    compiledPrompt: promptCarrying(other),
    digest: sha256,
  });
  assert.equal(report.passed, false);
  assert.ok(failedItems(report).includes("the composed context was serialized into the compiled prompt"));
});

test("a review phase that ran with no context at all fails the gate", () => {
  const report = reviewEvidencePresent({
    ...expectation(),
    context: null,
    compiledPrompt: "Review the exact candidate.",
    digest: sha256,
  });
  assert.equal(report.passed, false);
  assert.deepEqual(failedItems(report), ["review context composed"]);
});

test("every bounded field is bounded by the contract, not only by the composer", () => {
  // The envelope has one wire limit and the diff is not the only field that can
  // grow with the candidate. A composer that forgot to trim would produce an
  // invalid envelope rather than an oversized valid one.
  const schema = ENVELOPE_SCHEMAS["awsf.review-context/v1"];
  const base = context();
  assert.equal(Value.Check(schema, { ...base, diff: "x".repeat(REVIEW_CONTEXT_DIFF_MAX_CHARS + 1) }), false);
  assert.equal(Value.Check(schema, { ...base, stat: "x".repeat(REVIEW_CONTEXT_STAT_MAX_CHARS + 1) }), false);
  assert.equal(Value.Check(schema, { ...base, stat: "x".repeat(REVIEW_CONTEXT_STAT_MAX_CHARS) }), true);
});

test("the gate re-checks identity against git, not against the context alone", () => {
  const composed = context();
  const drifted = reviewEvidencePresent({
    ...expectation({ candidateSha: "e".repeat(40) }),
    context: composed,
    compiledPrompt: promptCarrying(composed),
    digest: sha256,
  });
  assert.ok(failedItems(drifted).includes("candidate SHA exact"));

  const renamed = reviewEvidencePresent({
    ...expectation({ changedFiles: ["README.md"] }),
    context: composed,
    compiledPrompt: promptCarrying(composed),
    digest: sha256,
  });
  assert.ok(failedItems(renamed).includes("changed files are the host-observed set"));
});
