import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import {
  isPersistableKind,
  isTerminalKind,
  mintToolCallId,
  NORMALIZED_EVENT_KINDS,
  NORMALIZED_EVENT_SCHEMAS,
  NormalizedEventSchema,
  NOTICE_CODES,
  MODEL_RESOLUTION_PROVENANCES,
  REASONING_RELATIONS,
  RUN_ERROR_CODES,
  TERMINAL_EVENT_KINDS,
  TokenUsageSchema,
  UNREPORTED_TOKEN_USAGE,
  validateEventSequence,
  type NormalizedEvent,
} from "../../../src/contracts/index.ts";

function base(seq: number) {
  return { seq, runId: "run-1", hostAt: "2026-08-05T10:00:00.000Z", providerAt: null };
}

test("there are exactly twelve normalized event kinds, in the contract's order", () => {
  assert.deepEqual(
    [...NORMALIZED_EVENT_KINDS],
    [
      "run.started",
      "model.resolved",
      "text.delta",
      "thinking.delta",
      "tool.requested",
      "tool.completed",
      "usage",
      "quota",
      "notice",
      "run.completed",
      "run.failed",
      "run.cancelled",
    ],
  );
  assert.equal(NORMALIZED_EVENT_KINDS.length, 12);
});

test("every kind has a schema, and every schema pins its own kind literal", () => {
  const keys = Object.keys(NORMALIZED_EVENT_SCHEMAS).sort();
  assert.deepEqual(keys, [...NORMALIZED_EVENT_KINDS].sort());
  for (const kind of NORMALIZED_EVENT_KINDS) {
    const schema = NORMALIZED_EVENT_SCHEMAS[kind];
    const kindProperty = (schema.properties as Record<string, { const?: string }>)["kind"];
    assert.equal(kindProperty?.const, kind);
  }
});

test("the notice codes are exactly the six named in the contract, including sqlite-projection-failed", () => {
  assert.deepEqual(
    [...NOTICE_CODES],
    [
      "unknown-provider-event",
      "non-json-output",
      "clock-skew",
      "malformed-usage",
      "output-truncated",
      "sqlite-projection-failed",
    ],
  );
});

test("the eleven run error codes are the contract's set", () => {
  assert.equal(RUN_ERROR_CODES.length, 11);
  for (const code of ["E_MODEL_UNRESOLVED", "E_QUOTA_EXHAUSTED", "E_ADAPTER_UNVERIFIED", "E_REDACTION"]) {
    assert.ok((RUN_ERROR_CODES as readonly string[]).includes(code));
  }
});

test("model.resolved carries provenance, so an inferred identity is never shown as confirmed", () => {
  assert.deepEqual([...MODEL_RESOLUTION_PROVENANCES], ["stream-authoritative", "route-attributed"]);
  const event = {
    ...base(1),
    kind: "model.resolved",
    adapter: "claude-code",
    provider: "anthropic",
    requestedModel: "opus",
    resolvedModel: "claude-opus-5",
    provenance: "route-attributed",
  };
  assert.equal(Value.Check(NormalizedEventSchema, event), true);
  const { provenance: _dropped, ...withoutProvenance } = event;
  assert.equal(Value.Check(NormalizedEventSchema, withoutProvenance), false);
  assert.equal(Value.Check(NormalizedEventSchema, { ...event, provenance: "guessed" }), false);
});

test("TokenUsage: null is not zero, and neither may be omitted", () => {
  const reported = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    reasoningRelation: "included-in-output",
  };
  assert.equal(Value.Check(TokenUsageSchema, reported), true);
  assert.equal(Value.Check(TokenUsageSchema, UNREPORTED_TOKEN_USAGE), true);

  // The two are distinguishable: zeros are data, nulls are silence.
  assert.notDeepEqual(reported, UNREPORTED_TOKEN_USAGE);
  assert.equal(UNREPORTED_TOKEN_USAGE.inputTokens, null);
  assert.notEqual(UNREPORTED_TOKEN_USAGE.inputTokens, 0);

  // An omitted metric is rejected — absence would be a third, ambiguous state.
  const { inputTokens: _omitted, ...missing } = reported;
  assert.equal(Value.Check(TokenUsageSchema, missing), false);
  assert.equal(Value.Check(TokenUsageSchema, { ...reported, inputTokens: undefined }), false);
});

