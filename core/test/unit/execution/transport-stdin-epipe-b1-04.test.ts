// A provider that leaves before it has read its prompt is an early exit, not a
// host crash.
//
// The broker writes the prompt to the released provider's stdin. When the
// provider exits without draining it — a bad flag, missing credentials, a
// startup crash — every byte still pending past the pipe buffer fails with
// EPIPE, and Node emits that as an `error` on the stdin socket. An `error` event
// nobody listens for is thrown, and nothing in core/src catches it at the
// process level: the HOST dies, after `startProcess` resolved and before the
// run's outcome was journaled.
//
// The host therefore has to be a separate process here. A crash inside this
// test process would be reported by the runner as a stray uncaught exception,
// not as the failed assertion it is; a child host lets the test assert on the
// one thing that matters — the host survived and saw the provider's own exit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BROKER = fileURLToPath(new URL("../../../src/execution/transport-broker.ts", import.meta.url));
const BUDGET = fileURLToPath(new URL("../../../src/execution/call-budget.ts", import.meta.url));

const KIB = 1024;
const MIB = 1024 * KIB;

/**
 * One launch through the real broker: a real gated launcher, a real exec, a
 * real provider. It prints what the host observed as a single JSON line, after
 * a pause long enough for any late stdin error to have been raised.
 */
const HOST_SOURCE = `
import { ProcessTransportBroker } from ${JSON.stringify(BROKER)};
import { CallBudget } from ${JSON.stringify(BUDGET)};

const [executable, bytes, cwd] = process.argv.slice(2);
const budget = new CallBudget({ taskId: "T99", tier: 2 });
const reservation = budget.reserve({ cost: 1, edge: "L4" });
const broker = new ProcessTransportBroker({ register: async () => {}, ledger: budget });
const transport = await broker.startProcess(
  {
    runId: "awsf-epipe-" + process.pid,
    sessionId: "epipe-session",
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
    stdin: "p".repeat(Number(bytes)),
    shell: false,
  },
  new AbortController().signal,
);
let stdoutBytes = 0;
const drained = (async () => {
  for await (const chunk of transport.stdout) stdoutBytes += chunk.length;
})();
const exit = await transport.exit;
await drained;
await new Promise((resolve) => setTimeout(resolve, 250));
process.stdout.write(JSON.stringify({ exit, stdoutBytes }) + "\\n");
`;

interface HostRun {
  status: number | null;
  stderr: string;
  observed: { exit: { code: number | null; signal: string | null }; stdoutBytes: number } | null;
}

function runHost(executable: string, bytes: number): HostRun {
  const dir = mkdtempSync(join(tmpdir(), "awsf-stdin-epipe-"));
  try {
    const host = join(dir, "host.mjs");
    writeFileSync(host, HOST_SOURCE);
    const result = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", host, executable, String(bytes), dir],
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

test("B1-04: a 1 MiB prompt to a provider that never reads stdin resolves as an early exit, not a host crash", POSIX, () => {
  const run = runHost("/bin/true", MIB);
  assert.equal(run.status, 0, `the host must survive the provider's early exit; host stderr:\n${run.stderr}`);
  assert.doesNotMatch(run.stderr, /EPIPE/);
  assert.deepEqual(run.observed, { exit: { code: 0, signal: null }, stdoutBytes: 0 });
});

test("B1-05: a provider that fails at startup under a 4 MiB prompt surfaces its own exit code to the host", POSIX, () => {
  // The failing-startup shape: the provider exits non-zero without reading a
  // byte. The host has to see THAT code, because it is what the run's outcome
  // and billing decision are journaled from.
  const run = runHost("/bin/false", 4 * MIB);
  assert.equal(run.status, 0, `the host must survive the provider's early exit; host stderr:\n${run.stderr}`);
  assert.doesNotMatch(run.stderr, /EPIPE/);
  assert.deepEqual(run.observed, { exit: { code: 1, signal: null }, stdoutBytes: 0 });
});

test("a provider that reads its whole 1 MiB prompt still resolves normally, with every byte of its output", POSIX, () => {
  const run = runHost("/bin/cat", MIB);
  assert.equal(run.status, 0, `host stderr:\n${run.stderr}`);
  assert.deepEqual(run.observed, { exit: { code: 0, signal: null }, stdoutBytes: MIB });
});

test("a prompt that fits the pipe buffer was never the problem, and still is not", POSIX, () => {
  // 1 KiB is absorbed by the pipe before the provider exits, so no write is
  // left pending to fail: the same early exit, through the same path.
  const run = runHost("/bin/false", KIB);
  assert.equal(run.status, 0, `host stderr:\n${run.stderr}`);
  assert.deepEqual(run.observed, { exit: { code: 1, signal: null }, stdoutBytes: 0 });
});
