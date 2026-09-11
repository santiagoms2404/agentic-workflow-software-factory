// `awsf relate` — the after-the-fact continuation declaration. Every refusal
// below asserts on the message, not only the error class, because D5 requires
// each one to name what it read: a refusal that says "invalid" leaves the
// driver guessing which of the five rules they hit.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import {
  locateAttempt,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptProjector,
  type AttemptStatus,
} from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { relateCommand, resolveContinues } from "../../../src/cli/commands/relate.ts";
import { getSession } from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { OWNER_ACTS } from "../../../../docs/driving/marimba/marimba-guard-rules.mts";

const PROJECT = "agentic-workflow-software-factory";

function sandbox(label: string): { root: string; stateRoot: string; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), `awsf-relate-${label}-`));
  return { root, stateRoot: join(root, "state"), close: () => rmSync(root, { recursive: true, force: true }) };
}

async function task(
  stateRoot: string,
  root: string,
  taskId: string,
  extra: { continuesTask?: string; sessionId?: string; projectRecord?: AttemptProjector } = {},
): Promise<{ attemptDir: string; status: AttemptStatus }> {
  const sessionId = extra.sessionId;
  return newCommand({
    stateRoot, project: PROJECT, taskId, repository: root,
    request: `open ${taskId}`, workflow: "build", tier: 1,
    ...(extra.continuesTask === undefined ? {} : { continuesTask: extra.continuesTask }),
    ...(sessionId === undefined ? {} : { sessionId: (): string => sessionId }),
    ...(extra.projectRecord === undefined ? {} : { projectRecord: extra.projectRecord }),
  });
}

test("relate records the declaration, the reason, and the projected edge", async () => {
  const box = sandbox("records");
  const projection = createDashboardProjection(box.stateRoot);
  try {
    await task(box.stateRoot, box.root, "prior-task", { sessionId: "prior-session", projectRecord: projection.project });
    await task(box.stateRoot, box.root, "later-task", { sessionId: "later-session", projectRecord: projection.project });
    const located = await locateAttempt(box.stateRoot, PROJECT, "later-task");
    const before = await readAttempt(located.attemptDir);
    assert.equal(before.continuesTask, null);

    const result = await relateCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "later-task",
      continues: "prior-task", reason: "prior-task blocked on the seam this one fixes",
      projectRecord: projection.project, now: () => "2026-09-10T10:00:00.000Z",
    });
    assert.equal(result.continuesTask, "prior-task");
    assert.equal(result.status.continuesTask, "prior-task");
    assert.match(result.status.lastActivity, /continues prior-task: prior-task blocked on the seam this one fixes/u);
    // A record, not a state change: the lifecycle is where it was and the
    // recommendation still points at the same next command.
    assert.equal(result.status.lifecycleState, before.lifecycleState);
    assert.equal(result.status.nextAction, before.nextAction);
    projection.close();

    const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.equal(getSession(db, result.status.sessionId)?.continues_task, "prior-task");
      const row = db.prepare("SELECT name, payload_json FROM events WHERE type = 'task_relation'").get() as
        | { name: string; payload_json: string } | undefined;
      assert.equal(row?.name, "task continuation declared");
      assert.match(row?.payload_json ?? "", /prior-task blocked on the seam this one fixes/u);
    } finally { db.close(); }
  } finally { projection.close(); box.close(); }
});

test("relate refuses self-reference and names what --continues read", async () => {
  const box = sandbox("self");
  try {
    await task(box.stateRoot, box.root, "solo-task");
    await assert.rejects(
      relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "solo-task", continues: "solo-task", reason: "loop" }),
      /cannot continue itself; --continues read "solo-task"/u,
    );
  } finally { box.close(); }
});

test("relate refuses a missing predecessor and names the path it found nothing at", async () => {
  const box = sandbox("missing");
  try {
    await task(box.stateRoot, box.root, "present-task");
    await assert.rejects(
      relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "present-task", continues: "never-existed", reason: "records an edge" }),
      /cannot continue missing task .*\/never-existed; no attempt directory exists under "never-existed"/u,
    );
  } finally { box.close(); }
});

