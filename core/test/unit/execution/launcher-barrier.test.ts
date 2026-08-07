// The barrier's sequencing, proven without a process.
//
// Every case here answers the same question in a different way: what does the
// system owe the world when a launch fails at step N? The answers are fixed —
// the tree is destroyed, the reservation goes back if and only if the provider
// provably never ran, and the release token is never written after a fault.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARRIER_STEPS,
  LAUNCHER_EXIT,
  PayloadInvalid,
  RegistrationFailed,
  HandshakeFailed,
  decodeLaunchPayload,
  encodeLaunchPayload,
  formatIdentityLine,
  parseIdentityLine,
  runLauncherBarrier,
  sameProcess,
  type BarrierRecord,
  type BarrierStep,
  type GatedLaunch,
  type ProcessIdentity,
  type TerminationReport,
} from "../../../src/execution/launcher-barrier.ts";
import { CallBudget } from "../../../src/execution/call-budget.ts";

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

/**
 * The rejection, typed.
 *
 * `assert.ok(error instanceof X)` reads fine but narrows nothing here — without
 * `@types/node` the compiler cannot see `assert.ok`'s assertion signature — so
 * the check and the narrowing happen in one place instead of drifting apart.
 */
function expectError<T>(error: unknown, type: new (...args: never[]) => T, detail = ""): T {
  if (!(error instanceof type)) {
    throw new Error(`expected ${type.name}${detail}, got ${String(error)}`);
  }
  return error;
}

interface Trace {
  calls: string[];
  steps: BarrierStep[];
}

interface FakeOptions {
  identify?: () => Promise<ProcessIdentity>;
  release?: () => Promise<void>;
  abandon?: () => Promise<TerminationReport>;
}

function fakeLaunch(trace: Trace, options: FakeOptions = {}): GatedLaunch {
  return {
    identify: async () => {
      trace.calls.push("identify");
      return options.identify === undefined ? IDENTITY : await options.identify();
    },
    release: async () => {
      trace.calls.push("release");
      if (options.release !== undefined) await options.release();
    },
    abandon: async () => {
      trace.calls.push("abandon");
      return options.abandon === undefined ? CANCELLED : await options.abandon();
    },
  };
}

const RECORD: Omit<BarrierRecord, "identity"> = {
  runId: "run-1",
  edge: "L4",
  reservationId: "r1",
  command: ["/usr/bin/true"],
  cwd: "/tmp",
};

function ledgerWithOneCall(): { budget: CallBudget; reservationId: string } {
  const budget = new CallBudget({ taskId: "T99", tier: 2 });
  return { budget, reservationId: budget.reserve({ cost: 1, edge: "L4" }).id };
}

async function runWith(
  overrides: {
    launch?: FakeOptions;
    register?: (record: BarrierRecord) => Promise<void>;
    signal?: AbortSignal;
    startFails?: unknown;
    /** Raises a fault at a chosen boundary — including one past the release token. */
    stepFails?: BarrierStep;
  } = {},
): Promise<{ trace: Trace; budget: CallBudget; error: unknown; registered: BarrierRecord[] }> {
  const trace: Trace = { calls: [], steps: [] };
  const registered: BarrierRecord[] = [];
  const { budget, reservationId } = ledgerWithOneCall();
  let error: unknown = null;
  try {
    await runLauncherBarrier({
      start: async () => {
        trace.calls.push("start");
        if (overrides.startFails !== undefined) throw overrides.startFails;
        return fakeLaunch(trace, overrides.launch ?? {});
      },
      record: { ...RECORD, reservationId },
      register: async (record) => {
        trace.calls.push("register");
        registered.push(record);
        await overrides.register?.(record);
      },
      ledger: budget,
      ...(overrides.signal === undefined ? {} : { signal: overrides.signal }),
      onStep: (step) => {
        trace.steps.push(step);
        if (step === overrides.stepFails) throw new Error(`injected fault at ${step}`);
      },
    });
  } catch (caught) {
    error = caught;
  }
  return { trace, budget, error, registered };
}

