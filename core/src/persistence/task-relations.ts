// A task's continuation declarations, stored where the task is — not on one of
// its attempts.
//
// `awsf relate` calls the relationship TASK-scoped, and the first cut stored it
// on the task's newest attempt because that is where a task's current facts
// happen to live. That was wrong in a way only real data showed: an attempt in
// BLOCKED, CANCELLED or PUBLISHED is sealed, so `relate` refused, and on the
// owner's real projection twenty-two of forty-four runs were BLOCKED. Half the
// history could never record "this task continued that one" after the fact,
// which is precisely when the relationship is usually learned.
//
// So the record sits beside the attempt directories rather than inside one. It
// touches no sealed bytes, it needs no attempt to be writable, and it survives
// `awsf db rebuild` because the rebuild reads it the same way the live command
// does. `awsf new --continues` still writes the attempt field — a different act
// with a different record — and the read rule below says which wins.

import { join } from "node:path";
import { Journal } from "./journal.ts";
import { scanJournal } from "./replay.ts";

export interface TaskRelation {
  readonly schema: "awsf/task-relation/v1";
  readonly project: string;
  readonly taskId: string;
  readonly continuesTask: string;
  /** The driver's written reason. Recorded here; never sent to a provider. */
  readonly reason: string;
  readonly at: string;
}

export function relationsFilePath(taskRoot: string): string {
  return join(taskRoot, "relations.jsonl");
}

/**
 * Every declaration this task has recorded, oldest first.
 *
 * A missing file is zero declarations, not an error: almost every task has
 * none. A torn tail refuses rather than silently dropping the last record,
 * because a half-written declaration is exactly the case where guessing is
 * worst.
 */
export async function readTaskRelations(taskRoot: string): Promise<readonly TaskRelation[]> {
  const scanned = await scanJournal<TaskRelation>(relationsFilePath(taskRoot));
  if (!scanned.ok) throw new Error(`task relation journal corrupt at ${scanned.badKey}`);
  if (scanned.tornTail !== null) {
    throw new Error(`interrupted task relation append at ${relationsFilePath(taskRoot)}: the file is retained unchanged`);
  }
  return scanned.records.map((record) => record.event);
}

/** The declaration in force, or null. The latest wins; none is not an error. */
export async function declaredContinuation(taskRoot: string): Promise<TaskRelation | null> {
  return (await readTaskRelations(taskRoot)).at(-1) ?? null;
}

export async function appendTaskRelation(taskRoot: string, relation: TaskRelation): Promise<void> {
  const journal = new Journal<TaskRelation>(relationsFilePath(taskRoot));
  try {
    await journal.append(relation);
  } finally {
    await journal.close();
  }
}
