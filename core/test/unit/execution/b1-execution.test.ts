import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContinuityStore,
  InterruptedTurnStore,
} from "../../../src/execution/continuity-store.ts";
import {
  RegistrationFailed,
  runLauncherBarrier,
  type BarrierRecord,
  type GatedLaunch,
  type ProcessIdentity,
  type TerminationReport,
} from "../../../src/execution/launcher-barrier.ts";
import { resetSignalDispositions } from "../../../src/execution/launcher.ts";
import {
  ProcessTransportBroker,
  SpawnRegistrationInvalid,
} from "../../../src/execution/transport-broker.ts";
import {
  ownExecutionLease,
  withExecutionLease,
} from "../../../src/execution/operation-lease.ts";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import { sha256 } from "../../../src/contracts/owner-amendment.ts";
import { turnCheckpoint } from "../../fixtures/interrupted-turn.ts";
import type { ProcessSpec } from "../../../src/adapters/interface.ts";

const IDENTITY: ProcessIdentity = {
  pid: 4242,
  pgid: 4242,
  startIdentity: "boot-id:4242:900",
  startIdentitySource: "linux-proc-stat",
};

const CANCELLED: TerminationReport = {
  termSent: true,
  killSent: false,
  survivors: [],
  terminated: true,
  skipped: null,
};

function fakeLaunch(
  trace: string[],
  overrides: {
    release?: () => Promise<void>;
    abandon?: () => Promise<TerminationReport>;
  } = {},
): GatedLaunch {
  return {
    identify: async () => {
      trace.push("identify");
      return IDENTITY;
    },
    release: async () => {
      trace.push("release");
      if (overrides.release) await overrides.release();
    },
    abandon: async () => {
      trace.push("abandon");
      return overrides.abandon ? await overrides.abandon() : CANCELLED;
    },
  };
}

const BASE_RECORD: Omit<BarrierRecord, "identity"> = {
  runId: "run-b1",
  edge: "L4",
  reservationId: "r1",
  command: ["/bin/echo"],
  cwd: "/tmp",
};

test("B1-29: open() and recordTurn() roll back in-memory map on flush failure and serialize", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awsf-b1-29-"));
  const path = join(dir, "continuity.json");
  const store = new ContinuityStore({ path });

  // Create a regular file so trying to use it as a directory fails
  const fileBlocker = join(dir, "file-not-dir");
  await writeFile(fileBlocker, "blocking");
  const badStore = new ContinuityStore({ path: join(fileBlocker, "continuity.json") });

  await assert.rejects(
    badStore.open({
      phaseId: "phase-1",
      adapter: "pi",
      provider: "pi",
      model: "pi/gpt-4o",
      storeDir: null,
    }),
  );

  // In-memory map should not have "continuity:phase-1"
  assert.equal(badStore.get("continuity:phase-1"), undefined);

  // Successful open on the good store
  const record = await store.open({
    phaseId: "phase-1",
    adapter: "pi",
    provider: "pi",
    model: "pi/gpt-4o",
    storeDir: null,
  });
  assert.equal(record.turns, 0);
  assert.equal(store.get("continuity:phase-1")?.turns, 0);

  // Successful recordTurn
  await store.recordTurn("continuity:phase-1");
  assert.equal(store.get("continuity:phase-1")?.turns, 1);

  // Use a store pointing to a directory to test recordTurn rollback
  const mockFlushDir = join(dir, "mock-dir");
  const mockFlushPath = join(mockFlushDir, "continuity.json");
  const mockFlushStore = new ContinuityStore({
    path: mockFlushPath,
  });
  await mockFlushStore.open({
    phaseId: "phase-3",
    adapter: "pi",
    provider: "pi",
    model: "pi/gpt-4o",
    storeDir: null,
  });
  assert.equal(mockFlushStore.get("continuity:phase-3")?.turns, 0);

  // Replace continuity.json with a directory so lstat.isFile() returns false and causes privateFailure
  const { rm, mkdir } = await import("node:fs/promises");
  await rm(mockFlushPath);
  await mkdir(mockFlushPath);
  await assert.rejects(mockFlushStore.recordTurn("continuity:phase-3"));
  // Turns must have rolled back to 0
  assert.equal(mockFlushStore.get("continuity:phase-3")?.turns, 0);
});

test("B1-30: InterruptedTurnStore.write() avoids leaving torn files on disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "awsf-b1-30-"));
  const privateRoot = join(root, "private", "turns");
  const store = new InterruptedTurnStore(privateRoot);

  const checkpoint = turnCheckpoint();
  const ref = await store.write(checkpoint, null);
  assert.equal(ref.generation, 1);

  // Idempotent write returns identical reference
  const idempotentRef = await store.write(checkpoint, null);
  assert.deepEqual(idempotentRef, ref);

  const genPath = join(privateRoot, sha256(checkpoint.binding.logicalTurnId), "1.json");
  const content = await readFile(genPath, "utf8");
  assert.ok(content.length > 0);
});

