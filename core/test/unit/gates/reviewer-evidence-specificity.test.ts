import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReviewContext } from "../../../src/contracts/review-context.ts";
import type { ReviewFinding, ReviewOutput } from "../../../src/contracts/review-output.ts";
import {
  reviewEnvelopeComplete,
  reviewFindingSpecificity,
  verdictConsistent,
} from "../../../src/gates/review.ts";
import { validReviewContext, validReviewOutput } from "../contracts/fixtures.ts";

const SHA = "a".repeat(40);
const PATH = "core/src/contracts/index.ts";
const OMITTED = "core/src/contracts/registry.ts";
const OMITTED_PROMPT_TEST = "core/test/unit/workflow/prompt-composition.test.ts";

function finding(patch: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "F-specific",
    severity: "high",
    file: PATH,
    line: 42,
    title: "Outermost-object scan accepts a trailing brace",
    detail: "A trailing prose brace would widen the JSON slice and fail strict parsing.",
    consequence: "a final message ending in prose braces widens the slice and fails strict parsing",
    evidence: "`scanObject` calls `lastIndexOf('}')` after locating the first opening brace.",
    ...patch,
  };
}

function output(patch: Partial<ReviewOutput> = {}): ReviewOutput {
  return {
    ...validReviewOutput(),
    verdict: "concern",
    reviewedSha: SHA,
    findings: [finding()],
    limitations: [],
    ...patch,
  };
}

function context(patch: Partial<ReviewContext> = {}): ReviewContext {
  return { ...validReviewContext(), changedFiles: [PATH], ...patch };
}

function report(review: ReviewOutput, candidate: ReviewContext = context()) {
  return verdictConsistent(review, {
    candidateSha: SHA,
    candidatePaths: candidate.changedFiles,
    reviewContext: candidate,
  });
}

function failedItems(review: ReviewOutput, candidate: ReviewContext = context()): readonly string[] {
  return report(review, candidate).checks.filter((check) => !check.ok).map((check) => check.item);
}

function incompleteItems(review: ReviewOutput): readonly string[] {
  return reviewEnvelopeComplete(review).checks.filter((check) => !check.ok).map((check) => check.item);
}

test("a detailed concern earns all four specificity points and passes", () => {
  const review = output();
  const score = reviewFindingSpecificity(review.findings[0]!, new Set([PATH]));
  assert.deepEqual(score, {
    candidateFile: true,
    lineOrFileWideScope: true,
    observedMechanismOrCondition: true,
    concreteConsequence: true,
    score: 4,
  });
  assert.equal(report(review).passed, true);
  assert.equal(reviewEnvelopeComplete(review).passed, true);
});

test("one-word evidence is vague even when the rest of the finding sounds decisive", () => {
  const review = output({ findings: [finding({ evidence: "Observed" })] });
  const score = reviewFindingSpecificity(review.findings[0]!, new Set([PATH]));
  assert.equal(score.observedMechanismOrCondition, false);
  assert.equal(score.score, 3);
  assert.equal(report(review).passed, true, "finding completeness is not verdict content");
  assert.deepEqual(incompleteItems(review), ["findings state an observed mechanism or condition"]);
});

test("a finding without a concrete consequence cannot borrow specificity from detailed evidence", () => {
  const review = output({ findings: [finding({
    title: "Parser branch condition",
    detail: "The branch is present in this function.",
    consequence: "   ",
  })] });
  assert.equal(report(review).passed, true, "the verdict remains internally consistent");
  assert.deepEqual(incompleteItems(review), ["findings state a concrete consequence"]);
});

// ---------------------------------------------------------------------------
// The consequence is read from its own contract field, never from the prose of
// `title` or `detail`. Two regexes stood here before and were wrong in both
// directions at once. These four cases are the measured evidence: the first two
// are real findings whose consequence is an ordinary declarative sentence and
// which the regex rejected; the third is a mechanism-only observation with no
// outcome at all, which the regex accepted on the word `with`.
// ---------------------------------------------------------------------------