// ---------------------------------------------------------------------------
// The happy path IS the ordering claim.
// ---------------------------------------------------------------------------

test("a released launch registers durably before it releases, and spends before that", async () => {
  const { trace, budget, error, registered } = await runWith();

  assert.equal(error, null);
  assert.deepEqual(trace.calls, ["start", "identify", "register", "release"]);
  assert.deepEqual(trace.steps, [...BARRIER_STEPS]);

  // The registration describes a process that has not executed a provider yet.
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0]?.identity, IDENTITY);
  assert.equal(registered[0]?.reservationId, "r1");

  assert.equal(budget.callsSpent, 1);
  assert.equal(budget.callsReserved, 0);
  assert.equal(budget.reservation("r1")?.state, "spent");
});

test("the release token is written after the spend, never before", async () => {
  // Reconstructed from the trace rather than asserted on a flag: crashing
  // between GO and the spend would let a provider run for free, and the only
  // structural defence is that the spend already happened.
  const { trace } = await runWith();
  assert.ok(trace.steps.indexOf("spent") < trace.steps.indexOf("released"));
  assert.ok(trace.steps.indexOf("registered") < trace.steps.indexOf("released"));
});

// ---------------------------------------------------------------------------
// Every fault before the token: destroy the tree, return the call.
// ---------------------------------------------------------------------------

test("a registration failure kills the tree, returns the reservation, and never releases", async () => {
  const { trace, budget, error } = await runWith({
    register: async () => {
      throw new Error("fsync failed");
    },
  });

  const failure = expectError(error, RegistrationFailed);
  assert.equal(failure.step, "identified");
  assert.equal(failure.cancellation?.terminated, true);
  assert.deepEqual(failure.cancellation?.survivors, []);
  assert.equal(failure.reservation?.state, "released");
  assert.match(String((failure.cause as Error).message), /fsync failed/);

  assert.ok(!trace.calls.includes("release"), "a launch that was never registered is never released");
  assert.ok(trace.calls.includes("abandon"));
  assert.deepEqual(trace.steps, ["launched", "identified"]);

  // A provider that never ran never costs a call.
  assert.equal(budget.callsSpent, 0);
  assert.equal(budget.callsReserved, 0);
  assert.equal(budget.committed, 0);
});

test("a handshake failure abandons at 'launched' and returns the reservation", async () => {
  const { trace, budget, error } = await runWith({
    launch: {
      identify: async () => {
        throw new HandshakeFailed("no identity within 5 ms");
      },
    },
  });

  const failure = expectError(error, RegistrationFailed);
  assert.equal(failure.step, "launched");
  assert.ok(failure.cause instanceof HandshakeFailed);
  assert.deepEqual(trace.calls, ["start", "identify", "abandon"]);
  assert.equal(budget.callsSpent, 0);
  assert.equal(budget.reservation("r1")?.state, "released");
});

test("a launch that never started refunds without pretending to cancel anything", async () => {
  const { trace, budget, error } = await runWith({ startFails: new Error("EMFILE") });

  const failure = expectError(error, RegistrationFailed);
  assert.equal(failure.step, "start");
  assert.equal(failure.cancellation, null, "there is no tree to report on");
  assert.deepEqual(trace.calls, ["start"]);
  assert.equal(budget.callsSpent, 0);
  assert.equal(budget.reservation("r1")?.state, "released");
});

test("an abort before the token destroys the launch and returns the call", async () => {
  const controller = new AbortController();
  const { trace, budget, error } = await runWith({
    signal: controller.signal,
    launch: {
      identify: async () => {
        controller.abort("owner cancelled");
        return IDENTITY;
      },
    },
  });

  const failure = expectError(error, RegistrationFailed);
  assert.equal(failure.step, "identified");
  assert.ok(!trace.calls.includes("register"), "an aborted launch is not registered");
  assert.ok(!trace.calls.includes("release"));
  assert.equal(budget.callsSpent, 0);
});