test("B1-31: runLauncherBarrier keeps 'at' accurate during durable spend and does not claim release reached child", async () => {
  const trace: string[] = [];
  const budget = new CallBudget({ taskId: "T99", tier: 2 });
  const reservation = budget.reserve({ cost: 1, edge: "L4" });

  await assert.rejects(
    runLauncherBarrier({
      start: async () => fakeLaunch(trace),
      record: { ...BASE_RECORD, reservationId: reservation.id },
      register: async () => undefined,
      onSpent: async () => {
        throw new Error("disk I/O error during onSpent persistence");
      },
      ledger: budget,
    }),
    (err: unknown) => {
      assert.ok(err instanceof RegistrationFailed);
      assert.equal(err.step, "spending");
      assert.match(err.message, /the provider never ran/);
      assert.ok(!err.message.includes("not knowable, so the call is billed"));
      return true;
    },
  );

  assert.ok(!trace.includes("release"), "release must not be called when onSpent throws");
  assert.ok(trace.includes("abandon"), "abandon must be called on failure");
});

test("B1-32: runLauncherBarrier checks abort signal between durable spend and release", async () => {
  const trace: string[] = [];
  const budget = new CallBudget({ taskId: "T99", tier: 2 });
  const reservation = budget.reserve({ cost: 1, edge: "L4" });
  const controller = new AbortController();

  await assert.rejects(
    runLauncherBarrier({
      start: async () => fakeLaunch(trace),
      record: { ...BASE_RECORD, reservationId: reservation.id },
      register: async () => undefined,
      onSpent: async () => {
        // Abort signal while persisting spend
        controller.abort("aborted during durable spend");
      },
      ledger: budget,
      signal: controller.signal,
    }),
    (err: unknown) => {
      assert.ok(err instanceof RegistrationFailed);
      assert.match(String((err.cause as Error).message), /aborted during durable spend/);
      return true;
    },
  );

  assert.ok(!trace.includes("release"), "release must never be called if aborted during durable spend");
  assert.ok(trace.includes("abandon"), "abandon must be called when aborted");
});

test("B1-33: runLauncherBarrier does not quietly refund when abandon throws or fails or leaves survivors", async () => {
  // Case A: abandon throws
  {
    const trace: string[] = [];
    const budget = new CallBudget({ taskId: "T99", tier: 2 });
    const reservation = budget.reserve({ cost: 1, edge: "L4" });

    await assert.rejects(
      runLauncherBarrier({
        start: async () =>
          fakeLaunch(trace, {
            abandon: async () => {
              throw new Error("process table unreachable during abandon");
            },
          }),
        record: { ...BASE_RECORD, reservationId: reservation.id },
        register: async () => {
          throw new Error("register failed");
        },
        ledger: budget,
      }),
      (err: unknown) => {
        assert.ok(err instanceof RegistrationFailed);
        assert.equal(err.reservation, null, "reservation must NOT be refunded if abandon throws");
        assert.ok(err.refundError !== null);
        return true;
      },
    );
    assert.equal(budget.callsReserved, 1, "reservation remains not released in budget");
  }

  // Case B: abandon leaves survivors
  {
    const trace: string[] = [];
    const budget = new CallBudget({ taskId: "T99", tier: 2 });
    const reservation = budget.reserve({ cost: 1, edge: "L4" });

    await assert.rejects(
      runLauncherBarrier({
        start: async () =>
          fakeLaunch(trace, {
            abandon: async () => ({
              termSent: true,
              killSent: true,
              survivors: [12345],
              terminated: false,
              skipped: null,
            }),
          }),
        record: { ...BASE_RECORD, reservationId: reservation.id },
        register: async () => {
          throw new Error("register failed");
        },
        ledger: budget,
      }),
      (err: unknown) => {
        assert.ok(err instanceof RegistrationFailed);
        assert.equal(err.reservation, null, "reservation must NOT be refunded if abandon leaves survivors");
        return true;
      },
    );
    assert.equal(budget.callsReserved, 1);
  }
});

test("B1-34: resetSignalDispositions installs listeners for SIGPIPE and SIGXFSZ", () => {
  resetSignalDispositions();
  const pipeListeners = process.listeners("SIGPIPE");
  const xfszListeners = process.listeners("SIGXFSZ");
  assert.ok(pipeListeners.length > 0, "SIGPIPE listener should be attached");
  assert.ok(xfszListeners.length > 0, "SIGXFSZ listener should be attached");
});

