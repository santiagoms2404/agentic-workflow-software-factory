import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeCeilingGrant,
  summarizeCompiledPrompt,
  summarizeEvent,
  summarizeModelResolved,
  summarizeNotice,
  summarizeQuota,
  summarizeRunCancelled,
  summarizeRunCompleted,
  summarizeRunFailed,
  summarizeRunStarted,
  summarizeTextDelta,
  summarizeToolCall,
  summarizeUsage,
} from "../../../dashboard/src/event-summary.ts";
import type { EventItem } from "../../../dashboard/shared/types.ts";

function event(type: string, payload: unknown, overrides: Partial<EventItem> = {}): EventItem {
  return {
    row: 1, id: "event-1", phaseId: "phase-1", runId: "run-1", parentEventId: null,
    firstSourceSeq: 1, lastSourceSeq: 1, type, name: "", status: null, payload,
    startedAt: "2026-01-01T00:00:00.000Z", endedAt: null,
    inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    reasoningTokens: null, totalTokens: null, estimatedCostUsd: null, costAuthority: null,
    ...overrides,
  };
}

test("tool_call summary uses the completed result rather than input", () => {
  const item = event("tool_call", { inputSummary: "escaped input", resultSnippet: "replaced 2 blocks", outcome: "ok", durationMs: 81 }, { name: "Edit" });
  assert.equal(summarizeToolCall(item), "Edit · replaced 2 blocks · ok 81ms");
  assert.equal(summarizeEvent(item), "Edit · replaced 2 blocks · ok 81ms");
  assert.equal(summarizeToolCall(event("tool_call", {}, { name: "Edit" })), "Edit · running");
});

test("usage summary formats each reported token category", () => {
  const item = event("usage", { usage: { inputTokens: 156_800, outputTokens: 43_300, cacheReadTokens: 4_190_000, cacheWriteTokens: null, reasoningTokens: 16_700 } });
  assert.equal(summarizeUsage(item), "156.8k in / 43.3k out · 4.19M cached · 16.7k reasoning");
  assert.equal(summarizeEvent(item), "156.8k in / 43.3k out · 4.19M cached · 16.7k reasoning");
  assert.equal(summarizeUsage(event("usage", { usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null } })), "—");
});

test("quota summary keeps the recorded message", () => {
  const item = event("quota", { message: "quota resets at 10:00" });
  assert.equal(summarizeQuota(item), "quota resets at 10:00");
  assert.equal(summarizeEvent(item), "quota resets at 10:00");
});

test("notice summary combines code and message", () => {
  const item = event("notice", { code: "clock-skew", message: "provider clock differs" });
  assert.equal(summarizeNotice(item), "clock-skew: provider clock differs");
  assert.equal(summarizeEvent(item), "clock-skew: provider clock differs");
});

test("run.started summary identifies adapter and requested model", () => {
  const item = event("run.started", { adapter: "claude-code", requestedModel: "sonnet-5" });
  assert.equal(summarizeRunStarted(item), "claude-code → sonnet-5");
  assert.equal(summarizeEvent(item), "claude-code → sonnet-5");
});

test("model.resolved summary identifies provenance", () => {
  const item = event("model.resolved", { resolvedModel: "claude-sonnet", provenance: "stream-authoritative" });
  assert.equal(summarizeModelResolved(item), "claude-sonnet (stream-authoritative)");
  assert.equal(summarizeEvent(item), "claude-sonnet (stream-authoritative)");
});

test("run.completed summary identifies the exit code", () => {
  const item = event("run.completed", { exitCode: 0 });
  assert.equal(summarizeRunCompleted(item), "exit 0");
  assert.equal(summarizeEvent(item), "exit 0");
});

test("run.failed summary identifies the failure", () => {
  const item = event("run.failed", { errorCode: "E_TIMEOUT", message: "deadline elapsed" });
  assert.equal(summarizeRunFailed(item), "E_TIMEOUT: deadline elapsed");
  assert.equal(summarizeEvent(item), "E_TIMEOUT: deadline elapsed");
});

test("run.cancelled summary identifies the reason", () => {
  const item = event("run.cancelled", { reason: "owner stopped run" });
  assert.equal(summarizeRunCancelled(item), "owner stopped run");
  assert.equal(summarizeEvent(item), "owner stopped run");
});

test("compiled_prompt summary identifies the prompt and line count", () => {
  const item = event("compiled_prompt", { lineCount: 42 }, { name: "review" });
  assert.equal(summarizeCompiledPrompt(item), "review · 42 lines");
  assert.equal(summarizeEvent(item), "review · 42 lines");
});

test("ceiling_grant summary identifies the change and reason", () => {
  const item = event("ceiling_grant", { from: 4, to: 7, reason: "owner approved" });
  assert.equal(summarizeCeilingGrant(item), "4 → 7 calls · owner approved");
  assert.equal(summarizeEvent(item), "4 → 7 calls · owner approved");
});

test("text.delta summary previews text instead of its type", () => {
  const item = event("text.delta", { text: "model response" });
  assert.equal(summarizeTextDelta(item), "model response");
  assert.equal(summarizeEvent(item), "model response");
});

test("unknown event kinds use an em dash", () => {
  const item = event("future.event", { message: "ignored" }, { name: "named" });
  assert.equal(summarizeEvent(item), "—");
});
