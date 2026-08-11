// The liveness monitor against real providers.
//
// The unit suite proves the arithmetic with an injected clock. This one proves
// the wiring: a real detached provider, a real silence window, a real trip, and
// a real process tree that is actually gone afterwards.
//
// The windows here are milliseconds rather than the 2700 seconds the plan
// specifies, and that substitution is the reason the unit suite exists: the
// DEFAULT is asserted there, against the committed config, where no clock has to
// be waited on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LivenessMonitor, type LivenessOutcome } from "../../src/execution/liveness-monitor.ts";
import type { StubScript } from "../../src/adapters/stub.ts";
import { isRunning, startStubRun, type LiveRun } from "./_live-run.ts";
import { processesMentioning } from "./_barrier-fixtures.ts";

interface Watched {
  run: LiveRun;
  monitor: LivenessMonitor;
  /** Everything the provider wrote, for tests that need to read it. */
  text: () => string;
  settled: Promise<LivenessOutcome>;
}

/**
 * Starts a run and watches it exactly the way the stream layer will: bytes go to
 * the monitor as a COUNT, and the text is kept separately by the test.
 */
async function watch(
  script: StubScript,
  options: { silenceMs?: number; timeoutMs?: number },
): Promise<Watched> {
  const run = await startStubRun(script, { graceMs: 500, settleMs: 25 });
  const monitor = new LivenessMonitor({
    supervisor: run.controller,
    identity: run.transport.identity,
    pollMs: 25,
    terminate: { graceMs: 500, settleMs: 25 },
    ...options,
  });

  let collected = "";
  const decoder = new TextDecoder("utf8");
  const feed = async (stream: AsyncIterable<Uint8Array>): Promise<void> => {
    try {
      for await (const chunk of stream) {
        monitor.noteOutput(chunk.byteLength);
        collected += decoder.decode(chunk, { stream: true });
      }
    } catch {
      // A stream torn down under a KILL is the outcome, not a failure.
    }
  };
  void feed(run.transport.stdout);
  void feed(run.transport.stderr);
  monitor.start();

  return { run, monitor, text: () => collected, settled: monitor.finished };
}

/** Polls a predicate to a deadline, returning as soon as observed state changes. */
async function until(deadlineMs: number, predicate: () => boolean): Promise<boolean> {
  const stop = Date.now() + deadlineMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= stop) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * The controller truthfully excludes zombies from survivors: they are dead,
 * not running tree members. Node reaps the direct child on its `exit` event,
 * which can arrive one event-loop turn after the controller's final `/proc`
 * census under parallel suite load. Await that event before making the
 * stronger PID-gone assertion; do not turn a scheduler race into a sleep.
 */
async function assertProviderReaped(watched: Watched, pid: number, message: string): Promise<void> {
  let exitObserved = false;
  void watched.run.transport.exit.then(() => { exitObserved = true; });
  const eventArrived = await until(5_000, () => exitObserved);
  assert.equal(eventArrived, true, "the provider exit event missed its bounded deadline");
  assert.equal(isRunning(pid), false, message);
}

test("a provider that says nothing and does nothing trips the silence window and is ended", async () => {
  const watched = await watch("silence", { silenceMs: 400 });
  try {
    const provider = watched.run.transport.identity.pid;
    assert.ok(isRunning(provider), "the provider is running before the window expires");

    const outcome = await watched.settled;
    assert.equal(outcome.reason, "silence");
    assert.equal(outcome.error, null);
    assert.equal(outcome.cancellation?.terminated, true);
    assert.deepEqual([...(outcome.cancellation?.survivors ?? [])], []);
    await assertProviderReaped(watched, provider, "the dead provider was not reaped after its exit event");
    assert.deepEqual(processesMentioning(watched.run.runId), []);
  } finally {
    await watched.run.end();
  }
});

test("a provider that never stops talking trips the TIMEOUT, never the silence window", async () => {
  // The `timeout` script emits a line every 50 ms and never exits. It is the
  // case that separates "still working" from "wedged": output keeps the silence
  // window open forever, and only the hard ceiling ends the run.
  const watched = await watch("timeout", { silenceMs: 400, timeoutMs: 1_500 });
  try {
    const outcome = await watched.settled;
    assert.equal(outcome.reason, "timeout");
    assert.equal(outcome.cancellation?.terminated, true);
    assert.ok(watched.text().includes("still working"), "the provider really was producing output");
    await assertProviderReaped(
      watched,
      watched.run.transport.identity.pid,
      "the timed-out provider was not reaped after its exit event",
    );
  } finally {
    await watched.run.end();
  }
});

test("a record-update failure ends the tree, grandchild included", async () => {
  // No hard timeout and a silence window far longer than this test: the only
  // thing that can end this run is the flag.
  const watched = await watch("grandchild-spawner", { silenceMs: 60_000 });
  try {
    const named = await until(10_000, () => /"type":"grandchild","pid":(\d+)/.test(watched.text()));
    assert.equal(named, true, `the stub never named a grandchild: ${watched.text()}`);
    const grandchild = Number(/"type":"grandchild","pid":(\d+)/.exec(watched.text())?.[1]);
    const provider = watched.run.transport.identity.pid;
    assert.ok(isRunning(grandchild), "the grandchild is running");

    watched.monitor.noteRecordUpdateFailed();

    const outcome = await watched.settled;
    assert.equal(outcome.reason, "record-update-failed");
    assert.equal(outcome.cancellation?.terminated, true);
    assert.deepEqual([...(outcome.cancellation?.survivors ?? [])], []);
    await assertProviderReaped(
      watched,
      provider,
      "the dead provider was not reaped after the record-update cancellation",
    );
    const grandchildReaped = await until(5_000, () => !isRunning(grandchild));
    assert.equal(grandchildReaped, true, "the dead grandchild was not reaped before the bounded deadline");
  } finally {
    await watched.run.end();
  }
});

test("a provider that finishes on its own is stopped, and nothing is signalled at it", async () => {
  const watched = await watch("success", { silenceMs: 60_000 });
  try {
    await watched.run.transport.exit;
    const outcome = await watched.monitor.stop();
    assert.equal(outcome.reason, null);
    assert.equal(outcome.cancellation, null);
    assert.ok(watched.text().includes("run") || watched.text().length > 0);
  } finally {
    await watched.run.end();
  }
});
