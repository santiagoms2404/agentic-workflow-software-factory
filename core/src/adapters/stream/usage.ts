// `null ≠ 0`, in the one place that decides it.
//
// This is a small file on purpose. The rule it holds is one sentence long and is
// wrong in a way nobody sees: a provider that did not report cache reads and a
// provider that reported zero of them are different facts, and collapsing them
// makes a subscription route look measured when it was not. Every path from
// provider bytes to a `TokenUsage` goes through here, so there is exactly one
// place the collapse could happen and it does not.
//
// It lives beside the sequencer rather than inside it because the sequencer is
// about ORDER and this is about a single event's payload — the advisory LOC
// budget noticed the second contract before anybody else did.

import {
  REASONING_RELATIONS,
  UNREPORTED_TOKEN_USAGE,
  type TokenUsage,
} from "../../contracts/normalized-events.ts";

const USAGE_COUNTS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
] as const;

export interface NormalizedUsage {
  usage: TokenUsage;
  /** Everything about the report the host could not read. Empty is the good case. */
  faults: string[];
}

/**
 * Turns whatever a provider reported into a `TokenUsage`, plus the list of
 * things about it the host could not read.
 *
 * A metric that is absent, null, or unreadable becomes `null` — never `0`. A
 * zero in the output is a zero the provider reported, and downstream is entitled
 * to treat it as data.
 *
 * Every fault is collected rather than the first one thrown: a report with three
 * bad fields is a fact about the provider, and a caller told only about the
 * first would fix it three times.
 */
export function normalizeUsage(raw: unknown): NormalizedUsage {
  if (raw === null || typeof raw !== "object") {
    return { usage: { ...UNREPORTED_TOKEN_USAGE }, faults: ["usage was not an object"] };
  }
  const source = raw as Record<string, unknown>;
  const usage: TokenUsage = { ...UNREPORTED_TOKEN_USAGE };
  const faults: string[] = [];

  for (const field of USAGE_COUNTS) {
    const value = source[field];
    // Absent and explicitly null are the same statement: not reported.
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      usage[field] = value;
      continue;
    }
    faults.push(`${field} was ${JSON.stringify(value)}, which is not a token count — recorded as null`);
  }

  const relation = source["reasoningRelation"];
  if (typeof relation === "string" && (REASONING_RELATIONS as readonly string[]).includes(relation)) {
    usage.reasoningRelation = relation as TokenUsage["reasoningRelation"];
  } else if (relation !== undefined && relation !== null) {
    faults.push(`reasoningRelation was ${JSON.stringify(relation)} — recorded as unknown`);
  }

  for (const key of Object.keys(source)) {
    if (key !== "reasoningRelation" && !(USAGE_COUNTS as readonly string[]).includes(key)) {
      // Reported rather than ignored: a provider carrying a metric this contract
      // has no field for is a fact about the adapter, not about the run.
      faults.push(`${key} is not a metric this contract carries — dropped`);
    }
  }

  return { usage, faults };
}