test("reasoningRelation is three-valued — SSSF's convention is one case, not a global truth", () => {
  assert.deepEqual([...REASONING_RELATIONS], ["included-in-output", "additive", "unknown"]);
  assert.equal(Value.Check(TokenUsageSchema, { ...UNREPORTED_TOKEN_USAGE, reasoningRelation: "share" }), false);
});

test("terminal kinds are the three run enders", () => {
  assert.deepEqual([...TERMINAL_EVENT_KINDS], ["run.completed", "run.failed", "run.cancelled"]);
  for (const kind of NORMALIZED_EVENT_KINDS) {
    assert.equal(isTerminalKind(kind), (TERMINAL_EVENT_KINDS as readonly string[]).includes(kind));
  }
});

test("invariant 9: thinking.delta is the one kind that is never persisted", () => {
  const nonPersistable = NORMALIZED_EVENT_KINDS.filter((kind) => !isPersistableKind(kind));
  assert.deepEqual(nonPersistable, ["thinking.delta"]);
});

test("tool call ids are host-minted t1, t2, … and provider ids never appear", () => {
  assert.equal(mintToolCallId(1), "t1");
  assert.equal(mintToolCallId(42), "t42");
  assert.throws(() => mintToolCallId(0), RangeError);
  assert.throws(() => mintToolCallId(1.5), RangeError);

  const withProviderId = {
    ...base(1),
    kind: "tool.requested",
    toolCallId: "toolu_01ABCdef",
    name: "Read",
    inputSummary: "",
  };
  assert.equal(Value.Check(NormalizedEventSchema, withProviderId), false);
});

test("sequence is authoritative: a non-contiguous seq is a violation", () => {
  const events = [
    { ...base(1), kind: "run.started", adapter: "stub", requestedModel: "m" },
    { ...base(5), kind: "run.completed", exitCode: 0 },
  ] as NormalizedEvent[];
  const codes = validateEventSequence(events).map((v) => v.code);
  assert.ok(codes.includes("seq-not-contiguous"));
});

test("exactly one terminal event per run, and it is last", () => {
  const started = { ...base(1), kind: "run.started", adapter: "stub", requestedModel: "m" };

  const none = validateEventSequence([started] as NormalizedEvent[]);
  assert.deepEqual(none.map((v) => v.code), ["terminal-missing"]);

  const two = validateEventSequence([
    started,
    { ...base(2), kind: "run.completed", exitCode: 0 },
    { ...base(3), kind: "run.failed", errorCode: "E_TIMEOUT", message: "late" },
  ] as NormalizedEvent[]);
  assert.ok(two.map((v) => v.code).includes("terminal-duplicated"));

  const notLast = validateEventSequence([
    started,
    { ...base(2), kind: "run.completed", exitCode: 0 },
    { ...base(3), kind: "text.delta", text: "after the end" },
  ] as NormalizedEvent[]);
  assert.ok(notLast.map((v) => v.code).includes("terminal-not-last"));
});

test("tool.completed is an explicit settlement — a terminal never closes a tool call implicitly", () => {
  const unsettled = validateEventSequence([
    { ...base(1), kind: "run.started", adapter: "stub", requestedModel: "m" },
    { ...base(2), kind: "tool.requested", toolCallId: "t1", name: "Read", inputSummary: "" },
    { ...base(3), kind: "run.completed", exitCode: 0 },
  ] as NormalizedEvent[]);
  assert.deepEqual(unsettled.map((v) => v.code), ["tool-unsettled-at-terminal"]);
});

test("cancellation settles every open tool first — an open tool at run.cancelled is still a violation", () => {
  const events = [
    { ...base(1), kind: "run.started", adapter: "stub", requestedModel: "m" },
    { ...base(2), kind: "tool.requested", toolCallId: "t1", name: "Read", inputSummary: "" },
    { ...base(3), kind: "run.cancelled", reason: "owner cancelled" },
  ] as NormalizedEvent[];
  assert.deepEqual(validateEventSequence(events).map((v) => v.code), ["tool-unsettled-at-terminal"]);

  const settledFirst = [
    { ...base(1), kind: "run.started", adapter: "stub", requestedModel: "m" },
    { ...base(2), kind: "tool.requested", toolCallId: "t1", name: "Read", inputSummary: "" },
    { ...base(3), kind: "tool.completed", toolCallId: "t1", outcome: "cancelled", durationMs: 12, resultSnippet: "" },
    { ...base(4), kind: "run.cancelled", reason: "owner cancelled" },
  ] as NormalizedEvent[];
  assert.deepEqual(validateEventSequence(settledFirst), []);
});

