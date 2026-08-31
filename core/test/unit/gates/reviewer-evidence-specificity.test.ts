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

function finding(patch: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "F-specific",
    severity: "high",
    file: PATH,
    line: 42,
    title: "Outermost-object scan accepts a trailing brace",
    detail: "A trailing prose brace would widen the JSON slice and fail strict parsing.",
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
  })] });
  assert.equal(report(review).passed, true, "the verdict remains internally consistent");
  assert.deepEqual(incompleteItems(review), ["findings state a concrete consequence"]);
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
  });
  const review = output({
    verdict: "accept",
    findings: [],
    limitations: [`The bounded diff omits one hunk from ${PATH}, so I could not verify its removed branch.`],
  });
  assert.equal(report(review, bounded).passed, true);
  assert.equal(review.findings.length, 0, "a limitation is not turned into a finding");
});

test("an entirely omitted file must be named, while other limitations cannot stand in for it", () => {
  const omitted = context({
    changedFiles: [PATH, OMITTED],
    diffTruncated: true,
    diffOmittedChars: 120,
    diffOmittedFiles: [OMITTED],
  });
  const named = output({
    verdict: "accept",
    findings: [],
    limitations: [`The bounded diff omitted ${OMITTED}, so I could not inspect its removed lines.`],
  });
  assert.equal(report(named, omitted).passed, true);

  const unnamed = { ...named, limitations: ["The bounded diff omitted another surface that I could not inspect."] };
  assert.deepEqual(failedItems(unnamed, omitted), ["bounded or omitted evidence has a specific limitation"]);
});
