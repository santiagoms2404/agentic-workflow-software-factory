import { test } from "node:test";
import assert from "node:assert/strict";
import type { Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ANTHROPIC_PRICING_SOURCE,
  OPENAI_PRICING_SOURCE,
  RATE_CARD,
  RATE_CARD_ROWS,
  formatListEquivalent,
  listEquivalentUsd,
  listPrice,
  priceRow,
  rateFor,
} from "../../../dashboard/shared/rate-card.ts";
import {
  BENCHMARKS,
  BENCHMARK_PRIORS,
  UNTESTED_ROUTES,
  observedModels,
  priorLookup,
  priorMean,
} from "../../../dashboard/shared/benchmark-priors.ts";
import { recommend, routeKey, stats, type MetricsRoute, type MetricsTokens } from "../../../dashboard/shared/route-metrics.ts";
import type { RateCardRow } from "../../../dashboard/shared/types.ts";
import { BenchmarkPriorsSchema, RateCardRowSchema, RateCardSchema } from "./_metrics-schemas.ts";
import { SUBSCRIPTION_COST_DISPLAY, formatCost } from "../../src/adapters/cost-display.ts";

// Compile-time: the schema and the declared row type describe the same shape.
const schemaRow = (row: RateCardRow): Static<typeof RateCardRowSchema> => row;
void schemaRow;

/** The design's table, per 1M tokens: input, cache write, cache read, output. */
const DESIGN: Readonly<Record<string, readonly [number, number, number, number]>> = {
  "claude-fable-5-1": [10, 12.5, 0.25, 50],
  "claude-opus-5-5": [4, 5, 0.2, 20],
  "claude-opus-5": [5, 6.25, 0.5, 25],
  "claude-sonnet-5-5": [2, 2.5, 0.2, 10],
  "claude-sonnet-5": [2, 2.5, 0.2, 10],
  "claude-haiku-4-5": [1, 1.25, 0.1, 5],
  "gpt-6-astra": [10, 0, 1, 50],
  "gpt-6.1-sol": [2, 0, 0.1, 10],
  "gpt-6-sol": [2, 0, 0.2, 10],
  "gpt-6-luna": [0.1, 0, 0.01, 0.5],
  "gpt-5.6-sol": [4, 0, 0.4, 20],
  "gpt-5.6-terra": [2, 0, 0.2, 12],
};

const tokens = (overrides: Partial<MetricsTokens> = {}): MetricsTokens => ({
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  cacheWriteTokens: 1_000_000,
  reasoningTokens: 1_000_000,
  ...overrides,
});

const OPUS_SELECTOR: MetricsRoute = { adapter: "claude", provider: "anthropic", model: "claude:opus", effort: "high" };
const SOL_SELECTOR: MetricsRoute = { adapter: "codex", provider: "openai-codex", model: "codex:gpt-5.6-sol", effort: "xhigh" };

test("the rate card validates against its schema and carries its twelve rows exactly, all checked 2026-09-30", () => {
  assert.equal(Value.Check(RateCardSchema, RATE_CARD), true, JSON.stringify([...Value.Errors(RateCardSchema, RATE_CARD)]));
  assert.equal(RATE_CARD.checkedAt, "2026-09-30");
  assert.deepEqual(RATE_CARD_ROWS.map((row) => row.model), Object.keys(DESIGN));
  for (const row of RATE_CARD_ROWS) {
    assert.deepEqual([row.input, row.cacheWrite, row.cacheRead, row.output], DESIGN[row.model], row.model);
    assert.equal(row.checkedAt, "2026-09-30");
    assert.equal(row.source, row.provider === "anthropic" ? ANTHROPIC_PRICING_SOURCE : OPENAI_PRICING_SOURCE);
    assert.equal(row.model.startsWith("claude-"), row.provider === "anthropic");
    if (row.provider === "openai") assert.equal(row.cacheWrite, 0, "OpenAI charges no cache write");
    assert.equal(Object.isFrozen(row), true);
  }
  assert.equal(Object.isFrozen(RATE_CARD_ROWS), true);
  // A malformed row is refused, so the schema is not vacuous.
  assert.equal(Value.Check(RateCardRowSchema, { ...RATE_CARD_ROWS[0], source: "http://example.test" }), false);
});

test("the card names its limitations", () => {
  const text = RATE_CARD.limitations.join("\n");
  assert.match(text, /5-minute rate/);
  assert.match(text, /1-hour write bills 2x input/);
  assert.match(text, /OpenAI rows are short-context rates/);
  assert.match(text, /OpenAI charges no cache write/);
});