test("B1-37: ProcessTransportBroker validates reservation exists and is held before child spawn in task-edge validator", async () => {
  const budget = new CallBudget({ taskId: "T99", tier: 2 });
  const broker = new ProcessTransportBroker({
    register: async () => undefined,
    ledger: budget,
  });

  const spec: ProcessSpec = {
    executable: "node",
    argv: ["-e", "process.exit(0)"],
    cwd: process.cwd(),
    env: { PATH: process.env["PATH"] ?? "" },
    stdin: "",
    shell: false,
  };

  // 1. Unknown reservation id
  await assert.rejects(
    broker.startProcess(
      {
        runId: "run-edge-1",
        sessionId: "s1",
        from: "PREPARED",
        to: "RUNNING",
        edge: "L4",
        reservationId: "unknown-reservation",
        adapterId: "stub",
        role: "builder",
      },
      spec,
      new AbortController().signal,
    ),
    (err: unknown) => {
      assert.ok(err instanceof SpawnRegistrationInvalid);
      assert.match(err.message, /reservation is unknown, settled, or not exactly one held call/);
      return true;
    },
  );

  // 2. Already settled / released reservation
  const res = budget.reserve({ cost: 1, edge: "L4" });
  budget.releaseOnRegistrationFailure(res.id);

  await assert.rejects(
    broker.startProcess(
      {
        runId: "run-edge-2",
        sessionId: "s1",
        from: "PREPARED",
        to: "RUNNING",
        edge: "L4",
        reservationId: res.id,
        adapterId: "stub",
        role: "builder",
      },
      spec,
      new AbortController().signal,
    ),
    (err: unknown) => {
      assert.ok(err instanceof SpawnRegistrationInvalid);
      assert.match(err.message, /reservation is unknown, settled, or not exactly one held call/);
      return true;
    },
  );
});

test("B1-38: ProcessTransportBroker fails closed on correction launch if onCorrection callback is missing", async () => {
  const budget = new CallBudget({ taskId: "T99", tier: 2 });
  const origin = budget.reserve({ cost: 1, edge: "L4" });
  budget.spendOnGo(origin.id);

  const broker = new ProcessTransportBroker({
    register: async () => undefined,
    ledger: budget,
    correctionLaunchVerifier: {
      verify: (reg) => ({
        taskSessionId: reg.taskSessionId,
        taskState: "RUNNING",
        workflowId: reg.workflowId,
        phaseId: reg.phaseId,
        phaseOrdinal: reg.phaseOrdinal,
        phaseKind: "agent",
        adapterId: reg.adapterId,
        role: reg.role,
        correctionRound: reg.correctionRound,
        tranche: reg.tranche,
        continuityHandle: reg.continuityHandle,
        verifiedContinuity: "same-session-correction",
        launchAuthorization: "phase-correction",
      }),
    },
    // onCorrection is missing!
  });

  const spec: ProcessSpec = {
    executable: "node",
    argv: ["-e", "process.exit(0)"],
    cwd: process.cwd(),
    env: { PATH: process.env["PATH"] ?? "" },
    stdin: "",
    shell: false,
  };

  await assert.rejects(
    broker.startProcess(
      {
        kind: "phase-correction",
        runId: "run-corr-1",
        taskSessionId: "ts-1",
        workflowId: "wf-1",
        phaseId: "ph-1",
        phaseOrdinal: 1,
        correctionRound: 1,
        tranche: "auto",
        adapterId: "stub",
        role: "builder",
        continuityHandle: "continuity:ph-1",
        originReservationId: origin.id,
      },
      spec,
      new AbortController().signal,
    ),
    (err: unknown) => {
      assert.ok(err instanceof SpawnRegistrationInvalid);
      assert.match(err.message, /the trusted correction verifier or durable evidence callback is not installed/);
      return true;
    },
  );
});

test("B1-42: ownExecutionLease verifies startIdentity to prevent PID reuse hijacking", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awsf-b1-42-"));

  // Claim lease properly
  await withExecutionLease(
    dir,
    async () => undefined,
    async () => {
      // Current process legitimately holds it
      const holder = await ownExecutionLease(dir);
      assert.equal(holder.pid, process.pid);
      assert.ok(typeof holder.startIdentity === "string");

      // Now tamper with the lease file to simulate PID reuse with a different startIdentity
      const leaseFile = join(dir, "execution-lease.json");
      const tampered = {
        id: holder.id,
        pid: process.pid,
        startIdentity: "tampered-boot-id:999999",
      };
      await writeFile(leaseFile, JSON.stringify(tampered));

      // ownExecutionLease must refuse the tampered startIdentity
      await assert.rejects(
        ownExecutionLease(dir),
        /this process does not hold the attempt's execution lease/,
      );

      // Restore it so withExecutionLease cleanup succeeds
      await writeFile(leaseFile, JSON.stringify(holder));
    },
  );
});