test("a declarative consequence passes on the field, whatever verb the prose uses", () => {
  for (const [detail, consequence] of [
    [
      "blockDraft transitions the attempt DRAFT to BLOCKED. BLOCKED permits no outgoing transition.",
      "An owner who mistypes one prompt path loses the attempt and must create a new one.",
    ],
    [
      "locateRunReport sorts the matching names and returns the first. A newer report never replaces an older name.",
      "The status display names the older file.",
    ],
  ] as const) {
    const review = output({ findings: [finding({ detail, consequence })] });
    assert.equal(
      reviewFindingSpecificity(review.findings[0]!, new Set([PATH])).concreteConsequence,
      true,
      `declarative consequence rejected: ${consequence}`,
    );
    assert.equal(reviewEnvelopeComplete(review).passed, true);
  }
});

test("a mechanism-only finding fails however conditional its prose sounds", () => {
  const mechanismOnly = output({ findings: [finding({
    title: "Boolean flag set membership",
    detail: "The BOOLEAN_FLAGS set is declared with one member and is consulted after the equals-form branch in parseArgs.",
    consequence: "\t\n ",
  })] });
  assert.equal(
    reviewFindingSpecificity(mechanismOnly.findings[0]!, new Set([PATH])).concreteConsequence,
    false,
  );
  assert.deepEqual(incompleteItems(mechanismOnly), ["findings state a concrete consequence"]);
});

test("no phrasing of the consequence field is preferred over another", () => {
  for (const consequence of [
    "With a null selection, dashboard readers receive an empty card.",
    "Readers receive an empty card and abandon the valid queued work.",
    "Consequence: readers receive an empty card.",
    "Empty card.",
  ]) {
    const review = output({ findings: [finding({ consequence })] });
    assert.equal(reviewEnvelopeComplete(review).passed, true, `rejected: ${consequence}`);
  }
});

test("accept and concern keep their existing meaning while specificity remains mandatory", () => {
  const acceptWithNonBlockingFinding = output({
    verdict: "accept",
    findings: [finding({ severity: "medium" })],
  });
  assert.equal(report(acceptWithNonBlockingFinding).passed, true);
  assert.equal(reviewEnvelopeComplete(acceptWithNonBlockingFinding).passed, true);
  assert.equal(report(output({ verdict: "concern" })).passed, true);
});

test("a tersely agreeable accept fails only when bounded evidence requires a limitation", () => {
  const bounded = context({
    diff: `${validReviewContext().diff}\n*** awsf: 1 of 2 hunk(s) omitted from ${PATH}\n`,
    diffTruncated: true,
    diffOmittedChars: 80,
    limitationRequiredFiles: [PATH],
  });
  const terse = output({
    summary: "Looks good.",
    verdict: "accept",
    findings: [],
    limitations: [],
  });
  assert.deepEqual(failedItems(terse, bounded), ["bounded or omitted evidence has a specific limitation"]);
});

test("a legitimate clean accept needs no finding and no limitation when the evidence is complete", () => {
  const clean = output({ verdict: "accept", findings: [], limitations: [] });
  assert.equal(report(clean).passed, true);
});

test("a deletion-only concern passes with explicit file-wide scope and no fabricated line", () => {
  const deletion = context({
    changedFiles: ["gone.ts"],
    insertions: 0,
    deletions: 2,
    diff: [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export function legacyFallback() {}",
      "-export const legacyMode = true;",
      "",
    ].join("\n"),
  });
  const review = output({
    findings: [finding({
      file: "gone.ts",
      line: null,
      title: "Deleted file removes the configured fallback",
      detail: "Callers would lose the fallback and fail when legacy mode is selected.",
      evidence: "The deletion hunk removes both `legacyFallback()` and `legacyMode`.",
    })],
  });
  assert.equal(report(review, deletion).passed, true);
  assert.equal(review.findings[0]?.line, null);
});

