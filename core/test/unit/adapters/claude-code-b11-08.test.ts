import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ClaudeCodeAdapter,
  assertSameSession,
} from "../../../src/adapters/claude-code.ts";
import type { ClaudeSessionRecord } from "../../../src/adapters/claude-code-stream.ts";
import { AdapterError, type ProcessTransport } from "../../../src/adapters/interface.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";

function adapter(): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter({
    now: () => "2026-08-07T00:00:00.000Z",
    exitWaitMs: 25,
  });
}

async function replayLines(
  lines: readonly string[],
  session?: ClaudeSessionRecord,
): Promise<NormalizedEvent[]> {
  const text = lines.map((l) => (l.endsWith("\n") ? l : `${l}\n`)).join("");
  const bytes = new TextEncoder().encode(text);
  const transport = {
    runId: "run-claude-test",
    identity: { pid: 1, pgid: 1, startedAt: "2026-08-07T00:00:00.000Z" },
    stdout: (async function* () {
      yield bytes;
    })(),
    stderr: (async function* () {})(),
    exit: Promise.resolve({ code: 0, signal: null }),
    cancel: async () => ({ termSent: true, killSent: false, survivors: [], terminated: [] }),
  } as unknown as ProcessTransport;

  const events: NormalizedEvent[] = [];
  for await (const event of adapter().parse(transport, undefined, {
    requestedModel: "sonnet",
    ...(session === undefined ? {} : { session }),
  })) {
    events.push(event);
  }
  return events;
}

const RESULT_LINE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  usage: { input_tokens: 10, output_tokens: 5 },
});

test("B11-08: init-less turn records resolvedModel from assistant message in session record", async () => {
  const session: ClaudeSessionRecord = { sessionId: null, resolvedModel: null };
  await replayLines(
    [
      JSON.stringify({
        type: "assistant",
        session_id: "s-initless",
        message: {
          model: "claude-haiku-4-5-20251001",
          content: [{ type: "text", text: "hello" }],
        },
      }),
      RESULT_LINE,
    ],
    session,
  );

  assert.equal(session.sessionId, "s-initless");
  assert.equal(
    session.resolvedModel,
    "claude-haiku-4-5-20251001",
    "session.resolvedModel must be populated from assistant message when init is absent",
  );
});

test("B11-08: assertSameSession catches model mismatch across init-less correction turns", async () => {
  const firstSession: ClaudeSessionRecord = { sessionId: null, resolvedModel: null };
  const nextSession: ClaudeSessionRecord = { sessionId: null, resolvedModel: null };

  await replayLines(
    [
      JSON.stringify({
        type: "assistant",
        session_id: "s-shared-session",
        message: {
          model: "claude-haiku-4-5-20251001",
          content: [{ type: "text", text: "turn 1" }],
        },
      }),
      RESULT_LINE,
    ],
    firstSession,
  );

  await replayLines(
    [
      JSON.stringify({
        type: "assistant",
        session_id: "s-shared-session",
        message: {
          model: "claude-opus-5",
          content: [{ type: "text", text: "turn 2" }],
        },
      }),
      RESULT_LINE,
    ],
    nextSession,
  );

  assert.throws(
    () => assertSameSession(firstSession, nextSession),
    (error: unknown) => error instanceof AdapterError && error.code === "E_MODEL_MISMATCH",
    "differing assistant models across init-less turns must throw E_MODEL_MISMATCH",
  );
});

test("B11-08: assertSameSession accepts matching models across init-less correction turns", async () => {
  const firstSession: ClaudeSessionRecord = { sessionId: null, resolvedModel: null };
  const nextSession: ClaudeSessionRecord = { sessionId: null, resolvedModel: null };

  await replayLines(
    [
      JSON.stringify({
        type: "assistant",
        session_id: "s-shared-session",
        message: {
          model: "claude-haiku-4-5-20251001",
          content: [{ type: "text", text: "turn 1" }],
        },
      }),
      RESULT_LINE,
    ],
    firstSession,
  );

  await replayLines(
    [
      JSON.stringify({
        type: "assistant",
        session_id: "s-shared-session",
        message: {
          model: "claude-haiku-4-5-20251001",
          content: [{ type: "text", text: "turn 2" }],
        },
      }),
      RESULT_LINE,
    ],
    nextSession,
  );

  assert.doesNotThrow(() => assertSameSession(firstSession, nextSession));
});
