// The driving-session group, from the flag that mints it to the public column
// the dashboard reads. Migration 0006 added `sessions.group_id` and nothing
// wrote it; these are the tests that make the column mean something.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import {
  nextRevision,
  persistAttempt,
  readAttempt,
  withLegacyDefaults,
  type AttemptStatus,
} from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { retryCommand } from "../../../src/cli/commands/retry.ts";
import { statusFilePath } from "../../../src/persistence/platform-paths.ts";
import { getSession, listSessions } from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";

const PROJECT = "agentic-workflow-software-factory";

function sandbox(label: string): { root: string; stateRoot: string; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), `awsf-group-${label}-`));
  return { root, stateRoot: join(root, "state"), close: () => rmSync(root, { recursive: true, force: true }) };
}

/** Drives one attempt into a terminal state without a worktree or a provider. */
async function block(attemptDir: string, status: AttemptStatus, project: ReturnType<typeof createDashboardProjection>["project"]): Promise<AttemptStatus> {
  return persistAttempt(attemptDir, status.revision, {
    kind: "attempt.updated",
    next: nextRevision(status, { lifecycleState: "BLOCKED", lastActivity: "blocked by the test harness" }),
  }, project);
}

test("a task created with --group projects that group, and one created without it projects NULL", async () => {
  const box = sandbox("projects");
  const projection = createDashboardProjection(box.stateRoot);
  try {
    const grouped = await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "grouped-task", groupId: "drive-2026-09-10",
      repository: box.root, request: "record the driving session", workflow: "build", tier: 1,
      sessionId: () => "grouped-session", projectRecord: projection.project,
    });
    const loose = await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "ungrouped-task",
      repository: box.root, request: "record no driving session", workflow: "build", tier: 1,
      sessionId: () => "ungrouped-session", projectRecord: projection.project,
    });
    assert.equal(grouped.status.groupId, "drive-2026-09-10");
    assert.equal(loose.status.groupId, null, "absent means NULL, never an inferred neighbour");
    projection.close();

    const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
    try {
      // Read back through the PUBLIC column list, which is the surface the
      // dashboard has: a column the projector writes and `SESSION_PUBLIC_COLUMNS`
      // omits is still invisible, which is exactly what 0006 shipped.
      assert.equal(getSession(db, "grouped-session")?.group_id, "drive-2026-09-10");
      assert.equal(getSession(db, "ungrouped-session")?.group_id, null);
      const listed = listSessions(db);
      assert.equal(listed.find((row) => row.session_id === "grouped-session")?.group_id, "drive-2026-09-10");
      assert.equal(listed.find((row) => row.session_id === "ungrouped-session")?.group_id, null);
    } finally { db.close(); }
  } finally { projection.close(); box.close(); }
});

test("retry records NULL rather than inheriting the prior attempt's group, because a different session minted it", async () => {
  const box = sandbox("retry-null");
  const projection = createDashboardProjection(box.stateRoot);
  try {
    const created = await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "carry-task", groupId: "drive-a",
      repository: box.root, request: "prove non-inheritance", workflow: "build", tier: 1,
      sessionId: () => "attempt-1-session", projectRecord: projection.project,
    });
    const blocked = await block(created.attemptDir, created.status, projection.project);

    const retried = await retryCommand({
      attemptDir: created.attemptDir, stateRoot: box.stateRoot,
      configSnapshotJson: "{}", allowance: { auto: 1, owner: 1 },
      sessionId: () => "attempt-2-session", projectRecord: projection.project,
    });

    // The assertion this file exists for. `retryCommand` builds attempt n+1 by
    // spreading the prior status, so every field it does not name explicitly is
    // inherited by default. `ownerReentries` and `reviewDegradation` are already
    // guarded in that same object literal; this proves `groupId` joined them.
    assert.equal(blocked.groupId, "drive-a");
    assert.equal(retried.status.groupId, null, "a group is minted by a driving session and never spread forward");
    projection.close();

    const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.equal(getSession(db, "attempt-1-session")?.group_id, "drive-a");
      assert.equal(getSession(db, "attempt-2-session")?.group_id, null);
    } finally { db.close(); }
  } finally { projection.close(); box.close(); }
});

test("a continuation chain crosses two groups with both intact and neither merged", async () => {
  const box = sandbox("cross-group");
  const projection = createDashboardProjection(box.stateRoot);
  try {
    const created = await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "task-x", groupId: "group-a",
      repository: box.root, request: "open task X in group A", workflow: "build", tier: 1,
      sessionId: () => "x-attempt-1", projectRecord: projection.project,
    });
    await block(created.attemptDir, created.status, projection.project);
    const second = await retryCommand({
      attemptDir: created.attemptDir, stateRoot: box.stateRoot,
      configSnapshotJson: "{}", allowance: { auto: 1, owner: 1 }, groupId: "group-b",
      sessionId: () => "x-attempt-2", projectRecord: projection.project,
    });
    assert.equal(second.status.attempt, 2);
    assert.equal(second.status.taskId, "task-x");
    projection.close();

    const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
    try {
      const first = getSession(db, "x-attempt-1");
      const next = getSession(db, "x-attempt-2");
      assert.equal(first?.task_id, next?.task_id, "one task");
      assert.equal(first?.group_id, "group-a");
      assert.equal(next?.group_id, "group-b");
      // Two groups, one task, two attempts: the edge Tasks 6 and 7 draw between
      // groups. Inheriting the group would have made both rows read "group-a"
      // and left those views with a single node and nothing to connect.
      assert.notEqual(first?.group_id, next?.group_id);
    } finally { db.close(); }
  } finally { projection.close(); box.close(); }
});

test("--group is validated as a path-safe identifier before anything is written", async () => {
  const box = sandbox("validation");
  try {
    for (const bad of ["../escape", "with space", "", "a".repeat(101), "/absolute"]) {
      await assert.rejects(
        newCommand({
          stateRoot: box.stateRoot, project: PROJECT, taskId: `reject-${bad.length}`, groupId: bad,
          repository: box.root, request: "reject this group", workflow: "build", tier: 1,
        }),
        /not a path-safe identifier/u,
        `--group ${JSON.stringify(bad)} must be refused`,
      );
    }
  } finally { box.close(); }
});

test("a status written before groups existed reads as belonging to none", async () => {
  const box = sandbox("legacy");
  try {
    const created = await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "legacy-task",
      repository: box.root, request: "read a pre-group record", workflow: "build", tier: 1,
    });
    const onDisk = JSON.parse(await readFile(statusFilePath(created.attemptDir), "utf8")) as Record<string, unknown>;
    delete onDisk.groupId;
    const legacy = withLegacyDefaults(onDisk as unknown as AttemptStatus);
    assert.equal(legacy.groupId, null, "no backfill, no inference: NULL is the honest value");
    // The shim must still be a no-op for a current record, or every read pays
    // for a rewrite of a status that was already correct.
    const current = await readAttempt(created.attemptDir);
    assert.equal(withLegacyDefaults(current), current);
  } finally { box.close(); }
});
