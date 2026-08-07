// The kill-host proof.
//
// This is the test the whole plan is ordered around. A real host, a real
// detached launcher, a real provider executable, and an uncatchable SIGKILL
// injected at every boundary between the launch and the release. At each one:
//
//     no provider process exists, and the stub's side-effect file
//     was never created.
//
// The last boundary is the control. Killing the host AFTER the release token
// must leave the side-effect file behind — otherwise "the file is absent" would
// be a claim this suite could satisfy by never launching anything at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BARRIER_STEPS, type BarrierStep } from "../../src/execution/launcher-barrier.ts";
import { journalFilePath } from "../../src/persistence/platform-paths.ts";
import { scanJournal } from "../../src/persistence/replay.ts";
import type { BarrierRecord } from "../../src/execution/launcher-barrier.ts";
import type { HostRequest } from "./_barrier-host.ts";
import { PROVIDER_PATH, processesMentioning, sideEffectPathFor, within } from "./_barrier-fixtures.ts";

const HOST = join(import.meta.dirname, "_barrier-host.ts");

/** Boundaries at which the release token has NOT been written. */
const BEFORE_RELEASE: BarrierStep[] = ["launched", "identified", "registered", "spent"];

let runCounter = 0;

interface Run {
  dir: string;
  runId: string;
  sideEffect: string;
  signal: string | null;
  status: number | null;
  stderr: string;
  steps: string[];
}

function runHost(overrides: Partial<HostRequest> & { script?: HostRequest["script"] } = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), "awsf-barrier-"));
  // Unique per run and greppable: it is in the launcher's argv and, through the
  // side-effect path, in the provider's.
  const runId = `awsfrun-${process.pid}-${++runCounter}`;
  const request: HostRequest = {
    dir,
    runId,
    script: "success",
    killStep: null,
    registerFails: false,
    mode: "barrier",
    ...overrides,
  };
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", HOST, JSON.stringify(request)],
    { encoding: "utf8" },
  );
  const stepsPath = join(dir, "steps.log");
  return {
    dir,
    runId,
    sideEffect: sideEffectPathFor(dir, runId),
    signal: result.signal,
    status: result.status,
    stderr: result.stderr,
    steps: existsSync(stepsPath) ? readFileSync(stepsPath, "utf8").split("\n").filter(Boolean) : [],
  };
}

