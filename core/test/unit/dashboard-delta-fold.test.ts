import assert from "node:assert/strict";
import { test } from "node:test";
import { containsCredential, REDACTED_VALUE } from "../../../dashboard/shared/credential-patterns.ts";
import { foldTextDeltaRuns, type FoldedTextDeltaRow } from "../../../dashboard/src/delta-fold.ts";
import type { EventItem } from "../../../dashboard/shared/types.ts";

function event(overrides: Partial<EventItem> = {}): EventItem {
  return {
    row: 1,
    id: "event-1",
    phaseId: "phase-synthetic",
    runId: "run-synthetic",
    parentEventId: null,
    firstSourceSeq: 1,
    lastSourceSeq: 1,
    type: "text.delta",
    name: "",
    status: null,
    payload: { text: "" },
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:00.000Z",
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    estimatedCostUsd: null,
    costAuthority: null,
    ...overrides,
  };
}

function delta(seq: number, text: string, overrides: Partial<EventItem> = {}): EventItem {
  return event({
    id: `delta-${seq}`,
    row: seq,
    firstSourceSeq: seq,
    lastSourceSeq: seq,
    payload: { text },
    ...overrides,
  });
}

function folded(row: ReturnType<typeof foldTextDeltaRuns>[number]): FoldedTextDeltaRow {
  assert.equal(row.type, "text.delta.fold");
  return row as FoldedTextDeltaRow;
}

test("contiguous text.delta rows fold in source sequence order", () => {
  const rows = foldTextDeltaRuns([
    delta(4, "first "),
    delta(5, "second "),
    delta(6, "third"),
  ]);

  assert.equal(rows.length, 1);
  const row = folded(rows[0]!);
  assert.equal(row.chunkCount, 3);
  assert.equal(row.reassembledText, "first second third");
});

test("a tool_call between text.delta rows closes the first fold", () => {
  const toolCall = event({
    id: "tool-synthetic",
    row: 2,
    firstSourceSeq: 2,
    lastSourceSeq: 2,
    type: "tool_call",
    name: "Read",
    payload: { outcome: "ok" },
  });
  const rows = foldTextDeltaRuns([
    delta(1, "before "),
    toolCall,
    delta(3, "after"),
  ]);

  assert.equal(rows.length, 3);
  assert.equal(folded(rows[0]!).reassembledText, "before ");
  assert.equal(rows[1], toolCall);
  assert.equal(folded(rows[2]!).reassembledText, "after");
});

test("a terminal event closes a text.delta fold", () => {
  const terminal = event({
    id: "completed-synthetic",
    row: 3,
    firstSourceSeq: 3,
    lastSourceSeq: 3,
    type: "run.completed",
    payload: { exitCode: 0 },
  });
  const rows = foldTextDeltaRuns([
    delta(1, "before "),
    delta(2, "completion"),
    terminal,
    delta(4, "after"),
  ]);

  assert.equal(rows.length, 3);
  assert.equal(folded(rows[0]!).reassembledText, "before completion");
  assert.equal(rows[1], terminal);
  assert.equal(folded(rows[2]!).reassembledText, "after");
});

test("thinking.delta neither starts nor extends a text.delta fold", () => {
  const thinking = event({
    id: "thinking-synthetic",
    row: 2,
    firstSourceSeq: 2,
    lastSourceSeq: 2,
    type: "thinking.delta",
    payload: { text: "synthetic reasoning" },
  });
  const rows = foldTextDeltaRuns([
    delta(1, "visible before"),
    thinking,
    delta(3, "visible after"),
  ]);

  assert.equal(rows.length, 3);
  assert.equal(folded(rows[0]!).reassembledText, "visible before");
  assert.equal(rows[1], thinking);
  assert.equal(folded(rows[2]!).reassembledText, "visible after");
});

test("re-redacts a credential split across contiguous text.delta rows", () => {
  const firstChunk = "credential: sk-abcd";
  const secondChunk = "efghijkl";
  assert.equal(containsCredential(firstChunk), false);
  assert.equal(containsCredential(secondChunk), false);
  assert.equal(containsCredential(firstChunk + secondChunk), true);

  const rows = foldTextDeltaRuns([
    delta(1, firstChunk),
    delta(2, secondChunk),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(folded(rows[0]!).reassembledText, REDACTED_VALUE);
});
