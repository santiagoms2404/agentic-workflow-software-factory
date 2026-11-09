// B1-10: the TERM grace period must always end in a KILL, and must end on time.
//
// Two ways the ladder used to stop short of SIGKILL while a survivor ignored
// SIGTERM. A throw from the SIGTERM itself, or from a census inside the grace
// loop, left `terminateTree` before the escalation, so the one signal that
// cannot be ignored was never sent. And the grace was measured on the wall
// clock (`Date.now()`), so a backward clock step (NTP correction, VM resume)
// stretched "up to 2 s" by the size of the step, and a forward step cut it to a
// single poll.
//
// The seam is the platform port, which is how the controller already takes both
// its census and its signals. The clock steps are a stubbed `Date.now`: the
// grace must not be listening to it at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EnumerationUnavailable,
  SignalUnavailable,
  type ProcessIdentity,
} from "../../../src/execution/launcher-barrier.ts";
import { ProcessController, type PlatformPort, type ProcessRow } from "../../../src/execution/process-controller.ts";

const LEADER = 7_100;
const CHILD = 7_101;
const HOUR = 3_600_000;

interface StubbornPort extends PlatformPort {
  readonly sent: { signal: "SIGTERM" | "SIGKILL"; members: readonly number[] }[];
}

/**
 * A group of two that ignores SIGTERM, and dies only to SIGKILL.
 *
 * `onCensus(n)` runs before census number `n` (1-based) answers; it may throw,
 * which is how a census that fails mid-grace is staged. `termThrows` makes the
 * SIGTERM itself fail after it has been recorded as attempted.
 */
function stubbornPort(options: { onCensus?: (n: number) => void; termThrows?: boolean } = {}): StubbornPort {
  const sent: StubbornPort["sent"] = [];
  let killed = false;
  let censuses = 0;
  const row = (pid: number, ppid: number): ProcessRow => ({
    pid,
    ppid,
    pgid: LEADER,
    alive: !killed,
    cpu: 0,
    startIdentity: `start-${pid}`,
    startedAt: pid,
  });
  return {
    platform: "fake",
    identitySource: "fake-start",
    grouping: "process-group",
    minPollMs: 0,
    sent,
    census: () => {
      censuses += 1;
      options.onCensus?.(censuses);
      return [row(LEADER, 1), row(CHILD, LEADER)];
    },
    signalGroup: (_group, signal, members) => {
      sent.push({ signal, members: [...members] });
      if (signal === "SIGTERM" && options.termThrows === true) {
        throw new SignalUnavailable("fake", "the TERM mechanism failed");
      }
      if (signal === "SIGKILL") killed = true;
      return true;
    },
  };
}

const identity: ProcessIdentity = {
  pid: LEADER,
  pgid: LEADER,
  startIdentity: `start-${LEADER}`,
  startIdentitySource: "fake-start",
};

async function caught(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Resolves to "timed out" if `work` has not settled within `ms` of REAL time. */
async function within(work: Promise<unknown>, ms: number): Promise<"settled" | "timed out"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timed out">((resolve) => {
    timer = setTimeout(() => resolve("timed out"), ms);
  });
  try {
    return await Promise.race([work.then(() => "settled" as const, () => "settled" as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

test("a SIGTERM that throws still escalates to SIGKILL, and the throw still reaches the caller", async () => {
  const port = stubbornPort({ termThrows: true });
  const controller = new ProcessController({ port });

  const error = await caught(controller.terminateTree(identity, { graceMs: 60, settleMs: 0, pollMs: 5 }));

  assert.deepEqual(
    port.sent.map((entry) => entry.signal),
    ["SIGTERM", "SIGKILL"],
    "a failed TERM must not leave the group without the one signal it cannot ignore",
  );
  assert.deepEqual(port.sent[1]?.members, [LEADER, CHILD]);
  // Escalating is not the same as reporting: a supervisor whose signal mechanism
  // failed still may not claim what the ladder achieved.
  assert.ok(error instanceof SignalUnavailable, `expected SignalUnavailable, got ${String(error)}`);
});

test("a census that throws inside the grace still escalates to SIGKILL at the last-seen survivors", async () => {
  const port = stubbornPort({
    onCensus: (n) => {
      if (n === 2) throw new EnumerationUnavailable("fake", "the census went blind mid-grace");
    },
  });
  const controller = new ProcessController({ port });

  const error = await caught(controller.terminateTree(identity, { graceMs: 60, settleMs: 0, pollMs: 5 }));

  assert.deepEqual(
    port.sent.map((entry) => entry.signal),
    ["SIGTERM", "SIGKILL"],
  );
  assert.deepEqual(port.sent[1]?.members, [LEADER, CHILD]);
  assert.ok(error instanceof EnumerationUnavailable, `expected EnumerationUnavailable, got ${String(error)}`);
});

test("a wall clock stepped back an hour mid-grace does not stretch the grace", async () => {
  const realNow = Date.now;
  let offset = 0;
  // The step lands at the first census INSIDE the grace (census 1 is the
  // pre-signal enumeration), i.e. after any wall-clock deadline was computed.
  const port = stubbornPort({ onCensus: (n) => { if (n === 2) offset = -HOUR; } });
  const controller = new ProcessController({ port });
  Date.now = (): number => realNow() + offset;
  const work = controller.terminateTree(identity, { graceMs: 100, settleMs: 0, pollMs: 5 });
  let outcome: "settled" | "timed out";
  try {
    outcome = await within(work, 2_000);
  } finally {
    // Restored before the drain, so a loop still waiting on the wall clock
    // finishes on its next poll instead of an hour from now.
    Date.now = realNow;
  }
  const report = await work;

  assert.equal(outcome, "settled", "a 100 ms grace was still running 2 s later: the clock step stretched it");
  assert.equal(report.killSent, true);
  assert.equal(report.terminated, true);
});

test("a wall clock stepped forward an hour mid-grace does not cut the grace short", async () => {
  const realNow = Date.now;
  let offset = 0;
  const port = stubbornPort({ onCensus: (n) => { if (n === 2) offset = HOUR; } });
  const controller = new ProcessController({ port });
  const graceMs = 200;
  Date.now = (): number => realNow() + offset;
  const started = performance.now();
  let report;
  try {
    report = await controller.terminateTree(identity, { graceMs, settleMs: 0, pollMs: 5 });
  } finally {
    Date.now = realNow;
  }
  const elapsed = performance.now() - started;

  assert.equal(report.killSent, true);
  // Half the grace is a lenient floor against timer jitter; the defect being
  // ruled out ends the grace after ONE 5 ms poll.
  assert.ok(elapsed >= graceMs / 2, `the grace ended after ${Math.round(elapsed)} ms of a ${graceMs} ms period`);
});
