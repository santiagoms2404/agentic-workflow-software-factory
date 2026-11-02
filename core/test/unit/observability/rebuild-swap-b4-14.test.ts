// B4-14: In retainAndSwap, moving -wal and -shm aside must compensate/restore
// sidecars if the final candidate rename fails, returning the documented refusal
// rather than leaving awsf.db broken without WAL.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal } from "../../../src/persistence/journal.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import {
  rebuildDatabase,
  retainAndSwap,
  type RebuildOptions,
} from "../../../src/observability/rebuild.ts";
import type { AttemptStatusProjection } from "../../../src/observability/projector.ts";

function stubAttempt(seq: number): AttemptStatusProjection {
  return {
    sessionId: "p:t:1",
    projectSlug: "p",
    taskId: "t",
    continuesTask: null,
    groupId: null,
    planRef: null,
    attempt: 1,
    workflowId: "wf",
    riskTier: 0,
    isProtected: false,
    requestText: "test req",
    callCeiling: 5,
    configSnapshotJson: "{}",
    journalPath: "/tmp/journal.jsonl",
    startedAt: "2026-08-06T00:00:00.000Z",
    lifecycleState: "RUNNING",
    baseSha: null,
    candidateSha: null,
    callsSpent: 0,
    callsReserved: 1,
    correctionsAuto: 0,
    correctionsOwner: 0,
    ownerReentries: 0,
    workerModelResolved: null,
    updatedAt: "2026-08-06T00:00:00.000Z",
    endedAt: null,
    stateRevision: seq,
    evidence: {
      type: "phase",
      phase: {
        phaseId: `phase-${seq}`,
        ordinal: seq,
        key: `builder-${seq}`,
        name: "builder",
        kind: "agent",
        owner: "builder",
        description: "fixture phase",
        status: "SUCCEEDED",
        correctionCount: 0,
        maxCorrections: 1,
        errorCode: null,
        errorMessage: null,
        startedAt: "2026-08-06T00:00:00.000Z",
        endedAt: "2026-08-06T00:00:01.000Z",
        createdAt: "2026-08-06T00:00:00.000Z",
      },
    },
  };
}

