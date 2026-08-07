// The sequencer: every invariant the plan states over a RUN rather than over an
// event.
//
// The cases below are the ones a parser gets subtly wrong and nobody notices
// until a session cannot be reconstructed: a terminal that closed a tool call by
// implication, a `0` that was really "not reported", a model identity nobody
// confirmed rendered as though somebody had.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventSequencer, type ModelIdentity } from "../../../../src/adapters/stream/event-sequencer.ts";
import { normalizeUsage } from "../../../../src/adapters/stream/usage.ts";
import { OutputBudget } from "../../../../src/adapters/stream/output-budget.ts";
import {
  isPersistableKind,
  validateEventSequence,
  type NormalizedEvent,
} from "../../../../src/contracts/normalized-events.ts";

/** A clock that advances one second per reading, so durations are deterministic. */
function tickingClock(): () => string {
  let tick = 0;
  return () => {
    const at = new Date(Date.UTC(2026, 7, 7, 0, 0, tick));
    tick += 1;
    return at.toISOString();
  };
}

function sequencerFor(options: {
  budget?: OutputBudget;
  attributedModel?: ModelIdentity;
} = {}): EventSequencer {
  return new EventSequencer({
    runId: "run-1",
    now: tickingClock(),
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.attributedModel === undefined ? {} : { attributedModel: options.attributedModel }),
  });
}

const STUB_MODEL = {
  adapter: "stub",
  provider: "stub",
  requestedModel: "stub/success",
  resolvedModel: "stub-model-1",
} as const;

/** Opens a run and names its model, which is the boring prefix of most cases. */
function opened(sequencer: EventSequencer): NormalizedEvent[] {
  return [
    ...sequencer.started({ adapter: "stub", requestedModel: "stub/success" }),
    ...sequencer.resolveModel({ ...STUB_MODEL, provenance: "stream-authoritative" }),
  ];
}

function kinds(events: readonly NormalizedEvent[]): string[] {
  return events.map((event) => event.kind);
}

test("a run is contiguous from seq 1 and ends in exactly one terminal", () => {
  const sequencer = sequencerFor();
  const events = [
    ...opened(sequencer),
    ...sequencer.text("text.delta", "hello"),
    ...sequencer.complete(0),
  ];

  assert.deepEqual(kinds(events), ["run.started", "model.resolved", "text.delta", "run.completed"]);
  assert.deepEqual(
    events.map((event) => event.seq),
    [1, 2, 3, 4],
  );
  assert.deepEqual(validateEventSequence(events), []);
  assert.equal(sequencer.terminal, "run.completed");
});

test("nothing is emitted after a terminal — not another terminal, not anything else", () => {
  const sequencer = sequencerFor();
  opened(sequencer);
  sequencer.complete(0);

  assert.deepEqual([...sequencer.complete(0)], []);
  assert.deepEqual([...sequencer.fail("E_BACKEND_FAILURE", "too late")], []);
  assert.deepEqual([...sequencer.cancel("too late")], []);
  assert.deepEqual([...sequencer.text("text.delta", "too late")], []);
  assert.deepEqual([...sequencer.notice("non-json-output", "too late", null)], []);
  assert.deepEqual([...sequencer.finish()], []);
  assert.equal(sequencer.seq, 3, "seq did not advance for a single refused event");
});

test("a stream that simply stopped failed — it did not succeed quietly", () => {
  const sequencer = sequencerFor();
  const events = [...opened(sequencer), ...sequencer.finish()];
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" && terminal.errorCode, "E_TERMINAL_MISSING");
  assert.deepEqual(validateEventSequence(events), []);
});

// ---------------------------------------------------------------------------
// Tool settlement — explicit, always, and first on cancellation.
// ---------------------------------------------------------------------------

