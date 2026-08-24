import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReviewFinding } from "../../../src/contracts/review-output.ts";
import {
  median,
  PROMPT_BENCHMARK_CORPUS,
  scorePromptBenchmark,
  scoreReviewerSpecificity,
  type PromptBenchmarkArm,
  type PromptBenchmarkCorpusOrdinal,
  type PromptBenchmarkProtocol,
  type PromptBenchmarkRow,
} from "../../../src/workflow/prompt-benchmark.ts";

const REPETITIONS = 5;
const PROTOCOL: PromptBenchmarkProtocol = {
  repetitions: REPETITIONS,
  revisions: {
    baseline: "baseline-revision",
    candidate: "candidate-revision",
  },
  routes: {
    1: {
      provider: "worker-provider",
      requestedModel: "worker-model",
      modelProvenance: "route-attributed",
      measuresReviewerSpecificity: false,
      requiresReviewerLimitation: false,
    },
    2: {
      provider: "worker-provider",
      requestedModel: "worker-model",
      modelProvenance: "route-attributed",
      measuresReviewerSpecificity: false,
      requiresReviewerLimitation: false,
    },
    3: {
      provider: "review-provider",
      requestedModel: "review-model",
      modelProvenance: "stream-authoritative",
      measuresReviewerSpecificity: true,
      requiresReviewerLimitation: true,
    },
  },
};

function correctionCount(corpus: PromptBenchmarkCorpusOrdinal, repetition: number, arm: PromptBenchmarkArm): number {
  if (arm === "baseline") {
    return (corpus === 1 && repetition === 1) ||
      (corpus === 2 && repetition === 2) ||
      (corpus === 3 && repetition === 3) ? 1 : 0;
  }
  return (corpus === 1 && repetition === 1) || (corpus === 3 && repetition === 3) ? 1 : 0;
}

function row(
  corpus: PromptBenchmarkCorpusOrdinal,
  repetition: number,
  arm: PromptBenchmarkArm,
  patch: Partial<PromptBenchmarkRow> = {},
): PromptBenchmarkRow {
  const route = PROTOCOL.routes[corpus];
  const baselineFirst = repetition % 2 === 1;
  const orderInPair = arm === "baseline"
    ? baselineFirst ? 1 : 2
    : baselineFirst ? 2 : 1;
  const review = corpus === 3;
  return {
    arm,
    corpusItemOrdinal: corpus,
    repetition,
    orderInPair,
    revision: PROTOCOL.revisions[arm],
    provider: route.provider,
    requestedModel: route.requestedModel,
    resolvedModel: `${route.requestedModel}-resolved`,
    modelProvenance: route.modelProvenance,
    usageAuthority: "provider",
    inputTokens: 100 + corpus * 10 + repetition + (arm === "candidate" ? 10 : 0),
    outputTokens: 80 + corpus * 10 + repetition - (arm === "candidate" ? 5 : 0),
    parseCorrectionCount: correctionCount(corpus, repetition, arm),
    reviewerSpecificityScore: review
      ? arm === "candidate" || repetition >= 3 ? 4 : 3
      : null,
    requiredLimitation: review ? "present" : "not-required",
    valid: true,
    invalidationReason: null,
    ...patch,
  };
}

function completeRows(): PromptBenchmarkRow[] {
  const rows: PromptBenchmarkRow[] = [];
  for (const corpus of PROMPT_BENCHMARK_CORPUS) {
    for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
      const arms: readonly PromptBenchmarkArm[] = repetition % 2 === 1
        ? ["baseline", "candidate"]
        : ["candidate", "baseline"];
      for (const arm of arms) rows.push(row(corpus.ordinal, repetition, arm));
    }
  }
  return rows;
}

function replaceRow(
  rows: readonly PromptBenchmarkRow[],
  corpus: PromptBenchmarkCorpusOrdinal,
  repetition: number,
  arm: PromptBenchmarkArm,
  patch: Partial<PromptBenchmarkRow>,
): PromptBenchmarkRow[] {
  return rows.map((current) =>
    current.corpusItemOrdinal === corpus && current.repetition === repetition && current.arm === arm
      ? { ...current, ...patch }
      : current);
}

test("pairs the frozen three-by-five corpus with alternating arm order", () => {
  const rows = completeRows();
  const score = scorePromptBenchmark(PROTOCOL, rows);

  assert.equal(rows.length, 30);
  assert.equal(score.validPairs.length, 15);
  assert.equal(score.invalidPairs.length, 0);
  assert.equal(score.complete, true);
  assert.deepEqual(
    score.validPairs.slice(0, 2).map((pair) => [pair.baseline.orderInPair, pair.candidate.orderInPair]),
    [[1, 2], [2, 1]],
  );
});

test("missing provider usage authority invalidates the affected pair and contributes no arithmetic", () => {
  const rows = replaceRow(completeRows(), 1, 1, "candidate", {
    usageAuthority: "partial",
    inputTokens: null,
  });
  const score = scorePromptBenchmark(PROTOCOL, rows);

  assert.equal(score.complete, false);
  assert.equal(score.validPairs.length, 14);
  assert.equal(score.invalidPairs.length, 1);
  assert.match(score.invalidPairs[0]?.reasons.join("\n") ?? "", /not provider-authoritative/);
  assert.match(score.invalidPairs[0]?.reasons.join("\n") ?? "", /input token count is missing/);
  assert.equal(score.arms.baseline.inputTokens.length, 14, "both arms of the invalid pair are excluded");
  assert.equal(score.arms.candidate.inputTokens.length, 14);
  assert.equal(score.thresholds.passed, null);
});

