// Cancel a run with a grandchild: the grandchild is reaped, and the survivor
// list is the truth.
//
// The grandchild is the case that decides whether cancellation is real. It is a
// process the host never spawned, never registered and cannot name — the only
// reason it is reachable at all is that the provider's child inherits the
// process group the broker created. A supervisor that killed the PID it knew
// about would leave this one running and report success.
//
// Every assertion below about "gone" is asked of the KERNEL (`kill(pid, 0)`),
// not of the port that just claimed it. A report is evidence; it is not proof of
// itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isRunning, startStubRun } from "./_live-run.ts";
import { processesMentioning, within } from "./_barrier-fixtures.ts";

/** The stub names its grandchild on stdout: `{"type":"grandchild","pid":N}`. */
async function grandchildPidOf(run: Awaited<ReturnType<typeof startStubRun>>): Promise<number> {
  for await (const event of run.adapter.parse(run.transport)) {
    const detail = "detail" in event ? (event.detail ?? "") : "";
    const named = /"type"\s*:\s*"grandchild"\s*,\s*"pid"\s*:\s*(\d+)/.exec(detail);
    if (named !== null) return Number(named[1]);
  }
  throw new Error("the stub never named a grandchild");
}

test("cancelling a run reaps a grandchild the host never spawned, and reports truthfully", async () => {
  const run = await startStubRun("grandchild-spawner");
  try {
    const grandchild = await grandchildPidOf(run);
    const provider = run.transport.identity.pid;

    // Both alive, and both in the group the cancellation is about to end.
    assert.ok(isRunning(provider), "the provider is running");
    assert.ok(isRunning(grandchild), "the grandchild is running");
    const before = run.controller.groupMembers(run.transport.identity);
    assert.ok(before.includes(provider), `the provider is in its own group: ${before.join(", ")}`);
    assert.ok(
      before.includes(grandchild),
      `the grandchild the host never spawned is in it too: ${before.join(", ")}`,
    );

    const report = await run.transport.cancel("the suite cancelled the run");

    assert.equal(report.termSent, true);
    assert.equal(report.skipped, null);
    assert.deepEqual([...report.survivors], [], "survivors are enumerated after the ladder, not assumed");
    assert.equal(report.terminated, true);

    // Asked of the kernel. `terminated: true` is a claim; these are the facts.
    //
    // Bounded rather than instantaneous, and the bound is the point: `kill(pid,
    // 0)` succeeds for a process that has exited but not yet been reaped, so an
    // immediate read observed a zombie and called it a survivor. That flake ran
    // in the layer `npm test` chained the journeys behind, so a teardown race
    // in the simulation layer could delete the journey signal entirely. Five
    // seconds is the same deadline the self-exit case below already uses; a
    // process still alive after it is a real survivor.
    assert.equal(await within(5_000, () => !isRunning(provider)), true, "the provider outlived its own cancellation");
    assert.equal(await within(5_000, () => !isRunning(grandchild)), true, "the grandchild outlived its parent's cancellation");
    assert.equal(
      await within(5_000, () => run.controller.groupMembers(run.transport.identity).length === 0),
      true,
      `the process group outlived the cancellation: ${run.controller.groupMembers(run.transport.identity).join(", ")}`,
    );
    assert.equal(
      await within(5_000, () => processesMentioning(run.runId).length === 0),
      true,
      `a process still names this run: ${processesMentioning(run.runId).join(", ")}`,
    );
  } finally {
    await run.end();
  }
});

test("a second cancellation of the same tree sends nothing and still reports the truth", async () => {
  const run = await startStubRun("grandchild-spawner");
  try {
    await grandchildPidOf(run);
    await run.transport.cancel("first");

    // The group is empty now, so there is nothing to aim at — and a supervisor
    // that signalled anyway would be signalling a PID number it no longer owns.
    const second = await run.transport.cancel("second");
    assert.equal(second.termSent, false);
    assert.equal(second.killSent, false);
    assert.deepEqual([...second.survivors], []);
    assert.equal(second.terminated, true);
  } finally {
    await run.end();
  }
});

test("a provider that exits on its own leaves an empty group and an honest report", async () => {
  const run = await startStubRun("success");
  try {
    const events = [];
    for await (const event of run.adapter.parse(run.transport)) events.push(event.kind);
    await run.transport.exit;
    assert.deepEqual(events, ["run.started", "model.resolved", "text.delta", "run.completed"]);

    // The tree left on its own. The ladder must notice that BEFORE signalling.
    const gone = await within(5_000, () => !isRunning(run.transport.identity.pid));
    assert.equal(gone, true);
    const report = await run.transport.cancel("nothing to cancel");
    assert.equal(report.termSent, false);
    assert.equal(report.terminated, true);
    assert.deepEqual([...report.survivors], []);
  } finally {
    await run.end();
  }
});
