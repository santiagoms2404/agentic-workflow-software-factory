// B4-38: every production caller built a new AttemptLock per write, and each
// instance had its own empty in-process queue, so two writers of one attempt in
// one process failed with EEXIST instead of queueing.
//
// B4-30: withLock's teardown could replace the callback's own failure. Its
// unlink ran in the same finally as the callback, so a lock file that had
// already gone turned the real error into ENOENT.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttemptLock } from "../../../src/persistence/attempt-lock.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "awsf-lock-b4-30-38-"));
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("two lock instances for one attempt in one process queue rather than failing with EEXIST (B4-38)", async () => {
  const dir = tempDir();
  try {
    const lockPath = join(dir, "attempt.lock");
    const first = new AttemptLock(lockPath);
    const second = new AttemptLock(lockPath);
    const trace: string[] = [];
    await Promise.all([
      first.withLock(async () => {
        trace.push("first:in");
        await delay(20);
        trace.push("first:out");
      }),
      second.withLock(async () => {
        trace.push("second:in");
        await delay(5);
        trace.push("second:out");
      }),
    ]);
    assert.deepEqual(trace, ["first:in", "first:out", "second:in", "second:out"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a callback's own failure survives the lock file having already gone (B4-30)", async () => {
  const dir = tempDir();
  try {
    const lockPath = join(dir, "attempt.lock");
    const lock = new AttemptLock(lockPath);
    await assert.rejects(
      lock.withLock(async () => {
        await unlink(lockPath);
        throw new Error("primary failure");
      }),
      /primary failure/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
