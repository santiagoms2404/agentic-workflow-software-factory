// The silence window, the hard timeout, and the record-update-failed flag.
//
// Driven by an injected clock rather than by waiting: a 2700-second window is
// not something a test can sit through, and a suite that shrinks the window to
// something it CAN sit through is measuring a different monitor.
//
// The case this file exists for is the one that reads as a non-event: output
// keeps a run alive, and content never does. The predecessor's silence window
// could be reset by a model narrating its own progress, which made "the provider
// is still working" indistinguishable from "the provider is still talking".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  LivenessMonitor,
  SILENCE_WINDOW_MS,
  type LivenessSupervisor,
} from "../../../src/execution/liveness-monitor.ts";
import { EnumerationUnavailable, type ProcessIdentity, type TerminationReport } from "../../../src/execution/launcher-barrier.ts";
import { repoRoot } from "../meta/_walk.ts";

const IDENTITY: ProcessIdentity = {
  pid: 4_242,
  pgid: 4_242,
  startIdentity: "boot:4242:99",
  startIdentitySource: "linux-proc-stat",
};

const CLEAN: TerminationReport = {
  termSent: true,
  killSent: false,
  survivors: [],
  terminated: true,
  skipped: null,
};

interface Harness {
  supervisor: LivenessSupervisor;
  now: () => number;
  advance: (ms: number) => void;
  setCpu: (value: number) => void;
  blind: (value: boolean) => void;
  failTermination: (error: unknown) => void;
  terminations: number;
}

function harness(): Harness {
  let clock = 1_000;
  let cpu = 0;
  let blind = false;
  let failure: unknown = null;
  const state = {
    terminations: 0,
    now: (): number => clock,
    advance: (ms: number): void => {
      clock += ms;
    },
    setCpu: (value: number): void => {
      cpu = value;
    },
    blind: (value: boolean): void => {
      blind = value;
    },
    failTermination: (error: unknown): void => {
      failure = error;
    },
    supervisor: {
      groupCpu: (): number => {
        if (blind) throw new EnumerationUnavailable("test", "the census was forced to fail");
        return cpu;
      },
      terminateTree: async (): Promise<TerminationReport> => {
        state.terminations += 1;
        if (failure !== null) throw failure;
        return CLEAN;
      },
    },
  };
  return state;
}

