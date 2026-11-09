// B1-13, B1-14: the production silence window is process and output activity,
// never decoded provider events.
//
// The builder loop in production-run.ts used to re-arm a one-shot timer on
// every event its adapter decoded and on nothing else. Two runs came out
// wrong. A provider deep in one long silent tool call keeps its process group
// burning CPU and writes nothing the decoder turns into an event, and it was
// cancelled as silent while working. A provider that streams thinking tokens
// and makes no progress reset the window on each token and was never stopped.
// The LivenessMonitor that measures the right thing (group CPU and output byte
// counts) was built only by tests.
//
// These runs go through the real `runProductionCommand` with the configured
// window at its 1 s schema floor, on scripted routes behind a broker that
// spawns nothing. The broker exposes the supervisor a real broker exposes,
// `controller.groupCpu`, so a test can say whether the group is working.

import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  reservationIdOf,
  type BrokerProcessRegistration,
  type ModelRequest,
  type TransportBroker,
} from "../../../src/adapters/interface.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import type { ProcessIdentity } from "../../../src/execution/launcher-barrier.ts";
import type { BrokerOptions } from "../../../src/execution/transport-broker.ts";
import { AT, ReplayStub, box, draft, prepare, run, start } from "../../fixtures/trap-world.ts";

const SILENCE = "configured silence timeout elapsed";
/** Three windows: a run that is cut off at all is cut off well inside this. */
const WORK_MS = 3_000;

interface Provider {
  /** What the group's CPU counter does: moves, stays put, cannot be read, or there is no supervisor at all. */
  cpu: "moving" | "still" | "blind" | "absent";
  /** A stdout chunk at this cadence while the provider works, or nothing. */
  writeEveryMs: number | null;
  /** A decoded thinking token at this cadence, with no byte behind it on stdout. */
  thinkEveryMs: number | null;
  /** `false` for an adapter that never reaches the broker at all. */
  launches: boolean;
}

interface Observed {
  cancels: string[];
  /** Whether the adapter saw its signal aborted when its provider stopped. */
  abortedSeen: boolean | null;
  cpuReads: number;
}

const quiet: Provider = { cpu: "still", writeEveryMs: null, thinkEveryMs: null, launches: true };

function scripted(provider: Provider) {
  const observed: Observed = { cancels: [], abortedSeen: null, cpuReads: 0 };

  const createBroker = (options: BrokerOptions): TransportBroker => {
    let cpu = 0;
    const groupCpu = (_identity: ProcessIdentity): number => {
      observed.cpuReads += 1;
      if (provider.cpu === "blind") throw new Error("census unavailable");
      if (provider.cpu === "moving") cpu += 7;
      return cpu;
    };
    const broker: TransportBroker & { controller?: { groupCpu: typeof groupCpu } } = {
      async startProcess(registration, spec) {
        const record = {
          identity: { pid: 4343, pgid: 4343, startIdentity: "fixture:4343", startIdentitySource: "fixture" },
          runId: registration.runId, edge: null,
          ...(registration.kind === "agent-phase" ? { phase: { taskSessionId: registration.taskSessionId, workflowId: registration.workflowId, phaseId: registration.phaseId, phaseOrdinal: registration.phaseOrdinal, adapterId: registration.adapterId, role: registration.role } } : {}),
          reservationId: reservationIdOf(registration), command: [spec.executable, ...spec.argv], cwd: spec.cwd,
        };
        if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
        await options.register(record);
        const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
        await options.onSpent?.(record, reservation);
        let closed = false;
        const until = Date.now() + WORK_MS;
        const stdout = (async function* () {
          while (!closed && Date.now() < until) {
            await delay(provider.writeEveryMs ?? 25);
            if (!closed && provider.writeEveryMs !== null) yield Buffer.from("progress\n");
          }
        })();
        return {
          runId: registration.runId, identity: record.identity,
          stdout, stderr: (async function* () {})(),
          exit: delay(WORK_MS).then(() => ({ code: 0, signal: null })),
          cancel: async (reason: string) => {
            observed.cancels.push(reason);
            closed = true;
            return { termSent: true, killSent: false, survivors: [], terminated: true, skipped: null };
          },
        };
      },
    };
    if (provider.cpu !== "absent") broker.controller = { groupCpu };
    return broker;
  };

  class Scripted extends ReplayStub {
    override async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
      signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
      const runId = registration.runId;
      if (!provider.launches) {
        // Stuck before launch: nothing exists to be active, so only the clock can end this.
        const until = Date.now() + WORK_MS;
        while (!signal.aborted && Date.now() < until) await delay(25);
        observed.abortedSeen = signal.aborted;
        return;
      }
      const transport = await broker.startProcess(registration, this.buildSpec(request), signal);
      yield { kind: "run.started", seq: 1, runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
      let seq = 2;
      if (provider.thinkEveryMs !== null) {
        const until = Date.now() + WORK_MS;
        while (!signal.aborted && Date.now() < until) {
          await delay(provider.thinkEveryMs);
          yield { kind: "thinking.delta", seq: seq++, runId, hostAt: AT, providerAt: null, text: "considering the next step" };
        }
      } else {
        for await (const _chunk of transport.stdout) { /* read, as a decoder would */ }
      }
      observed.abortedSeen = signal.aborted;
      if (signal.aborted) return;
      yield { kind: "run.failed", seq, runId, hostAt: AT, providerAt: null, errorCode: "E_BACKEND_FAILURE", message: "synthetic stop after work" };
    }
  }

  return { observed, createBroker, adapterFor: (_entry: unknown, id: string) => new Scripted(id) };
}