test("cancellation settles every open tool call EXPLICITLY, before the terminal", () => {
  const sequencer = sequencerFor();
  const events = [
    ...opened(sequencer),
    ...sequencer.toolRequested({ providerToolId: "toolu_01ABC", name: "read", inputSummary: "src/a.ts" }),
    ...sequencer.toolRequested({ providerToolId: "toolu_02DEF", name: "grep", inputSummary: "needle" }),
    ...sequencer.cancel("the owner cancelled the run"),
  ];

  assert.deepEqual(kinds(events), [
    "run.started",
    "model.resolved",
    "tool.requested",
    "tool.requested",
    "tool.completed",
    "tool.completed",
    "run.cancelled",
  ]);
  const settlements = events.filter((event) => event.kind === "tool.completed");
  for (const settled of settlements) {
    assert.equal(settled.kind === "tool.completed" && settled.outcome, "cancelled");
  }
  // Settled in the order they were opened, and both before the terminal.
  assert.deepEqual(
    settlements.map((event) => (event.kind === "tool.completed" ? event.toolCallId : "")),
    ["t1", "t2"],
  );
  assert.deepEqual(validateEventSequence(events), []);
});

test("a terminal arriving over an open call settles it explicitly rather than by implication", () => {
  // A provider that says "done" with a call still open has not closed it. The
  // host records what actually happened — an `error` settlement naming the
  // breach — instead of leaving a consumer to infer that the terminal did it.
  const sequencer = sequencerFor();
  const events = [
    ...opened(sequencer),
    ...sequencer.toolRequested({ providerToolId: "p1", name: "read", inputSummary: "" }),
    ...sequencer.complete(0),
  ];

  const settled = events[events.length - 2];
  assert.equal(settled?.kind, "tool.completed");
  assert.equal(settled?.kind === "tool.completed" && settled.outcome, "error");
  assert.match(settled?.kind === "tool.completed" ? settled.resultSnippet : "", /still open/);
  assert.equal(events[events.length - 1]?.kind, "run.completed");
  assert.deepEqual(validateEventSequence(events), []);
});

test("tool ids are host-minted; the provider's own ids never reach an event", () => {
  const sequencer = sequencerFor();
  const events = [
    ...opened(sequencer),
    ...sequencer.toolRequested({ providerToolId: "toolu_01SECRET", name: "read", inputSummary: "a" }),
    ...sequencer.toolCompleted({ providerToolId: "toolu_01SECRET", outcome: "ok", resultSnippet: "42 lines" }),
    ...sequencer.toolRequested({ providerToolId: "call_9f2", name: "grep", inputSummary: "b" }),
    ...sequencer.toolCompleted({ providerToolId: "call_9f2", outcome: "error", resultSnippet: "no match" }),
    ...sequencer.complete(0),
  ];

  const ids = events.flatMap((event) =>
    event.kind === "tool.requested" || event.kind === "tool.completed" ? [event.toolCallId] : [],
  );
  assert.deepEqual(ids, ["t1", "t1", "t2", "t2"]);
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes("toolu_01SECRET"), "a provider id leaked into the event stream");
  assert.ok(!serialized.includes("call_9f2"), "a provider id leaked into the event stream");
  assert.deepEqual(validateEventSequence(events), []);
});

test("a settlement for a call the host never opened is a notice, not an unpaired event", () => {
  const sequencer = sequencerFor();
  const events = [
    ...opened(sequencer),
    ...sequencer.toolCompleted({ providerToolId: "ghost", outcome: "ok", resultSnippet: "" }),
    ...sequencer.complete(0),
  ];
  const notice = events[2];
  assert.equal(notice?.kind, "notice");
  assert.equal(notice?.kind === "notice" && notice.code, "unknown-provider-event");
  // An unpaired `tool.completed` here would read as `tool-settled-without-request`.
  assert.deepEqual(validateEventSequence(events), []);
});

