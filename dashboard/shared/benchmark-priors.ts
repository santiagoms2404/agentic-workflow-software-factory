// Public benchmarks as a cold-start prior (W18 D3, the design's benchmark
// table). They are shown beside local numbers and never added into them: the
// only consumers are `recommend`'s prior-only branch, through `priorLookup`,
// and the matrix's row labels.
//
// A prior mean must be a probability. Only a benchmark scored as a percentage
// of tasks solved has one; an Elo or an index (GDPval-AA, the AA intelligence
// index) has no mean and yields `null` rather than a rescaled number.
//
// Scores are the labs' own unless a row says otherwise, checked 2026-09-26.

import type { BenchmarkPrior, BenchmarkPriors, UntestedRoute } from "./types.ts";
import { canonicalModel, routeKey, type MetricsRoute, type MetricsRow, type PriorLookup } from "./route-metrics.ts";

export const PRIORS_CHECKED_AT = "2026-09-26";

const ANTHROPIC_OPUS_5_5 = "https://www.anthropic.com/news/claude-opus-5-5";
const AA_GPT_6_ASTRA = "https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra";
const AA_SOL_VS_ASTRA = "https://artificialanalysis.ai/models/releases/comparisons/gpt-6-sol-vs-gpt-6-astra";
const METR = "https://metr.org/time-horizons/";
const BENCHLM_SWE_VERIFIED = "https://benchlm.ai/benchmarks/swe-bench-verified";
const MORPH_SWE_PRO = "https://www.morphllm.com/swe-bench-pro";
const INDYDEVDAN = "IndyDevDan, \"top five benchmarks for agentic engineering\" (video transcript supplied by the owner)";

function benchmark(row: Omit<BenchmarkPrior, "checkedAt">): BenchmarkPrior {
  return Object.freeze({ ...row, checkedAt: PRIORS_CHECKED_AT });
}

