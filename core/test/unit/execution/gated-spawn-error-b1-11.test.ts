// A gated child that cannot be started is a refused launch, not a host crash.
//
// `spawn()` reports most of its failures — a working directory that no longer
// exists, EMFILE, EAGAIN — asynchronously, as an `error` event on the
// ChildProcess. An `error` event nobody listens for is thrown, and nothing in
// core/src catches it at the process level: the HOST died before the barrier's
// start step could reject, so the reservation was never refunded and no
// RegistrationFailed was ever raised. The error it died of also named the node
// binary rather than the directory that was actually missing.
//
// The trigger is real: an attempt worktree removed or pruned between preflight
// and a phase launch is exactly a `spec.cwd` that does not exist.
//
// As in the B1-04 suite, each case runs its host in a separate process, so a
// crash shows up as the host's exit code rather than as a stray uncaught
// exception the runner attributes to nothing in particular.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BROKER = fileURLToPath(new URL("../../../src/execution/transport-broker.ts", import.meta.url));
const BUDGET = fileURLToPath(new URL("../../../src/execution/call-budget.ts", import.meta.url));

/**
 * One launch through the real broker. It prints a single JSON line: either the
 * provider's exit and output, or the refusal `startProcess` rejected with and
 * what became of the reservation.
 */
const HOST_SOURCE = `
import { ProcessTransportBroker } from ${JSON.stringify(BROKER)};
import { CallBudget } from ${JSON.stringify(BUDGET)};

const [executable, cwd] = process.argv.slice(2);
const budget = new CallBudget({ taskId: "T99", tier: 2 });
const reservation = budget.reserve({ cost: 1, edge: "L4" });
const broker = new ProcessTransportBroker({ register: async () => {}, ledger: budget });
let transport;
try {
  transport = await broker.startProcess(
    {
      runId: "awsf-spawn-error-" + process.pid,
      sessionId: "spawn-error-session",
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
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdin: "hello",
      shell: false,
    },
    new AbortController().signal,
  );
} catch (error) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.stdout.write(JSON.stringify({
    refused: {
      name: error.name,
      message: error.message,
      step: error.step ?? null,
      causeName: error.cause?.name ?? null,
      causeCode: error.cause?.errorCode ?? null,
      causeMessage: error.cause?.message ?? null,
    },
    reservation: budget.reservation(reservation.id)?.state ?? null,
    callsSpent: budget.callsSpent,
  }) + "\\n");
  process.exit(0);
}
let stdout = "";
const drained = (async () => {
  for await (const chunk of transport.stdout) stdout += Buffer.from(chunk).toString("utf8");
})();
const exit = await transport.exit;
await drained;
await new Promise((resolve) => setTimeout(resolve, 250));
process.stdout.write(JSON.stringify({ exit, stdout }) + "\\n");
`;

interface Refusal {
  name: string;
  message: string;
  step: string | null;
  causeName: string | null;
  causeCode: string | null;
  causeMessage: string | null;
}

interface HostRun {
  status: number | null;
  stderr: string;
  observed: {
    refused?: Refusal;
    reservation?: string | null;
    callsSpent?: number;
    exit?: { code: number | null; signal: string | null };
    stdout?: string;
  } | null;
}

function runHost(executable: string, cwdIn: (dir: string) => string): HostRun {
  const dir = mkdtempSync(join(tmpdir(), "awsf-gated-spawn-"));
  try {
    const host = join(dir, "host.mjs");
    writeFileSync(host, HOST_SOURCE);
    const result = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", host, executable, cwdIn(dir)],
      { encoding: "utf8", timeout: 60_000, shell: false },
    );
    const line = (result.stdout ?? "").split("\n").find((entry) => entry.startsWith("{"));
    return {
      status: result.status,
      stderr: result.stderr ?? "",
      observed: line === undefined ? null : JSON.parse(line),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The launcher's exec is POSIX-only, and so are these providers.
const POSIX = { skip: process.platform === "win32" };

test("B1-11: a gated spawn into a working directory that does not exist is refused by name, not a host crash", POSIX, () => {
  let missing = "";
  const run = runHost("/bin/cat", (dir) => (missing = join(dir, "worktree-removed-after-preflight")));
  assert.equal(run.status, 0, `the host must survive a failed spawn; host stderr:\n${run.stderr}`);
  assert.doesNotMatch(run.stderr, /Unhandled|uncaught/i);
  const refused = run.observed?.refused;
  assert.equal(refused?.name, "RegistrationFailed");
  assert.equal(refused?.step, "start");
  assert.equal(refused?.causeName, "GatedSpawnFailed");
  assert.equal(refused?.causeCode, "ENOENT");
  // The message names the directory that is missing, not the node binary that
  // spawn() itself blames for an ENOENT.
  assert.ok(
    refused?.causeMessage?.includes(JSON.stringify(missing)) === true &&
      /working directory does not exist/.test(refused.causeMessage),
    `the refusal must name the missing working directory; got: ${String(refused?.causeMessage)}`,
  );
  assert.match(refused?.message ?? "", /failed at "start" and the provider never ran/);
  // The provider never ran, so the call goes back rather than being billed or lost.
  assert.equal(run.observed?.reservation, "released");
  assert.equal(run.observed?.callsSpent, 0);
});

test("a working directory that is a regular file is refused as a failed spawn too", POSIX, () => {
  const run = runHost("/bin/cat", (dir) => join(dir, "host.mjs"));
  assert.equal(run.status, 0, `the host must survive a failed spawn; host stderr:\n${run.stderr}`);
  const refused = run.observed?.refused;
  assert.equal(refused?.name, "RegistrationFailed");
  assert.equal(refused?.step, "start");
  assert.equal(refused?.causeName, "GatedSpawnFailed");
  assert.notEqual(refused?.causeCode, null);
  assert.notEqual(refused?.causeCode, "ENOENT");
});

test("a provider executable that does not exist (ENOENT) is refused by name before any child exists", POSIX, () => {
  const run = runHost("/nonexistent-b1-11/provider", (dir) => dir);
  assert.equal(run.status, 0, `host stderr:\n${run.stderr}`);
  const refused = run.observed?.refused;
  assert.equal(refused?.name, "ExecutableNotFound");
  assert.match(refused?.message ?? "", /"\/nonexistent-b1-11\/provider" is not runnable/);
  // Refused before the barrier: the reservation is still the caller's to settle.
  assert.equal(run.observed?.reservation, "held");
});

test("a gated spawn into an existing working directory still runs the provider normally", POSIX, () => {
  const run = runHost("/bin/cat", (dir) => dir);
  assert.equal(run.status, 0, `host stderr:\n${run.stderr}`);
  assert.deepEqual(run.observed, { exit: { code: 0, signal: null }, stdout: "hello" });
});
