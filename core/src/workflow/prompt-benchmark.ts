import type { ModelResolutionProvenance } from "../contracts/normalized-events.ts";
import type { ReviewFinding } from "../contracts/review-output.ts";
import { reviewFindingSpecificity } from "../gates/review.ts";

export const PROMPT_BENCHMARK_ARMS = ["baseline", "candidate"] as const;
export type PromptBenchmarkArm = (typeof PROMPT_BENCHMARK_ARMS)[number];

export const PROMPT_BENCHMARK_CORPUS = [
  { ordinal: 1, taskClass: "bounded-source-change" },
  { ordinal: 2, taskClass: "contract-envelope-change" },
  { ordinal: 3, taskClass: "evidence-heavy-defect-review" },
] as const;
export type PromptBenchmarkCorpusOrdinal = (typeof PROMPT_BENCHMARK_CORPUS)[number]["ordinal"];

export type RequiredLimitationStatus = "not-required" | "present" | "missing";

export interface PromptBenchmarkRow {
  readonly arm: PromptBenchmarkArm;
  readonly corpusItemOrdinal: PromptBenchmarkCorpusOrdinal;
  readonly repetition: number;
  /** One is the first arm run in the pair, two is the second. */
  readonly orderInPair: 1 | 2;
  readonly revision: string;
  readonly provider: string;
  readonly requestedModel: string;
  readonly resolvedModel: string | null;
  readonly modelProvenance: "stream-authoritative" | "route-attributed" | null;
  readonly usageAuthority: "provider" | "partial" | "none";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly parseCorrectionCount: number;
  /** The Q2 four-point score, aggregated by `scoreReviewerSpecificity`. */
  readonly reviewerSpecificityScore: number | null;
  /** Part of Q2's omitted-evidence rule, not a fifth metric. */
  readonly requiredLimitation: RequiredLimitationStatus;
  readonly valid: boolean;
  readonly invalidationReason: string | null;
}

export interface PromptBenchmarkRouteExpectation {
  readonly provider: string;
  readonly requestedModel: string;
  readonly modelProvenance: ModelResolutionProvenance;
  readonly measuresReviewerSpecificity: boolean;
  readonly requiresReviewerLimitation: boolean;
}

export interface PromptBenchmarkProtocol {
  readonly repetitions: number;
  readonly revisions: Readonly<Record<PromptBenchmarkArm, string>>;
  readonly routes: Readonly<Record<PromptBenchmarkCorpusOrdinal, PromptBenchmarkRouteExpectation>>;
}

export interface PromptBenchmarkDifference {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly parseCorrectionCount: number;
  readonly reviewerSpecificityScore: number | null;
}

export interface ValidPromptBenchmarkPair {
  readonly corpusItemOrdinal: PromptBenchmarkCorpusOrdinal;
  readonly repetition: number;
  readonly baseline: PromptBenchmarkRow;
  readonly candidate: PromptBenchmarkRow;
  /** Every difference is candidate minus baseline. */
  readonly difference: PromptBenchmarkDifference;
}

export interface InvalidPromptBenchmarkPair {
  readonly corpusItemOrdinal: PromptBenchmarkCorpusOrdinal;
  readonly repetition: number;
  readonly reasons: readonly string[];
}

export interface PromptBenchmarkArmDistribution {
  readonly inputTokens: readonly number[];
  readonly outputTokens: readonly number[];
  readonly parseCorrectionCounts: readonly number[];
  readonly reviewerSpecificityScores: readonly number[];
  readonly inputTokenMedian: number | null;
  readonly outputTokenMedian: number | null;
  readonly parseCorrectionMedian: number | null;
  readonly reviewerSpecificityMedian: number | null;
  readonly parseCorrectionTotal: number;
  readonly missingRequiredLimitations: number;
}

export interface PromptBenchmarkCorpusScore {
  readonly corpusItemOrdinal: PromptBenchmarkCorpusOrdinal;
  readonly arms: Readonly<Record<PromptBenchmarkArm, PromptBenchmarkArmDistribution>>;
  readonly pairedDifferences: readonly PromptBenchmarkDifference[];
}

