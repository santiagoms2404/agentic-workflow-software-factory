// B4-15: In retainAndSwap, ensure handles opened prior to swap do not
// invisibly continue writing to superseded inodes without error, or verify
// that live handles/readers are checked or refreshed so live awsf.db reflects
// rebuilt data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal } from "../../../src/persistence/journal.ts";
import { openDatabase, closeDatabase } from "../../../src/observability/sqlite.ts";
import { rebuildDatabase, type RebuildOptions } from "../../../src/observability/rebuild.ts";
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

test("rebuildDatabase refuses swap when a live writer handle is active on target database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-handles-b4-15-writer-"));
  const targetPath = join(dir, "awsf.db");
  const journalPath = join(dir, "journal.jsonl");

  try {
    // 1. Establish initial live database
    const liveDb = openDatabase(targetPath);
    liveDb.exec("CREATE TABLE IF NOT EXISTS live_table (id TEXT PRIMARY KEY);");
    liveDb.exec("INSERT INTO live_table VALUES ('live-1');");

    // Keep liveDb open as an active writer connection!

    // 2. Prepare journal for rebuild
    const journal = new Journal<AttemptStatusProjection>(journalPath);
    await journal.append(stubAttempt(1) as unknown as AttemptStatusProjection);
    await journal.close();

    const options: RebuildOptions = {
      targetPath,
      stamp: () => "handles-stamp-1",
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
    };

    // 3. Attempt rebuild while writer is active
    const report = await rebuildDatabase(options);

    // Invariant B4-15: Rebuild must refuse when live handles are active on the database
    assert.equal(report.ok, false, "rebuildDatabase must refuse swap when live writer is active");
    if (!report.ok) {
      assert.match(report.reason, /active handles|database is locked/i, "refusal reason must report active handle lock");
      assert.equal(existsSync(report.candidatePath), true, "candidate must remain on disk");
    }

    // Close the writer connection
    closeDatabase(liveDb);

    // Now rebuild must succeed once handles are closed
    const report2 = await rebuildDatabase(options);
    assert.equal(report2.ok, true, "rebuildDatabase succeeds once live writer handle is closed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rebuildDatabase refuses swap when a live reader has queried the target database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-handles-b4-15-reader-"));
  const targetPath = join(dir, "awsf.db");
  const journalPath = join(dir, "journal.jsonl");

  try {
    const initDb = openDatabase(targetPath);
    closeDatabase(initDb);

    // Active reader opens and runs query
    const reader = openDatabase(targetPath, { readonly: true });
    reader.prepare("SELECT * FROM sessions").all();

    const journal = new Journal<AttemptStatusProjection>(journalPath);
    await journal.append(stubAttempt(1) as unknown as AttemptStatusProjection);
    await journal.close();

    const options: RebuildOptions = {
      targetPath,
      stamp: () => "handles-stamp-2",
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
    };

    const report = await rebuildDatabase(options);
    assert.equal(report.ok, false, "rebuildDatabase must refuse swap when live reader is active");
    if (!report.ok) {
      assert.match(report.reason, /active handles|database is locked/i);
    }

    reader.close();

    const report2 = await rebuildDatabase(options);
    assert.equal(report2.ok, true, "rebuildDatabase succeeds once live reader is closed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rebuildDatabase succeeds without refusal when no live handles exist on target", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-handles-b4-15-clean-"));
  const targetPath = join(dir, "awsf.db");
  const journalPath = join(dir, "journal.jsonl");

  try {
    const initDb = openDatabase(targetPath);
    closeDatabase(initDb);

    const journal = new Journal<AttemptStatusProjection>(journalPath);
    await journal.append(stubAttempt(1) as unknown as AttemptStatusProjection);
    await journal.close();

    const options: RebuildOptions = {
      targetPath,
      stamp: () => "handles-stamp-clean",
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
    };

    const report = await rebuildDatabase(options);
    assert.equal(report.ok, true, "rebuildDatabase succeeds cleanly when no handles are open");

    // Fresh reader verifies rebuilt data
    const freshDb = openDatabase(targetPath, { readonly: true });
    try {
      const row = freshDb.prepare("SELECT session_id FROM sessions WHERE session_id = 'p:t:1'").get() as { session_id: string } | undefined;
      assert.equal(row?.session_id, "p:t:1");
    } finally {
      freshDb.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
