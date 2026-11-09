import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { openDatabase, setSessionArchived } from "../../../src/observability/sqlite.ts";
import { createSession, projectAttemptStatus, projectEvent, type AttemptStatusProjection } from "../../../src/observability/projector.ts";
import { getSession } from "../../../src/observability/queries.ts";

const STATUS: AttemptStatusProjection = {
  sessionId: "s1", projectSlug: "proj", taskId: "T1", continuesTask: null,
  groupId: null, planRef: null, attempt: 1, workflowId: "wf", riskTier: 0,
  isProtected: false, requestText: "contention fixture", callCeiling: 5,
  configSnapshotJson: "{}", journalPath: "journal.jsonl", startedAt: "2026-08-06T00:00:00.000Z",
  lifecycleState: "RUNNING", baseSha: null, candidateSha: null,
  callsSpent: 0, callsReserved: 0, correctionsAuto: 0, correctionsOwner: 0,
  ownerReentries: 0, workerModelResolved: null, updatedAt: "2026-08-06T00:00:01.000Z",
  endedAt: null, stateRevision: 1,
};

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "awsf-b4-16-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "awsf.db");
  const initial = openDatabase(path);
  createSession(initial, STATUS);
  initial.close();
  return { root, path };
}

// A second real connection releases the lock independently of the blocked main
// thread. Handshakes start the hold only when the tested operation is ready;
// a main-thread setTimeout cannot release a DatabaseSync contention lock.
async function holdLock(path: string, exclusive = false, untilReleased = false) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(`
    const { DatabaseSync } = require("node:sqlite");
    const { parentPort, workerData } = require("node:worker_threads");
    const signal = new Int32Array(workerData.signal);
    const db = new DatabaseSync(workerData.path);
    try {
      db.exec(workerData.exclusive ? "BEGIN EXCLUSIVE" : "BEGIN IMMEDIATE");
      parentPort.postMessage("locked");
      while (Atomics.load(signal, 0) === 0) Atomics.wait(signal, 0, 0);
      if (workerData.untilReleased) {
        while (Atomics.load(signal, 0) !== 2) Atomics.wait(signal, 0, 1);
      } else {
        // The start notification must not accidentally wake the timed hold.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
      }
      db.exec("COMMIT");
    } finally { db.close(); }
  `, { eval: true, workerData: { path, exclusive, untilReleased, signal: signal.buffer } });
  const exited = once(worker, "exit");
  // Observe errors immediately, including before the ready message arrives.
  void exited.catch(() => {});
  try {
    assert.deepEqual(await once(worker, "message"), ["locked"]);
  } catch (error) {
    await worker.terminate();
    throw error;
  }
  return {
    start() { Atomics.store(signal, 0, 1); Atomics.notify(signal, 0); },
    async close() {
      Atomics.store(signal, 0, 2);
      Atomics.notify(signal, 0);
      assert.deepEqual(await exited, [0]);
    },
  };
}

test("every initial, reopened writer and readonly connection gets the five-second timeout", (t) => {
  const { path } = fixture(t);
  const fresh = openDatabase(":memory:");
  const writer = openDatabase(path);
  const reader = openDatabase(path, { readonly: true });
  try {
    assert.deepEqual([fresh, writer, reader].map((db) => db.prepare("PRAGMA busy_timeout").get()?.timeout),
      [5000, 5000, 5000]);
    assert.throws(() => setSessionArchived(reader, STATUS.sessionId), /readonly/);
  } finally { reader.close(); writer.close(); fresh.close(); }
});

test("archive on a reopened connection waits for another writer and persists", async (t) => {
  const { path } = fixture(t);
  const db = openDatabase(path);
  const lock = await holdLock(path);
  try {
    lock.start();
    assert.doesNotThrow(() => assert.equal(setSessionArchived(db, STATUS.sessionId), true),
      "archive must wait for transient writer contention");
    assert.equal(getSession(db, STATUS.sessionId)?.archived, 1);
  } finally { await lock.close(); db.close(); }
});

test("B4-07 attempt projection waits at session creation without degrading", async (t) => {
  const { path } = fixture(t);
  const db = openDatabase(path);
  const lock = await holdLock(path);
  try {
    lock.start();
    const outcome = projectAttemptStatus(db, { ...STATUS, sessionId: "s2", taskId: "T2" }, 1);
    assert.deepEqual(outcome, { ok: true, applied: true, degraded: false, flagPersisted: false });
    assert.equal(getSession(db, "s2")?.last_projected_seq, 1);
    assert.equal(getSession(db, "s2")?.observability_degraded, 0);
  } finally { await lock.close(); db.close(); }
});

test("B4-07 event projection waits at BEGIN IMMEDIATE without degrading", async (t) => {
  const { path } = fixture(t);
  const db = openDatabase(path);
  const lock = await holdLock(path);
  try {
    lock.start();
    const outcome = projectEvent(db, { sessionId: STATUS.sessionId, runId: "run1", phaseId: null }, {
      source_seq: 1, recorded_at: STATUS.updatedAt,
      event: { kind: "text.delta", text: "projected", seq: 1, runId: "run1", hostAt: STATUS.updatedAt, providerAt: null },
    });
    assert.deepEqual(outcome, { ok: true, applied: true, degraded: false, flagPersisted: false });
    assert.equal(getSession(db, STATUS.sessionId)?.last_projected_seq, 1);
    assert.equal(getSession(db, STATUS.sessionId)?.observability_degraded, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get()?.n, 1);
  } finally { await lock.close(); db.close(); }
});

test("readonly queries wait for an exclusive rollback-journal lock", async (t) => {
  const { path } = fixture(t);
  const setup = openDatabase(path);
  setup.exec("PRAGMA journal_mode = DELETE");
  setup.close();
  const reader = openDatabase(path, { readonly: true });
  const lock = await holdLock(path, true);
  try {
    lock.start();
    assert.doesNotThrow(() => assert.equal(getSession(reader, STATUS.sessionId)?.task_id, "T1"),
      "readonly queries must wait for transient exclusive contention");
  } finally { await lock.close(); reader.close(); }
});

test("the timeout is installed before pending migrations acquire their write lock", async (t) => {
  const { root, path } = fixture(t);
  const migrationsDir = join(root, "migrations");
  mkdirSync(migrationsDir);
  writeFileSync(join(migrationsDir, "0010-contention.sql"),
    "CREATE TABLE contention_fixture (id INTEGER PRIMARY KEY); PRAGMA user_version = 10;\n");
  const lock = await holdLock(path);
  try {
    lock.start();
    assert.doesNotThrow(() => {
      const db = openDatabase(path, { migrationsDir });
      try {
        assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 10);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM contention_fixture").get()?.n, 0);
      } finally { db.close(); }
    }, "pending migration must wait before BEGIN IMMEDIATE");
  } finally { await lock.close(); }
});

test("contention exceeding the timeout still fails without an archive write", async (t) => {
  const { path } = fixture(t);
  const db = openDatabase(path);
  const lock = await holdLock(path, false, true);
  try {
    lock.start();
    const start = performance.now();
    assert.throws(() => setSessionArchived(db, STATUS.sessionId), /database is locked/);
    const elapsed = performance.now() - start;
    assert.ok(elapsed >= 4500, `expected the five-second wait, got ${elapsed} ms`);
    assert.equal(getSession(db, STATUS.sessionId)?.archived, 0);
  } finally { await lock.close(); db.close(); }
});