export interface PromptBenchmarkThresholds {
  readonly correctionNonInferior: boolean | null;
  readonly specificityNonInferior: boolean | null;
  readonly noLostRequiredLimitation: boolean | null;
  readonly passed: boolean | null;
}

export interface PromptBenchmarkScore {
  readonly complete: boolean;
  readonly validPairs: readonly ValidPromptBenchmarkPair[];
  readonly invalidPairs: readonly InvalidPromptBenchmarkPair[];
  readonly arms: Readonly<Record<PromptBenchmarkArm, PromptBenchmarkArmDistribution>>;
  readonly byCorpus: readonly PromptBenchmarkCorpusScore[];
  readonly thresholds: PromptBenchmarkThresholds;
}

function assertFiniteValues(values: readonly number[]): void {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("median accepts finite numbers only");
  }
}

/** Median without mutating the caller's distribution. Empty distributions have no median. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  assertFiniteValues(values);
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] ?? null;
  return ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

/**
 * One review run's specificity under Q2. The evidence-heavy corpus contains a
 * declared defect, so reporting no finding is a measured zero rather than an
 * invalid pair. Finding count itself contributes no points.
 */
export function scoreReviewerSpecificity(
  findings: readonly ReviewFinding[],
  candidatePaths: ReadonlySet<string>,
): number {
  if (findings.length === 0) return 0;
  const scores = findings.map((finding) => reviewFindingSpecificity(finding, candidatePaths).score);
  return median(scores) ?? 0;
}

function pairKey(corpusItemOrdinal: number, repetition: number): string {
  return `${String(corpusItemOrdinal)}:${String(repetition)}`;
}

function expectedOrder(arm: PromptBenchmarkArm, repetition: number): 1 | 2 {
  const baselineFirst = repetition % 2 === 1;
  if (arm === "baseline") return baselineFirst ? 1 : 2;
  return baselineFirst ? 2 : 1;
}

function nonNegativeInteger(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 0;
}

function validateRow(
  row: PromptBenchmarkRow,
  arm: PromptBenchmarkArm,
  protocol: PromptBenchmarkProtocol,
): readonly string[] {
  const reasons: string[] = [];
  const route = protocol.routes[row.corpusItemOrdinal];
  if (row.arm !== arm) reasons.push(`${arm} slot carries arm ${row.arm}`);
  if (row.revision !== protocol.revisions[arm]) reasons.push(`${arm} revision does not match the protocol`);
  if (row.provider !== route.provider) reasons.push(`${arm} provider does not match the protocol`);
  if (row.requestedModel !== route.requestedModel) reasons.push(`${arm} requested model does not match the protocol`);
  if (row.resolvedModel === null || row.resolvedModel.trim().length === 0) reasons.push(`${arm} resolved model authority is missing`);
  if (row.modelProvenance !== route.modelProvenance) {
    reasons.push(`${arm} resolved-model provenance does not match the protocol`);
  }
  if (row.orderInPair !== expectedOrder(arm, row.repetition)) reasons.push(`${arm} arm order does not alternate by repetition`);
  if (row.usageAuthority !== "provider") reasons.push(`${arm} token usage is not provider-authoritative`);
  if (!nonNegativeInteger(row.inputTokens)) reasons.push(`${arm} input token count is missing or invalid`);
  if (!nonNegativeInteger(row.outputTokens)) reasons.push(`${arm} output token count is missing or invalid`);
  if (!nonNegativeInteger(row.parseCorrectionCount)) reasons.push(`${arm} correction count is invalid`);

  if (route.measuresReviewerSpecificity) {
    if (row.reviewerSpecificityScore === null || !Number.isFinite(row.reviewerSpecificityScore) ||
      row.reviewerSpecificityScore < 0 || row.reviewerSpecificityScore > 4) {
      reasons.push(`${arm} reviewer specificity score is missing or outside zero to four`);
    }
  } else if (row.reviewerSpecificityScore !== null) {
    reasons.push(`${arm} carries reviewer specificity for a non-review route`);
  }

  if (route.requiresReviewerLimitation) {
    if (row.requiredLimitation === "not-required") reasons.push(`${arm} omitted the required-limitation observation`);
  } else if (row.requiredLimitation !== "not-required") {
    reasons.push(`${arm} carries a limitation observation for a route that does not require one`);
  }

  if (!row.valid) {
    reasons.push(`${arm} row invalidated: ${row.invalidationReason?.trim() || "reason missing"}`);
  } else if (row.invalidationReason !== null) {
    reasons.push(`${arm} valid row carries an invalidation reason`);
  }
  return Object.freeze(reasons);
}

