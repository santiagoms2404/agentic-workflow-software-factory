import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttemptLock,
  LockHolderChanged,
  readLockHolder,
  reclaimLock,
  type LockHolder,
} from "../../../src/persistence/attempt-lock.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "awsf-b4-17-"));
}

test("reclaimLock can reclaim an unnamed 0-byte lock file left behind by a crash", async () => {
  const dir = tempDir();
  try {
    const lockPath = join(dir, "attempt.lock");
    writeFileSync(lockPath, "");

    // Reclaiming with expected = null should remove the 0-byte lock file
    await reclaimLock(lockPath, null);

    // After reclaim, readLockHolder should return null and withLock should succeed
    const holder = await readLockHolder(lockPath);
    assert.equal(holder, null);

    const lock = new AttemptLock(lockPath);
    const result = await lock.withLock(async () => "acquired");
    assert.equal(result, "acquired");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reclaimLock refuses when expected is null but a live holder exists", async () => {
  const dir = tempDir();
  try {
    const lockPath = join(dir, "attempt.lock");
    const liveHolder: LockHolder = { pid: process.pid, acquiredAt: new Date().toISOString() };
    writeFileSync(lockPath, JSON.stringify(liveHolder));

    await assert.rejects(
      () => reclaimLock(lockPath, null),
      (err: unknown) => {
        assert.ok(err instanceof LockHolderChanged);
        assert.match((err as Error).message, /it was held by an unnamed holder/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reclaimLock refuses when expected is null but lock file does not exist", async () => {
  const dir = tempDir();
  try {
    const lockPath = join(dir, "attempt.lock");

    await assert.rejects(
      () => reclaimLock(lockPath, null),
      (err: unknown) => {
        assert.ok(err instanceof LockHolderChanged);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withLock writes lock holder atomically and releases on exit", async () => {
  const dir = tempDir();
  try {
    const lockPath = join(dir, "attempt.lock");
    const lock = new AttemptLock(lockPath);

    let observedHolder: LockHolder | null = null;
    await lock.withLock(async () => {
      observedHolder = await readLockHolder(lockPath);
    });

    assert.notEqual(observedHolder, null);
    assert.equal(observedHolder!.pid, process.pid);
    assert.equal(await readLockHolder(lockPath), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
