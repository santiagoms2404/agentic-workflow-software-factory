// The host that gets killed at the barrier.
//
// A real host running the real broker against the real stub provider, with a
// real uncatchable SIGKILL injected from inside the barrier's own step hook. Not
// a simulation of a dead host — an actual one, so whatever the machine looks
// like afterwards is exactly what a power cut at that boundary would have left.
//
// Registration here is the durable path from M2: append + fsync to the journal,
// then an atomic status replace. That is deliberate. The barrier's promise is
// "no provider runs before its record is durable", and a simulation that
// registered into a variable would prove nothing about it.
//
// Invoked by `launcher-barrier.test.ts` as:
//   node --experimental-strip-types _barrier-host.ts '<json>'

import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StubAdapter, type StubScript } from "../../src/adapters/stub.ts";
import { CallBudget } from "../../src/execution/call-budget.ts";
import { ProcessTransportBroker } from "../../src/execution/transport-broker.ts";
import { groupMembers } from "../../src/execution/process-controller.ts";
import {
  RegistrationFailed,
  type BarrierRecord,
  type BarrierStep,
} from "../../src/execution/launcher-barrier.ts";
import { Journal } from "../../src/persistence/journal.ts";
import { writeStatus } from "../../src/persistence/status-store.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import { PROVIDER_PATH, sideEffectPathFor } from "./_barrier-fixtures.ts";

export interface HostRequest {
  dir: string;
  runId: string;
  script: StubScript;
  /** The boundary the host dies at, or `null` for a host that survives. */
  killStep: BarrierStep | null;
  /** Simulates a durability step that fails: the tree must go, the call must come back. */
  registerFails: boolean;
  /** `grandchild` waits for the provider to spawn one and reports the group. */
  mode: "barrier" | "grandchild";
}

const request = JSON.parse(process.argv[2] ?? "{}") as HostRequest;
const dir = request.dir;
const sideEffect = sideEffectPathFor(dir, request.runId);
const steps = join(dir, "steps.log");
const outcomePath = join(dir, "outcome.json");

const adapter = new StubAdapter({ providerPath: PROVIDER_PATH, sideEffectPath: sideEffect });
const budget = new CallBudget({ taskId: "T99", tier: 2 });
const reservation = budget.reserve({ cost: 1, edge: "L4" });
const journal = new Journal<BarrierRecord>(join(dir, "journal.jsonl"));

const broker = new ProcessTransportBroker({
  register: async (record) => {
    // The TEST's window into a child the parent cannot otherwise name — not
    // part of the protocol, and written before the simulated fault so the
    // failure case can still be checked against a real pid.
    writeFileSync(join(dir, "observed-identity.json"), JSON.stringify(record.identity));
    if (request.registerFails) throw new Error("simulated durability failure: fsync refused");
    await journal.append(record);
    await writeStatus(join(dir, "status.json"), {
      run_id: record.runId,
      pid: record.identity.pid,
      pgid: record.identity.pgid,
      process_start_identity: record.identity.startIdentity,
      status: "REGISTERED",
    });
  },
  ledger: budget,
  terminate: { graceMs: 500, settleMs: 25 },
});

function finish(outcome: Record<string, unknown>): never {
  writeFileSync(outcomePath, JSON.stringify(outcome));
  process.exit(0);
  // Unreachable, and required: without `@types/node` the compiler does not know
  // `process.exit` never returns, and a `finish` that might return would let
  // the released path run after the grandchild path had already reported.
  throw new Error("unreachable");
}

const spec = adapter.buildSpec({
  model: `stub/${request.script}`,
  prompt: "the prompt rides stdin",
  cwd: dir,
  env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
});

try {
  const transport = await broker.startProcess(
    {
      runId: request.runId,
      sessionId: "sim-session",
      from: "PREPARED",
      to: "RUNNING",
      edge: "L4",
      reservationId: reservation.id,
      adapterId: "stub",
      role: "worker",
    },
    spec,
    new AbortController().signal,
    {
      onStep: (step) => {
        appendFileSync(steps, `${step}\n`);
        if (step === request.killStep) process.kill(process.pid, "SIGKILL");
      },
    },
  );

  if (request.mode === "grandchild") {
    // Read until the provider names its grandchild, then report what the host
    // can see of the group it would have to kill.
    const events: NormalizedEvent[] = [];
    for await (const event of adapter.parse(transport)) {
      events.push(event);
      const named = event.kind === "notice" && event.detail !== null && event.detail.includes("grandchild");
      if (named) break;
    }
    const members = groupMembers(transport.identity);
    const cancellation = await transport.cancel("simulation complete");
    await journal.close();
    finish({
      kind: "grandchild",
      identity: transport.identity,
      membersBeforeCancel: members,
      cancellation,
      events: events.map((event) => ({ kind: event.kind, detail: "detail" in event ? event.detail : null })),
    });
  }

  // Drained concurrently with stdout: the handshake must have left this stream
  // untouched, or the first bytes of it are already gone.
  let stderrText = "";
  const drainStderr = (async () => {
    const decoder = new TextDecoder("utf8");
    for await (const chunk of transport.stderr) stderrText += decoder.decode(chunk, { stream: true });
  })();

  const events: NormalizedEvent[] = [];
  for await (const event of adapter.parse(transport)) events.push(event);
  const exit = await transport.exit;
  await drainStderr;
  await journal.close();
  finish({
    kind: "released",
    identity: transport.identity,
    exit,
    stderr: stderrText,
    events: events.map((event) => event.kind),
    callsSpent: budget.callsSpent,
    callsReserved: budget.callsReserved,
    reservation: budget.reservation(reservation.id),
  });
} catch (error) {
  await journal.close();
  if (error instanceof RegistrationFailed) {
    finish({
      kind: "failed",
      step: error.step,
      message: error.message,
      cancellation: error.cancellation,
      callsSpent: budget.callsSpent,
      callsReserved: budget.callsReserved,
      committed: budget.committed,
      reservation: error.reservation,
    });
  }
  finish({ kind: "unexpected", message: error instanceof Error ? error.stack : String(error) });
}