function distribution(rows: readonly PromptBenchmarkRow[]): PromptBenchmarkArmDistribution {
  const inputTokens = rows.flatMap((row) => row.inputTokens === null ? [] : [row.inputTokens]);
  const outputTokens = rows.flatMap((row) => row.outputTokens === null ? [] : [row.outputTokens]);
  const parseCorrectionCounts = rows.map((row) => row.parseCorrectionCount);
  const reviewerSpecificityScores = rows.flatMap((row) =>
    row.reviewerSpecificityScore === null ? [] : [row.reviewerSpecificityScore]);
  return Object.freeze({
    inputTokens: Object.freeze(inputTokens),
    outputTokens: Object.freeze(outputTokens),
    parseCorrectionCounts: Object.freeze(parseCorrectionCounts),
    reviewerSpecificityScores: Object.freeze(reviewerSpecificityScores),
    inputTokenMedian: median(inputTokens),
    outputTokenMedian: median(outputTokens),
    parseCorrectionMedian: median(parseCorrectionCounts),
    reviewerSpecificityMedian: median(reviewerSpecificityScores),
    parseCorrectionTotal: parseCorrectionCounts.reduce((total, count) => total + count, 0),
    missingRequiredLimitations: rows.filter((row) => row.requiredLimitation === "missing").length,
  });
}

function armDistributions(pairs: readonly ValidPromptBenchmarkPair[]): Readonly<Record<PromptBenchmarkArm, PromptBenchmarkArmDistribution>> {
  return Object.freeze({
    baseline: distribution(pairs.map((pair) => pair.baseline)),
    candidate: distribution(pairs.map((pair) => pair.candidate)),
  });
}

function pairedDifference(baseline: PromptBenchmarkRow, candidate: PromptBenchmarkRow): PromptBenchmarkDifference {
  return Object.freeze({
    inputTokens: (candidate.inputTokens ?? 0) - (baseline.inputTokens ?? 0),
    outputTokens: (candidate.outputTokens ?? 0) - (baseline.outputTokens ?? 0),
    parseCorrectionCount: candidate.parseCorrectionCount - baseline.parseCorrectionCount,
    reviewerSpecificityScore: candidate.reviewerSpecificityScore === null || baseline.reviewerSpecificityScore === null
      ? null
      : candidate.reviewerSpecificityScore - baseline.reviewerSpecificityScore,
  });
}