test("a rate is found by its exact id only", () => {
  assert.equal(rateFor("claude-opus-5-5")?.label, "Opus 5.5");
  for (const alias of ["opus", "claude:opus", "claude-opus-5-5-20260922", "Claude-Opus-5-5", null]) {
    assert.equal(rateFor(alias), null, String(alias));
  }
});

test("listEquivalentUsd adds reasoning to output only when the relation is additive", () => {
  const opus = rateFor("claude-opus-5-5")!;
  // 1M of each kind: input 4 + cache read 0.2 + cache write 5 + output 20.
  assert.equal(listEquivalentUsd(tokens({ reasoningRelation: "included-in-output" }), opus), 29.2);
  assert.equal(listEquivalentUsd(tokens({ reasoningRelation: "unknown" }), opus), 29.2);
  assert.equal(listEquivalentUsd(tokens(), opus), 29.2, "an absent relation reads as unknown");
  assert.equal(listEquivalentUsd(tokens({ reasoningRelation: "additive" }), opus), 49.2);
  assert.equal(listEquivalentUsd(tokens({ reasoningRelation: "additive", reasoningTokens: null }), opus), 29.2);

  const sol = rateFor("gpt-5.6-sol")!;
  const small = { inputTokens: 26_000, outputTokens: 1_900, cacheReadTokens: 550_000, cacheWriteTokens: 7_000, reasoningTokens: 900 };
  // A cache write reported on an OpenAI route prices at the card's 0.
  const expected = (26_000 * 4 + 550_000 * 0.4 + 1_900 * 20) / 1_000_000;
  assert.equal(listEquivalentUsd({ ...small, reasoningRelation: "included-in-output" }, sol), expected);
  assert.equal(listEquivalentUsd({ ...small, inputTokens: null, reasoningRelation: "unknown" }, sol), expected - 26_000 * 4 / 1_000_000);
});

test("a row prices on its observed model, and a selector only when it is itself a card id", () => {
  const usage = tokens({ reasoningRelation: "included-in-output" });

  const observed = priceRow({ route: OPUS_SELECTOR, resolvedModel: "claude-opus-5", tokens: usage });
  assert.equal(observed.priced && observed.basis, "resolved-model");
  assert.equal(observed.priced && observed.rate.model, "claude-opus-5", "the observed model wins, not a guess from the selector");
  assert.equal(observed.priced && observed.usd, 5 + 0.5 + 6.25 + 25);

  const selector = priceRow({ route: SOL_SELECTOR, resolvedModel: null, tokens: usage });
  assert.equal(selector.priced && selector.basis, "selector");
  assert.equal(selector.priced && selector.rate.model, "gpt-5.6-sol");

  const unresolved = priceRow({ route: OPUS_SELECTOR, resolvedModel: null, tokens: usage });
  assert.deepEqual(unresolved, {
    priced: false, reason: "unresolved-selector",
    detail: "no model was observed and the selector opus is not a rate-card id",
  });
  const noRoute = priceRow({ route: { adapter: null, provider: null, model: null, effort: null }, resolvedModel: null, tokens: usage });
  assert.equal(!noRoute.priced && noRoute.reason, "unresolved-selector");

  const offCard = priceRow({ route: OPUS_SELECTOR, resolvedModel: "claude-opus-4-1", tokens: usage });
  assert.deepEqual(offCard, { priced: false, reason: "off-card", detail: "observed model claude-opus-4-1 is not on the rate card" });

  const silent = priceRow({
    route: SOL_SELECTOR, resolvedModel: "gpt-5.6-sol",
    tokens: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null },
  });
  assert.equal(!silent.priced && silent.reason, "no-usage");
});

test("listPrice is the module's RowPrice: unpriced rows are left out of the ≈ list total", () => {
  const base = { route: OPUS_SELECTOR, tokens: tokens({ reasoningRelation: "included-in-output" }) };
  assert.equal(listPrice({ ...base, resolvedModel: "claude-opus-5-5" } as never), 29.2);
  assert.equal(listPrice({ ...base, resolvedModel: null } as never), null);
});

