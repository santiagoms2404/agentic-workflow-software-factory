// Regressions from the adapters review: B11-12 (no requested model, refuse),
// B11-14 and B11-15 (JSON null where the decoder expects an object), B11-16
// (a whitespace run that backtracks the reset-time pattern) and B11-17 and
// B11-18 (a null line in the host-owned session file).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiCodexAdapter } from "../../../src/adapters/pi-codex.ts";
import { AdapterError, type ProcessTransport } from "../../../src/adapters/interface.ts";
import {
  validateEventSequence,
  type NormalizedEvent,
} from "../../../src/contracts/normalized-events.ts";

function adapter(): PiCodexAdapter {
  return new PiCodexAdapter({ now: () => "2026-08-08T00:00:00.000Z", exitWaitMs: 25 });
}

function transportOf(text: string): ProcessTransport {
  const bytes = new TextEncoder().encode(text);
  return {
    runId: "run-pi-b11",
    identity: { pid: 1, pgid: 1, startedAt: "2026-08-08T00:00:00.000Z" },
    stdout: (async function* () {
      yield bytes;
    })(),
    stderr: (async function* () {})(),
    exit: Promise.resolve({ code: 0, signal: null }),
    cancel: async () => ({ termSent: true, killSent: false, survivors: [], terminated: [] }),
  } as unknown as ProcessTransport;
}

async function run(lines: readonly string[], requestedModel = "gpt-5.6-sol"): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of adapter().parse(transportOf(`${lines.join("\n")}\n`), undefined, { requestedModel })) {
    events.push(event);
  }
  return events;
}

const START = '{"type":"message_start","message":{"role":"assistant","provider":"openai-codex","model":"gpt-5.6-sol"}}';
const SETTLED = '{"type":"agent_settled"}';

test("B11-12: parse refuses to read a stream when the host named no requested model", async () => {
  await assert.rejects(
    async () => {
      for await (const _event of adapter().parse(transportOf(`${START}\n${SETTLED}\n`))) {
        // drained: the refusal is the only outcome under test
      }
    },
    (error: unknown) => error instanceof AdapterError && error.code === "E_INVALID_REQUEST",
  );
});

test("B11-14: a message_start whose message is null is skipped and the run still settles", async () => {
  const events = await run(['{"type":"message_start","message":null}', START, SETTLED]);
  assert.equal(events.filter((event) => event.kind === "run.failed").length, 0);
  assert.equal(events.at(-1)?.kind, "run.completed");
  assert.deepEqual(validateEventSequence(events), []);
});

test("B11-14: a message_end with a null message, and an error update with a null error, do not abort the run", async () => {
  const events = await run([
    START,
    '{"type":"message_end","message":null}',
    '{"type":"message_update","assistantMessageEvent":{"type":"error","error":null}}',
    SETTLED,
  ]);
  assert.equal(events.filter((event) => event.kind === "run.failed").length, 0);
  assert.equal(events.at(-1)?.kind, "run.completed");
  assert.deepEqual(validateEventSequence(events), []);
});

test("B11-14: a message_update whose assistantMessageEvent is null is skipped and the run still settles", async () => {
  const events = await run([START, '{"type":"message_update","assistantMessageEvent":null}', SETTLED]);
  assert.equal(events.filter((event) => event.kind === "run.failed").length, 0);
  assert.equal(events.at(-1)?.kind, "run.completed");
});

test("B11-15: a turn_end whose message is null is skipped and the run still settles", async () => {
  const events = await run([START, '{"type":"turn_end","message":null}', SETTLED]);
  assert.equal(events.filter((event) => event.kind === "run.failed").length, 0);
  assert.equal(events.at(-1)?.kind, "run.completed");
  assert.deepEqual(validateEventSequence(events), []);
});

test("B11-16: a long whitespace run after 'try again in' is read in linear time", async () => {
  const message = `usage limit reached. try again in${" ".repeat(40_000)}soon`;
  const turnEnd = JSON.stringify({
    type: "turn_end",
    message: { role: "assistant", stopReason: "error", errorMessage: message },
  });
  const started = performance.now();
  const events = await run([START, turnEnd, SETTLED]);
  const elapsed = performance.now() - started;
  assert.equal(events.at(-1)?.kind, "run.failed");
  assert.ok(elapsed < 1_000, `the run resolved in ${elapsed.toFixed(0)} ms`);
});

test("B11-16: triangulation: a stated 'try again in N min' still yields a reset time", async () => {
  const turnEnd = JSON.stringify({
    type: "turn_end",
    message: { role: "assistant", stopReason: "error", errorMessage: "usage limit reached. Try again in ~37 min." },
  });
  const events = await run([START, turnEnd, SETTLED]);
  const quota = events.find((event) => event.kind === "quota");
  assert.equal(quota?.kind === "quota" && typeof quota.resetAt, "string");
});

// ---------------------------------------------------------------------------
// The host-owned session file, read by the correction proof.
// ---------------------------------------------------------------------------

const LOCATOR = "9b1f0c2a-3d4e-4f50-8a61-72b83c94d5e6";
const HEADER = JSON.stringify({ type: "session", version: 3, id: LOCATOR, timestamp: "2026-08-13T00:00:00.000Z", cwd: "/tmp/work" });
const ASSISTANT = JSON.stringify({
  type: "message",
  id: "bbbbbbb0",
  parentId: "aaaaaaaa",
  timestamp: "2026-08-13T00:00:02.000Z",
  message: { role: "assistant", content: [{ type: "text", text: "done" }], provider: "openai-codex", model: "gpt-5.6-sol", stopReason: "stop" },
});

/** Runs `check` against a fresh host session store holding one file with `lines`. */
function withSessionFile(lines: readonly string[], check: (storeDir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "awsf-pi-b11-18-"));
  try {
    writeFileSync(join(dir, `2026-08-13T00-00-00-000Z_${LOCATOR}.jsonl`), `${lines.join("\n")}\n`);
    check(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("B11-18: a bare null line after the session header is skipped and the resume still proves", () => {
  withSessionFile([HEADER, "null", ASSISTANT], (storeDir) => {
    const evidence = adapter().assertResumable({ providerSessionId: LOCATOR, storeDir }, { cwd: "/tmp/work" });
    assert.equal(evidence.proof, "host-visible-session-store");
    assert.match(evidence.detail, /1 prior assistant turn/);
  });
});

test("B11-17: a bare null line before the session header does not escape as a TypeError", () => {
  withSessionFile(["null", HEADER, ASSISTANT], (storeDir) => {
    const evidence = adapter().assertResumable({ providerSessionId: LOCATOR, storeDir }, { cwd: "/tmp/work" });
    assert.equal(evidence.proof, "host-visible-session-store");
    assert.match(evidence.detail, /1 prior assistant turn/);
  });
});

test("B11-17: triangulation: a file whose first line is not a session header is still refused as an AdapterError", () => {
  withSessionFile(["null", ASSISTANT], (storeDir) => {
    assert.throws(
      () => adapter().assertResumable({ providerSessionId: LOCATOR, storeDir }, { cwd: "/tmp/work" }),
      (error: unknown) => error instanceof AdapterError && error.code === "E_BACKEND_FAILURE",
    );
  });
});
