// B1-18: a release token that never reached the gated child is a failed
// launch, not a released one.
//
// release() handed the GO write's completion callback straight to `resolve`.
// Node calls that callback WITH the write error, so a launcher that died
// between identify and release (killed, OOM, or `awsf cancel` signalling the
// registered group before GO) still produced a resolved release(): the barrier
// recorded the launch as released and spent, startProcess returned a transport
// whose `exit` listener was attached after the exit had already fired, and no
// RegistrationFailed was raised for a provider that never ran.
//
// Driven through the real broker and the real gated launcher, in process. The
// child is killed from the barrier's own `spent` step hook, the last point
// before the token is written. Tests may spawn.

import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import { RegistrationFailed, type BarrierRecord, type BarrierStep } from "../../../src/execution/launcher-barrier.ts";
import { ProcessTransportBroker } from "../../../src/execution/transport-broker.ts";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function launch(killAt: BarrierStep | null, executable: string) {
  const budget = new CallBudget({ taskId: "T99", tier: 2 });
  const reservation = budget.reserve({ cost: 1, edge: "L4" });
  const registered: BarrierRecord[] = [];
  const broker = new ProcessTransportBroker({ register: async (record) => { registered.push(record); }, ledger: budget });
  const pending = broker.startProcess(
    {
      runId: `awsf-release-${String(process.pid)}`,
      sessionId: "release-session",
      from: "PREPARED",
      to: "RUNNING",
      edge: "L4",
      reservationId: reservation.id,
      adapterId: "stub",
      role: "worker",
    },
    {
      executable,
      argv: [],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdin: "",
      shell: false,
    },
    new AbortController().signal,
    {
      onStep: async (step) => {
        if (step !== killAt) return;
        const pid = registered[0]!.identity.pid;
        process.kill(pid, "SIGKILL");
        // Until the host has reaped it, so the control channel is really gone.
        for (let poll = 0; poll < 100 && alive(pid); poll += 1) await delay(20);
      },
    },
  );
  const outcome = await pending.then((transport) => ({ transport, error: null }), (error: unknown) => ({ transport: null, error }));
  return { ...outcome, budget, reservation, registered };
}

test("a gated child that died before GO fails the launch at `spent` instead of resolving release()", async () => {
  const { transport, error, registered } = await launch("spent", "/bin/true");
  if (transport !== null) await transport.cancel("test cleanup").catch(() => undefined);
  assert.equal(transport === null, true, "startProcess returned a transport for a provider that never received GO");
  assert.ok(error instanceof RegistrationFailed, String(error));
  assert.equal(error.step, "spent");
  assert.match(error.message, /whether the release token reached the child is not knowable, so the call is billed/u);
  assert.equal(registered.length, 1, "the launch was registered before it failed");
});

test("the dead launch stays billed: a spent call is never refunded", async () => {
  const { error, budget, reservation } = await launch("spent", "/bin/true");
  assert.ok(error instanceof RegistrationFailed, String(error));
  assert.equal(error.reservation, null, "no refund was issued");
  assert.equal(budget.reservation(reservation.id)?.state, "spent");
});

test("a child that is alive at GO is released and its exit is observed", async () => {
  const { transport, error } = await launch(null, "/bin/true");
  assert.equal(error, null, String(error));
  const exit = await Promise.race([transport!.exit, delay(5_000).then(() => "pending" as const)]);
  assert.deepEqual(exit, { code: 0, signal: null });
});