test("formatListEquivalent always carries its label", () => {
  assert.equal(formatListEquivalent(12.3), "≈ list $12.30");
  assert.equal(formatListEquivalent(0), "≈ list $0.00");
  assert.equal(formatListEquivalent(0.004), "≈ list $0.00");
  assert.equal(formatListEquivalent(null), "≈ list —");
  assert.equal(formatListEquivalent(Number.NaN), "≈ list —");
  for (const usd of [0, 1, 12.345, 9_999.99]) assert.match(formatListEquivalent(usd), /^≈ list \$\d+\.\d\d$/);
});

test("formatCost still refuses a spend figure for a subscription route (D1)", () => {
  assert.equal(formatCost("unavailable", 12.3), "— subscription");
  assert.equal(formatCost("unavailable", 12.3), SUBSCRIPTION_COST_DISPLAY);
});

// ---------------------------------------------------------------------------
// Benchmark priors.
// ---------------------------------------------------------------------------

test("the priors carry the design's benchmark table with sources and a date", () => {
  assert.equal(Value.Check(BenchmarkPriorsSchema, BENCHMARK_PRIORS), true,
    JSON.stringify([...Value.Errors(BenchmarkPriorsSchema, BENCHMARK_PRIORS)]));
  assert.equal(BENCHMARKS.length, 14);
  assert.equal(new Set(BENCHMARKS.map((row) => row.id)).size, BENCHMARKS.length);
  for (const row of BENCHMARKS) {
    for (const score of row.scores) {
      if (row.scale === "percent") assert.ok(score.score <= 100, `${row.id} ${score.model}`);
      assert.notEqual(rateFor(score.model), null, `${row.id} scores ${score.model}, which is not a rate-card id`);
    }
  }
});

test("a prior mean is a probability from the role's percent benchmark, and null otherwise", () => {
  assert.equal(priorMean("builder", "claude-opus-5-5"), 0.664);
  assert.equal(priorMean("builder", "gpt-5.6-sol"), 0.373);
  assert.equal(priorMean("builder", "gpt-6-sol"), null, "Terminal-Bench scores no GPT-6 Sol");
  assert.equal(priorMean("builder", "opus"), null, "an alias is never mapped");
  assert.equal(priorMean("planner", "claude-opus-5-5"), null, "GDPval-AA is an Elo, not a probability");
  assert.equal(priorMean("reviewer", "claude-opus-5-5"), null, "SWE-Atlas-QnA publishes no per-model score here");
  assert.equal(priorMean("host", "claude-opus-5-5"), null);
});

test("the untested routes are the design's four, each with a key", () => {
  assert.deepEqual(UNTESTED_ROUTES.map(routeKey), [
    "claude/claude-opus-5-5@medium",
    "claude/claude-sonnet-5@medium",
    "codex/gpt-6-sol@high",
    "codex/gpt-5.6-terra@medium",
  ]);
  for (const route of UNTESTED_ROUTES) assert.ok(route.prior.length > 0 && route.label.length > 0);
});

test("priorLookup takes a selector that is a scored id, else the one model its rows were observed as", () => {
  const rows = [
    { route: OPUS_SELECTOR, resolvedModel: "claude-opus-5" },
    { route: OPUS_SELECTOR, resolvedModel: "claude-opus-5-5" },
    { route: { ...OPUS_SELECTOR, effort: "xhigh" }, resolvedModel: "claude-opus-5-5" },
    { route: { ...OPUS_SELECTOR, effort: "xhigh" }, resolvedModel: null },
  ];
  const observed = observedModels(rows);
  assert.deepEqual([...observed], [["claude/opus@xhigh", "claude-opus-5-5"]], "a key that saw two models has none");
  const lookup = priorLookup(observed);
  assert.equal(lookup("builder", SOL_SELECTOR), 0.373);
  assert.equal(lookup("builder", OPUS_SELECTOR), null);
  assert.equal(lookup("builder", { ...OPUS_SELECTOR, effort: "xhigh" }), 0.664);
  assert.equal(priorLookup()("builder", { ...OPUS_SELECTOR, effort: "xhigh" }), null);
});

test("recommend's prior-only branch ranks the untested routes on the supplied prior", () => {
  const result = recommend([], "builder", null, "production", {
    price: listPrice, prior: priorLookup(), untested: UNTESTED_ROUTES,
  });
  assert.equal(result?.basis, "prior only");
  assert.equal(result?.choice.key, "claude/claude-opus-5-5@medium");
  assert.equal(result?.choice.prior, 0.664);
  assert.equal(result?.ranked.length, 4);
  assert.equal(stats([], listPrice).listTotal, null);
});
