// B1-17: runSystemCommand's timeout bounds the whole command, not only its
// direct child.
//
// spawnSync's `timeout` signals the one process it started. A configured gate,
// a git push or a census whose child started its own children (ssh, a
// credential helper, a test runner's workers) used to return ETIMEDOUT with
// those descendants still running, unregistered, in the worktree the next gate
// runs in. Tests may spawn; the descendants here are `sleep`s that print their
// own pid so the test can look for them afterwards.

import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runSystemCommand } from "../../../src/execution/transport-broker.ts";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls briefly, so a descendant that is merely being reaped is not reported as a survivor. */
async function survivors(pids: readonly number[]): Promise<number[]> {
  for (let poll = 0; poll < 20; poll += 1) {
    if (!pids.some(alive)) return [];
    await delay(50);
  }
  return pids.filter(alive);
}

function pidsIn(stdout: string): number[] {
  return stdout.split("\n").map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0);
}

function cleanUp(pids: readonly number[]): void {
  for (const pid of pids) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

test("a timed-out command takes its background descendant down with it", async () => {
  const result = runSystemCommand("sh", ["-c", "sleep 30 & echo $!; sleep 30"], 400);
  const pids = pidsIn(result.stdout);
  try {
    assert.equal(pids.length, 1, `the command reported its descendant before the timeout: ${JSON.stringify(result)}`);
    assert.equal(result.status, null);
    assert.match(result.error ?? "", /ETIMEDOUT/u);
    assert.deepEqual(await survivors(pids), [], "a descendant of the timed-out command outlived the timeout");
  } finally { cleanUp(pids); }
});

test("a grandchild two levels down is ended too", async () => {
  const result = runSystemCommand("sh", ["-c", "sh -c 'sleep 30 & echo $!; wait' & sleep 30"], 400);
  const pids = pidsIn(result.stdout);
  try {
    assert.equal(pids.length, 1, JSON.stringify(result));
    assert.deepEqual(await survivors(pids), [], "a grandchild of the timed-out command outlived the timeout");
  } finally { cleanUp(pids); }
});

test("a command that finishes inside its bound is reported as it ran", () => {
  const result = runSystemCommand("sh", ["-c", "echo out; echo err >&2; exit 3"], { timeoutMs: 5_000 });
  assert.deepEqual(result, { status: 3, stdout: "out\n", stderr: "err\n", error: null });
});

test("a command that cannot be run at all says so instead of timing out", () => {
  const result = runSystemCommand("/nonexistent/awsf-b1-17", [], 1_000);
  assert.equal(result.status, null);
  assert.match(result.error ?? "", /ENOENT/u);
});