test("a duplicate request for an already-open call opens nothing", () => {
  const sequencer = sequencerFor();
  opened(sequencer);
  assert.equal(sequencer.toolRequested({ providerToolId: "p", name: "read", inputSummary: "" }).length, 1);
  assert.deepEqual([...sequencer.toolRequested({ providerToolId: "p", name: "read", inputSummary: "" })], []);
  assert.equal(sequencer.openToolCount, 1);
});

test("durations come from the host's own clock, and an unnamed tool is labelled, not dropped", () => {
  const sequencer = sequencerFor(); // one second per stamp
  opened(sequencer);
  const requested = sequencer.toolRequested({ providerToolId: "p", name: "not a tool name!", inputSummary: "" });
  assert.equal(requested[0]?.kind === "tool.requested" && requested[0].name, "tool");
  const settled = sequencer.toolCompleted({ providerToolId: "p", outcome: "ok", resultSnippet: "" });
  assert.equal(settled[0]?.kind === "tool.completed" && settled[0].durationMs, 1_000);
});

// ---------------------------------------------------------------------------
// Model identity — fail closed, and never present an inference as a confirmation.
// ---------------------------------------------------------------------------

test("an unrepresentable model identity fails closed rather than resolving", () => {
  for (const resolvedModel of ["", "   ", "a model, probably", "x".repeat(200), "opus"]) {
    const sequencer = sequencerFor();
    sequencer.started({ adapter: "stub", requestedModel: "stub/success" });
    const events = [...sequencer.resolveModel({ ...STUB_MODEL, resolvedModel, provenance: "stream-authoritative" })];
    const terminal = events[events.length - 1];
    assert.equal(terminal?.kind, "run.failed", `${JSON.stringify(resolvedModel)} should not resolve`);
    assert.equal(terminal?.kind === "run.failed" && terminal.errorCode, "E_MODEL_UNRESOLVED");
    assert.equal(sequencer.resolvedModel, null);
  }
});

test("a run that completes without ever naming a model fails closed too", () => {
  const sequencer = sequencerFor();
  const events = [
    ...sequencer.started({ adapter: "stub", requestedModel: "stub/no-model-line" }),
    ...sequencer.text("text.delta", "an answer from nobody knows what"),
    ...sequencer.complete(0),
  ];
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" && terminal.errorCode, "E_MODEL_UNRESOLVED");
  assert.deepEqual(validateEventSequence(events), []);
});

test("a route-attributed identity is emitted as inferred, never as confirmed", () => {
  const sequencer = sequencerFor({
    attributedModel: {
      adapter: "claude-code",
      provider: "anthropic",
      requestedModel: "claude-opus-5",
      resolvedModel: "claude-opus-5",
    },
  });
  const events = [
    ...sequencer.started({ adapter: "claude-code", requestedModel: "claude-opus-5" }),
    ...sequencer.complete(0),
  ];
  const resolved = events[1];
  assert.equal(resolved?.kind, "model.resolved");
  assert.equal(resolved?.kind === "model.resolved" && resolved.provenance, "route-attributed");
  assert.equal(events[2]?.kind, "run.completed");
  assert.deepEqual(validateEventSequence(events), []);
});

test("a stream-authoritative identity wins over the route's; the route never overwrites it", () => {
  const sequencer = sequencerFor({
    attributedModel: { ...STUB_MODEL, resolvedModel: "guessed-model" },
  });
  const events = [...opened(sequencer), ...sequencer.complete(0)];
  assert.equal(kinds(events).filter((kind) => kind === "model.resolved").length, 1);
  assert.equal(sequencer.resolvedModel?.resolvedModel, "stub-model-1");
  assert.equal(sequencer.resolvedModel?.provenance, "stream-authoritative");
});

test("a run that answers on two different models fails with E_MODEL_MISMATCH", () => {
  const sequencer = sequencerFor();
  opened(sequencer);
  // The same identity again is a repeat, not a second event.
  assert.deepEqual([...sequencer.resolveModel({ ...STUB_MODEL, provenance: "stream-authoritative" })], []);

  const events = [
    ...sequencer.resolveModel({ ...STUB_MODEL, resolvedModel: "stub-model-2", provenance: "stream-authoritative" }),
  ];
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind === "run.failed" && terminal.errorCode, "E_MODEL_MISMATCH");
});