test("an abort raised before anything starts still returns the reservation", async () => {
  const controller = new AbortController();
  controller.abort("cancelled first");
  const { trace, budget, error } = await runWith({ signal: controller.signal });

  const failure = expectError(error, RegistrationFailed);
  assert.equal(failure.step, "start");
  assert.deepEqual(trace.calls, [], "no child is created for a launch that was already cancelled");
  assert.equal(budget.reservation("r1")?.state, "released");
});

// ---------------------------------------------------------------------------
// After the spend: bill it. The ledger does not guess.
// ---------------------------------------------------------------------------

test("a release that fails after the spend bills the call rather than guessing", async () => {
  const { trace, budget, error } = await runWith({
    launch: {
      release: async () => {
        throw new Error("EPIPE on the control channel");
      },
    },
  });

  const failure = expectError(error, RegistrationFailed);
  assert.equal(failure.step, "spent");
  assert.equal(failure.reservation, null, "nothing was refunded");
  assert.ok(trace.calls.includes("abandon"), "the tree still goes");

  // The token may or may not have reached the child. Billing over-counts by
  // one; refunding would leave a possibly-running provider free.
  assert.equal(budget.callsSpent, 1);
  assert.equal(budget.reservation("r1")?.state, "spent");

  // And the message says exactly that, rather than the "never ran" the earlier
  // steps are entitled to claim.
  assert.match(failure.message, /not knowable, so the call is billed/);
  assert.ok(!failure.message.includes("the provider never ran"));
});

test("a fault raised past the token says a provider may be live, and the tree still goes", async () => {
  const { trace, budget, error } = await runWith({ stepFails: "released" });

  const failure = expectError(error, RegistrationFailed);
  assert.equal(failure.step, "released");
  assert.match(failure.message, /a provider may be running under the registered pid/);
  assert.ok(!failure.message.includes("the provider never ran"), "past the token, that claim is false");

  // The token was written, so the call is real and the tree needs ending.
  assert.deepEqual(trace.calls, ["start", "identify", "register", "release", "abandon"]);
  assert.equal(budget.callsSpent, 1);
  assert.equal(failure.reservation, null, "nothing is refunded once a provider may exist");
});

test("the steps before the token are the only ones entitled to claim the provider never ran", async () => {
  for (const step of ["launched", "identified", "registered"] as const) {
    const { error } = await runWith({ stepFails: step });
    const failure = expectError(error, RegistrationFailed, ` at ${step}`);
    assert.equal(failure.step, step);
    assert.match(failure.message, /the provider never ran/);
  }
});

test("a refund that itself fails is reported, never allowed to bury the first fault", async () => {
  const trace: Trace = { calls: [], steps: [] };
  const budget = new CallBudget({ taskId: "T99", tier: 2 });
  const reservation = budget.reserve({ cost: 1, edge: "L4" });
  // Somebody already settled it — the exact bug `ReservationNotHeld` exists for.
  budget.releaseOnRegistrationFailure(reservation.id);

  const error = await runLauncherBarrier({
    start: async () => fakeLaunch(trace),
    record: { ...RECORD, reservationId: reservation.id },
    register: async () => {
      throw new Error("the disk is full");
    },
    ledger: budget,
  }).then(
    () => null,
    (caught: unknown) => caught,
  );

  const failure = expectError(error, RegistrationFailed);
  assert.match(String((failure.cause as Error).message), /the disk is full/);
  assert.equal(failure.reservation, null);
  assert.equal((failure.refundError as Error).name, "ReservationNotHeld");
});

// ---------------------------------------------------------------------------
// The wire protocol.
// ---------------------------------------------------------------------------

