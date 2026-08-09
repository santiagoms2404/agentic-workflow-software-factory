import assert from "node:assert/strict";
import test from "node:test";
import { contextMeterPercent, costAuthorityLabel, formatCost, formatUsage, modelProvenanceLabel } from "../../../dashboard/src/display.ts";

test("dashboard never turns a subscription cost into a bare number", () => {
  assert.equal(formatCost("unavailable", 0), "— subscription");
  assert.equal(formatCost("unavailable", null), "— subscription");
});

test("dashboard marks catalog arithmetic as an estimate with its authority", () => {
  assert.equal(formatCost("catalog-estimate", 0.6479), "≈ $0.6479");
  assert.equal(costAuthorityLabel("catalog-estimate"), "estimate");
  assert.equal(formatCost("provider", 0.6479), "$0.6479");
});

test("dashboard exposes partial totals rather than inventing a token total", () => {
  assert.equal(formatUsage({ totalTokens: null } as never), "—");
  assert.equal(formatUsage({ totalTokens: 3_480_000 } as never), "3.48M");
});

test("dashboard labels model provenance and does not draw an unknown context window", () => {
  assert.equal(modelProvenanceLabel("stream-authoritative"), "stream-authoritative");
  assert.equal(modelProvenanceLabel("route-attributed"), "route-attributed");
  assert.equal(modelProvenanceLabel(null), "unrecorded");
  assert.equal(contextMeterPercent(100, null), null);
  assert.equal(contextMeterPercent(50, 100), 50);
});