async function produce(provider: Provider): Promise<Observed> {
  const b = box((config) => { config.runtime.silence_timeout_seconds = 1; });
  try {
    const created = await draft(b);
    await prepare(b, created.attemptDir);
    await start(b, created.attemptDir);
    const script = scripted(provider);
    await run(b, created.attemptDir, { ...b.infrastructure, createBroker: script.createBroker, adapterFor: script.adapterFor });
    return script.observed;
  } finally { b.close(); }
}

test("B1-13: a provider whose group keeps burning CPU through a long silent tool call is not cut off as silent", async () => {
  const observed = await produce({ ...quiet, cpu: "moving" });
  assert.deepEqual(observed.cancels.filter((reason) => reason === SILENCE), [],
    "a working group was cancelled as silent: the window never read its CPU");
  assert.equal(observed.abortedSeen, false, "the provider ran its work to the end");
  assert.ok(observed.cpuReads > 1, `the group's CPU was sampled across the window (${String(observed.cpuReads)} reads)`);
});

test("B1-14: a provider that streams thinking tokens without working is silent, and is aborted and cancelled", async () => {
  const observed = await produce({ ...quiet, thinkEveryMs: 200 });
  assert.equal(observed.cancels[0], SILENCE, "decoded events re-armed the window, so a talking, idle provider ran on");
  assert.equal(observed.abortedSeen, true, "the adapter's signal is aborted, not only its transport cancelled");
});

test("B1-13: output bytes keep a provider alive even when the decoder makes no event of them", async () => {
  const observed = await produce({ ...quiet, cpu: "absent", writeEveryMs: 200 });
  assert.deepEqual(observed.cancels.filter((reason) => reason === SILENCE), [], "a provider writing output was cancelled as silent");
  assert.equal(observed.abortedSeen, false);
});

test("a provider that neither writes nor works trips the window", async () => {
  const observed = await produce(quiet);
  assert.equal(observed.cancels[0], SILENCE);
  assert.equal(observed.abortedSeen, true);
});

test("a census that cannot see the group is not activity: the quiet provider still trips", async () => {
  const observed = await produce({ ...quiet, cpu: "blind" });
  assert.equal(observed.cancels[0], SILENCE);
  assert.equal(observed.abortedSeen, true);
  assert.ok(observed.cpuReads > 0, "the census was attempted");
});

test("an adapter stuck before it launches anything is still bounded by the window", async () => {
  const observed = await produce({ ...quiet, launches: false });
  assert.equal(observed.abortedSeen, true, "nothing ever aborted a turn that never reached the broker");
  assert.deepEqual(observed.cancels, [], "there was no transport to cancel");
});
