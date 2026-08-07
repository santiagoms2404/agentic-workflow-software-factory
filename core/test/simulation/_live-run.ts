// A real stub run, in this process.
//
// The kill-host simulation needs a separate host because it SIGKILLs itself.
// Nothing here does: these suites watch a live provider and then end it, so the
// test process can be the host and assert against the machine directly.
//
// Everything is real except the durability step — a real broker, a real gated
// launcher, a real detached process group, a real provider executable. What is
// stubbed is the registration, because the barrier's durability contract is
// T10's and is proven there against the actual journal.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StubAdapter, type StubScript } from "../../src/adapters/stub.ts";
import { CallBudget } from "../../src/execution/call-budget.ts";
import { ProcessTransportBroker } from "../../src/execution/transport-broker.ts";
import type { ProcessController, TerminateOptions } from "../../src/execution/process-controller.ts";
import type { ProcessTransport } from "../../src/adapters/interface.ts";
import { PROVIDER_PATH, sideEffectPathFor } from "./_barrier-fixtures.ts";

let counter = 0;

export interface LiveRun {
  runId: string;
  dir: string;
  adapter: StubAdapter;
  transport: ProcessTransport;
  controller: ProcessController;
  /** Ends the tree if anything is still in it, then removes the run's directory. */
  end: () => Promise<void>;
}

export async function startStubRun(
  script: StubScript,
  terminate: TerminateOptions = { graceMs: 500, settleMs: 25 },
): Promise<LiveRun> {
  const dir = mkdtempSync(join(tmpdir(), "awsf-live-"));
  const runId = `awsflive-${process.pid}-${++counter}`;
  const adapter = new StubAdapter({
    providerPath: PROVIDER_PATH,
    sideEffectPath: sideEffectPathFor(dir, runId),
  });
  const budget = new CallBudget({ taskId: "T99", tier: 2 });
  const reservation = budget.reserve({ cost: 1, edge: "L4" });
  const broker = new ProcessTransportBroker({ register: async () => {}, ledger: budget, terminate });

  const transport = await broker.startProcess(
    {
      runId,
      sessionId: "live-session",
      from: "PREPARED",
      to: "RUNNING",
      edge: "L4",
      reservationId: reservation.id,
      adapterId: "stub",
      role: "worker",
    },
    adapter.buildSpec({
      model: `stub/${script}`,
      prompt: "the prompt rides stdin",
      cwd: dir,
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
    }),
    new AbortController().signal,
  );

  return {
    runId,
    dir,
    adapter,
    transport,
    controller: broker.controller,
    end: async () => {
      try {
        await transport.cancel("the suite is finished");
      } catch {
        // A tree that is already gone is the outcome every one of these wanted.
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** `kill(pid, 0)` asks the kernel, not the port under test. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
