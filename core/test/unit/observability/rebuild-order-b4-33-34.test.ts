// B4-34 and B4-33: the rebuild's replay order.
//
// B4-34: records were sorted by wall-clock `recorded_at` across every journal,
// with a string tie-break. Two records of one attempt in the same millisecond
// (seq 9 and 10) then replayed 10 before 9, and a backward clock step did the
// same, so the projector refused a healthy journal as non-contiguous. Each
// journal now keeps its own source_seq order.
//
// B4-33: task-level decisions were projected after every attempt existed, so
// they attached to the newest attempt that exists at rebuild time rather than
// the one that was newest when the decision was recorded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { rebuildDatabase, type RebuildOptions, type RebuildSource } from "../../../src/observability/rebuild.ts";
import type { AttemptStatusProjection } from "../../../src/observability/projector.ts";
import type { DecisionRecord } from "../../../src/contracts/decision-record.ts";

function attemptStatus(attempt: number, seq: number): AttemptStatusProjection {
  return {
    sessionId: `p:t:${attempt}`,
    projectSlug: "p",
    taskId: "t",
    continuesTask: null,
    groupId: null,
    planRef: null,
    attempt,
    workflowId: "wf",
    riskTier: 0,
    isProtected: false,
    requestText: "test req",
    callCeiling: 5,
    configSnapshotJson: "{}",
    journalPath: "/unused",
    startedAt: "2026-08-06T00:00:00.000Z",
    lifecycleState: "RUNNING",
    baseSha: null,
    candidateSha: null,
    callsSpent: 0,
    callsReserved: 0,
    correctionsAuto: 0,
    correctionsOwner: 0,
    ownerReentries: 0,
    workerModelResolved: null,
    updatedAt: "2026-08-06T00:00:00.000Z",
    endedAt: null,
    stateRevision: seq,
  };
}

function sourceFor(attempt: number, journalPath: string): RebuildSource {
  return {
    session: {
      sessionId: `p:t:${attempt}`,
      projectSlug: "p",
      taskId: "t",
      continuesTask: null,
      groupId: null,
      planRef: null,
      attempt,
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
  };
}

/** A journal file with the given `[source_seq, recorded_at]` pairs, one record each. */
function writeJournal(path: string, attempt: number, stamps: readonly [number, string][]): void {
  const lines = stamps.map(([seq, recordedAt]) => JSON.stringify({
    source_seq: seq,
    recorded_at: recordedAt,
    event: attemptStatus(attempt, seq),
  }));
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

async function withDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "awsf-rebuild-order-"));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("two records of one attempt stamped in the same millisecond replay in source_seq order (B4-34)", async () => {
  await withDir(async (dir) => {
    const journalPath = join(dir, "journal.jsonl");
    const stamps: [number, string][] = [];
    for (let seq = 1; seq <= 8; seq += 1) stamps.push([seq, `2026-08-06T00:00:0${seq}.000Z`]);
    // 9 and 10 share a millisecond: the tie-break must not put 10 ahead of 9.
    stamps.push([9, "2026-08-06T00:00:09.000Z"], [10, "2026-08-06T00:00:09.000Z"]);
    writeJournal(journalPath, 1, stamps);

    const report = await rebuildDatabase({
      targetPath: join(dir, "awsf.db"),
      stamp: () => "b4-34",
      sources: [sourceFor(1, journalPath)],
    } satisfies RebuildOptions);
    assert.equal(report.ok, true, report.ok ? "" : report.reason);
    if (report.ok) assert.equal(report.records, 10);
  });
});

test("a wall-clock step back inside one journal does not reorder that journal (B4-34)", async () => {
  await withDir(async (dir) => {
    const journalPath = join(dir, "journal.jsonl");
    writeJournal(journalPath, 1, [
      [1, "2026-08-06T00:00:01.000Z"],
      [2, "2026-08-06T00:00:02.000Z"],
      [3, "2026-08-06T00:00:03.000Z"],
      [4, "2026-08-06T00:00:00.500Z"],
    ]);
    const report = await rebuildDatabase({
      targetPath: join(dir, "awsf.db"),
      stamp: () => "b4-34-step",
      sources: [sourceFor(1, journalPath)],
    });
    assert.equal(report.ok, true, report.ok ? "" : report.reason);
  });
});

test("a task-level decision attaches to the attempt that was newest when it was recorded (B4-33)", async () => {
  await withDir(async (dir) => {
    const first = join(dir, "attempt-1.jsonl");
    const second = join(dir, "attempt-2.jsonl");
    writeJournal(first, 1, [[1, "2026-08-06T00:00:01.000Z"], [2, "2026-08-06T00:00:02.000Z"]]);
    writeJournal(second, 2, [[1, "2026-08-06T00:00:04.000Z"]]);
    // Recorded after attempt 1 ran and before attempt 2 existed.
    const decision = {
      id: "d-task-level",
      project: "p",
      taskId: "t",
      attempt: null,
      questionSet: { id: "replay-check", version: 1 },
      outcome: "answered",
      at: "2026-08-06T00:00:03.000Z",
    } as unknown as DecisionRecord;

    const targetPath = join(dir, "awsf.db");
    const report = await rebuildDatabase({
      targetPath,
      stamp: () => "b4-33",
      sources: [sourceFor(1, first), sourceFor(2, second)],
      decisions: [decision],
    });
    assert.equal(report.ok, true, report.ok ? "" : report.reason);

    const db = openDatabase(targetPath, { readonly: true });
    try {
      const rows = db.prepare("SELECT session_id FROM events WHERE type = 'decision'").all() as { session_id: string }[];
      assert.deepEqual(rows.map((row) => row.session_id), ["p:t:1"]);
    } finally {
      db.close();
    }
  });
});