export const BENCHMARKS: readonly BenchmarkPrior[] = Object.freeze([
  benchmark({
    id: "terminal-bench-4", name: "Terminal-Bench 4.0",
    tests: "Long multi-step terminal tasks in containers, graded by tests, including error recovery.",
    informs: "builder, shift, host validation", roles: ["builder"], transfer: "high", scale: "percent",
    scores: [
      { model: "claude-opus-5-5", score: 66.4, effort: "xhigh" },
      { model: "gpt-6-astra", score: 57.9, effort: "high" },
      { model: "claude-fable-5-1", score: 55.8, effort: null },
      { model: "claude-opus-5", score: 52.3, effort: null },
      { model: "gpt-5.6-sol", score: 37.3, effort: null },
    ],
    summary: "Opus 5.5 66.4 (xhigh) · GPT-6 Astra 57.9 (high) · Fable 5.1 55.8 · Opus 5 52.3 · GPT-5.6 Sol 37.3",
    sources: [ANTHROPIC_OPUS_5_5],
  }),
  benchmark({
    id: "swe-bench-pro", name: "SWE-bench Pro (Scale)",
    tests: "1,865 issue-resolution tasks across 41 professional repos, hidden tests, built to resist contamination.",
    informs: "builder on bounded source changes", roles: [], transfer: "medium", scale: "percent", scores: [],
    summary: "Harness dominates: aggregators report 89.9 and a standardized 61.5 for the top models",
    sources: [MORPH_SWE_PRO],
  }),
  benchmark({
    id: "swe-bench-verified", name: "SWE-bench Verified",
    tests: "500 human-validated GitHub issues.",
    informs: "none", roles: [], transfer: "none", scale: "percent", scores: [],
    summary: "Archived as saturated by Vals AI on 2026-09-01",
    sources: [BENCHLM_SWE_VERIFIED],
  }),
  benchmark({
    id: "cursorbench-4", name: "CursorBench 4.0",
    tests: "Tasks drawn from real editor sessions.",
    informs: "builder", roles: [], transfer: "medium", scale: "percent",
    scores: [
      { model: "claude-opus-5-5", score: 57.8, effort: null },
      { model: "claude-fable-5-1", score: 51.8, effort: null },
      { model: "gpt-5.6-sol", score: 41.7, effort: null },
    ],
    summary: "Opus 5.5 57.8 · Fable 5.1 51.8 · GPT-5.6 Sol 41.7",
    sources: [ANTHROPIC_OPUS_5_5],
  }),
  benchmark({
    id: "swe-atlas-qna", name: "SWE-Atlas-QnA",
    tests: "Answering questions about an unfamiliar codebase.",
    informs: "scout, reviewer reading", roles: ["scout", "reviewer"], transfer: "medium", scale: "percent", scores: [],
    summary: "In the Artificial Analysis coding index",
    sources: [AA_GPT_6_ASTRA],
  }),
  benchmark({
    id: "deepswe-1-1", name: "DeepSWE v1.1",
    tests: "Long-horizon software engineering from short, realistic prompts. Reports steps, output tokens and cost per task.",
    informs: "builder on multi-file work", roles: [], transfer: "high", scale: "index", scores: [],
    summary: "GPT-6 Astra first at about 30k output tokens and 29 steps (IndyDevDan's reading). AA: Astra 68 · GPT-5.6 Sol 72",
    sources: [INDYDEVDAN, AA_GPT_6_ASTRA],
  }),
  benchmark({
    id: "apex-agents", name: "APEX-Agents",
    tests: "Expert-vetted knowledge work in investment banking, consulting and law, run inside file workspaces.",
    informs: "planner, designer, documenter: a proxy for non-code domains such as Smart Health", roles: [],
    transfer: "medium", scale: "percent", scores: [],
    summary: "Near saturation at the top (80s). Publishes no cost or time",
    sources: [INDYDEVDAN],
  }),
  benchmark({
    id: "aa-omniscience", name: "AA-Omniscience",
    tests: "Factual reliability: correct, incorrect, partial or not attempted, with no penalty for declining.",
    informs: "every role: honest stops against false success claims", roles: [], transfer: "high as a method",
    scale: "index", scores: [],
    summary: "Anthropic and OpenAI flagships lead. Scores fall off sharply below them",
    sources: [INDYDEVDAN, AA_GPT_6_ASTRA],
  }),
  benchmark({
    id: "gdpval-aa-2-1", name: "GDPval-AA v2.1",
    tests: "Professional deliverables across 44 occupations, graded pairwise as Elo.",
    informs: "planner, designer, documenter", roles: ["planner", "designer", "documenter"], transfer: "medium", scale: "elo",
    scores: [
      { model: "claude-opus-5-5", score: 1846, effort: null },
      { model: "claude-fable-5-1", score: 1735, effort: null },
      { model: "claude-opus-5", score: 1708, effort: null },
      { model: "gpt-5.6-sol", score: 1588, effort: null },
      { model: "gpt-6-astra", score: 1542, effort: null },
    ],
    summary: "Opus 5.5 1846 · Fable 5.1 1735 · Opus 5 1708 · GPT-5.6 Sol 1588 · GPT-6 Astra 1542",
    sources: [ANTHROPIC_OPUS_5_5],
  }),
  benchmark({
    id: "aa-briefcase", name: "AA-Briefcase",
    tests: "Long-horizon knowledge work over multi-week projects.",
    informs: "Marimba, the driving session", roles: [], transfer: "medium", scale: "elo", scores: [],
    summary: "GPT-6 Astra about 90 Elo above GPT-5.6 Sol",
    sources: [AA_SOL_VS_ASTRA],
  }),
  benchmark({
    id: "automationbench", name: "AutomationBench",
    tests: "600+ business tasks across six domains. A task fails if it trips a guardrail on the way.",
    informs: "every role that writes: completion without guardrail violations", roles: [], transfer: "high as a method",
    scale: "percent",
    scores: [
      { model: "gpt-6-astra", score: 41.4, effort: null },
      { model: "claude-opus-5-5", score: 40.0, effort: null },
    ],
    summary: "GPT-6 Astra 41.4 · Opus 5.5 40.0 (Anthropic table)",
    sources: [ANTHROPIC_OPUS_5_5, INDYDEVDAN],
  }),
  benchmark({
    id: "osworld-2", name: "OSWorld 2.0",
    tests: "Operating a desktop GUI.",
    informs: "journey and visual inspection only", roles: [], transfer: "low", scale: "percent",
    scores: [
      { model: "claude-opus-5-5", score: 81.8, effort: null },
      { model: "claude-fable-5-1", score: 80.7, effort: null },
    ],
    summary: "Opus 5.5 81.8 · Fable 5.1 80.7",
    sources: [ANTHROPIC_OPUS_5_5],
  }),
  benchmark({
    id: "humanitys-last-exam", name: "Humanity's Last Exam",
    tests: "Expert-level questions, with tools.",
    informs: "little: knowledge, not agency", roles: [], transfer: "low", scale: "percent",
    scores: [
      { model: "claude-opus-5-5", score: 67.7, effort: null },
      { model: "gpt-6-astra", score: 57.2, effort: null },
    ],
    summary: "Opus 5.5 67.7 · GPT-6 Astra 57.2",
    sources: [ANTHROPIC_OPUS_5_5],
  }),
  benchmark({
    id: "metr-time-horizon", name: "METR time horizon",
    tests: "Task length a model finishes at 50% success.",
    informs: "method for an AWSF horizon per route", roles: [], transfer: "high as a method", scale: "index", scores: [],
    summary: "Frontier 50% horizon above 16 h (May 2026). METR calls values past 16 h unreliable",
    sources: [METR],
  }),
]);