test("a provider that opens the same run twice is reported, not obeyed", () => {
  const sequencer = sequencerFor();
  sequencer.started({ adapter: "stub", requestedModel: "stub/success" });
  const second = sequencer.started({ adapter: "stub", requestedModel: "stub/success" });
  assert.equal(second[0]?.kind, "notice");
  assert.equal(second[0]?.kind === "notice" && second[0].code, "unknown-provider-event");
});

// ---------------------------------------------------------------------------
// Usage — null is not zero.
// ---------------------------------------------------------------------------

test("a metric the provider did not report is null; a zero it did report is data", () => {
  const sequencer = sequencerFor();
  opened(sequencer);
  const events = [...sequencer.usage({ inputTokens: 0, outputTokens: 12, reasoningRelation: "additive" })];
  const event = events[0];
  assert.equal(event?.kind, "usage");
  const usage = event?.kind === "usage" ? event.usage : null;
  assert.equal(usage?.inputTokens, 0, "a reported zero is authoritative data");
  assert.equal(usage?.outputTokens, 12);
  assert.equal(usage?.cacheReadTokens, null, "an unreported metric is null, never zero");
  assert.equal(usage?.reasoningTokens, null);
  assert.equal(usage?.reasoningRelation, "additive");
});

test("usage the host cannot read is nulled behind a malformed-usage notice", () => {
  const sequencer = sequencerFor();
  opened(sequencer);
  const events = [
    ...sequencer.usage({ inputTokens: -4, outputTokens: "many", reasoningRelation: "guessed", costUsd: 0.12 }),
  ];
  assert.deepEqual(kinds(events), ["notice", "usage"]);
  const notice = events[0];
  assert.equal(notice?.kind === "notice" && notice.code, "malformed-usage");
  const event = events[1];
  const usage = event?.kind === "usage" ? event.usage : null;
  assert.equal(usage?.inputTokens, null);
  assert.equal(usage?.outputTokens, null);
  assert.equal(usage?.reasoningRelation, "unknown");
});

test("normalizeUsage names every fault it found rather than the first", () => {
  const { usage, faults } = normalizeUsage({ inputTokens: 1.5, cacheWriteTokens: null, mystery: true });
  assert.equal(usage.inputTokens, null);
  assert.equal(usage.cacheWriteTokens, null);
  assert.equal(faults.length, 2, faults.join(" | "));
  assert.deepEqual(normalizeUsage("nope").faults, ["usage was not an object"]);
});

// ---------------------------------------------------------------------------
// The clock is advisory; seq is authoritative.
// ---------------------------------------------------------------------------

