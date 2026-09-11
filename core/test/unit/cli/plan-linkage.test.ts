// Which plan a run came from. `sessions.plan_ref` has existed since migration
// 0005 with nothing writing it, and its comment names the reason the obvious
// shortcut was refused: the only automatic link available is a task id equal to
// a ticket uid, and zero real runs have one. So these tests are as much about
// what is NOT inferred as about what is recorded.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import {
  nextRevision,
  persistAttempt,
  withLegacyDefaults,
  type AttemptStatus,
} from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { PlanRefNoCatalog, PlanRefUnknown, resolvePlanRef } from "../../../src/cli/commands/plan-ref.ts";
import { retryCommand } from "../../../src/cli/commands/retry.ts";
import { statusFilePath } from "../../../src/persistence/platform-paths.ts";
import { getSession } from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";

const PROJECT = "agentic-workflow-software-factory";
/** This repository registers its own plans, so the fence has a real catalog. */
const REPOSITORY = resolve(".");

function sandbox(label: string): { root: string; stateRoot: string; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), `awsf-plan-${label}-`));
  return { root, stateRoot: join(root, "state"), close: () => rmSync(root, { recursive: true, force: true }) };
}

test("a freehand task links to the registered plan it names, and one that names none stays NULL", async () => {
  const box = sandbox("links");
  const projection = createDashboardProjection(box.stateRoot);
  try {
    const stem = await resolvePlanRef({ repository: REPOSITORY, stateRoot: box.stateRoot, project: PROJECT, stem: "awsf-v2-plan" });
    const linked = await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "freehand-task", planRef: stem,
      repository: box.root, request: "work the driver typed by hand", workflow: "build", tier: 1,
      sessionId: () => "freehand-session", projectRecord: projection.project,
    });
    const loose = await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "planless-task",
      repository: box.root, request: "work belonging to no plan", workflow: "build", tier: 1,
      sessionId: () => "planless-session", projectRecord: projection.project,
    });
    assert.equal(linked.status.planRef, "awsf-v2-plan");
    assert.equal(loose.status.planRef, null);
    projection.close();

    const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
    try {
      // Through the PUBLIC column list, which is what 0005 shipped without.
      assert.equal(getSession(db, "freehand-session")?.plan_ref, "awsf-v2-plan");
      assert.equal(getSession(db, "planless-session")?.plan_ref, null);
    } finally { db.close(); }
  } finally { projection.close(); box.close(); }
});

test("a plan is named, never guessed from the task id's shape or the request's words", async () => {
  const box = sandbox("no-guess");
  try {
    // A task id spelled exactly like a plan stem, and a request naming a plan
    // out loud. Neither produces a link: only `--plan` does.
    const shaped = await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "awsf-v2-plan",
      repository: box.root, request: "this is work on the awsf-v2-plan plan", workflow: "build", tier: 1,
    });
    assert.equal(shaped.status.planRef, null);
  } finally { box.close(); }
});

test("an unregistered plan stem is refused with the candidates it read", async () => {
  const box = sandbox("unknown");
  try {
    await assert.rejects(
      resolvePlanRef({ repository: REPOSITORY, stateRoot: box.stateRoot, project: PROJECT, stem: "not-a-plan" }),
      (error: unknown) => {
        assert.ok(error instanceof PlanRefUnknown);
        assert.match(error.message, /is not a registered plan; the catalog resolved/u);
        assert.ok(error.candidates.includes("awsf-plan"), error.candidates.join(", "));
        return true;
      },
    );
    await assert.rejects(
      resolvePlanRef({ repository: box.root, stateRoot: box.stateRoot, project: PROJECT, stem: "awsf-plan" }),
      PlanRefNoCatalog,
    );
  } finally { box.close(); }
});

test("a retry CARRIES its plan, because attempt 2 is the same work on the same plan while the group is not", async () => {
  // The decision D3 does not cover, and its reason is in this test's name on
  // purpose. A group answers "which driving session minted this attempt", and a
  // retry is minted by whichever session runs it — so it inherits nothing. A
  // plan answers "what work is this", and a retry is the same work.
  const box = sandbox("retry-carry");
  const projection = createDashboardProjection(box.stateRoot);
  try {
    const created = await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "carried-task",
      planRef: "awsf-v2-plan", groupId: "drive-a",
      repository: box.root, request: "prove the asymmetry", workflow: "build", tier: 1,
      sessionId: () => "carry-attempt-1", projectRecord: projection.project,
    });
    await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.updated",
      next: nextRevision(created.status, { lifecycleState: "BLOCKED", lastActivity: "blocked by the test harness" }),
    }, projection.project);

    const retried = await retryCommand({
      attemptDir: created.attemptDir, stateRoot: box.stateRoot,
      configSnapshotJson: "{}", allowance: { auto: 1, owner: 1 },
      sessionId: () => "carry-attempt-2", projectRecord: projection.project,
    });
    assert.equal(retried.status.planRef, "awsf-v2-plan", "the plan carries");
    assert.equal(retried.status.groupId, null, "the group does not");
    projection.close();

    const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.equal(getSession(db, "carry-attempt-2")?.plan_ref, "awsf-v2-plan");
      assert.equal(getSession(db, "carry-attempt-2")?.group_id, null);
    } finally { db.close(); }
  } finally { projection.close(); box.close(); }
});

test("--plan is validated as an identifier, and a record written before plan linkage reads as unlinked", async () => {
  const box = sandbox("shape");
  try {
    for (const bad of ["../escape", "with space", "", "/absolute"]) {
      await assert.rejects(
        newCommand({
          stateRoot: box.stateRoot, project: PROJECT, taskId: `plan-reject-${bad.length}`, planRef: bad,
          repository: box.root, request: "reject this plan stem", workflow: "build", tier: 1,
        }),
        /not a path-safe identifier/u,
        `--plan ${JSON.stringify(bad)} must be refused`,
      );
    }
    const created = await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "legacy-plan-task",
      repository: box.root, request: "read a pre-linkage record", workflow: "build", tier: 1,
    });
    const onDisk = JSON.parse(await readFile(statusFilePath(created.attemptDir), "utf8")) as Record<string, unknown>;
    delete onDisk.planRef;
    assert.equal(withLegacyDefaults(onDisk as unknown as AttemptStatus).planRef, null);
  } finally { box.close(); }
});
