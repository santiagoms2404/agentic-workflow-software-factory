// B11-01 / B11-03: the wait for stderr to close is bounded, like the exit wait.
//
// Stderr closes only when EVERY holder of the pipe closes it, and a process the
// provider started inherits that pipe. When such a descendant outlives the
// provider, the provider has already written its terminal, closed stdout and
// exited, and stderr stays open for as long as the descendant lives. `parse`
// awaited that close with no bound before it yielded the held terminal, so an
// already-finished run hung on a process that was not the provider at all.
//
// Both adapters, through the same hand-built transport their own suites use.
// What is asserted: a stderr held open after exit no longer stops `parse` from
// resolving within the bound, and a stderr that DOES end is still captured in
// full — the bound must not cost the tail a dying provider explained itself in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.ts";
import { PiCodexAdapter } from "../../../src/adapters/pi-codex.ts";
import type { ProcessTransport } from "../../../src/adapters/interface.ts";
import {
  validateEventSequence,
  type NormalizedEvent,
} from "../../../src/contracts/normalized-events.ts";

const PROVIDERS = join(import.meta.dirname, "..", "..", "fixtures", "providers");

/** The adapters' wait for the process, and now for its stderr. */
const BOUND_MS = 300;
/** Far past the bound: a `parse` still pending here is hung, not slow. */
const DEADLINE_MS = 3_000;

interface Route {
  name: string;
  fixture: string;
  parse: (transport: ProcessTransport) => AsyncIterable<NormalizedEvent>;
}

function clock(): () => string {
  let tick = 0;
  return () => `2026-08-08T00:00:${String(tick++).padStart(2, "0")}.000Z`;
}

const ROUTES: Route[] = [
  {
    name: "pi-codex",
    fixture: join(PROVIDERS, "codex", "probe-readonly-tool.jsonl"),
    parse: (transport) =>
      new PiCodexAdapter({ now: clock(), exitWaitMs: BOUND_MS }).parse(transport, undefined, {
        requestedModel: "gpt-5.6-sol",
      }),
  },
  {
    name: "claude-code",
    fixture: join(PROVIDERS, "claude", "probe-readonly-tool.jsonl"),
    parse: (transport) =>
      new ClaudeCodeAdapter({ now: clock(), exitWaitMs: BOUND_MS }).parse(transport, undefined, {
        requestedModel: "sonnet",
      }),
  },
];

/** A stderr that writes `text` and then never ends — as a descendant holding the pipe leaves it. */
async function* heldOpenStderr(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
  await new Promise<never>(() => {});
}

/** A stderr that writes its chunks a little apart, AFTER stdout has ended, and then closes. */
async function* slowClosingStderr(chunks: readonly string[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    yield new TextEncoder().encode(chunk);
  }
}

/** A process that has already exited cleanly, with the given stdout and stderr. */
function exitedTransport(stdout: Uint8Array, stderr: AsyncIterable<Uint8Array>): ProcessTransport {
  return {
    runId: "run-stderr-bound",
    identity: { pid: 1, pgid: 1, startedAt: "2026-08-08T00:00:00.000Z" },
    stdout: (async function* () {
      if (stdout.length > 0) yield stdout;
    })(),
    stderr,
    exit: Promise.resolve({ code: 0, signal: null }),
    cancel: async () => ({ termSent: true, killSent: false, survivors: [], terminated: [] }),
  } as unknown as ProcessTransport;
}

const PENDING = "parse() still pending";

/** Drains `parse`, or reports that it had not finished by the deadline. */
async function drainWithin(
  events: AsyncIterable<NormalizedEvent>,
  ms: number,
): Promise<NormalizedEvent[] | typeof PENDING> {
  const collected = (async () => {
    const out: NormalizedEvent[] = [];
    for await (const event of events) out.push(event);
    return out;
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof PENDING>((resolve) => {
    timer = setTimeout(() => resolve(PENDING), ms);
  });
  try {
    return await Promise.race([collected, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

for (const route of ROUTES) {
  test(`${route.name}: a stderr held open after exit does not withhold the decoded terminal`, async () => {
    const started = Date.now();
    const result = await drainWithin(
      route.parse(exitedTransport(readFileSync(route.fixture), heldOpenStderr("descendant still here"))),
      DEADLINE_MS,
    );
    const elapsed = Date.now() - started;
    assert.notEqual(result, PENDING, `parse() must resolve within the ${String(BOUND_MS)} ms bound`);
    const events = result as NormalizedEvent[];
    const terminal = events[events.length - 1];
    assert.equal(terminal?.kind, "run.completed");
    assert.equal(terminal?.kind === "run.completed" ? terminal.exitCode : undefined, 0,
      "the exit the process really made is still measured");
    assert.deepEqual(validateEventSequence(events), []);
    assert.ok(elapsed < DEADLINE_MS, `resolved in ${String(elapsed)} ms`);
  });

  test(`${route.name}: a held-open stderr still contributes what it wrote to a missing-terminal failure`, async () => {
    const result = await drainWithin(
      route.parse(exitedTransport(new Uint8Array(0), heldOpenStderr("provider: not authenticated"))),
      DEADLINE_MS,
    );
    assert.notEqual(result, PENDING, `parse() must resolve within the ${String(BOUND_MS)} ms bound`);
    const events = result as NormalizedEvent[];
    const terminal = events[events.length - 1];
    assert.equal(terminal?.kind, "run.failed");
    const failed = terminal as Extract<NormalizedEvent, { kind: "run.failed" }>;
    assert.equal(failed.errorCode, "E_TERMINAL_MISSING");
    assert.match(failed.message, /the provider wrote to stderr: provider: not authenticated$/);
  });

  test(`${route.name}: a stderr that ends after stdout is still captured in full`, async () => {
    const result = await drainWithin(
      route.parse(
        exitedTransport(new Uint8Array(0), slowClosingStderr(["first half of the reason, ", "and the second half"])),
      ),
      DEADLINE_MS,
    );
    assert.notEqual(result, PENDING);
    const events = result as NormalizedEvent[];
    const terminal = events[events.length - 1];
    assert.equal(terminal?.kind, "run.failed");
    const failed = terminal as Extract<NormalizedEvent, { kind: "run.failed" }>;
    assert.equal(failed.errorCode, "E_TERMINAL_MISSING");
    assert.match(
      failed.message,
      /the provider wrote to stderr: first half of the reason, and the second half$/,
      "the bound must not cut off a tail that does arrive",
    );
  });
}
