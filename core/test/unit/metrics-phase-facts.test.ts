import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/observability/sqlite.ts";
import { readPhaseFacts, type PhaseFacts } from "../../src/metrics/phase-facts.ts";
import { OPUS_HIGH, SyntheticAttempt, phase, session, usage } from "./_metrics-journal.ts";

const CODEX = ["builder", "codex", "openai-codex", "codex:gpt-6-sol"] as const;

function factsOf(run: SyntheticAttempt): { facts: PhaseFacts[]; agentInput: number | null; agentCalls: number } {
  const db = openDatabase(":memory:");
  try {
    run.project(db);
    const agent = db.prepare("SELECT input_tokens, call_count FROM agent_sessions WHERE agent = 'builder'").get() as
      | { input_tokens: number | null; call_count: number }
      | undefined;
    return { facts: readPhaseFacts(db), agentInput: agent?.input_tokens ?? null, agentCalls: agent?.call_count ?? 0 };
  } finally {
    db.close();
  }
}

/** One builder phase that took a correction: two calls, the second far smaller than the first. */
function twoCallBuild(): SyntheticAttempt {
  const run = new SyntheticAttempt(session("s1"));
  run.phase(phase("t01-build", "builder"));
  run.start("phase-t01-build", ...CODEX);
  run.event("phase-t01-build", "run-1", { kind: "run.started", adapter: "pi-codex", requestedModel: "gpt-6-sol" });
  run.event("phase-t01-build", "run-1", { kind: "tool.requested", toolCallId: "t1", name: "Read", inputSummary: "core/src/a.ts" });
  run.event("phase-t01-build", "run-1", { kind: "tool.completed", toolCallId: "t1", outcome: "ok", durationMs: 120, resultSnippet: "" });
  run.event("phase-t01-build", "run-1", { kind: "tool.requested", toolCallId: "t2", name: "bash", inputSummary: "npm test" });
  run.event("phase-t01-build", "run-1", { kind: "tool.completed", toolCallId: "t2", outcome: "error", durationMs: 30, resultSnippet: "exit 1" });
  run.event("phase-t01-build", "run-1", { kind: "usage", usage: usage(1000, 200, 5000, 300, 50) });
  run.call("phase-t01-build", ...CODEX, "gpt-6-sol", usage(1000, 200, 5000, 300, 50));
  run.start("phase-t01-build", ...CODEX);
  run.event("phase-t01-build", "run-2", { kind: "run.started", adapter: "pi-codex", requestedModel: "gpt-6-sol" });
  run.event("phase-t01-build", "run-2", { kind: "tool.requested", toolCallId: "t1", name: "Grep", inputSummary: "TODO" });
  run.event("phase-t01-build", "run-2", { kind: "tool.completed", toolCallId: "t1", outcome: "ok", durationMs: 10, resultSnippet: "" });
  // Still running when the record was cut: counted as a call, contributes no time.
  run.event("phase-t01-build", "run-2", { kind: "tool.requested", toolCallId: "t2", name: "Edit", inputSummary: "core/src/a.ts" });
  run.event("phase-t01-build", "run-2", { kind: "usage", usage: usage(100, 20, 400, 0, 5) });
  run.call("phase-t01-build", ...CODEX, "gpt-6-sol", usage(100, 20, 400, 0, 5));
  run.phase(phase("t01-build", "builder", { status: "SUCCEEDED", correctionCount: 1, endedAt: "2026-09-26T10:12:00.000Z" }));
  return run;
}

test("a role with two calls: the phase sums both, while agent_sessions holds only the second (F8)", () => {
  const { facts, agentInput, agentCalls } = factsOf(twoCallBuild());
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0]!.tokens, {
    inputTokens: 1100,
    outputTokens: 220,
    cacheReadTokens: 5400,
    cacheWriteTokens: 300,
    reasoningTokens: 55,
    reasoningRelation: "included-in-output",
    usageEvents: 2,
  });
  assert.equal(agentCalls, 2);
  assert.equal(agentInput, 100, "the projector replaces the role row per call; that is why it is never read");
  assert.equal(facts[0]!.role?.callCount, 2);
});

test("turns, minutes, tool classes, tool errors and tool time come from the phase's own events", () => {
  const [build] = factsOf(twoCallBuild()).facts;
  assert.equal(build!.turns, 2);
  assert.equal(build!.minutes, 12);
  assert.equal(build!.correctionCount, 1);
  assert.deepEqual(build!.tools, {
    calls: 4,
    byClass: { read: 1, search: 1, edit: 1, exec: 1, other: 0 },
    errors: 1,
    timeMs: 160,
  });
});

