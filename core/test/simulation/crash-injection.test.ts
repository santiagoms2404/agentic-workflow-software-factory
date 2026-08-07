// Kill injected between every pair of write-protocol steps.
//
// Every case in the matrix spawns a real host process, SIGKILLs it inside the
// real protocol at a real boundary, and then asks recovery what happened. The
// answer must be exact reconstruction or a refusal naming the exact key —
// there is no case in this file where recovery is allowed to be approximately
// right, and no case where it is allowed to write to the file it is reading.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  WRITE_PROTOCOL_STEPS,
  reclaimLock,
  LockHolderChanged,
  type WriteProtocolStep,
} from "../../src/persistence/attempt-lock.ts";
import { writeStatus } from "../../src/persistence/status-store.ts";
import { journalFilePath, statusFilePath, lockFilePath } from "../../src/persistence/platform-paths.ts";
import { recoverAttempt, scanJournal, type ReconstructionKind } from "../../src/persistence/replay.ts";
import { openDatabase, closeDatabase } from "../../src/observability/sqlite.ts";
import { projectEvent } from "../../src/observability/projector.ts";
import { getSession } from "../../src/observability/queries.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import {
  canonicalJson,
  deriveFor,
  driveWrites,
  makeStateRoot,
  sessionIdFor,
  simAttemptDir,
  type SimStatus,
} from "./_harness.ts";

const WRITES = 3;
const CHILD = join(import.meta.dirname, "_crash-child.ts");

async function withStateRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await makeStateRoot();
  try {
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function crash(request: {
  attemptDir: string;
  dbPath: string | null;
  writes: number;
  terminal: "completed" | "failed" | null;
  killWrite: number;
  killStep: WriteProtocolStep;
}): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", CHILD, JSON.stringify(request)],
    { encoding: "utf8" },
  );
  assert.equal(
    result.signal,
    "SIGKILL",
    `the injected kill never fired at ${request.killStep} (exit ${String(result.status)}): ${result.stderr}`,
  );
}

/**
 * The uninterrupted run, as the ground truth every reconstruction is compared
 * against. Same identity, its own state root — the status of an attempt is a
 * function of its identity and its journal, and nothing else.
 */