test("resolved-model provenance must match each frozen route", () => {
  let rows = replaceRow(completeRows(), 1, 1, "candidate", { modelProvenance: "stream-authoritative" });
  rows = replaceRow(rows, 3, 1, "candidate", { modelProvenance: "route-attributed" });
  const score = scorePromptBenchmark(PROTOCOL, rows);

  assert.equal(score.validPairs.length, 13);
  assert.equal(score.invalidPairs.length, 2);
  assert.ok(score.invalidPairs.every((pair) =>
    pair.reasons.some((reason) => reason.includes("provenance does not match"))));
});

test("missing, duplicate, declared-invalid, and identity-drift pairs are invalid", () => {
  let rows = completeRows();
  rows = rows.filter((current) =>
    !(current.corpusItemOrdinal === 2 && current.repetition === 2 && current.arm === "candidate"));
  rows.push(row(1, 1, "baseline"));
  rows = replaceRow(rows, 3, 5, "candidate", {
    valid: false,
    invalidationReason: "synthetic precondition failure",
  });
  rows = replaceRow(rows, 1, 2, "candidate", { resolvedModel: "drifted-model" });

  const score = scorePromptBenchmark(PROTOCOL, rows);
  assert.equal(score.invalidPairs.length, 4);
  const reasons = score.invalidPairs.flatMap((pair) => pair.reasons);
  assert.ok(reasons.some((reason) => reason.includes("expected two")));
  assert.ok(reasons.some((reason) => reason.includes("expected one")));
  assert.ok(reasons.some((reason) => reason.includes("synthetic precondition failure")));
  assert.ok(reasons.some((reason) => reason.includes("within the pair")));
});

test("correction sums include corrected envelopes and enforce total non-inferiority", () => {
  const passing = scorePromptBenchmark(PROTOCOL, completeRows());
  assert.equal(passing.arms.baseline.parseCorrectionTotal, 3);
  assert.equal(passing.arms.candidate.parseCorrectionTotal, 2);
  assert.equal(passing.thresholds.correctionNonInferior, true);

  const regressedRows = replaceRow(completeRows(), 2, 5, "candidate", { parseCorrectionCount: 2 });
  const regressed = scorePromptBenchmark(PROTOCOL, regressedRows);
  assert.equal(regressed.arms.candidate.parseCorrectionTotal, 4);
  assert.equal(regressed.thresholds.correctionNonInferior, false);
  assert.equal(regressed.thresholds.passed, false);
});

test("specificity uses Q2 finding points, a per-run median, and zero for a missed declared defect", () => {
  const path = "src/synthetic.ts";
  const detailed: ReviewFinding = {
    id: "F-detailed",
    severity: "high",
    file: path,
    line: 12,
    title: "Fallback branch exposes an unavailable value",
    detail: "Callers would receive the stale value and fail the authority check.",
    evidence: "`formatValue` returns `raw` when authority equals unavailable.",
  };
  const vague: ReviewFinding = { ...detailed, id: "F-vague", evidence: "Observed" };

  assert.equal(scoreReviewerSpecificity([detailed], new Set([path])), 4);
  assert.equal(scoreReviewerSpecificity([detailed, vague], new Set([path])), 3.5);
  assert.equal(scoreReviewerSpecificity([], new Set([path])), 0);

  let rows = completeRows();
  for (const repetition of [1, 2, 3] as const) {
    rows = replaceRow(rows, 3, repetition, "candidate", { reviewerSpecificityScore: 2 });
  }
  const score = scorePromptBenchmark(PROTOCOL, rows);
  assert.equal(score.arms.baseline.reviewerSpecificityMedian, 4);
  assert.equal(score.arms.candidate.reviewerSpecificityMedian, 2);
  assert.equal(score.thresholds.specificityNonInferior, false);
});

test("median handles odd, even, empty, and unsorted distributions without mutation", () => {
  const values = [9, 1, 5, 3];
  assert.equal(median(values), 4);
  assert.deepEqual(values, [9, 1, 5, 3]);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([]), null);
  assert.throws(() => median([1, Number.NaN]), /finite numbers/);
});

test("paired differences are candidate minus baseline and retained per corpus", () => {
  let rows = completeRows();
  rows = replaceRow(rows, 3, 4, "baseline", {
    inputTokens: 200,
    outputTokens: 120,
    parseCorrectionCount: 1,
    reviewerSpecificityScore: 3,
  });
  rows = replaceRow(rows, 3, 4, "candidate", {
    inputTokens: 215,
    outputTokens: 111,
    parseCorrectionCount: 0,
    reviewerSpecificityScore: 4,
  });
  const score = scorePromptBenchmark(PROTOCOL, rows);
  const pair = score.validPairs.find((current) =>
    current.corpusItemOrdinal === 3 && current.repetition === 4);

  assert.deepEqual(pair?.difference, {
    inputTokens: 15,
    outputTokens: -9,
    parseCorrectionCount: -1,
    reviewerSpecificityScore: 1,
  });
  assert.deepEqual(score.byCorpus[2]?.pairedDifferences[3], pair?.difference);
});

test("a candidate cannot lose a required reviewer limitation", () => {
  const rows = replaceRow(completeRows(), 3, 2, "candidate", { requiredLimitation: "missing" });
  const score = scorePromptBenchmark(PROTOCOL, rows);

  assert.equal(score.complete, true, "a measured safety outcome is not recast as a protocol invalidation");
  assert.equal(score.arms.candidate.missingRequiredLimitations, 1);
  assert.equal(score.thresholds.noLostRequiredLimitation, false);
  assert.equal(score.thresholds.passed, false);
});