test("rebuildDatabase returns a documented refusal and restores live WAL sidecars if candidate swap rename fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-swap-b4-14-"));
  const targetPath = join(dir, "awsf.db");
  const journalPath = join(dir, "journal.jsonl");

  try {
    // 1. Establish an existing live database with an active WAL sidecar
    const liveDb = openDatabase(targetPath);
    liveDb.exec("CREATE TABLE IF NOT EXISTS live_data (key TEXT PRIMARY KEY, val TEXT);");
    liveDb.exec("INSERT INTO live_data VALUES ('k1', 'committed_in_wal');");
    const walFrames = existsSync(`${targetPath}-wal`) ? readFileSync(`${targetPath}-wal`) : null;
    const shmFrames = existsSync(`${targetPath}-shm`) ? readFileSync(`${targetPath}-shm`) : null;
    liveDb.close();
    // Simulate uncheckpointed crash by restoring the valid active WAL sidecars
    if (walFrames) writeFileSync(`${targetPath}-wal`, walFrames);
    if (shmFrames) writeFileSync(`${targetPath}-shm`, shmFrames);

    // Verify target -wal exists
    assert.equal(existsSync(`${targetPath}-wal`), true, "targetPath-wal must exist prior to swap");

    // 2. Prepare journal for rebuild
    const journal = new Journal<AttemptStatusProjection>(journalPath);
    await journal.append(stubAttempt(1) as unknown as AttemptStatusProjection);
    await journal.close();

    const options: RebuildOptions = {
      targetPath,
      stamp: () => "b4-14-stamp",
      sources: [{
        session: {
          sessionId: "p:t:1",
          projectSlug: "p",
          taskId: "t",
          continuesTask: null,
          groupId: null,
          planRef: null,
          attempt: 1,
          workflowId: "wf",
          riskTier: 0,
          isProtected: false,
          requestText: "test req",
          callCeiling: 5,
          configSnapshotJson: "{}",
          journalPath,
          startedAt: "2026-08-06T00:00:00.000Z",
        },
        journalPath,
        attemptStatus: (record) => record.event as AttemptStatusProjection,
      }],
      rename: async (from: string, to: string) => {
        // Fail only the candidate -> targetPath rename, simulate EACCES / DrvFS lock
        if (to === targetPath) {
          throw new Error("injected EACCES at candidate rename");
        }
        return rename(from, to);
      },
    };

    // 3. rebuildDatabase must not throw: it must return RebuildRefused
    let report: Awaited<ReturnType<typeof rebuildDatabase>> | null = null;
    try {
      report = await rebuildDatabase(options);
    } catch (err) {
      assert.fail(`rebuildDatabase must return a refusal on swap failure instead of throwing: ${err}`);
    }

    assert.equal(report.ok, false, "rebuildDatabase must report refusal when swap fails");
    if (!report.ok) {
      assert.match(report.reason, /swap failed/i, "refusal reason must explain swap failure");
      assert.equal(existsSync(report.candidatePath), true, "candidate database must remain on disk for diagnosis");
    }

    // 4. Invariant: live sidecars must be restored, not left stripped
    assert.equal(existsSync(`${targetPath}-wal`), true, "targetPath-wal must be restored after candidate rename failure");

    // 5. Live database is intact and can be read with its WAL frames
    const checkDb = openDatabase(targetPath, { readonly: true });
    try {
      const row = checkDb.prepare("SELECT val FROM live_data WHERE key = 'k1'").get() as { val: string } | undefined;
      assert.equal(row?.val, "committed_in_wal", "live database must retain its committed WAL frames");
    } finally {
      checkDb.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retainAndSwap restores moved sidecars if candidate rename throws", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-swap-b4-14-direct-"));
  const targetPath = join(dir, "awsf.db");
  const candidatePath = join(dir, "awsf.db.candidate");

  try {
    writeFileSync(targetPath, "live-db-content\n");
    writeFileSync(`${targetPath}-wal`, "wal-frames\n");
    writeFileSync(`${targetPath}-shm`, "shm-content\n");
    writeFileSync(candidatePath, "candidate-content\n");

    const failingRename = async (from: string, to: string) => {
      if (from === candidatePath) {
        throw new Error("injected candidate rename failure");
      }
      return rename(from, to);
    };

    await assert.rejects(
      async () => retainAndSwap(targetPath, candidatePath, "direct-stamp", failingRename),
      /injected candidate rename failure/,
    );

    assert.equal(existsSync(targetPath), true, "targetPath still exists");
    assert.equal(existsSync(`${targetPath}-wal`), true, "targetPath-wal was restored");
    assert.equal(existsSync(`${targetPath}-shm`), true, "targetPath-shm was restored");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retainAndSwap restores partial sidecars without error when only -wal exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-swap-b4-14-partial-"));
  const targetPath = join(dir, "awsf.db");
  const candidatePath = join(dir, "awsf.db.candidate");

  try {
    writeFileSync(targetPath, "live-db-content\n");
    writeFileSync(`${targetPath}-wal`, "wal-frames-only\n");
    writeFileSync(candidatePath, "candidate-content\n");

    const failingRename = async (from: string, to: string) => {
      if (from === candidatePath) {
        throw new Error("injected candidate rename failure");
      }
      return rename(from, to);
    };

    await assert.rejects(
      async () => retainAndSwap(targetPath, candidatePath, "partial-stamp", failingRename),
      /injected candidate rename failure/,
    );

    assert.equal(existsSync(`${targetPath}-wal`), true, "targetPath-wal was restored");
    assert.equal(existsSync(`${targetPath}-shm`), false, "targetPath-shm remains absent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
