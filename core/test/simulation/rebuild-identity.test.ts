// Delete `awsf.db` and lose nothing.
//
// The comparison is at the query level, over every read the API performs,
// because that is what the dashboard actually sees: two databases with the
// same rows but different cursors are not the same database to a client that
// polls by cursor. So every view is captured as bytes before the deletion and
// compared as bytes afterwards — including `event_row`, the autoincrement the
// cursor IS.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { journalFilePath } from "../../src/persistence/platform-paths.ts";
import { discoverAttempts, rebuildDatabase, type RebuildSource } from "../../src/observability/rebuild.ts";
import { openDatabase, closeDatabase } from "../../src/observability/sqlite.ts";
import { getSession, listSessions, pollEvents, pollPhaseEvents } from "../../src/observability/queries.ts";
import { driveWrites, makeStateRoot, sessionIdFor, sessionInitFor, simAttemptDir, PROJECT } from "./_harness.ts";

async function withStateRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await makeStateRoot("awsf-rebuild-");
  try {
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Every read the API makes, as one document.
 *
 * `SELECT *` throughout, so a column added later is compared without this
 * fixture being taught about it — a rebuild that got a new column wrong
 * would still be caught.
 */
function captureViews(dbPath: string, sessionIds: readonly string[]): string {
  const db = openDatabase(dbPath, { readonly: true });
  try {
    return JSON.stringify(
      {
        sessions: listSessions(db, { limit: 100 }),
        archived: listSessions(db, { archived: true, limit: 100 }),
        perSession: sessionIds.map((id) => ({
          id,
          session: getSession(db, id),
          events: pollEvents(db, id, 0, 500),
          fromCursor: pollEvents(db, id, 2, 500),
          phaseEvents: pollPhaseEvents(db, "unphased", 0, 500),
        })),
      },
      null,
      2,
    );
  } finally {
    db.close();
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function sourcesFor(root: string): Promise<RebuildSource[]> {
  // Everything the rebuild needs comes off the disk: the attempt tree is
  // discovered, and each session's identity is read out of its own path.
  const attempts = await discoverAttempts(root);
  return attempts.map((dir) => ({ session: sessionInitFor(dir), journalPath: journalFilePath(dir) }));
}

/** Two attempts whose writes interleave in real time — the case a naive per-attempt replay renumbers. */
async function seedInterleavedRun(root: string, dbPath: string): Promise<string[]> {
  const first = simAttemptDir(root, PROJECT, "T98", "1");
  const second = simAttemptDir(root, PROJECT, "T99", "1");

  await driveWrites({ attemptDir: first, from: 1, count: 2, dbPath });
  await delay(3);
  await driveWrites({ attemptDir: second, from: 1, count: 4, terminal: "completed", dbPath });
  await delay(3);
  await driveWrites({ attemptDir: first, from: 3, count: 2, terminal: "completed", dbPath });

  return [sessionIdFor(first), sessionIdFor(second)];
}

test("delete awsf.db, rebuild from the journals, and every query view is byte-identical", async () => {
  await withStateRoot(async (root) => {
    const dbPath = join(root, "awsf.db");
    const sessionIds = await seedInterleavedRun(root, dbPath);
    const before = captureViews(dbPath, sessionIds);

    // The acceptance row's own act: the database is gone.
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });

    const report = await rebuildDatabase({ targetPath: dbPath, sources: await sourcesFor(root) });
    assert.equal(report.ok, true, report.ok ? "" : report.reason);
    if (!report.ok) return;
    assert.equal(report.sessions, 2);
    assert.equal(report.retainedPath, null, "there was no prior file to retain");

    const after = captureViews(dbPath, sessionIds);
    assert.equal(
      Buffer.compare(Buffer.from(after, "utf8"), Buffer.from(before, "utf8")),
      0,
      "every dashboard view over the rebuilt database is byte-identical",
    );
  });
});

test("a rebuild over a live database retains the prior file byte-identically", async () => {
  await withStateRoot(async (root) => {
    const dbPath = join(root, "awsf.db");
    const sessionIds = await seedInterleavedRun(root, dbPath);
    const before = captureViews(dbPath, sessionIds);
    const priorDigest = sha256(dbPath);

    const report = await rebuildDatabase({
      targetPath: dbPath,
      sources: await sourcesFor(root),
      stamp: () => "fixed-stamp",
    });
    assert.equal(report.ok, true, report.ok ? "" : report.reason);
    if (!report.ok) return;

    assert.equal(report.retainedPath, `${dbPath}.superseded-fixed-stamp`);
    assert.equal(sha256(report.retainedPath ?? ""), priorDigest, "the replaced file is retained, not deleted");
    assert.equal(captureViews(dbPath, sessionIds), before);
    assert.equal(captureViews(report.retainedPath ?? "", sessionIds), before, "and it is still a readable database");
  });
});

test("the rebuilt database is a pure function of the journals: rebuilding twice is identical", async () => {
  await withStateRoot(async (root) => {
    const dbPath = join(root, "awsf.db");
    const sessionIds = await seedInterleavedRun(root, dbPath);
    const sources = await sourcesFor(root);

    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
    await rebuildDatabase({ targetPath: dbPath, sources, stamp: () => "one" });
    const first = captureViews(dbPath, sessionIds);

    await rebuildDatabase({ targetPath: dbPath, sources, stamp: () => "two" });
    assert.equal(captureViews(dbPath, sessionIds), first);
  });
});

test("a rebuild refuses a corrupt journal, naming the key, and never touches the live file", async () => {
  await withStateRoot(async (root) => {
    const dbPath = join(root, "awsf.db");
    const sessionIds = await seedInterleavedRun(root, dbPath);
    const before = captureViews(dbPath, sessionIds);
    const liveDigest = sha256(dbPath);

    const sources = await sourcesFor(root);
    const broken = sources[0];
    if (broken === undefined) throw new Error("expected at least one discovered attempt");
    const path = broken.journalPath;
    const lines = readFileSync(path, "utf8").split("\n");
    lines[1] = "{ this is not a record";
    writeFileSync(path, lines.join("\n"));

    const report = await rebuildDatabase({ targetPath: dbPath, sources, stamp: () => "refused" });
    assert.equal(report.ok, false);
    if (report.ok) return;
    assert.equal(report.badKey, "journal.jsonl#line:2");

    assert.equal(sha256(dbPath), liveDigest, "the live database is untouched by a refused rebuild");
    assert.equal(captureViews(dbPath, sessionIds), before);
  });
});

test("a rebuild carries every journal record forward, cursor included", async () => {
  await withStateRoot(async (root) => {
    const dbPath = join(root, "awsf.db");
    const sessionIds = await seedInterleavedRun(root, dbPath);
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });

    const report = await rebuildDatabase({ targetPath: dbPath, sources: await sourcesFor(root) });
    assert.equal(report.ok, true);
    if (!report.ok) return;
    assert.equal(report.records, 8, "four records per attempt");
    assert.equal(report.projected, 8, "every record advances its session's cursor");

    const db = openDatabase(dbPath, { readonly: true });
    try {
      for (const id of sessionIds) {
        assert.equal(getSession(db, id)?.last_projected_seq, 4);
        assert.equal(getSession(db, id)?.observability_degraded, 0);
        // Four records, three rows: the `thinking.delta` is streamed and
        // never persisted (invariant 9), and a rebuild does not resurrect it.
        assert.equal(pollEvents(db, id, 0, 500).length, 3);
      }
    } finally {
      closeDatabase(db);
    }
  });
});
