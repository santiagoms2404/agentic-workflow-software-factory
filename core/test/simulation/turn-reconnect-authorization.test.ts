// Synthetic process/host evidence proves broker ordering and accounting only.
// These tests do not qualify either paid provider for original-turn continuation.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { continuityDigest } from "../../src/contracts/interrupted-turn.ts";
import { ProcessTransportBroker, type StartHooks } from "../../src/execution/transport-broker.ts";
import type { BarrierRecord } from "../../src/execution/launcher-barrier.ts";
import type { TurnReconnectLaunchVerifier } from "../../src/workflow/turn-reconnect-authorization.ts";
import { reconnectFixture } from "../fixtures/interrupted-turn.ts";

function world(options: { originalState?: "held" | "spent"; fail?: "register" | "reattach"; verifier?: "absent" } = {}) {
  const w = reconnectFixture(options.originalState);
  const root = mkdtempSync(join(tmpdir(), "awsf-reconnect-broker-"));
  const retained = join(root, "retained.txt");
  writeFileSync(retained, "original dirty bytes\n");
  w.spec.cwd = root;
  w.state = { ...w.state, descriptorDigest: continuityDigest(w.spec) };
  const records: BarrierRecord[] = [];
  const trace: string[] = [];
  const brokerOptions = {
    ledger: w.ledger,
    ...(options.verifier === "absent" ? {} : { reconnectLaunchVerifier: w.verifier }),
    register: async (record: BarrierRecord) => {
      trace.push("register");
      records.push(record);
      w.state = { ...w.state, reconnectStage: "registered" };
      if (options.fail === "register") throw new Error("fixture registration durability failure");
    },
    onSpent: async () => assert.fail("reconnect used the ordinary spend callback"),
    onCorrection: async () => assert.fail("reconnect used correction authority"),
    onReattached: async () => {
      trace.push("reattach");
      assert.equal(w.ledger.callsSpent, 1);
      if (options.fail === "reattach") throw new Error("fixture reattachment durability failure");
      w.state = { ...w.state, reconnectStage: "reattached", originalReservationState: "spent" };
    },
  };
  w.ledger.spendOnGo = () => assert.fail("reconnect called spendOnGo");
  w.ledger.reserve = () => assert.fail("reconnect minted a reservation");
  const broker = new ProcessTransportBroker(brokerOptions);
  return { w, root, retained, records, trace, broker, brokerOptions,
    close: () => rmSync(root, { recursive: true, force: true }) };
}

async function launch(f: ReturnType<typeof world>, hooks: StartHooks = {}): Promise<string> {
  const transport = await f.broker.startProcess(f.w.registration, f.w.spec, new AbortController().signal, hooks);
  const read = async (stream: AsyncIterable<Uint8Array>) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  };
  const [out, err, exit] = await Promise.all([read(transport.stdout), read(transport.stderr), transport.exit]);
  assert.equal(exit.code, 0, err);
  return out;
}

for (const originalState of ["held", "spent"] as const) {
  test(`broker registers and records reattachment before GO using the original ${originalState} liability`, async () => {
    const f = world({ originalState });
    try {
      assert.equal(await launch(f, { onStep: (step) => { f.trace.push(step); } }), "continued");
      assert.ok(f.trace.indexOf("register") < f.trace.indexOf("reattach"));
      assert.ok(f.trace.indexOf("reattach") < f.trace.indexOf("released"));
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]!.reservationId, f.w.reservation.id);
      assert.equal(f.records[0]!.edge, null);
      assert.equal(f.records[0]!.reconnect?.logicalTurnId, f.w.binding.logicalTurnId);
      assert.equal(f.w.ledger.callsSpent, 1);
      assert.equal(f.w.ledger.callsReserved, 0);
      assert.equal(readFileSync(f.retained, "utf8"), "original dirty bytes\n");
      await assert.rejects(launch(f), /authorized launch frontier/);
      assert.equal(f.records.length, 1, "settled/reattached activation cannot start a second physical process");
    } finally { f.close(); }
  });
}

for (const fail of ["register", "reattach"] as const) {
  for (const originalState of ["held", "spent"] as const) {
    test(`${fail} failure retains the original ${originalState} liability and kills the gated process`, async () => {
      const f = world({ fail, originalState });
      try {
        await assert.rejects(launch(f, { onStep: (step) => { f.trace.push(step); } }), /durability failure/);
        assert.equal(f.trace.includes("released"), false);
        assert.equal(f.records.length, 1);
        assert.deepEqual(f.broker.controller.groupMembers(f.records[0]!.identity), []);
        assert.equal(f.w.ledger.committed, 1);
        assert.equal(f.w.ledger.reservation(f.w.reservation.id)?.state, fail === "reattach" ? "spent" : originalState);
        assert.equal(readFileSync(f.retained, "utf8"), "original dirty bytes\n");
      } finally { f.close(); }
    });
  }
}

test("missing live proof or verifier refuses before a process is registered", async () => {
  for (const missing of ["proof", "verifier"] as const) {
    const f = world(missing === "verifier" ? { verifier: "absent" } : {});
    try {
      f.w.proofAvailable = missing !== "proof";
      await assert.rejects(launch(f));
      assert.equal(f.records.length, 0);
      assert.equal(f.w.ledger.callsSpent, 1);
    } finally { f.close(); }
  }
});

test("changed lease after durable reattachment refuses immediately before GO", async () => {
  const f = world();
  try {
    await assert.rejects(launch(f, { onStep: (step) => {
      f.trace.push(step);
      if (step === "spent") f.w.state = { ...f.w.state, leaseId: "replacement-lease" };
    } }), /durable activation/);
    assert.equal(f.trace.includes("released"), false);
    assert.equal(f.w.ledger.callsSpent, 1);
    assert.deepEqual(f.broker.controller.groupMembers(f.records[0]!.identity), []);
  } finally { f.close(); }
});

test("concurrent brokers cannot consume one physical launch intent twice", async () => {
  const f = world();
  try {
    const first = launch(f);
    const second = new ProcessTransportBroker(f.brokerOptions);
    await assert.rejects(second.startProcess(f.w.registration, f.w.spec, new AbortController().signal), /already claimed/);
    assert.equal(await first, "continued");
    assert.equal(f.records.length, 1);
    assert.equal(f.w.ledger.callsSpent, 1);
  } finally { f.close(); }
});

test("a verifier replaying genuine evidence for a different descriptor is rejected", async () => {
  const f = world();
  try {
    const proof = f.w.verifier.verify(f.w.registration, f.w.spec);
    const replay: TurnReconnectLaunchVerifier = { verify: () => proof };
    const broker = new ProcessTransportBroker({ ...f.brokerOptions, reconnectLaunchVerifier: replay });
    await assert.rejects(broker.startProcess(f.w.registration, { ...f.w.spec, stdin: "new turn disguised as reconnect" }, new AbortController().signal), /another launch or descriptor/);
    assert.equal(f.records.length, 0);
  } finally { f.close(); }
});

test("caller mutation during registration cannot substitute the frozen reconnect input", async () => {
  const f = world();
  try {
    assert.equal(await launch(f, { onStep: (step) => {
      if (step === "registered") {
        f.w.spec.argv = ["-e", "process.stdout.write('substituted')"];
        f.w.spec.stdin = "replacement prompt";
      }
    } }), "continued");
    assert.equal(f.w.ledger.callsSpent, 1);
  } finally { f.close(); }
});
