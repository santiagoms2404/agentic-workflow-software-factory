import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendTaskRelation, readTaskRelations, relationsFilePath, type TaskRelation } from "../../../src/persistence/task-relations.ts";

const valid: TaskRelation = {
  schema: "awsf/task-relation/v1",
  project: "fixture",
  taskId: "source-task",
  continuesTask: "prior-task",
  reason: "Reuse the prior outcome",
  at: "2026-10-01T00:00:00.000Z",
};

test("task relation reads and appends validate the journal event shape", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-task-relations-"));
  const path = relationsFilePath(root);
  try {
    await appendTaskRelation(root, valid);
    assert.deepEqual(await readTaskRelations(root), [valid]);
    const malformed: TaskRelation = { ...valid, continuesTask: "../escape" };
    await assert.rejects(appendTaskRelation(root, malformed), /invalid task relation record/u);
    const badRow = { source_seq: 1, recorded_at: valid.at, event: malformed };
    writeFileSync(path, `${JSON.stringify(badRow)}\n`);
    const before = readFileSync(path, "utf8");
    await assert.rejects(readTaskRelations(root), /invalid task relation record/u);
    assert.equal(readFileSync(path, "utf8"), before, "a refusal leaves the append-only journal unchanged");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
