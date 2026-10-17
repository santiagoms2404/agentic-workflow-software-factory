import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProcessRegistration, ProcessSpec } from "../../../src/adapters/interface.ts";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import { ProcessController, type PlatformPort, type ProcessRow } from "../../../src/execution/process-controller.ts";
import { ProcessTransportBroker } from "../../../src/execution/transport-broker.ts";
import { RegistrationFailed } from "../../../src/execution/launcher-barrier.ts";

const POSIX = { skip: process.platform === "win32" };
const TEST_START_IDENTITY = "darwin-test-start-identity";

interface World {
  readonly directory: string;
  readonly budget: CallBudget;
  readonly reservationId: string;
  readonly broker: ProcessTransportBroker;
  readonly registered: import("../../../src/execution/launcher-barrier.ts").BarrierRecord[];
  readonly censusCalls: () => number;
  readonly close: () => Promise<void>;
}

async function world(observe: (pid: number, attempt: number) => readonly ProcessRow[]): Promise<World> {
  const directory = await mkdtemp(join(tmpdir(), "awsf-identity-census-"));
  const pidPath = join(directory, "launcher.pid");
  const launcherPath = join(directory, "null-identity-launcher.mjs");
  await writeFile(launcherPath, [
    'import { createReadStream, writeFileSync, writeSync } from "node:fs";',
    `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    'writeSync(3, JSON.stringify({ pid: process.pid, pgid: process.pid, startIdentity: null, startIdentitySource: "unavailable:darwin" }) + "\\n");',
    'const release = createReadStream(undefined, { fd: 4, autoClose: true });',
    'release.once("data", () => { release.destroy(); process.stdin.pipe(process.stdout); });',
    "",
  ].join("\n"));

  let attempts = 0;
  const port: PlatformPort = {
    platform: "darwin",
    identitySource: "darwin-ps",
    grouping: "process-group",
    minPollMs: 10,
    census: () => {
      attempts += 1;
      return observe(Number(readFileSync(pidPath, "utf8")), attempts);
    },
    signalGroup: () => true,
  };
  const budget = new CallBudget({ taskId: "T99", tier: 2 });
  const reservation = budget.reserve({ cost: 1, edge: "L4" });
  const registered: World["registered"] = [];
  const broker = new ProcessTransportBroker({
    register: async (record) => { registered.push(record); },
    ledger: budget,
    launcherPath,
    handshakeMs: 1_000,
    controller: new ProcessController({ port }),
  });
  return {
    directory, budget, reservationId: reservation.id, broker, registered,
    censusCalls: () => attempts,
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

function registration(reservationId: string): ProcessRegistration {
  return {
    runId: "b1-27-identity-probe",
    sessionId: "identity-session",
    from: "PREPARED",
    to: "RUNNING",
    edge: "L4",
    reservationId,
    adapterId: "fixture",
    role: "worker",
  };
}

function specFor(cwd: string): ProcessSpec {
  return {
    executable: process.execPath,
    argv: [],
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    stdin: "identity probe",
    shell: false,
  };
}

test("a transient identity census failure is retried before the broker durably registers the process", POSIX, async () => {
  const fixture = await world((pid, attempt) => {
    if (attempt === 1) throw new Error("simulated transient ps failure");
    return [{ pid, ppid: 1, pgid: pid, alive: true, cpu: 0, startIdentity: TEST_START_IDENTITY, startedAt: 1 }];
  });
  try {
    const transport = await fixture.broker.startProcess(
      registration(fixture.reservationId), specFor(fixture.directory), new AbortController().signal,
    );
    assert.equal(fixture.censusCalls(), 2);
    assert.equal(fixture.registered.length, 1);
    assert.deepEqual(fixture.registered[0]?.identity, {
      pid: transport.identity.pid,
      pgid: transport.identity.pid,
      startIdentity: TEST_START_IDENTITY,
      startIdentitySource: "darwin-ps",
    });
    let output = "";
    for await (const chunk of transport.stdout) output += Buffer.from(chunk).toString("utf8");
    assert.deepEqual(await transport.exit, { code: 0, signal: null });
    assert.equal(output, "identity probe");
  } finally { await fixture.close(); }
});

test("persistent identity census failure refuses before registration and refunds the held call", POSIX, async () => {
  const fixture = await world(() => { throw new Error("simulated unavailable ps census"); });
  try {
    const failure = await fixture.broker.startProcess(
      registration(fixture.reservationId), specFor(fixture.directory), new AbortController().signal,
    ).then(() => null, (error: unknown) => error);
    assert.ok(failure instanceof RegistrationFailed);
    assert.match(failure.message, /identity/i);
    assert.equal(fixture.censusCalls(), 2);
    assert.equal(fixture.registered.length, 0, "an unverifiable process must never be durably registered");
    assert.equal(fixture.budget.reservation(fixture.reservationId)?.state, "released");
    assert.equal(fixture.budget.callsSpent, 0);
  } finally { await fixture.close(); }
});