function monitorFor(state: Harness, options: { silenceMs?: number; timeoutMs?: number } = {}): LivenessMonitor {
  return new LivenessMonitor({
    supervisor: state.supervisor,
    identity: IDENTITY,
    now: state.now,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// The window is the plan's, and it is the config's.
// ---------------------------------------------------------------------------

test("the default silence window is 2700 s, and is the value the committed config carries", () => {
  assert.equal(SILENCE_WINDOW_MS, 2_700_000);
  const config = parse(readFileSync(join(repoRoot(), "awsf.config.yaml"), "utf8")) as {
    runtime: { silence_timeout_seconds: number };
  };
  // Two copies of a number are two chances to drift. This is the assertion that
  // notices when one of them moves.
  assert.equal(config.runtime.silence_timeout_seconds * 1_000, SILENCE_WINDOW_MS);
});

// ---------------------------------------------------------------------------
// Silence.
// ---------------------------------------------------------------------------

test("a run with no activity trips the silence window, and the tree is ended", async () => {
  const state = harness();
  const monitor = monitorFor(state, { silenceMs: 60_000 });

  state.advance(59_999);
  await monitor.tick();
  assert.equal(monitor.reason, null, "one millisecond short of the window is not silence");

  state.advance(1);
  await monitor.tick();
  const outcome = await monitor.finished;
  assert.equal(outcome.reason, "silence");
  assert.deepEqual(outcome.cancellation, CLEAN);
  assert.equal(state.terminations, 1);
});

test("output activity keeps a run alive — and the monitor only ever learns HOW MUCH", async () => {
  const state = harness();
  const monitor = monitorFor(state, { silenceMs: 60_000 });

  // Ten full windows' worth of elapsed time, with a byte arriving in each one.
  for (let round = 0; round < 10; round += 1) {
    state.advance(59_000);
    monitor.noteOutput(1);
    await monitor.tick();
    assert.equal(monitor.reason, null, `round ${round} tripped while output was arriving`);
  }

  // The signature is the invariant: there is no parameter through which a
  // milestone line, a thinking token or a heartbeat message could arrive and be
  // mistaken for progress. Only a count of bytes gets in.
  assert.equal(monitor.noteOutput.length, 1);
  assert.equal(typeof monitor.noteOutput.call(monitor, 1), "undefined");

  state.advance(60_000);
  await monitor.tick();
  assert.equal((await monitor.finished).reason, "silence");
});

test("an empty chunk is not activity", async () => {
  const state = harness();
  const monitor = monitorFor(state, { silenceMs: 10_000 });
  state.advance(9_000);
  monitor.noteOutput(0);
  state.advance(1_000);
  await monitor.tick();
  assert.equal((await monitor.finished).reason, "silence");
});

test("process activity keeps a silent run alive: cpu that moves is work", async () => {
  const state = harness();
  const monitor = monitorFor(state, { silenceMs: 10_000 });

  // The first sample only establishes a baseline; a reading is not a heartbeat.
  await monitor.tick();
  for (let round = 1; round <= 5; round += 1) {
    state.advance(9_000);
    state.setCpu(round * 7);
    await monitor.tick();
    assert.equal(monitor.reason, null, `round ${round} tripped while the group was burning cpu`);
  }

  // Wedged: the counter stops moving even though the process still exists.
  state.advance(10_000);
  await monitor.tick();
  assert.equal((await monitor.finished).reason, "silence");
});

// ---------------------------------------------------------------------------
// The other three trips.
// ---------------------------------------------------------------------------

test("a hard timeout trips a run that never stops talking — the two monitors are different", async () => {
  const state = harness();
  const monitor = monitorFor(state, { silenceMs: 10_000, timeoutMs: 45_000 });

  for (let round = 0; round < 9; round += 1) {
    state.advance(5_000);
    monitor.noteOutput(4_096);
    await monitor.tick();
  }
  const outcome = await monitor.finished;
  assert.equal(outcome.reason, "timeout", "a noisy provider must never be mistaken for a finished one");
  assert.equal(state.terminations, 1);
});

test("a record-update failure trips termination on its own, and outranks a window that has not expired", async () => {
  const state = harness();
  const monitor = monitorFor(state, { silenceMs: 60_000, timeoutMs: 600_000 });

  state.advance(10);
  monitor.noteOutput(512);
  monitor.noteRecordUpdateFailed();
  await monitor.tick();

  const outcome = await monitor.finished;
  // A run whose record cannot be written is a run nobody can find, bill or kill
  // later. It is ended now rather than allowed to continue invisibly.
  assert.equal(outcome.reason, "record-update-failed");
  assert.equal(state.terminations, 1);
});

test("a census the monitor cannot take is NOT a heartbeat", async () => {
  const state = harness();
  const monitor = monitorFor(state, { silenceMs: 10_000 });

  state.blind(true);
  for (let round = 0; round < 4; round += 1) {
    state.advance(2_000);
    await monitor.tick();
  }
  state.advance(2_000);
  await monitor.tick();

  const outcome = await monitor.finished;
  // Fail closed: a broken census must not be able to keep a wedged provider
  // alive, and the blind polls are reported rather than swallowed.
  assert.equal(outcome.reason, "silence");
  assert.equal(outcome.blindPolls, 5);
});

// ---------------------------------------------------------------------------
// Settling.
// ---------------------------------------------------------------------------

test("a termination that fails travels with the outcome instead of looking like a clean stop", async () => {
  const state = harness();
  const failure = new EnumerationUnavailable("test", "the census was forced to fail");
  state.failTermination(failure);
  const monitor = monitorFor(state, { silenceMs: 1_000 });

  state.advance(1_000);
  await monitor.tick();

  const outcome = await monitor.finished;
  assert.equal(outcome.reason, "silence");
  assert.equal(outcome.cancellation, null, "no report is better than a report nothing measured");
  assert.equal(outcome.error, failure);
});

test("a run that ended on its own is stopped, not terminated", async () => {
  const state = harness();
  const monitor = monitorFor(state, { silenceMs: 1_000 });

  const outcome = await monitor.stop();
  assert.equal(outcome.reason, null);
  assert.equal(outcome.cancellation, null);
  assert.equal(state.terminations, 0, "nothing was signalled at a tree that had already left");

  // And a tick that arrives after the stop changes nothing.
  state.advance(10_000);
  await monitor.tick();
  assert.equal(monitor.reason, null);
  assert.equal(state.terminations, 0);
});

test("the monitor trips once, however many ticks arrive", async () => {
  const state = harness();
  const monitor = monitorFor(state, { silenceMs: 1_000 });
  state.advance(5_000);
  await Promise.all([monitor.tick(), monitor.tick(), monitor.tick()]);
  await monitor.finished;
  assert.equal(state.terminations, 1);
});

// ---------------------------------------------------------------------------
// The structural half of "never conversational markers".
// ---------------------------------------------------------------------------

test("the monitor has no way to reach the event vocabulary at all", () => {
  const source = readFileSync(
    join(repoRoot(), "core", "src", "execution", "liveness-monitor.ts"),
    "utf8",
  );
  // Not a style rule. An import of the normalized-event contract is the door
  // through which "the model said MILESTONE" becomes "the model is working".
  assert.equal(/from\s+["'].*normalized-events/.test(source), false);
  assert.equal(/from\s+["'].*contracts\//.test(source), false);
});