test("an identity line round-trips, and every malformed one is refused", () => {
  assert.deepEqual(parseIdentityLine(formatIdentityLine(IDENTITY).trim()), IDENTITY);

  const refusals: [string, RegExp][] = [
    ["not json", /is not JSON/],
    ["[1,2]", /pid\/pgid/],
    ['{"pid":0,"pgid":1,"startIdentity":null,"startIdentitySource":"x"}', /positive integers/],
    ['{"pid":1,"pgid":1.5,"startIdentity":null,"startIdentitySource":"x"}', /positive integers/],
    ['{"pid":1,"pgid":1,"startIdentity":7,"startIdentitySource":"x"}', /startIdentity must be/],
    ['{"pid":1,"pgid":1,"startIdentity":null,"startIdentitySource":""}', /startIdentitySource/],
  ];
  for (const [line, message] of refusals) {
    assert.throws(() => parseIdentityLine(line), (error: Error) => {
      assert.equal(error.name, "HandshakeFailed");
      assert.match(error.message, message);
      return true;
    }, `"${line}" must be refused`);
  }
});

test("a null start identity survives the wire — an unknown identity is stated, not invented", () => {
  const unknown: ProcessIdentity = {
    pid: 9,
    pgid: 9,
    startIdentity: null,
    startIdentitySource: "unavailable:darwin",
  };
  assert.deepEqual(parseIdentityLine(formatIdentityLine(unknown).trim()), unknown);
});

test("the launch payload round-trips and refuses anything that is not a descriptor", () => {
  const payload = { executable: "/usr/bin/true", argv: ["--flag", "value"] };
  assert.deepEqual(decodeLaunchPayload(encodeLaunchPayload(payload)), payload);

  const refusals: [string, RegExp][] = [
    ["!!!not-base64!!!", /not base64url-encoded JSON/],
    [Buffer.from('"a string"').toString("base64url"), /not an object/],
    [Buffer.from('{"argv":[]}').toString("base64url"), /executable must be/],
    [Buffer.from('{"executable":"bin/true","argv":[]}').toString("base64url"), /not an absolute path/],
    [Buffer.from('{"executable":"/bin/true","argv":"--flag"}').toString("base64url"), /argv must be an array/],
    [Buffer.from('{"executable":"/bin/true","argv":[1]}').toString("base64url"), /argv must be an array/],
  ];
  for (const [encoded, message] of refusals) {
    assert.throws(() => decodeLaunchPayload(encoded), (error: Error) => {
      assert.ok(error instanceof PayloadInvalid);
      assert.match(error.message, message);
      return true;
    });
  }
});

test("the payload carries no prompt — there is nowhere in it for one to ride", () => {
  const decoded = decodeLaunchPayload(encodeLaunchPayload({ executable: "/usr/bin/true", argv: [] }));
  assert.deepEqual(Object.keys(decoded).sort(), ["argv", "executable"]);
});

test("the launcher's exit codes are distinct, so a journal never has to guess which happened", () => {
  const codes = Object.values(LAUNCHER_EXIT);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(LAUNCHER_EXIT.controlChannelClosed, 65);
});

// ---------------------------------------------------------------------------
// Recycled PIDs.
// ---------------------------------------------------------------------------

test("sameProcess fails closed on every kind of doubt", () => {
  assert.equal(sameProcess(IDENTITY, IDENTITY), true);
  assert.equal(sameProcess(IDENTITY, null), false, "a process that is gone is not the same process");
  assert.equal(sameProcess(IDENTITY, { ...IDENTITY, pid: 4243 }), false);
  assert.equal(sameProcess(IDENTITY, { ...IDENTITY, startIdentity: "boot-id:4242:901" }), false);
  assert.equal(
    sameProcess(IDENTITY, { ...IDENTITY, startIdentity: null }),
    false,
    "an identity nobody could establish is never a match",
  );
  assert.equal(sameProcess({ ...IDENTITY, startIdentity: null }, IDENTITY), false);
});
