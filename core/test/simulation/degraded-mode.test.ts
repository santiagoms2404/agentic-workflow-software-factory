// Corrupt the database while a task is running.
//
// Two things must both be true afterwards, and they pull in opposite
// directions: the task keeps going (no provider is ever killed for a
// dashboard's sake), and it cannot finish invisibly (no advance past
// `GATING` while the display is lying). This suite holds both ends down.
//
// The corruption is real, not simulated: the WAL is checkpointed back into
// the main file, the file's first page is overwritten with garbage, and the
// live connection's page cache is dropped so the very next projection reads
// the damage off the disk. No exception is faked anywhere in this file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { openSync, writeSync, closeSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Journal } from "../../src/persistence/journal.ts";
import { AttemptLock, runWriteProtocol } from "../../src/persistence/attempt-lock.ts";
import { tryReadStatus } from "../../src/persistence/status-store.ts";
import { journalFilePath, statusFilePath } from "../../src/persistence/platform-paths.ts";
import { scanJournal } from "../../src/persistence/replay.ts";
import { openDatabase, closeDatabase, type DatabaseSync } from "../../src/observability/sqlite.ts";
import {
  createSession,
  projectEvent,
  projectionNotice,
  type ProjectionOutcome,
} from "../../src/observability/projector.ts";
import { getSession, pollEvents } from "../../src/observability/queries.ts";
import {
  DegradedObservabilityHold,
  assertAdvancementPermitted,
  discoverAttempts,
  observabilityDegraded,
  rebuildDatabase,
} from "../../src/observability/rebuild.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { TaskState } from "../../src/state/task-machine.ts";
import {
  applyEvent,
  deriveFor,
  initialStatus,
  makeStateRoot,
  sessionIdFor,
  sessionInitFor,
  simAttemptDir,
  simEvent,
  runIdFor,
  type SimStatus,
} from "./_harness.ts";

/**
 * Real corruption of a real file, in a way a live connection cannot miss:
 * checkpoint so the main file is authoritative, overwrite its header, then
 * drop the page cache so the next statement has to go back to the disk.
 */
