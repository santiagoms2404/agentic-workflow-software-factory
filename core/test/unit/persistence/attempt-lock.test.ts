import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttemptLock, SealedAttempt, runWriteProtocol } from "../../../src/persistence/attempt-lock.ts";
import { Journal } from "../../../src/persistence/journal.ts";
import { tryReadStatus } from "../../../src/persistence/status-store.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "awsf-lock-"));
}

test("withLock serializes concurrent callers in the same process", async () => {
  const dir = tempDir();
  try {
    const lock = new AttemptLock(join(dir, "attempt.lock"));
    let inside = 0;
    let maxObservedInside = 0;
    const order: number[] = [];

    const tasks = Array.from({ length: 50 }, (_, i) =>
      lock.withLock(async () => {
        inside += 1;
        maxObservedInside = Math.max(maxObservedInside, inside);
        await Promise.resolve();
        await Promise.resolve();
        order.push(i);
        inside -= 1;
      }),
    );
    await Promise.all(tasks);

    assert.equal(maxObservedInside, 1, "no two critical sections ever overlapped");
    assert.equal(order.length, 50);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sealed attempt throws SealedAttempt on the next write, and on ones already queued", async () => {
  const dir = tempDir();
  try {
    const lock = new AttemptLock(join(dir, "attempt.lock"));
    assert.equal(lock.isSealed(), false);

    await lock.withLock(async () => {
      lock.seal("LANDED");
    });

    assert.equal(lock.isSealed(), true);
    await assert.rejects(() => lock.withLock(async () => {}), SealedAttempt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sealing mid-queue rejects everything still waiting behind it", async () => {
  const dir = tempDir();
  try {
    const lock = new AttemptLock(join(dir, "attempt.lock"));
    const first = lock.withLock(async () => {
      lock.seal("BLOCKED");
    });
    const second = lock.withLock(async () => "should not run");

    await first;
    await assert.rejects(second, SealedAttempt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface FakeStatus {
  state: string;
  revision: number;
}

test("runWriteProtocol: lock -> validate -> append+fsync -> atomic status -> project -> unlock", async () => {
  const dir = tempDir();
  try {
    const lock = new AttemptLock(join(dir, "attempt.lock"));
    const journal = new Journal<{ kind: string }>(join(dir, "journal.jsonl"));
    const statusPath = join(dir, "status.json");
    const projected: unknown[] = [];

    const result = await runWriteProtocol<{ kind: string }, FakeStatus>({
      lock,
      journal,
      statusPath,
      readCurrentStatus: () => tryReadStatus<FakeStatus>(statusPath),
      validate: (current) => {
        const revision = (current?.revision ?? 0) + 1;
        return { event: { kind: "run.started" }, nextStatus: { state: "RUNNING", revision } };
      },
      project: (record, status) => {
        projected.push({ record, status });
      },
    });

    assert.deepEqual(result, { state: "RUNNING", revision: 1 });
    const onDisk = await tryReadStatus<FakeStatus>(statusPath);
    assert.deepEqual(onDisk, { state: "RUNNING", revision: 1 });
    assert.equal(projected.length, 1);
    await journal.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runWriteProtocol rejects a write once validate reports the attempt sealed", async () => {
  const dir = tempDir();
  try {
    const lock = new AttemptLock(join(dir, "attempt.lock"));
    const journal = new Journal<{ kind: string }>(join(dir, "journal.jsonl"));
    const statusPath = join(dir, "status.json");

    await runWriteProtocol<{ kind: string }, FakeStatus>({
      lock,
      journal,
      statusPath,
      readCurrentStatus: () => tryReadStatus<FakeStatus>(statusPath),
      validate: () => ({ event: { kind: "run.completed" }, nextStatus: { state: "LANDED", revision: 1 } }),
      sealWhenTerminal: (status) => (status.state === "LANDED" ? status.state : null),
    });

    assert.equal(lock.isSealed(), true);
    await assert.rejects(
      () =>
        runWriteProtocol<{ kind: string }, FakeStatus>({
          lock,
          journal,
          statusPath,
          readCurrentStatus: () => tryReadStatus<FakeStatus>(statusPath),
          validate: () => ({ event: { kind: "run.started" }, nextStatus: { state: "RUNNING", revision: 2 } }),
        }),
      SealedAttempt,
    );
    await journal.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
