// H15 (B1-02, B7-09): a promise the production runner starts but does not
// await at once must never become an unhandled rejection. Node 22 ends the
// whole process on one, so the attempt would be left RUNNING with no journaled
// outcome. Each failure is held instead and surfaces as the BLOCKED reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { PhaseState } from "../../../src/state/phase-machine.ts";
import { cancelOrRecord, closestBlocker, phaseStateQueue } from "../../../src/cli/commands/production-run.ts";

/**
 * Every unhandled rejection raised while `body` runs and the event loop then
 * turns twice. The test runner's own listeners are set aside for that window,
 * so a regression fails on the assertion below rather than on the runner's
 * report, and restored afterwards.
 */
async function unhandledDuring(body: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const listener = (reason: unknown): void => { seen.push(reason); };
  const runner = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", listener);
  try {
    await body();
    await nextTurn();
    await nextTurn();
  } finally {
    process.off("unhandledRejection", listener);
    for (const restored of runner) process.on("unhandledRejection", restored);
  }
  return seen;
}

function censusFailure(): Error {
  return Object.assign(new Error("ps census did not finish within 5000 ms"), { name: "EnumerationUnavailable" });
}

test("a silence cancel that rejects is recorded as the silence blocker, never left unhandled", async () => {
  const recorded: Error[] = [];
  let pending: Promise<void> | null = null;
  const seen = await unhandledDuring(async () => {
    // The silence timer does not await the cancel; the turn awaits it later.
    pending = cancelOrRecord({ cancel: async () => { throw censusFailure(); } },
      "configured silence timeout elapsed", (failure) => { recorded.push(failure); });
  });
  await pending;
  assert.deepEqual(seen, [], "a rejected cancel must not reach process 'unhandledRejection'");
  assert.equal(recorded.length, 1);
  assert.deepEqual(closestBlocker(recorded[0]), {
    code: "silence",
    detail: "Error: configured silence timeout elapsed; the provider process tree could not be cancelled: EnumerationUnavailable: ps census did not finish within 5000 ms",
  });
});

test("a cancel that succeeds records nothing and passes the reason through", async () => {
  const reasons: string[] = [];
  const recorded: Error[] = [];
  const seen = await unhandledDuring(async () => {
    await cancelOrRecord({ cancel: async (reason) => {
      reasons.push(reason);
      return { terminated: true, survivors: [], skipped: null } as never;
    } }, "configured silence timeout elapsed", (failure) => { recorded.push(failure); });
  });
  assert.deepEqual(seen, []);
  assert.deepEqual(reasons, ["configured silence timeout elapsed"]);
  assert.deepEqual(recorded, []);
});

test("no transport yet means nothing to cancel and nothing to record", async () => {
  const recorded: Error[] = [];
  await cancelOrRecord(undefined, "configured silence timeout elapsed", (failure) => { recorded.push(failure); });
  assert.deepEqual(recorded, []);
});

test("a phase-state write that rejects before anyone awaits the queue becomes the BLOCKED reason", async () => {
  const written: PhaseState[] = [];
  const queue = phaseStateQueue(async (next) => {
    written.push(next);
    if (next === "VALIDATING") throw new Error("attempt revision changed: expected 4, found 5");
  });
  const seen = await unhandledDuring(async () => {
    // The engine queues these and then awaits store() I/O; nothing awaits the queue yet.
    queue.push("RUNNING");
    queue.push("VALIDATING");
    queue.push("CORRECTING");
  });
  assert.deepEqual(seen, [], "a rejected phase-state write must not reach process 'unhandledRejection'");
  const failure = await queue.settled().then(() => null, (error: unknown) => error);
  assert.deepEqual(closestBlocker(failure), {
    code: "phase-abort",
    detail: "Error: attempt revision changed: expected 4, found 5",
  });
  // The chain keeps its order: a state after the failed write is never written.
  assert.deepEqual(written, ["RUNNING", "VALIDATING"]);
  // The held failure stays the reason for every later wait on the queue.
  await assert.rejects(queue.settled(), /attempt revision changed: expected 4, found 5/);
});

test("phase-state writes that all succeed settle in order", async () => {
  const written: PhaseState[] = [];
  const queue = phaseStateQueue(async (next) => {
    await nextTurn();
    written.push(next);
  });
  queue.push("RUNNING");
  queue.push("VALIDATING");
  queue.push("SUCCEEDED");
  await queue.settled();
  assert.deepEqual(written, ["RUNNING", "VALIDATING", "SUCCEEDED"]);
});