function outcomeOf(run: Run): Record<string, unknown> {
  const path = join(run.dir, "outcome.json");
  assert.ok(existsSync(path), `the host wrote no outcome: ${run.stderr}`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

async function cleanup(run: Run): Promise<void> {
  for (const pid of processesMentioning(run.runId)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is the outcome the assertions wanted anyway.
    }
  }
  rmSync(run.dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// The matrix.
// ---------------------------------------------------------------------------

for (const step of BEFORE_RELEASE) {
  test(`SIGKILL after "${step}" leaves no provider process and no side effect`, async () => {
    const run = runHost({ killStep: step });
    try {
      assert.equal(run.signal, "SIGKILL", `the injected kill never fired at ${step}: ${run.stderr}`);
      // The kill really did land where it was aimed, so a child really did
      // exist to be orphaned.
      assert.deepEqual(run.steps, BARRIER_STEPS.slice(0, BARRIER_STEPS.indexOf(step) + 1));

      // The gated child loses its control channel when the host's descriptors
      // close, and exits without exec'ing. Give it a generous window, then
      // assert on reality.
      const gone = await within(10_000, () => processesMentioning(run.runId).length === 0);
      assert.equal(
        gone,
        true,
        `processes from this run survived the host: ${processesMentioning(run.runId).join(", ")}`,
      );

      // The proof. The provider's very first act is to write this file.
      assert.equal(existsSync(run.sideEffect), false, "the provider command ran");

      // And once more after a settling window, so a provider that started
      // slowly cannot slip past the check above.
      await within(500, () => false);
      assert.equal(existsSync(run.sideEffect), false, "the provider command ran, late");
      assert.deepEqual(processesMentioning(run.runId), []);
    } finally {
      await cleanup(run);
    }
  });
}

test("a host killed AFTER the release leaves the provider's side effect behind — the control", async () => {
  const run = runHost({ killStep: "released" });
  try {
    assert.equal(run.signal, "SIGKILL");
    assert.deepEqual(run.steps, [...BARRIER_STEPS]);

    const ran = await within(10_000, () => existsSync(run.sideEffect));
    assert.equal(ran, true, "past the barrier the provider must actually run");

    // Which also proves the assertion in the matrix above is capable of failing.
    const proof = JSON.parse(readFileSync(run.sideEffect, "utf8")) as { script: string; pid: number };
    assert.equal(proof.script, "success");

    await within(5_000, () => processesMentioning(run.runId).length === 0);
  } finally {
    await cleanup(run);
  }
});

// ---------------------------------------------------------------------------
// Registration failure: kill the tree, return the call.
// ---------------------------------------------------------------------------

test("a registration failure kills the tree, returns the reservation, and the provider never ran", async () => {
  const run = runHost({ registerFails: true });
  try {
    assert.equal(run.signal, null, `the host must survive to report: ${run.stderr}`);
    const outcome = outcomeOf(run);

    assert.equal(outcome["kind"], "failed", JSON.stringify(outcome));
    assert.equal(outcome["step"], "identified");
    assert.match(String(outcome["message"]), /simulated durability failure/);

    // The tree went, and the report is enumerated truth rather than a shrug.
    const cancellation = outcome["cancellation"] as { terminated: boolean; survivors: number[]; skipped: string | null };
    assert.equal(cancellation.terminated, true);
    assert.deepEqual(cancellation.survivors, []);

    // A provider that never ran never costs a call.
    assert.equal(outcome["callsSpent"], 0);
    assert.equal(outcome["callsReserved"], 0);
    assert.equal(outcome["committed"], 0);
    assert.equal((outcome["reservation"] as { state: string }).state, "released");

    assert.equal(existsSync(run.sideEffect), false, "the provider command ran");
    assert.deepEqual(processesMentioning(run.runId), []);

    // Nothing durable was written either: the registration is what failed.
    assert.equal(existsSync(join(run.dir, "status.json")), false);
  } finally {
    await cleanup(run);
  }
});

// ---------------------------------------------------------------------------
// The released path, end to end.
// ---------------------------------------------------------------------------

test("a released launch keeps its PID and its start identity across the exec", async () => {
  const run = runHost();
  try {
    assert.equal(run.signal, null, run.stderr);
    const outcome = outcomeOf(run);
    assert.equal(outcome["kind"], "released", JSON.stringify(outcome));

    const identity = outcome["identity"] as { pid: number; pgid: number; startIdentity: string };
    const proof = JSON.parse(readFileSync(run.sideEffect, "utf8")) as {
      pid: number;
      pgid: number;
      startTime: string;
    };

    // `execve` replaces the image, not the task. Both halves matter: the PID is
    // what the host will signal, and the start time is what stops it signalling
    // a stranger that inherited the number.
    assert.equal(proof.pid, identity.pid, "the provider runs under the registered PID");
    assert.equal(proof.pgid, identity.pgid, "and in the registered process group");
    assert.ok(
      identity.startIdentity.endsWith(`:${identity.pid}:${proof.startTime}`),
      `the registered start identity ${identity.startIdentity} must describe the provider`,
    );

    assert.deepEqual(outcome["events"], ["run.started", "model.resolved", "text.delta", "run.completed"]);
    assert.deepEqual(outcome["exit"], { code: 0, signal: null });

    // The handshake read fd3 and must have left the provider's own streams
    // alone: a `data` listener left on stderr would have consumed this before
    // the stream layer ever saw it.
    assert.equal(outcome["stderr"], "stub-provider: success\n");
    assert.equal(outcome["callsSpent"], 1);
    assert.equal((outcome["reservation"] as { state: string }).state, "spent");
  } finally {
    await cleanup(run);
  }
});

test("the durable record names the process before the process exists", async () => {
  const run = runHost();
  try {
    const scan = await scanJournal<BarrierRecord>(journalFilePath(run.dir));
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    assert.equal(scan.records.length, 1);

    const record = scan.records[0]?.event;
    assert.equal(record?.runId, run.runId);
    assert.equal(record?.edge, "L4");
    // `process_start_identity` on the record, so a later cancellation can prove
    // the PID it is about to signal is still the one it registered.
    assert.match(String(record?.identity.startIdentity), /^[0-9a-f-]{36}:\d+:\d+$/);
    assert.equal(record?.identity.startIdentitySource, "linux-proc-stat");
    assert.deepEqual(record?.command, [PROVIDER_PATH, "success", run.sideEffect]);

    const status = JSON.parse(readFileSync(join(run.dir, "status.json"), "utf8")) as {
      status: string;
      process_start_identity: string;
    };
    assert.equal(status.status, "REGISTERED");
    assert.equal(status.process_start_identity, record?.identity.startIdentity);
  } finally {
    await cleanup(run);
  }
});

test("the prompt reaches the provider on stdin, and appears in no argv on the machine", async () => {
  const run = runHost();
  try {
    const proof = JSON.parse(readFileSync(run.sideEffect, "utf8")) as { argv: string[] };
    assert.deepEqual(proof.argv, ["success", run.sideEffect]);

    const outcome = outcomeOf(run);
    assert.equal(outcome["kind"], "released");
    // `text.delta` carries `prompt:<bytes>` — the provider counted what arrived
    // on fd0, which is the only place the prompt was ever put.
    const scan = await scanJournal<BarrierRecord>(journalFilePath(run.dir));
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    assert.ok(!JSON.stringify(scan.records[0]?.event.command).includes("the prompt rides stdin"));
  } finally {
    await cleanup(run);
  }
});

// ---------------------------------------------------------------------------
// A grandchild the host never saw is still in the group it will kill.
// ---------------------------------------------------------------------------

test("a provider's own child joins the registered process group", async () => {
  const run = runHost({ script: "grandchild-spawner", mode: "grandchild" });
  try {
    assert.equal(run.signal, null, run.stderr);
    const outcome = outcomeOf(run);
    assert.equal(outcome["kind"], "grandchild", JSON.stringify(outcome));

    const identity = outcome["identity"] as { pid: number; pgid: number };
    const members = outcome["membersBeforeCancel"] as number[];
    assert.ok(members.includes(identity.pid), "the provider is in its own group");
    assert.ok(
      members.length >= 2,
      `a grandchild the host never spawned must still be in the group: ${members.join(", ")}`,
    );

    // Cancellation is T11's contract; what matters here is that the group is
    // the thing that has to be killed, and that it enumerates truthfully.
    const cancellation = outcome["cancellation"] as { terminated: boolean; survivors: number[] };
    assert.equal(cancellation.terminated, true);
    assert.deepEqual(cancellation.survivors, []);
  } finally {
    await cleanup(run);
  }
});