/** The matrix's row labels: the one public number the design shows beside a model. */
export const MODEL_PRIOR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "claude-opus-5": "TB 4.0 52.3",
  "gpt-5.6-sol": "TB 4.0 37.3",
  "claude-opus-5-5": "TB 4.0 66.4",
  "gpt-6-sol": "AA index up to 48",
});

/** Routes available but never run, shown as sunk rows with their public prior. */
export const UNTESTED_ROUTES: readonly UntestedRoute[] = Object.freeze([
  { adapter: "claude", provider: "anthropic", model: "claude-opus-5-5", effort: "medium", label: "Opus 5.5 · medium", prior: "TB 4.0 66.4 at xhigh" },
  { adapter: "claude", provider: "anthropic", model: "claude-sonnet-5", effort: "medium", label: "Sonnet 5 · medium", prior: "$2 / $10" },
  { adapter: "codex", provider: "openai-codex", model: "gpt-6-sol", effort: "high", label: "GPT-6 Sol · high", prior: "AA index 28 to 48 by effort" },
  { adapter: "codex", provider: "openai-codex", model: "gpt-5.6-terra", effort: "medium", label: "GPT-5.6 Terra · medium", prior: "$2 / $12" },
].map((route) => Object.freeze(route)));

export const BENCHMARK_PRIORS: BenchmarkPriors = Object.freeze({
  checkedAt: PRIORS_CHECKED_AT,
  benchmarks: BENCHMARKS,
  modelLabels: MODEL_PRIOR_LABELS,
});

/** The benchmark a role's prior comes from: the first row listing the role. `null` when none does. */
export function roleBenchmark(role: string): BenchmarkPrior | null {
  return BENCHMARKS.find((row) => row.roles.includes(role)) ?? null;
}

/** A role's prior mean for one model id, in [0, 1]. `null` unless the role's benchmark is a percentage and scores that exact id. */
export function priorMean(role: string, model: string | null): number | null {
  const bench = roleBenchmark(role);
  if (bench === null || bench.scale !== "percent" || model === null) return null;
  const found = bench.scores.find((score) => score.model === model);
  return found === undefined ? null : found.score / 100;
}

/**
 * The model each route key was observed answering as, where every row of the
 * key that observed one agrees. A key whose rows saw two models (the owner's
 * `claude:opus` reached both Opus 5 and Opus 5.5) has no entry.
 */
export function observedModels(rows: readonly Pick<MetricsRow, "route" | "resolvedModel">[]): ReadonlyMap<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = routeKey(row.route);
    if (key === null || row.resolvedModel === null) continue;
    const models = seen.get(key) ?? new Set<string>();
    models.add(row.resolvedModel);
    seen.set(key, models);
  }
  const agreed = new Map<string, string>();
  for (const [key, models] of seen) if (models.size === 1) agreed.set(key, [...models][0]!);
  return agreed;
}

/**
 * The `PriorLookup` `recommend` takes. A route's model is its selector when
 * that is a scored id, else the one model its rows were observed answering as.
 */
export function priorLookup(observed: ReadonlyMap<string, string> = new Map()): PriorLookup {
  return (role: string, route: MetricsRoute) => {
    const key = routeKey(route);
    const selector = canonicalModel(route);
    const direct = priorMean(role, selector);
    if (direct !== null) return direct;
    return priorMean(role, key === null ? null : observed.get(key) ?? null);
  };
}
