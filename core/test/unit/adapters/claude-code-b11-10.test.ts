// Regressions from the adapters review: B11-10 (a JSON null where an object is
// expected) and B11-12 (a parse with no requested model must refuse, not
// journal a placeholder model name).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.ts";
import { AdapterError, type ProcessTransport } from "../../../src/adapters/interface.ts";
import {
  validateEventSequence,
  type NormalizedEvent,
} from "../../../src/contracts/normalized-events.ts";

function adapter(): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter({ now: () => "2026-08-07T00:00:00.000Z", exitWaitMs: 25 });
}

function transportOf(text: string): ProcessTransport {
  const bytes = new TextEncoder().encode(text);
  return {
    runId: "run-claude-b11-10",
    identity: { pid: 1, pgid: 1, startedAt: "2026-08-07T00:00:00.000Z" },
    stdout: (async function* () {
      yield bytes;
    })(),
    stderr: (async function* () {})(),
    exit: Promise.resolve({ code: 0, signal: null }),
    cancel: async () => ({ termSent: true, killSent: false, survivors: [], terminated: [] }),
  } as unknown as ProcessTransport;
}

async function run(lines: readonly string[], requestedModel: string = "sonnet"): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of adapter().parse(transportOf(`${lines.join("\n")}\n`), undefined, { requestedModel })) {
    events.push(event);
  }
  return events;
}

const INIT = '{"type":"system","subtype":"init","model":"claude-sonnet-5","session_id":"s-null"}';
const RESULT = '{"type":"result","subtype":"success","is_error":false}';

test("B11-10: a stream_event whose event or delta is null is skipped and the run still completes", async () => {
  const events = await run([
    INIT,
    '{"type":"stream_event","event":null}',
    '{"type":"stream_event","event":{"type":"content_block_delta","delta":null}}',
    RESULT,
  ]);
  assert.equal(events.filter((event) => event.kind === "run.failed").length, 0);
  assert.equal(events.at(-1)?.kind, "run.completed");
  assert.deepEqual(validateEventSequence(events), []);
});

test("B11-10: an assistant or user line holding a null content block is skipped and the run still completes", async () => {
  const events = await run([
    INIT,
    '{"type":"assistant","message":{"content":[null]}}',
    '{"type":"user","message":{"content":[null]}}',
    RESULT,
  ]);
  assert.equal(events.filter((event) => event.kind === "run.failed").length, 0);
  assert.equal(events.at(-1)?.kind, "run.completed");
  assert.deepEqual(validateEventSequence(events), []);
});

test("B11-10: triangulation: a text delta after a null event still arrives in order", async () => {
  const events = await run([
    INIT,
    '{"type":"stream_event","event":null}',
    '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}',
    RESULT,
  ]);
  const text = events.filter((event) => event.kind === "text.delta");
  assert.deepEqual(text.map((event) => (event.kind === "text.delta" ? event.text : "")), ["hi"]);
  assert.equal(events.at(-1)?.kind, "run.completed");
});

test("B11-12: parse refuses to read a stream when the host named no requested model", async () => {
  await assert.rejects(
    async () => {
      for await (const _event of adapter().parse(transportOf(`${INIT}\n${RESULT}\n`))) {
        // drained: the refusal is the only outcome under test
      }
    },
    (error: unknown) => error instanceof AdapterError && error.code === "E_INVALID_REQUEST",
  );
});

test("B11-12: triangulation: the requested model the host named is the one journaled", async () => {
  const events = await run([INIT, RESULT], "sonnet");
  const started = events.find((event) => event.kind === "run.started");
  assert.equal(started?.kind === "run.started" && started.requestedModel, "sonnet");
  assert.notEqual(started?.kind === "run.started" && started.requestedModel, "unknown-model");
});