test("a clock that goes backwards is noticed once, and never reorders the run", () => {
  const sequencer = sequencerFor();
  const events = [
    ...sequencer.started({
      adapter: "stub",
      requestedModel: "stub/success",
      providerAt: "2026-08-07T00:00:10.000Z",
    }),
    ...sequencer.resolveModel({
      ...STUB_MODEL,
      provenance: "stream-authoritative",
      providerAt: "2026-08-07T00:00:05.000Z",
    }),
    ...sequencer.text("text.delta", "later still", "2026-08-07T00:00:01.000Z"),
    ...sequencer.complete(0),
  ];

  const notices = events.filter((event) => event.kind === "notice");
  assert.equal(notices.length, 1, "one notice per run, not one per skewed line");
  assert.equal(notices[0]?.kind === "notice" && notices[0].code, "clock-skew");
  // Order is `seq`, and `seq` never moved.
  assert.deepEqual(
    events.map((event) => event.seq),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(validateEventSequence(events), []);
});

test("a provider timestamp the host cannot read is a notice, not a crash", () => {
  const sequencer = sequencerFor();
  const events = [...sequencer.started({ adapter: "stub", requestedModel: "s", providerAt: "yesterday-ish" })];
  assert.equal(events[0]?.kind === "notice" && events[0].code, "clock-skew");
  assert.equal(events[1]?.kind, "run.started");
  assert.equal(events[1]?.providerAt, "yesterday-ish", "advisory means displayed, not discarded");
});

// ---------------------------------------------------------------------------
// The budget, from the sequencer's side.
// ---------------------------------------------------------------------------

test("text is bounded on a code point boundary and announced once", () => {
  const sequencer = sequencerFor({ budget: new OutputBudget({ maxOutputBytes: 6 }) });
  opened(sequencer);
  const events = [
    ...sequencer.text("text.delta", "ab🙂cd"),
    ...sequencer.text("text.delta", "more"),
    ...sequencer.complete(0),
  ];

  const delta = events[0];
  assert.equal(delta?.kind === "text.delta" && delta.text, "ab🙂", "cut on the code point boundary");
  const notices = events.filter((event) => event.kind === "notice");
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.kind === "notice" && notices[0].code, "output-truncated");
  assert.equal(kinds(events).filter((kind) => kind === "text.delta").length, 1);
  assert.equal(events[events.length - 1]?.kind, "run.completed");
});

test("an exhausted event budget still lets the run reach its own terminal", () => {
  // The rule the whole layer exists for. A budget that could drop a terminal
  // would turn "this run said too much" into "this run never ended".
  const sequencer = sequencerFor({ budget: new OutputBudget({ maxEventCount: 6 }) });
  const events = [...opened(sequencer)];
  for (let index = 0; index < 50; index += 1) events.push(...sequencer.text("text.delta", `line ${index}`));
  events.push(...sequencer.complete(0));

  assert.equal(events[events.length - 1]?.kind, "run.completed", "the terminal survived the cap");
  assert.equal(kinds(events).filter((kind) => kind === "notice").length, 1);
  assert.ok(events.length <= 8, `the cap held: ${events.length} events`);
  assert.deepEqual(validateEventSequence(events), []);
});

test("a tool call opened under a tight cap is still settled explicitly", () => {
  const sequencer = sequencerFor({ budget: new OutputBudget({ maxEventCount: 6 }) });
  const events = [
    ...opened(sequencer),
    ...sequencer.toolRequested({ providerToolId: "p1", name: "read", inputSummary: "" }),
    ...sequencer.text("text.delta", "chatter the cap will refuse"),
    ...sequencer.cancel("cancelled under a tight cap"),
  ];
  assert.deepEqual(kinds(events).slice(-2), ["tool.completed", "run.cancelled"]);
  assert.deepEqual(validateEventSequence(events), []);
});

// ---------------------------------------------------------------------------
// Contract cross-checks.
// ---------------------------------------------------------------------------

test("thinking is sequenced for live display and excluded from persistence", () => {
  const sequencer = sequencerFor();
  const events = [...opened(sequencer), ...sequencer.text("thinking.delta", "reasoning"), ...sequencer.complete(0)];
  assert.ok(events.some((event) => event.kind === "thinking.delta"));
  assert.equal(isPersistableKind("thinking.delta"), false);
  assert.deepEqual(
    events.filter((event) => isPersistableKind(event.kind)).map((event) => event.kind),
    ["run.started", "model.resolved", "run.completed"],
  );
});

test("every event carries the run id it was sequenced for", () => {
  const sequencer = sequencerFor();
  const events = [...opened(sequencer), ...sequencer.quota({ scope: "5h", resetAt: null, message: "" }), ...sequencer.complete(0)];
  for (const event of events) assert.equal(event.runId, "run-1");
});

test("a sequencer without a run id is not constructible", () => {
  assert.throws(() => new EventSequencer({ runId: "" }), RangeError);
});
