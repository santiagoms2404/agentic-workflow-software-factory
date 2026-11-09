// B9-04: two `awsf relate` declarations for one task, made at the same time.
//
// Both used to pass the existing-declaration check before either appended, and
// each append opened its own Journal, which reads the file tail once per
// instance — so both records were stamped source_seq 1. The next read of the
// task's relations then threw "task relation journal corrupt", and `awsf
// status` threw with it for every attempt of the task. Even when the seqs came
// out 1 and 2, the later declaration silently took effect, breaking relate's
// refuses-rather-than-overwrites promise.
//
// The race is repeated over several tasks because one pair of calls can
// interleave either way; eight pairs make the broken interleaving all but
// certain, and the fixed code must hold for every one of them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskRoot } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { declaredContinuation, relateCommand, relationLockPath } from "../../../src/cli/commands/relate.ts";
import { AttemptLock } from "../../../src/persistence/attempt-lock.ts";
import { readTaskRelations, relationsFilePath } from "../../../src/persistence/task-relations.ts";

const PROJECT = "agentic-workflow-software-factory";
const RACES = 8;

function sandbox(label: string): { root: string; stateRoot: string; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), `awsf-relate-race-${label}-`));
  return { root, stateRoot: join(root, "state"), close: () => rmSync(root, { recursive: true, force: true }) };
}

async function task(stateRoot: string, root: string, taskId: string): Promise<void> {
  await newCommand({
    stateRoot, project: PROJECT, taskId, repository: root,
    request: `open ${taskId}`, workflow: "build", tier: 1,
  });
}

/** The source_seq of every line actually on disk, read without the journal's own validation. */
function storedSeqs(file: string): number[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => (JSON.parse(line) as { source_seq: number }).source_seq);
}

/** A loser may only lose by name: the declaration already on record, or the lock its rival holds. */
function refusedByName(reason: unknown): boolean {
  const error = reason as NodeJS.ErrnoException;
  if (error.name === "RelateAlreadyDeclared") return true;
  return error.code === "EEXIST" && String(error.message).includes("relations.lock");
}

test("two concurrent relates on one task never duplicate source_seq, and relations.jsonl still parses", async () => {
  const box = sandbox("pair");
  try {
    await task(box.stateRoot, box.root, "prior-a");
    await task(box.stateRoot, box.root, "prior-b");
    const outcomes: { fulfilled: number; namedRefusals: number; seqs: number[]; read: string }[] = [];
    for (let race = 0; race < RACES; race += 1) {
      const taskId = `later-${race}`;
      await task(box.stateRoot, box.root, taskId);
      const settled = await Promise.allSettled([
        relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId, continues: "prior-a", reason: "pane one" }),
        relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId, continues: "prior-b", reason: "pane two" }),
      ]);
      const root = taskRoot(box.stateRoot, PROJECT, taskId);
      let read: string;
      try {
        read = `ok:${(await readTaskRelations(root)).length}`;
      } catch (error) {
        read = `threw:${(error as Error).message}`;
      }
      outcomes.push({
        fulfilled: settled.filter((outcome) => outcome.status === "fulfilled").length,
        namedRefusals: settled.filter((outcome) => outcome.status === "rejected" && refusedByName(outcome.reason)).length,
        seqs: storedSeqs(relationsFilePath(root)),
        read,
      });
    }
    // Exactly one declaration wins each race, the other is refused by name,
    // the file holds exactly one record at seq 1, and it reads back cleanly.
    assert.deepEqual(outcomes.map((outcome) => outcome.seqs), Array.from({ length: RACES }, () => [1]));
    assert.deepEqual(outcomes.map((outcome) => outcome.read), Array.from({ length: RACES }, () => "ok:1"));
    assert.deepEqual(outcomes.map((outcome) => outcome.fulfilled), Array.from({ length: RACES }, () => 1));
    assert.deepEqual(outcomes.map((outcome) => outcome.namedRefusals), Array.from({ length: RACES }, () => 1));
  } finally { box.close(); }
});

test("a single relate still appends at the next seq, releases its lock, and a second one is refused unchanged", async () => {
  const box = sandbox("single");
  try {
    await task(box.stateRoot, box.root, "prior-task");
    await task(box.stateRoot, box.root, "other-prior");
    await task(box.stateRoot, box.root, "later-task");
    const root = taskRoot(box.stateRoot, PROJECT, "later-task");

    const result = await relateCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "later-task", continues: "prior-task", reason: "the first",
    });
    assert.equal(result.continuesTask, "prior-task");
    assert.deepEqual(storedSeqs(relationsFilePath(root)), [1]);
    assert.equal(existsSync(relationLockPath(root)), false, "the relation lock is released once the declaration is durable");

    await assert.rejects(
      relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "later-task", continues: "other-prior", reason: "the second" }),
      (error: Error) => error.name === "RelateAlreadyDeclared" && /already continues .*\/prior-task/u.test(error.message),
    );
    assert.deepEqual(storedSeqs(relationsFilePath(root)), [1]);
    assert.equal(await declaredContinuation(box.stateRoot, PROJECT, "later-task"), "prior-task");
  } finally { box.close(); }
});

test("while another writer holds the task's relation lock, relate refuses by the lock's name and writes nothing", async () => {
  const box = sandbox("held");
  try {
    await task(box.stateRoot, box.root, "prior-task");
    await task(box.stateRoot, box.root, "later-task");
    const root = taskRoot(box.stateRoot, PROJECT, "later-task");

    await new AttemptLock(relationLockPath(root)).withLock(async () => {
      await assert.rejects(
        relateCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "later-task", continues: "prior-task", reason: "blocked" }),
        (error: NodeJS.ErrnoException) => error.code === "EEXIST" && error.message.includes(relationLockPath(root)),
      );
    });
    assert.deepEqual(storedSeqs(relationsFilePath(root)), [], "a refused declaration leaves no record behind");

    // Once the holder lets go, the same declaration goes through.
    const result = await relateCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "later-task", continues: "prior-task", reason: "unblocked",
    });
    assert.equal(result.relation.reason, "unblocked");
    assert.deepEqual(storedSeqs(relationsFilePath(root)), [1]);
  } finally { box.close(); }
});