test("an open phase has no minutes, and a phase without usage has null tokens rather than zeros", () => {
  const run = new SyntheticAttempt(session("s1"));
  run.phase(phase("t01-build", "builder"));
  const [open] = factsOf(run).facts;
  assert.equal(open!.minutes, null);
  assert.equal(open!.turns, 0);
  assert.deepEqual(open!.tokens, {
    inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null,
    reasoningRelation: "unknown", usageEvents: 0,
  });
  assert.deepEqual(open!.tools, { calls: 0, byClass: { read: 0, search: 0, edit: 0, exec: 0, other: 0 }, errors: 0, timeMs: 0 });
  assert.equal(open!.role, null);
});

test("reasoningRelation is kept per phase, and unknown when its usage events disagree", () => {
  const run = new SyntheticAttempt(session("s1"));
  run.phase(phase("t01-build", "builder", { ordinal: 1 }));
  run.event("phase-t01-build", "run-1", { kind: "usage", usage: usage(10, 5, 0, 0, 2, "additive") });
  run.event("phase-t01-build", "run-2", { kind: "usage", usage: usage(10, 5, 0, 0, null, "additive") });
  run.phase(phase("t02-build", "builder", { ordinal: 2 }));
  run.event("phase-t02-build", "run-3", { kind: "usage", usage: usage(10, 5, 0, 0, 2, "additive") });
  run.event("phase-t02-build", "run-4", { kind: "usage", usage: usage(10, 5, 0, 0, 2, "included-in-output") });
  const [agreeing, mixed] = factsOf(run).facts;
  assert.equal(agreeing!.tokens.reasoningRelation, "additive");
  assert.equal(agreeing!.tokens.reasoningTokens, 2, "an unreported kind adds nothing, and is not a zero");
  assert.equal(mixed!.tokens.reasoningRelation, "unknown");
});

test("model identity stays two fields: the requested selector and the observed model with its provenance", () => {
  const run = new SyntheticAttempt(session("s1"));
  // Legacy: its selector is the configured one; the stream said which model answered.
  run.phase(phase("t01-build", "builder", { ordinal: 1 }));
  run.event("phase-t01-build", "run-1", {
    kind: "model.resolved", adapter: "pi-codex", provider: "openai-codex", requestedModel: "gpt-6-sol",
    resolvedModel: "gpt-6-sol-2026-09-01", provenance: "route-attributed",
  });
  // Journaled: the route asked for a selector and the call observed a different, exact model.
  run.phase(phase("shift-review", "reviewer", { ordinal: 2 }));
  run.start("phase-shift-review", "reviewer", "claude", "anthropic", "claude:opus", OPUS_HIGH);
  run.call("phase-shift-review", "reviewer", "claude", "anthropic", "claude:opus", "claude-opus-5-5", usage(1, 1, 0, 0, null));
  const [legacy, review] = factsOf(run).facts;

  assert.deepEqual(legacy!.identity, {
    requestedModel: "codex:gpt-6-sol",
    resolvedModel: "gpt-6-sol-2026-09-01",
    modelProvenance: "route-attributed",
  });
  assert.deepEqual(legacy!.route, {
    adapterId: "codex", adapterKind: "pi-codex", provider: "openai-codex", model: "codex:gpt-6-sol",
    effort: "xhigh", effortSource: "config-agent", journalSource: null,
  });

  assert.deepEqual(review!.identity, {
    requestedModel: "claude:opus",
    resolvedModel: "claude-opus-5-5",
    modelProvenance: "stream-authoritative",
  });
  assert.deepEqual(review!.route, {
    adapterId: "claude", adapterKind: "claude-code", provider: "anthropic", model: "opus",
    effort: "high", effortSource: "journal", journalSource: "attempt-override",
  });
  assert.deepEqual(review!.role, {
    callCount: 1, modelProvenance: "stream-authoritative", costAuthority: "unavailable", contextTokens: 1, contextWindow: 400_000,
  });
});

test("only agent phases are facts, and a row projected before migration 0007 reads as unresolved", () => {
  const db = openDatabase(":memory:");
  try {
    const run = new SyntheticAttempt(session("s1"));
    run.phase(phase("t01-build", "builder", { ordinal: 1 }));
    run.phase(phase("t01-tests", "host", { ordinal: 2, kind: "code" }));
    run.project(db);
    // What an un-rebuilt legacy database holds: the columns exist and are empty.
    db.prepare(`UPDATE phases SET route_adapter = NULL, route_provider = NULL, route_model = NULL,
      route_effort = NULL, effort_source = NULL`).run();
    const facts = readPhaseFacts(db);
    assert.deepEqual(facts.map((fact) => fact.phaseKey), ["t01-build"]);
    assert.deepEqual(facts[0]!.route, {
      adapterId: null, adapterKind: null, provider: null, model: null, effort: null, effortSource: null, journalSource: null,
    });
    assert.equal(facts[0]!.identity.requestedModel, null);
  } finally {
    db.close();
  }
});