test("a settlement without a request, a double settlement, and a reused id are each violations", () => {
  const orphan = validateEventSequence([
    { ...base(1), kind: "run.started", adapter: "stub", requestedModel: "m" },
    { ...base(2), kind: "tool.completed", toolCallId: "t9", outcome: "ok", durationMs: 1, resultSnippet: "" },
    { ...base(3), kind: "run.completed", exitCode: 0 },
  ] as NormalizedEvent[]);
  assert.deepEqual(orphan.map((v) => v.code), ["tool-settled-without-request"]);

  const twice = validateEventSequence([
    { ...base(1), kind: "run.started", adapter: "stub", requestedModel: "m" },
    { ...base(2), kind: "tool.requested", toolCallId: "t1", name: "Read", inputSummary: "" },
    { ...base(3), kind: "tool.completed", toolCallId: "t1", outcome: "ok", durationMs: 1, resultSnippet: "" },
    { ...base(4), kind: "tool.completed", toolCallId: "t1", outcome: "ok", durationMs: 1, resultSnippet: "" },
    { ...base(5), kind: "run.completed", exitCode: 0 },
  ] as NormalizedEvent[]);
  assert.deepEqual(twice.map((v) => v.code), ["tool-settled-twice"]);

  const reused = validateEventSequence([
    { ...base(1), kind: "run.started", adapter: "stub", requestedModel: "m" },
    { ...base(2), kind: "tool.requested", toolCallId: "t1", name: "Read", inputSummary: "" },
    { ...base(3), kind: "tool.requested", toolCallId: "t1", name: "Read", inputSummary: "" },
    { ...base(4), kind: "tool.completed", toolCallId: "t1", outcome: "ok", durationMs: 1, resultSnippet: "" },
    { ...base(5), kind: "run.completed", exitCode: 0 },
  ] as NormalizedEvent[]);
  assert.deepEqual(reused.map((v) => v.code), ["tool-id-reused"]);
});

test("a well-formed run has no sequence violations", () => {
  const events = [
    { ...base(1), kind: "run.started", adapter: "stub", requestedModel: "m" },
    {
      ...base(2),
      kind: "model.resolved",
      adapter: "stub",
      provider: "fixture",
      requestedModel: "m",
      resolvedModel: "m",
      provenance: "stream-authoritative",
    },
    { ...base(3), kind: "thinking.delta", text: "…" },
    { ...base(4), kind: "tool.requested", toolCallId: "t1", name: "Read", inputSummary: "a.ts" },
    { ...base(5), kind: "tool.completed", toolCallId: "t1", outcome: "ok", durationMs: 8, resultSnippet: "ok" },
    { ...base(6), kind: "text.delta", text: "{" },
    { ...base(7), kind: "usage", usage: UNREPORTED_TOKEN_USAGE },
    { ...base(8), kind: "notice", code: "sqlite-projection-failed", message: "database is locked", detail: null },
    { ...base(9), kind: "run.completed", exitCode: 0 },
  ] as NormalizedEvent[];
  for (const event of events) {
    assert.equal(Value.Check(NormalizedEventSchema, event), true, `${event.kind} failed validation`);
  }
  assert.deepEqual(validateEventSequence(events), []);
});

test("provider timestamps are advisory — an event may carry none", () => {
  const event = { ...base(1), providerAt: null, kind: "text.delta", text: "x" };
  assert.equal(Value.Check(NormalizedEventSchema, event), true);
  const { providerAt: _dropped, ...missing } = event;
  assert.equal(Value.Check(NormalizedEventSchema, missing), false);
});

test("quota carries a reset time and never a retry hint", () => {
  const event = { ...base(1), kind: "quota", scope: "claude-pro-5h", resetAt: "2026-08-05T14:00:00Z", message: "" };
  assert.equal(Value.Check(NormalizedEventSchema, event), true);
  assert.equal(Value.Check(NormalizedEventSchema, { ...event, retryAfterMs: 1000 }), false);
});
