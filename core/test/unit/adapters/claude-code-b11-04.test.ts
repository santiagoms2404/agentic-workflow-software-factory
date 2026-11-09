import { test } from "node:test";
import assert from "node:assert/strict";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.ts";
import type { ProcessTransport } from "../../../src/adapters/interface.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";

function adapter(): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter({
    now: () => "2026-08-07T00:00:00.000Z",
    exitWaitMs: 25,
  });
}

async function replayLines(lines: readonly string[]): Promise<NormalizedEvent[]> {
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
  for await (const event of adapter().parse(transport, undefined, { requestedModel: "sonnet" })) {
    events.push(event);
  }
  return events;
}

const INIT_LINE = JSON.stringify({
  type: "system",
  subtype: "init",
  model: "claude-sonnet-5",
  session_id: "s-regression",
});

const RESULT_LINE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  usage: { input_tokens: 10, output_tokens: 5 },
});

test("B11-04: allowed_limit_reached is not exempt from rate-limit blocking", async () => {
  const events = await replayLines([
    INIT_LINE,
    JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed_limit_reached",
        resetsAt: 1786147200,
        rateLimitType: "five_hour",
      },
    }),
    RESULT_LINE,
  ]);
  const terminal = events[events.length - 1];
  assert.equal(
    terminal?.kind === "run.failed" ? terminal.errorCode : null,
    "E_QUOTA_EXHAUSTED",
    "allowed_limit_reached must fail the run with E_QUOTA_EXHAUSTED",
  );
});

test("B11-04: variations of *_limit_reached with allowed prefix are not exempt", async () => {
  for (const status of ["allowed_requests_limit_reached", "allowed_rate_limit_reached", "allowed_tier_limit_reached"]) {
    const events = await replayLines([
      INIT_LINE,
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: {
          status,
          resetsAt: 1786147200,
          rateLimitType: "five_hour",
        },
      }),
      RESULT_LINE,
    ]);
    const terminal = events[events.length - 1];
    assert.equal(
      terminal?.kind === "run.failed" ? terminal.errorCode : null,
      "E_QUOTA_EXHAUSTED",
      `${status} must fail with E_QUOTA_EXHAUSTED`,
    );
  }
});

test("B11-04: non-exhausted allowed statuses remain exempt from blocking", async () => {
  for (const status of ["allowed", "allowed_warning", "allowed_approaching_limit"]) {
    const events = await replayLines([
      INIT_LINE,
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: {
          status,
          resetsAt: 1786147200,
          rateLimitType: "five_hour",
        },
      }),
      RESULT_LINE,
    ]);
    const terminal = events[events.length - 1];
    assert.equal(terminal?.kind, "run.completed", `${status} must allow the run to complete`);
  }
});