/** Pair, reject invalid evidence, and calculate only the four predeclared metrics. */
export function scorePromptBenchmark(
  protocol: PromptBenchmarkProtocol,
  rows: readonly PromptBenchmarkRow[],
): PromptBenchmarkScore {
  if (!Number.isInteger(protocol.repetitions) || protocol.repetitions < 1) {
    throw new RangeError("benchmark repetitions must be a positive integer");
  }

  const grouped = new Map<string, PromptBenchmarkRow[]>();
  for (const row of rows) {
    const key = pairKey(row.corpusItemOrdinal, row.repetition);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  const validPairs: ValidPromptBenchmarkPair[] = [];
  const invalidPairs: InvalidPromptBenchmarkPair[] = [];
  const expectedKeys = new Set<string>();
  const resolvedByRoute = new Map<string, string>();
  for (const corpus of PROMPT_BENCHMARK_CORPUS) {
    for (let repetition = 1; repetition <= protocol.repetitions; repetition += 1) {
      const key = pairKey(corpus.ordinal, repetition);
      expectedKeys.add(key);
      const group = grouped.get(key) ?? [];
      const baselineRows = group.filter((row) => row.arm === "baseline");
      const candidateRows = group.filter((row) => row.arm === "candidate");
      const reasons: string[] = [];
      if (group.length !== 2) reasons.push(`pair has ${String(group.length)} row(s), expected two`);
      if (baselineRows.length !== 1) reasons.push(`pair has ${String(baselineRows.length)} baseline row(s), expected one`);
      if (candidateRows.length !== 1) reasons.push(`pair has ${String(candidateRows.length)} candidate row(s), expected one`);
      const baseline = baselineRows[0];
      const candidate = candidateRows[0];
      if (baseline !== undefined) reasons.push(...validateRow(baseline, "baseline", protocol));
      if (candidate !== undefined) reasons.push(...validateRow(candidate, "candidate", protocol));
      if (baseline?.resolvedModel !== undefined && baseline.resolvedModel !== null &&
        candidate?.resolvedModel !== undefined && candidate.resolvedModel !== null &&
        baseline.resolvedModel !== candidate.resolvedModel) {
        reasons.push("resolved model drifted within the pair");
      }
      if (reasons.length === 0 && baseline !== undefined && candidate !== undefined && baseline.resolvedModel !== null) {
        const route = protocol.routes[corpus.ordinal];
        const routeKey = `${route.provider}\u0000${route.requestedModel}`;
        const lockedModel = resolvedByRoute.get(routeKey);
        if (lockedModel === undefined) resolvedByRoute.set(routeKey, baseline.resolvedModel);
        else if (baseline.resolvedModel !== lockedModel) reasons.push("resolved model drifted from the route's first valid pair");
      }

      if (reasons.length > 0 || baseline === undefined || candidate === undefined) {
        invalidPairs.push(Object.freeze({
          corpusItemOrdinal: corpus.ordinal,
          repetition,
          reasons: Object.freeze(reasons),
        }));
        continue;
      }
      validPairs.push(Object.freeze({
        corpusItemOrdinal: corpus.ordinal,
        repetition,
        baseline,
        candidate,
        difference: pairedDifference(baseline, candidate),
      }));
    }
  }

  for (const [key, group] of grouped) {
    if (expectedKeys.has(key)) continue;
    const row = group[0]!;
    invalidPairs.push(Object.freeze({
      corpusItemOrdinal: row.corpusItemOrdinal,
      repetition: row.repetition,
      reasons: Object.freeze(["row is outside the frozen corpus or repetition range"]),
    }));
  }

  const arms = armDistributions(validPairs);
  const byCorpus = PROMPT_BENCHMARK_CORPUS.map((corpus) => {
    const pairs = validPairs.filter((pair) => pair.corpusItemOrdinal === corpus.ordinal);
    return Object.freeze({
      corpusItemOrdinal: corpus.ordinal,
      arms: armDistributions(pairs),
      pairedDifferences: Object.freeze(pairs.map((pair) => pair.difference)),
    });
  });
  const expectedPairCount = PROMPT_BENCHMARK_CORPUS.length * protocol.repetitions;
  const complete = invalidPairs.length === 0 && validPairs.length === expectedPairCount;
  const correctionNonInferior = complete
    ? arms.candidate.parseCorrectionTotal <= arms.baseline.parseCorrectionTotal
    : null;
  const baselineSpecificity = arms.baseline.reviewerSpecificityMedian;
  const candidateSpecificity = arms.candidate.reviewerSpecificityMedian;
  const specificityNonInferior = complete && baselineSpecificity !== null && candidateSpecificity !== null
    ? candidateSpecificity >= baselineSpecificity
    : null;
  const noLostRequiredLimitation = complete
    ? arms.candidate.missingRequiredLimitations === 0
    : null;
  const passed = correctionNonInferior !== null && specificityNonInferior !== null && noLostRequiredLimitation !== null
    ? correctionNonInferior && specificityNonInferior && noLostRequiredLimitation
    : null;

  return Object.freeze({
    complete,
    validPairs: Object.freeze(validPairs),
    invalidPairs: Object.freeze(invalidPairs),
    arms,
    byCorpus: Object.freeze(byCorpus),
    thresholds: Object.freeze({
      correctionNonInferior,
      specificityNonInferior,
      noLostRequiredLimitation,
      passed,
    }),
  });
}
