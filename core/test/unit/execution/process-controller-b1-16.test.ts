// B1-16: the module-level conveniences see the machine on every platform.
//
// `groupMembers`, `observeIdentity` and `terminateGroup` build a host
// controller for a caller that holds an identity and nothing else. They built
// it with no census command runner, and the darwin and win32 ports cannot
// enumerate without one, so on those platforms every call threw
// EnumerationUnavailable. candidate-seed.ts reads that throw as "unknown" and
// refuses the seed, so every candidate seed off Linux was refused even with the
// processes long gone.
//
// The darwin port's census is `/bin/ps -A -o pid=,ppid=,pgid=,stat=,time=,lstart=`,
// which this Linux host's procps answers in the same shape, so the platform is
// overridden to darwin and the darwin port is driven for real. Tests may spawn.

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { ProcessIdentity } from "../../../src/execution/launcher-barrier.ts";
import { groupMembers, observeIdentity, terminateGroup } from "../../../src/execution/process-controller.ts";

const REAL_PLATFORM = Object.getOwnPropertyDescriptor(process, "platform")!;

/** Runs `body` while `process.platform` reads `darwin`, restoring it whatever happens. */
async function asDarwin<T>(body: () => T | Promise<T>): Promise<T> {
  Object.defineProperty(process, "platform", { ...REAL_PLATFORM, value: "darwin" });
  try {
    return await body();
  } finally {
    Object.defineProperty(process, "platform", REAL_PLATFORM);
  }
}

function attempt<T>(body: () => T): T | Error {
  try {
    return body();
  } catch (error) {
    return error as Error;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("groupMembers enumerates a darwin process group instead of throwing for want of a runner", async () => {
  const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  try {
    const pid = child.pid!;
    const identity: ProcessIdentity = { pid, pgid: pid, startIdentity: null, startIdentitySource: "test" };
    const members = await asDarwin(() => attempt(() => groupMembers(identity)));
    assert.deepEqual(members, [pid], `the darwin convenience could not see the group: ${String(members)}`);
  } finally {
    child.kill("SIGKILL");
  }
});

test("observeIdentity reads a darwin start identity for a live pid", async () => {
  const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  try {
    const pid = child.pid!;
    const observed = await asDarwin(() => attempt(() => observeIdentity(pid)));
    assert.ok(!(observed instanceof Error), `the darwin convenience threw: ${String(observed)}`);
    assert.equal(observed?.pid, pid);
    assert.equal(observed?.pgid, pid);
    assert.equal(observed?.startIdentitySource, "darwin-ps-lstart");
    assert.notEqual(observed?.startIdentity, null);
  } finally {
    child.kill("SIGKILL");
  }
});

test("terminateGroup ends a darwin group and reports it gone", async () => {
  const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    const pid = child.pid!;
    const report = await asDarwin(async () => {
      const identity = observeIdentity(pid);
      assert.notEqual(identity, null);
      return terminateGroup(identity!, { graceMs: 2_000, settleMs: 50 });
    });
    await Promise.race([exited, delay(2_000)]);
    assert.equal(report.termSent, true);
    assert.equal(alive(pid), false, "the sleeping group survived terminateGroup");
  } finally {
    child.kill("SIGKILL");
  }
});

test("an identity whose group is empty enumerates as empty, not as unknown", async () => {
  const child = spawn("true", [], { detached: true, stdio: "ignore" });
  const pid = child.pid!;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const identity: ProcessIdentity = { pid, pgid: pid, startIdentity: null, startIdentitySource: "test" };
  const members = await asDarwin(() => attempt(() => groupMembers(identity)));
  assert.deepEqual(members, []);
});
