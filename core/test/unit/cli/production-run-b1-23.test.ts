// B1-23: a silence timeout is not proof that the provider process group ended.
// The termination report must reach the BLOCKED reason, and the journal must
// not turn an unresolved process into a terminal FAILED row.

import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  reservationIdOf,
  type BrokerProcessRegistration,
  type ModelRequest,
  type TransportBroker,
} from "../../../src/adapters/interface.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import type { ProcessIdentity } from "../../../src/execution/launcher-barrier.ts";
import type { BrokerOptions } from "../../../src/execution/transport-broker.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { AT, ReplayStub, box, draft, prepare, run, start } from "../../fixtures/trap-world.ts";

const SILENCE = "configured silence timeout elapsed";
const IDENTITY: ProcessIdentity = {
  pid: 4343,
  pgid: 4343,
  startIdentity: "fixture:4343",
  startIdentitySource: "fixture",
};

function unresolvedProcess() {
  const createBroker = (options: BrokerOptions): TransportBroker & { controller: { groupCpu: () => number } } => ({
    controller: { groupCpu: () => 0 },
    async startProcess(registration, spec) {
      const record = {
        identity: IDENTITY,
        runId: registration.runId,
        edge: null,
        ...(registration.kind === "agent-phase" ? { phase: {
          taskSessionId: registration.taskSessionId,
          workflowId: registration.workflowId,
          phaseId: registration.phaseId,
          phaseOrdinal: registration.phaseOrdinal,
          adapterId: registration.adapterId,
          role: registration.role,
        } } : {}),
        reservationId: reservationIdOf(registration),
        command: [spec.executable, ...spec.argv],
        cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
      await options.register(record);
      const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
      await options.onSpent?.(record, reservation);
      let closed = false;
      const stdout = (async function* () {
        while (!closed) {
          await delay(10);
          if (!closed) yield new Uint8Array();
        }
      })();
      return {
        runId: registration.runId,
        identity: IDENTITY,
        stdout,
        stderr: (async function* () {})(),
        exit: new Promise<{ code: null; signal: null }>(() => {}),
        cancel: async (reason: string) => {
          assert.equal(reason, SILENCE);
          closed = true;
          return {
            termSent: true,
            killSent: true,
            survivors: [IDENTITY.pid],
            terminated: false,
            skipped: null,
          };
        },
      };
    },
  });
  return createBroker;
}

class SilentUntilAborted extends ReplayStub {
  override async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<import("../../../src/contracts/normalized-events.ts").NormalizedEvent> {
    const runId = registration.runId;
    await broker.startProcess(registration, this.buildSpec(request), signal);
    yield { kind: "run.started", seq: 1, runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
    while (!signal.aborted) await delay(10);
  }
}

test("B1-23: survivors from silence cancellation block the run without journaling the process as FAILED", async () => {
  const b = box((config) => { config.runtime.silence_timeout_seconds = 1; });
  try {
    const created = await draft(b);
    await prepare(b, created.attemptDir);
    await start(b, created.attemptDir);
    const status = await run(b, created.attemptDir, {
      ...b.infrastructure,
      createBroker: unresolvedProcess(),
      adapterFor: (_entry: unknown, id: string) => new SilentUntilAborted(id),
    });
    const evidence = await readAttemptEvidence(created.attemptDir);
    const processEvents = evidence.filter((entry): entry is Extract<AttemptEvidence, { type: "process" }> => entry.type === "process");

    assert.equal(status.lifecycleState, "BLOCKED");
    assert.match(status.blocker?.detail ?? "", /provider process tree could not be confirmed terminated/i,
      "an unconfirmed termination report must become the BLOCKED reason");
    assert.match(status.blocker?.detail ?? "", new RegExp(String(IDENTITY.pid)),
      "the BLOCKED reason must retain the survivor identity");
    assert.ok(processEvents.length > 0, "the provider launch is retained in process evidence");
    assert.equal(processEvents.at(-1)?.status, "RUNNING",
      "a process whose cancellation reported survivors must not be journaled as terminal FAILED");
  } finally {
    b.close();
  }
});
