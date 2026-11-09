import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { createSession, projectTaskRelation, type SessionInit } from "../../../src/observability/projector.ts";

test("B4-10: subsequent attempts inherit declared task continuation when continuesTask is not passed", () => {
  const db = openDatabase(":memory:");
  try {
    const attempt1: SessionInit = {
      sessionId: "s1",
      projectSlug: "test-proj",
      taskId: "T05",
      continuesTask: null,
      groupId: null,
      planRef: null,
      attempt: 1,
      workflowId: "simple-sdlc",
      riskTier: 0,
      isProtected: false,
      requestText: "attempt 1",
      callCeiling: 10,
      configSnapshotJson: "{}",
      journalPath: "/path/attempt1/journal.jsonl",
      startedAt: "2026-08-06T00:00:00.000Z",
    };

    createSession(db, attempt1);

    // awsf relate declares continuation on the task
    projectTaskRelation(db, {
      project: "test-proj",
      taskId: "T05",
      continuesTask: "T04",
      reason: "follow-up to T04",
      at: "2026-08-06T01:00:00.000Z",
    });

    const row1 = db.prepare("SELECT continues_task FROM sessions WHERE session_id = ?").get("s1") as { continues_task: string | null };
    assert.equal(row1.continues_task, "T04", "attempt 1 received continuation from projectTaskRelation");

    // Later attempt 2 is created without explicit continuesTask
    const attempt2: SessionInit = {
      ...attempt1,
      sessionId: "s2",
      attempt: 2,
      continuesTask: null,
      requestText: "attempt 2",
      journalPath: "/path/attempt2/journal.jsonl",
      startedAt: "2026-08-06T02:00:00.000Z",
    };

    createSession(db, attempt2);

    const row2 = db.prepare("SELECT continues_task FROM sessions WHERE session_id = ?").get("s2") as { continues_task: string | null };
    assert.equal(row2.continues_task, "T04", "attempt 2 must inherit declared continuation T04 from the task");
  } finally {
    db.close();
  }
});