async function controlStatuses(): Promise<string[]> {
  const root = await makeStateRoot("awsf-control-");
  try {
    const dir = simAttemptDir(root);
    const captured: string[] = [];
    await driveWrites({
      attemptDir: dir,
      from: 1,
      count: WRITES,
      terminal: "completed",
      afterWrite: () => {
        captured.push(readFileSync(statusFilePath(dir), "utf8"));
      },
    });
    return captured;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface StepExpectation {
  records: number;
  reconstructions: ReconstructionKind[];
  lockHeld: boolean;
}

/**
 * What each boundary leaves behind, stated up front rather than discovered.
 *
 * The only boundary that needs a repair is `appended`: the record is durable
 * and the status has not caught up yet, which is precisely the one
 * disagreement a crash can explain. Everything before it leaves an attempt
 * that is simply one write shorter, and everything after leaves one that is
 * complete.
 */
const EXPECTED: Record<WriteProtocolStep, StepExpectation> = {
  locked: { records: WRITES - 1, reconstructions: [], lockHeld: true },
  validated: { records: WRITES - 1, reconstructions: [], lockHeld: true },
  appended: { records: WRITES, reconstructions: ["status-stale"], lockHeld: true },
  "status-written": { records: WRITES, reconstructions: [], lockHeld: true },
  projected: { records: WRITES, reconstructions: [], lockHeld: true },
  sealed: { records: WRITES, reconstructions: [], lockHeld: true },
  unlocked: { records: WRITES, reconstructions: [], lockHeld: false },
};

for (const step of WRITE_PROTOCOL_STEPS) {
  test(`a kill after "${step}" reconstructs the attempt exactly`, async () => {
    await withStateRoot(async (root) => {
      const control = await controlStatuses();
      const dir = simAttemptDir(root);
      crash({ attemptDir: dir, dbPath: null, writes: WRITES, terminal: "completed", killWrite: WRITES, killStep: step });

      const expectation = EXPECTED[step];
      const recovery = await recoverAttempt<NormalizedEvent, SimStatus>({
        attemptDir: dir,
        derive: deriveFor(dir),
        lifecycleStateOf: (status) => status.lifecycle_state,
      });

      assert.equal(recovery.outcome, "recovered", `a kill at ${step} must not be ambiguous`);
      if (recovery.outcome !== "recovered") return;

      assert.equal(recovery.records.length, expectation.records);
      assert.deepEqual(
        recovery.reconstructions.map((r) => r.kind),
        expectation.reconstructions,
      );
      assert.equal(recovery.heldLock !== null, expectation.lockHeld, "the lock file a crash leaves behind");
      if (recovery.heldLock !== null) {
        assert.notEqual(recovery.heldLock.holder, null, "a lock left by a crash still names its holder");
      }

      // Exact, not approximate: the reconstructed status is byte-identical to
      // the one the uninterrupted run wrote at the same record count.
      const expectedStatus = control[expectation.records - 1];
      assert.equal(JSON.stringify(recovery.status), expectedStatus);
      assert.equal(canonicalJson(recovery.status), canonicalJson(JSON.parse(expectedStatus ?? "null")));
      assert.equal(recovery.nextSourceSeq, expectation.records + 1);

      // ...and the attempt goes on from there. The caller repairs; recovery
      // only ever reported.
      if (recovery.heldLock?.holder != null) {
        await reclaimLock(recovery.heldLock.path, recovery.heldLock.holder);
      }
      await writeStatus(statusFilePath(dir), recovery.status);

      const resumed = await driveWrites({
        attemptDir: dir,
        from: recovery.nextSourceSeq,
        count: 1,
        terminal: "completed",
      });

      const scan = await scanJournal<NormalizedEvent>(journalFilePath(dir));
      assert.equal(scan.ok, true, "the resumed journal is still contiguous");
      if (!scan.ok) return;
      assert.equal(scan.records.length, expectation.records + 1);
      assert.equal(canonicalJson(resumed), canonicalJson(deriveFor(dir)(scan.records)));
    });
  });
}

test("a kill after the terminal write recovers a sealed attempt, and the seal is re-derived", async () => {
  await withStateRoot(async (root) => {
    const dir = simAttemptDir(root);
    crash({ attemptDir: dir, dbPath: null, writes: WRITES, terminal: "failed", killWrite: WRITES, killStep: "sealed" });

    const recovery = await recoverAttempt<NormalizedEvent, SimStatus>({
      attemptDir: dir,
      derive: deriveFor(dir),
      lifecycleStateOf: (status) => status.lifecycle_state,
    });
    assert.equal(recovery.outcome, "recovered");
    if (recovery.outcome !== "recovered") return;
    assert.equal(recovery.status?.lifecycle_state, "BLOCKED");

    if (recovery.heldLock?.holder != null) {
      await reclaimLock(recovery.heldLock.path, recovery.heldLock.holder);
    }

    // Sealing lives in memory and the memory died with the host, so a
    // resumed host re-seals from the recovered status. Without that, a
    // terminal attempt would quietly accept writes after a crash.
    await assert.rejects(
      () =>
        driveWrites({
          attemptDir: dir,
          from: recovery.nextSourceSeq,
          count: 1,
          sealedState: recovery.status?.lifecycle_state ?? null,
        }),
      /sealed in terminal state BLOCKED/,
    );
  });
});

test("a projection left behind by a kill catches up by replay, and re-applying is a no-op", async () => {
  await withStateRoot(async (root) => {
    const dir = simAttemptDir(root);
    const dbPath = join(root, "awsf.db");
    crash({
      attemptDir: dir,
      dbPath,
      writes: WRITES,
      terminal: "completed",
      killWrite: WRITES,
      killStep: "status-written",
    });

    const sessionId = sessionIdFor(dir);
    const scan = await scanJournal<NormalizedEvent>(journalFilePath(dir));
    assert.equal(scan.ok, true);
    if (!scan.ok) return;

    const db = openDatabase(dbPath);
    try {
      assert.equal(
        getSession(db, sessionId)?.last_projected_seq,
        WRITES - 1,
        "the kill landed before the projection of the last record",
      );

      for (const record of scan.records) {
        const outcome = projectEvent(db, { sessionId, runId: record.event.runId, phaseId: null }, record);
        assert.equal(outcome.ok, true);
      }
      assert.equal(getSession(db, sessionId)?.last_projected_seq, WRITES);

      const again = scan.records.map((record) =>
        projectEvent(db, { sessionId, runId: record.event.runId, phaseId: null }, record),
      );
      assert.deepEqual(
        again.map((o) => o.applied),
        scan.records.map(() => false),
        "replaying an already-projected journal writes nothing",
      );
      assert.equal(getSession(db, sessionId)?.observability_degraded, 0);
    } finally {
      closeDatabase(db);
    }
  });
});

// ---------------------------------------------------------------------------
// Corruption: refuse by name, and leave the evidence exactly as found.
// ---------------------------------------------------------------------------

async function corruptedAttempt(root: string, mutate: (dir: string) => void): Promise<string> {
  const dir = simAttemptDir(root);
  await driveWrites({ attemptDir: dir, from: 1, count: 2 });
  mutate(dir);
  return dir;
}

test("a torn final line is discarded as the append fsync never acknowledged, and the file is retained", async () => {
  await withStateRoot(async (root) => {
    const dir = await corruptedAttempt(root, (d) => {
      appendFileSync(journalFilePath(d), '{"source_seq":3,"recorded_at":"2026-08-06T00:00:03.000Z","eve');
    });
    const before = sha256(journalFilePath(dir));

    const recovery = await recoverAttempt<NormalizedEvent, SimStatus>({
      attemptDir: dir,
      derive: deriveFor(dir),
    });

    assert.equal(recovery.outcome, "recovered");
    if (recovery.outcome !== "recovered") return;
    assert.equal(recovery.records.length, 2);
    assert.deepEqual(
      recovery.reconstructions.map((r) => r.kind),
      ["torn-tail-discarded"],
    );
    assert.deepEqual(recovery.retained, [journalFilePath(dir)]);
    assert.equal(sha256(journalFilePath(dir)), before, "recovery never rewrites the journal it read");
  });
});

test("an unparseable interior line BLOCKS naming the exact line, file byte-identical", async () => {
  await withStateRoot(async (root) => {
    const dir = await corruptedAttempt(root, (d) => {
      const path = journalFilePath(d);
      const lines = readFileSync(path, "utf8").split("\n");
      lines[1] = '{"source_seq":2,"recorded_at":"2026-';
      writeFileSync(path, lines.join("\n"));
    });
    const before = sha256(journalFilePath(dir));

    const recovery = await recoverAttempt<NormalizedEvent, SimStatus>({
      attemptDir: dir,
      derive: deriveFor(dir),
    });

    assert.equal(recovery.outcome, "blocked");
    if (recovery.outcome !== "blocked") return;
    assert.equal(recovery.code, "record-corrupt");
    assert.equal(recovery.badKey, "journal.jsonl#line:2");
    assert.deepEqual(recovery.retained, [journalFilePath(dir)]);
    assert.equal(sha256(journalFilePath(dir)), before);
  });
});

test("a gap in source_seq BLOCKS naming the exact key, never renumbering what survived", async () => {
  await withStateRoot(async (root) => {
    const dir = await corruptedAttempt(root, (d) => {
      const path = journalFilePath(d);
      const lines = readFileSync(path, "utf8").split("\n");
      const second = JSON.parse(lines[1] ?? "{}") as { source_seq: number };
      second.source_seq = 7;
      lines[1] = JSON.stringify(second);
      writeFileSync(path, lines.join("\n"));
    });
    const before = sha256(journalFilePath(dir));

    const recovery = await recoverAttempt<NormalizedEvent, SimStatus>({
      attemptDir: dir,
      derive: deriveFor(dir),
    });

    assert.equal(recovery.outcome, "blocked");
    if (recovery.outcome !== "blocked") return;
    assert.equal(recovery.badKey, "journal.jsonl#line:2.source_seq");
    assert.match(recovery.detail, /expected source_seq 2, found 7/);
    assert.equal(sha256(journalFilePath(dir)), before);
  });
});

test("a status that disagrees with the journal BLOCKS naming the exact key", async () => {
  await withStateRoot(async (root) => {
    const dir = await corruptedAttempt(root, (d) => {
      const path = statusFilePath(d);
      const status = JSON.parse(readFileSync(path, "utf8")) as SimStatus;
      writeFileSync(path, JSON.stringify({ ...status, lifecycle_state: "LANDED" }));
    });
    const before = sha256(statusFilePath(dir));

    const recovery = await recoverAttempt<NormalizedEvent, SimStatus>({
      attemptDir: dir,
      derive: deriveFor(dir),
      lifecycleStateOf: (status) => status.lifecycle_state,
    });

    assert.equal(recovery.outcome, "blocked");
    if (recovery.outcome !== "blocked") return;
    assert.equal(recovery.code, "record-corrupt");
    assert.equal(recovery.badKey, "status.json#lifecycle_state");
    assert.match(recovery.detail, /"LANDED"/);
    assert.deepEqual(recovery.retained, [journalFilePath(dir), statusFilePath(dir)]);
    assert.equal(sha256(statusFilePath(dir)), before);
  });
});

test("a status ahead of the journal BLOCKS on the key it is ahead on", async () => {
  await withStateRoot(async (root) => {
    const dir = await corruptedAttempt(root, (d) => {
      const path = statusFilePath(d);
      const status = JSON.parse(readFileSync(path, "utf8")) as SimStatus;
      writeFileSync(path, JSON.stringify({ ...status, last_source_seq: 9 }));
    });

    const recovery = await recoverAttempt<NormalizedEvent, SimStatus>({
      attemptDir: dir,
      derive: deriveFor(dir),
    });

    assert.equal(recovery.outcome, "blocked");
    if (recovery.outcome !== "blocked") return;
    assert.equal(recovery.badKey, "status.json#last_source_seq");
  });
});

test("a lifecycle state outside the plan's ten BLOCKS as unknown-state", async () => {
  await withStateRoot(async (root) => {
    const dir = await corruptedAttempt(root, (d) => {
      const path = statusFilePath(d);
      const status = JSON.parse(readFileSync(path, "utf8")) as SimStatus;
      writeFileSync(path, JSON.stringify({ ...status, lifecycle_state: "FINISHING" }));
    });

    const recovery = await recoverAttempt<NormalizedEvent, SimStatus>({
      attemptDir: dir,
      derive: deriveFor(dir),
      lifecycleStateOf: (status) => status.lifecycle_state,
    });

    assert.equal(recovery.outcome, "blocked");
    if (recovery.outcome !== "blocked") return;
    assert.equal(recovery.code, "unknown-state");
    assert.equal(recovery.badKey, "status.json#lifecycle_state");
  });
});

test("an unreadable status.json is rebuilt from the journal and retained byte-identical", async () => {
  await withStateRoot(async (root) => {
    const dir = await corruptedAttempt(root, (d) => {
      writeFileSync(statusFilePath(d), "{not json at all");
    });
    const before = sha256(statusFilePath(dir));

    const recovery = await recoverAttempt<NormalizedEvent, SimStatus>({
      attemptDir: dir,
      derive: deriveFor(dir),
    });

    assert.equal(recovery.outcome, "recovered");
    if (recovery.outcome !== "recovered") return;
    assert.deepEqual(
      recovery.reconstructions.map((r) => r.kind),
      ["status-unreadable"],
    );
    assert.equal(recovery.status?.last_source_seq, 2);
    assert.equal(sha256(statusFilePath(dir)), before, "the corrupt status is retained exactly as found");
  });
});

test("a missing status.json is rebuilt from the journal", async () => {
  await withStateRoot(async (root) => {
    const dir = await corruptedAttempt(root, (d) => {
      rmSync(statusFilePath(d));
    });

    const recovery = await recoverAttempt<NormalizedEvent, SimStatus>({
      attemptDir: dir,
      derive: deriveFor(dir),
    });

    assert.equal(recovery.outcome, "recovered");
    if (recovery.outcome !== "recovered") return;
    assert.deepEqual(
      recovery.reconstructions.map((r) => r.kind),
      ["status-missing"],
    );
    assert.equal(recovery.status?.events_seen, 2);
  });
});

test("reclaiming a lock that changed hands is refused", async () => {
  await withStateRoot(async (root) => {
    const dir = simAttemptDir(root);
    mkdirSync(dir, { recursive: true });
    const path = lockFilePath(dir);
    writeFileSync(path, JSON.stringify({ pid: 4242, acquiredAt: "2026-08-06T00:00:00.000Z" }));

    await assert.rejects(
      () => reclaimLock(path, { pid: 111, acquiredAt: "2026-08-06T00:00:00.000Z" }),
      LockHolderChanged,
    );
    assert.equal(readFileSync(path, "utf8").includes("4242"), true, "the live holder's lock is left alone");
  });
});