function corruptDatabaseFile(db: DatabaseSync, path: string): void {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const fd = openSync(path, "r+");
  try {
    writeSync(fd, Buffer.alloc(4096, 0x41), 0, 4096, 0);
  } finally {
    closeSync(fd);
  }
  db.exec("PRAGMA shrink_memory");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface DegradedRun {
  root: string;
  dir: string;
  dbPath: string;
  sessionId: string;
  status: SimStatus | null;
  outcomes: ProjectionOutcome[];
  notices: NormalizedEvent[];
  /** What the host's own live connection said about the session's health, before it let go of it. */
  degradedOnLiveHandle: boolean;
}

/**
 * Drives the write protocol directly rather than through the harness, so the
 * corruption can land BETWEEN two writes and the projection outcome of the
 * write after it is observable. The caller's own degraded-mode wiring — a
 * failed projection becomes a journaled `notice` — is exercised here as the
 * host would do it.
 */
async function runWithCorruptionAfter(writeToCorruptAfter: number, totalWrites: number): Promise<DegradedRun> {
  const root = await makeStateRoot("awsf-degraded-");
  const dir = simAttemptDir(root);
  const dbPath = join(root, "awsf.db");
  const sessionId = sessionIdFor(dir);
  const statusPath = statusFilePath(dir);
  const lock = new AttemptLock(join(dir, "attempt.lock"));
  const journal = new Journal<NormalizedEvent>(journalFilePath(dir));
  const outcomes: ProjectionOutcome[] = [];
  const notices: NormalizedEvent[] = [];

  const db = openDatabase(dbPath);
  createSession(db, sessionInitFor(dir));

  let status: SimStatus | null = null;
  let sourceSeq = 0;
  let degradedOnLiveHandle = false;

  const write = async (event: NormalizedEvent, mayEmitNotice: boolean): Promise<void> => {
    sourceSeq += 1;
    const at = sourceSeq;
    let outcome: ProjectionOutcome | undefined;
    status = await runWriteProtocol<NormalizedEvent, SimStatus>({
      lock,
      journal,
      statusPath,
      readCurrentStatus: () => tryReadStatus<SimStatus>(statusPath),
      validate: (current) => ({ event, nextStatus: applyEvent(current ?? initialStatus(dir), event, at) }),
      project: (record) => {
        outcome = projectEvent(db, { sessionId, runId: record.event.runId, phaseId: null }, record);
        outcomes.push(outcome);
      },
    });

    // The projection failed; the journal has not. The notice goes through the
    // write protocol like any other event, so the failure is durable even
    // when the database is too broken to record its own illness — and the
    // notice's own failed projection does not start a cascade.
    const settled: ProjectionOutcome | undefined = outcome;
    if (mayEmitNotice && settled !== undefined && !settled.ok) {
      const notice = projectionNotice(settled, {
        seq: at,
        runId: runIdFor(dir),
        hostAt: `2026-08-06T00:00:${String(at).padStart(2, "0")}.500Z`,
      });
      if (notice !== null) {
        notices.push(notice);
        await write(notice, false);
      }
    }
  };

  try {
    for (let n = 1; n <= totalWrites; n += 1) {
      await write(simEvent(runIdFor(dir), n, n === totalWrites ? "completed" : null), true);
      if (n === writeToCorruptAfter) corruptDatabaseFile(db, dbPath);
    }
  } finally {
    await journal.close();
    degradedOnLiveHandle = observabilityDegraded(db, sessionId);
    try {
      closeDatabase(db);
    } catch {
      // A database this broken may refuse to close cleanly. It is being
      // replaced, and nothing here deletes it.
    }
  }

  return { root, dir, dbPath, sessionId, status, outcomes, notices, degradedOnLiveHandle };
}

async function withRun(
  body: (run: DegradedRun) => Promise<void>,
  corruptAfter = 2,
  writes = 4,
): Promise<void> {
  const run = await runWithCorruptionAfter(corruptAfter, writes);
  try {
    await body(run);
  } finally {
    rmSync(run.root, { recursive: true, force: true });
  }
}

test("the task keeps running when the database is corrupted mid-run", async () => {
  await withRun(async (run) => {
    // The run reached its last write and its status advanced, with the
    // journal complete — a projection failure never reached the caller's
    // phase as an exception.
    assert.equal(run.status?.lifecycle_state, "GATING");

    const scan = await scanJournal<NormalizedEvent>(journalFilePath(run.dir));
    assert.equal(scan.ok, true, "the journal is intact and contiguous");
    if (!scan.ok) return;
    // Four run records plus one notice per failed projection.
    assert.equal(scan.records.length, 4 + run.notices.length);
    assert.equal(run.status?.last_source_seq, scan.records.length, "the status kept up with the journal");
  });
});

test("the failure is reported as a sqlite-projection-failed notice and journaled", async () => {
  await withRun(async (run) => {
    const failures = run.outcomes.filter((o) => !o.ok);
    assert.ok(failures.length > 0, "the corruption must actually have broken a projection");
    for (const failure of failures) {
      assert.equal(failure.notice?.code, "sqlite-projection-failed");
      assert.equal(failure.degraded, true, "a session whose projection failed is degraded");
      assert.equal(
        failure.flagPersisted,
        false,
        "a database this broken cannot even record its own illness — which is why the journal must",
      );
    }

    // Two run events were projected against the corrupt file; each produced
    // one notice. The notices' own projections fail too, and deliberately do
    // not produce notices of their own — a cascade would bury the first one.
    assert.equal(run.notices.length, 2);
    const scan = await scanJournal<NormalizedEvent>(journalFilePath(run.dir));
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    const journaled = scan.records.filter((r) => r.event.kind === "notice");
    assert.equal(journaled.length, run.notices.length);
    for (const record of journaled) {
      assert.equal(record.event.kind === "notice" && record.event.code, "sqlite-projection-failed");
    }
  });
});

test("the session reads as degraded, and the corrupt file cannot simply be reopened", async () => {
  await withRun(async (run) => {
    assert.equal(run.degradedOnLiveHandle, true, "the host's own connection reports the session degraded");

    // An unreadable projection is a degraded one, and there is no way back
    // to a healthy database except a rebuild: the file will not even open.
    assert.throws(() => openDatabase(run.dbPath), /file is not a database/);
  });
});

test("a degraded session may not advance past GATING, but may correct, block, or cancel", async () => {
  const refused: TaskState[] = ["REVIEWING", "AWAITING_OWNER", "LANDING", "LANDED"];
  const permitted: TaskState[] = ["RUNNING", "GATING", "BLOCKED", "CANCELLED"];

  for (const to of refused) {
    assert.throws(
      () => assertAdvancementPermitted({ sessionId: "s1", to, degraded: true }),
      DegradedObservabilityHold,
      `${to} must be held while degraded`,
    );
  }
  for (const to of permitted) {
    assert.doesNotThrow(
      () => assertAdvancementPermitted({ sessionId: "s1", to, degraded: true }),
      `${to} must stay available while degraded`,
    );
  }
  // A healthy session is held nowhere.
  for (const to of [...refused, ...permitted]) {
    assert.doesNotThrow(() => assertAdvancementPermitted({ sessionId: "s1", to, degraded: false }));
  }
});

test("the hold names the session, the refused state, and the one command that lifts it", () => {
  const error = new DegradedObservabilityHold("proj:T99:1", "AWAITING_OWNER");
  assert.match(error.message, /proj:T99:1/);
  assert.match(error.message, /AWAITING_OWNER/);
  assert.match(error.message, /awsf db rebuild/);
});

test("rebuild lifts the hold, retains the corrupt file byte-identically, and keeps the notice", async () => {
  await withRun(async (run) => {
    const corruptDigest = sha256(run.dbPath);

    const attempts = await discoverAttempts(run.root);
    const report = await rebuildDatabase({
      targetPath: run.dbPath,
      sources: attempts.map((dir) => ({ session: sessionInitFor(dir), journalPath: journalFilePath(dir) })),
      stamp: () => "after-corruption",
    });
    assert.equal(report.ok, true, report.ok ? "" : report.reason);
    if (!report.ok) return;

    assert.equal(report.retainedPath, `${run.dbPath}.superseded-after-corruption`);
    assert.equal(
      sha256(report.retainedPath ?? ""),
      corruptDigest,
      "the corrupt file is retained exactly as it was, not deleted",
    );

    const db = openDatabase(run.dbPath, { readonly: true });
    try {
      const session = getSession(db, run.sessionId);
      assert.equal(session?.observability_degraded, 0, "a rebuilt projection is a healthy projection");
      assert.equal(observabilityDegraded(db, run.sessionId), false);

      const scan = await scanJournal<NormalizedEvent>(journalFilePath(run.dir));
      assert.equal(scan.ok, true);
      if (!scan.ok) return;
      assert.equal(session?.last_projected_seq, scan.records.length, "every record, including the notices");

      // The flag is current health and clears; the notice is history and does not.
      const rows = pollEvents(db, run.sessionId, 0, 500);
      const notices = rows.filter((row) => row.type === "notice");
      assert.equal(notices.length, run.notices.length);
      assert.match(notices[0]?.payload_json ?? "", /sqlite-projection-failed/);

      // And with health restored, the advance the hold refused is allowed.
      assert.doesNotThrow(() =>
        assertAdvancementPermitted({
          sessionId: run.sessionId,
          to: "AWAITING_OWNER",
          degraded: observabilityDegraded(db, run.sessionId),
        }),
      );
    } finally {
      closeDatabase(db);
    }

    // The status the run left behind still agrees with the journal.
    const scan = await scanJournal<NormalizedEvent>(journalFilePath(run.dir));
    if (scan.ok) {
      assert.equal(deriveFor(run.dir)(scan.records).last_source_seq, scan.records.length);
    }
  });
});
