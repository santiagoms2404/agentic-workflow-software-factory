// The dated rate card behind every "≈ list $" figure (W18 D1, D2, DD4).
//
// A list-price equivalent is tokens by kind times a published per-1M price. It
// is a comparison unit across two subscriptions and never spend:
// `core/src/adapters/cost-display.ts` still refuses a spend figure for a
// subscription route, and nothing here changes that. Every rendering goes
// through `formatListEquivalent`, which always carries the "≈ list" label.
//
// Prices key on the model observed answering (`resolvedModel`), because one
// selector can reach more than one model: the owner's `claude:opus` resolved
// to both claude-opus-5 and claude-opus-5-5. A selector prices only when it is
// itself a rate-card id. Anything else is unpriced, with its reason, and no
// alias is ever mapped to a card id by guesswork.
//
// Updating a price is a one-file change here: the row, its `checkedAt` and its
// source move together.

import type { RateCard, RateCardRow } from "./types.ts";
import { canonicalModel, type MetricsRow, type MetricsTokens, type RowPrice } from "./route-metrics.ts";

export const RATE_CARD_CHECKED_AT = "2026-09-26";
export const ANTHROPIC_PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
export const OPENAI_PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing";

function anthropic(row: Omit<RateCardRow, "provider" | "checkedAt" | "source">): RateCardRow {
  return Object.freeze({ ...row, provider: "anthropic", checkedAt: RATE_CARD_CHECKED_AT, source: ANTHROPIC_PRICING_SOURCE });
}

function openai(row: Omit<RateCardRow, "provider" | "checkedAt" | "source">): RateCardRow {
  return Object.freeze({ ...row, provider: "openai", checkedAt: RATE_CARD_CHECKED_AT, source: OPENAI_PRICING_SOURCE });
}

/** USD per 1M tokens. Cache writes are the 5-minute rate; OpenAI charges none. */
export const RATE_CARD_ROWS: readonly RateCardRow[] = Object.freeze([
  anthropic({ model: "claude-fable-5-1", label: "Fable 5.1", tier: "state of the art", input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50, note: "credit-billed, explicit authorization only" }),
  anthropic({ model: "claude-opus-5-5", label: "Opus 5.5", tier: "state of the art", input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20, note: "released 2026-09-22, default effort medium" }),
  anthropic({ model: "claude-opus-5", label: "Opus 5", tier: "workhorse", input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25, note: null }),
  anthropic({ model: "claude-sonnet-5", label: "Sonnet 5", tier: "workhorse", input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10, note: "$2/$10 made permanent" }),
  anthropic({ model: "claude-haiku-4-5", label: "Haiku 4.5", tier: "lightweight", input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5, note: null }),
  openai({ model: "gpt-6-astra", label: "GPT-6 Astra", tier: "state of the art", input: 10, cacheWrite: 0, cacheRead: 1, output: 50, note: "released 2026-09-04" }),
  openai({ model: "gpt-6-sol", label: "GPT-6 Sol", tier: "workhorse", input: 2, cacheWrite: 0, cacheRead: 0.2, output: 10, note: null }),
  openai({ model: "gpt-6-luna", label: "GPT-6 Luna", tier: "lightweight", input: 0.1, cacheWrite: 0, cacheRead: 0.01, output: 0.5, note: null }),
  openai({ model: "gpt-5.6-sol", label: "GPT-5.6 Sol", tier: "workhorse", input: 4, cacheWrite: 0, cacheRead: 0.4, output: 20, note: null }),
  openai({ model: "gpt-5.6-terra", label: "GPT-5.6 Terra", tier: "workhorse", input: 2, cacheWrite: 0, cacheRead: 0.2, output: 12, note: null }),
]);

export const RATE_CARD_LIMITATIONS: readonly string[] = Object.freeze([
  "Cache writes are priced at the 5-minute rate. A 1-hour write bills 2x input, and usage events do not split the two, so ≈ list $ runs low for Claude rows.",
  "OpenAI rows are short-context rates.",
  "OpenAI charges no cache write.",
  "Reasoning tokens bill as output on both providers; they are added to output only when a usage event reports them as additive.",
  "A list-price equivalent is a comparison unit, never spend. Subscription routes still show no spend figure.",
]);

export const RATE_CARD: RateCard = Object.freeze({
  checkedAt: RATE_CARD_CHECKED_AT,
  rows: RATE_CARD_ROWS,
  limitations: RATE_CARD_LIMITATIONS,
});

/** The card's row for exactly this model id. No alias, prefix or date suffix is matched. */
export function rateFor(model: string | null): RateCardRow | null {
  return model === null ? null : RATE_CARD_ROWS.find((row) => row.model === model) ?? null;
}

/**
 * USD at list price: input, cache read, cache write and output at their rates.
 * Reasoning is added to output only when the relation is `additive`; when it is
 * `included-in-output` it is already there, and `unknown` adds nothing. A kind
 * no usage reported counts as zero.
 */
export function listEquivalentUsd(tokens: MetricsTokens, rate: RateCardRow): number {
  const reasoning = tokens.reasoningRelation === "additive" ? tokens.reasoningTokens ?? 0 : 0;
  return ((tokens.inputTokens ?? 0) * rate.input +
    (tokens.cacheReadTokens ?? 0) * rate.cacheRead +
    (tokens.cacheWriteTokens ?? 0) * rate.cacheWrite +
    ((tokens.outputTokens ?? 0) + reasoning) * rate.output) / 1_000_000;
}

export const UNPRICED_REASONS = ["off-card", "unresolved-selector", "no-usage"] as const;
export type UnpricedReason = (typeof UNPRICED_REASONS)[number];

export type RowPricing =
  | {
    readonly priced: true;
    /** `resolved-model` when the observed model priced it; `selector` when the route named a card id and none was observed. */
    readonly basis: "resolved-model" | "selector";
    readonly rate: RateCardRow;
    readonly usd: number;
  }
  | { readonly priced: false; readonly reason: UnpricedReason; readonly detail: string };

type PricedRow = Pick<MetricsRow, "route" | "resolvedModel" | "tokens">;

const TOKEN_KINDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"] as const;

/** One row's list-price equivalent, or why it has none. */
export function priceRow(row: PricedRow): RowPricing {
  let rate: RateCardRow | null;
  let basis: "resolved-model" | "selector";
  if (row.resolvedModel !== null) {
    rate = rateFor(row.resolvedModel);
    basis = "resolved-model";
    if (rate === null) {
      return { priced: false, reason: "off-card", detail: `observed model ${row.resolvedModel} is not on the rate card` };
    }
  } else {
    const selector = canonicalModel(row.route);
    rate = rateFor(selector);
    basis = "selector";
    if (rate === null) {
      return {
        priced: false,
        reason: "unresolved-selector",
        detail: selector === null
          ? "no model was observed and the route names none"
          : `no model was observed and the selector ${selector} is not a rate-card id`,
      };
    }
  }
  if (TOKEN_KINDS.every((kind) => row.tokens[kind] === null)) {
    return { priced: false, reason: "no-usage", detail: "no token usage was reported" };
  }
  return { priced: true, basis, rate, usd: listEquivalentUsd(row.tokens, rate) };
}

/** The `RowPrice` the metrics module takes: a row's ≈ list $, or `null` when it is unpriced. */
export const listPrice: RowPrice = (row) => {
  const pricing = priceRow(row);
  return pricing.priced ? pricing.usd : null;
};

/** Always labelled: "≈ list $x.xx", or "≈ list —" when there is no figure. Never a bare "$". */
export function formatListEquivalent(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "≈ list —";
  return `≈ list $${usd.toFixed(2)}`;
}