test("relate refuses a cycle and prints the chain already on record", async () => {
  const box = sandbox("cycle");
  try {
    // a <- b <- c, then asking a to continue c closes the loop.
    await task(box.stateRoot, box.root, "a");
    await task(box.stateRoot, box.root, "b", { continuesTask: "a" });
    await task(box.stateRoot, box.root, "c", { continuesTask: "b" });
    await assert.rejects(
      relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "a", continues: "c", reason: "close the loop" }),
      /that would close a cycle\. The declarations already on record read c -> b -> a -> a/u,
    );
    // And the one-hop case, which a naive "is the target my own predecessor"
    // check catches but a chain walk must also catch.
    await assert.rejects(
      relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "a", continues: "b", reason: "close a shorter loop" }),
      /would close a cycle/u,
    );
  } finally { box.close(); }
});

test("relate refuses a cross-project link rather than reinterpreting it as a local one", async () => {
  const box = sandbox("cross");
  try {
    await task(box.stateRoot, box.root, "local-task");
    await task(box.stateRoot, box.root, "prior-task");
    await assert.rejects(
      relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "local-task", continues: "other-project/prior-task", reason: "reach across" }),
      /which names project "other-project"; .* may only continue a task in/u,
    );
    // A qualified name for THIS project is the same edge spelled longer, and is
    // accepted rather than refused on punctuation.
    assert.equal(resolveContinues(PROJECT, "local-task", `${PROJECT}/prior-task`), "prior-task");
    assert.equal(resolveContinues(PROJECT, "local-task", "prior-task"), "prior-task");
  } finally { box.close(); }
});

test("relate refuses to overwrite an existing declaration and names the one it found", async () => {
  const box = sandbox("overwrite");
  try {
    await task(box.stateRoot, box.root, "first-prior");
    await task(box.stateRoot, box.root, "second-prior");
    await task(box.stateRoot, box.root, "declared", { continuesTask: "first-prior" });
    await assert.rejects(
      relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "declared", continues: "second-prior", reason: "change my mind" }),
      /already continues .*\/first-prior; a declaration is not overwritten/u,
    );
    const located = await locateAttempt(box.stateRoot, PROJECT, "declared");
    assert.equal((await readAttempt(located.attemptDir)).continuesTask, "first-prior", "the refused write changed nothing");
  } finally { box.close(); }
});

test("relate refuses a sealed attempt rather than reopening it to carry the edge", async () => {
  const box = sandbox("sealed");
  try {
    await task(box.stateRoot, box.root, "prior-task");
    const created = await task(box.stateRoot, box.root, "cancelled-task");
    await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.updated",
      next: nextRevision(created.status, { lifecycleState: "CANCELLED", lastActivity: "cancelled by the test harness" }),
    });
    await assert.rejects(
      relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "cancelled-task", continues: "prior-task", reason: "late edge" }),
      /attempt 1 is CANCELLED, whose bytes are sealed/u,
    );
  } finally { box.close(); }
});

test("relate requires a written reason and refuses a credential-shaped one", async () => {
  const box = sandbox("reason");
  try {
    await task(box.stateRoot, box.root, "prior-task");
    await task(box.stateRoot, box.root, "later-task");
    await assert.rejects(
      relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "later-task", continues: "prior-task", reason: "   " }),
      /requires --reason naming why this task continues the prior one/u,
    );
    await assert.rejects(
      relateCommand({
        stateRoot: box.stateRoot, project: PROJECT, taskId: "later-task", continues: "prior-task",
        reason: `continues the work behind ghp_${"a".repeat(36)}`,
      }),
      /credential-shaped data is never persisted/u,
    );
  } finally { box.close(); }
});

test("relate is not an owner act: a driving session already holds the authority it needs", () => {
  // D5. `awsf new --continues` declares the same edge, and marimba's guard
  // denies owner acts by VERB, so adding `relate` to that list would deny a
  // driving session an authority it demonstrably already has.
  assert.equal((OWNER_ACTS as readonly string[]).includes("relate"), false);
});