test("a file-wide finding uses null as explicit scope and still earns four points", () => {
  const fileWide = finding({
    line: null,
    title: "Registry file exports the stale parser throughout",
    detail: "Consumers would keep resolving the stale parser and reject valid nested envelopes.",
    evidence: "Every export in `registry.ts` still targets `parseEnvelopeLegacy`.",
  });
  const score = reviewFindingSpecificity(fileWide, new Set([PATH]));
  assert.equal(score.lineOrFileWideScope, true);
  assert.equal(score.score, 4);
  assert.equal(report(output({ findings: [fileWide] })).passed, true);
});

test("a bounded diff passes with no findings when its partial file is named as a limitation", () => {
  const bounded = context({
    diff: `${validReviewContext().diff}\n*** awsf: 1 of 2 hunk(s) omitted from ${PATH}\n`,
    diffTruncated: true,
    diffOmittedChars: 80,
    limitationRequiredFiles: [PATH],
  });
  const review = output({
    verdict: "accept",
    findings: [],
    limitations: [{
      detail: "The bounded diff omits one hunk, so I could not verify its removed branch.",
      affectedFiles: [PATH],
    }],
  });
  assert.equal(report(review, bounded).passed, true);
  assert.equal(review.findings.length, 0, "a limitation is not turned into a finding");
});

test("every affected omitted test file is named rather than collapsed into a generic limitation", () => {
  const tests = ["core/test/unit/adoption.test.ts", "core/test/journeys/adoption.test.ts"];
  const omitted = context({
    changedFiles: [PATH, ...tests],
    diffTruncated: true,
    diffOmittedChars: 240,
    diffOmittedFiles: tests,
    limitationRequiredFiles: tests,
  });
  const generic = output({
    verdict: "accept",
    findings: [],
    limitations: [{ detail: "The bounded diff omitted tests that I could not inspect.", affectedFiles: [] }],
  });
  assert.deepEqual(failedItems(generic, omitted), ["bounded or omitted evidence has a specific limitation"]);

  const named = {
    ...generic,
    limitations: [{ detail: "The complete changes were withheld from review.", affectedFiles: tests }],
  };
  assert.equal(report(named, omitted).passed, true);
});

test("a contradictory host limitation list cannot hide a path proved omitted elsewhere", () => {
  const omitted = context({
    changedFiles: [PATH, OMITTED],
    diffTruncated: true,
    diffOmittedChars: 80,
    diffOmittedFiles: [OMITTED],
    limitationRequiredFiles: [],
  });
  const review = output({
    verdict: "accept",
    findings: [],
    limitations: [{ detail: "No file-specific limitation was reported.", affectedFiles: [] }],
  });
  assert.deepEqual(failedItems(review, omitted), ["bounded or omitted evidence has a specific limitation"]);
});

test("the omitted prompt-composition test is covered structurally regardless of limitation wording", () => {
  const omitted = context({
    changedFiles: [PATH, OMITTED_PROMPT_TEST],
    diffTruncated: true,
    diffOmittedChars: 80,
    diffOmittedFiles: [OMITTED_PROMPT_TEST],
    limitationRequiredFiles: [OMITTED_PROMPT_TEST],
  });
  const review = output({
    verdict: "accept",
    findings: [],
    limitations: [{
      detail: "I opened the file, but its complete hunk was withheld from me.",
      affectedFiles: [OMITTED_PROMPT_TEST],
    }],
  });
  assert.equal(report(review, omitted).passed, true);
});

test("an entirely omitted file must be named, while other limitations cannot stand in for it", () => {
  const omitted = context({
    changedFiles: [PATH, OMITTED],
    diffTruncated: true,
    diffOmittedChars: 120,
    diffOmittedFiles: [OMITTED],
    limitationRequiredFiles: [OMITTED],
  });
  const named = output({
    verdict: "accept",
    findings: [],
    limitations: [{ detail: "I did not see this file's complete change.", affectedFiles: [OMITTED] }],
  });
  assert.equal(report(named, omitted).passed, true, "wording does not control structured path coverage");

  const unnamed = {
    ...named,
    limitations: [{ detail: "The bounded diff omitted another surface that I could not inspect.", affectedFiles: [] }],
  };
  assert.deepEqual(failedItems(unnamed, omitted), ["bounded or omitted evidence has a specific limitation"]);
});
