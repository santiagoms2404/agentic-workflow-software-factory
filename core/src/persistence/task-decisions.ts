// The Jev decision records for a task, stored where the task is (W19 DD3).
//
// Task-scoped like `attributions.jsonl`: a call can be made for a stop, a phase
// hook, a tool or the replay, so the record sits beside the attempt directories
// rather than inside one attempt's journal, and `awsf db rebuild` replays it by
// reading this same file. Append-only; a record is never corrected in place.

import { join } from "node:path";
import { assertDecisionRecord, type DecisionRecord } from "../contracts/decision-record.ts";
import { Journal } from "./journal.ts";
import { scanJournal } from "./replay.ts";

export function decisionsFilePath(taskRoot: string): string {
  return join(taskRoot, "decisions.jsonl");
}

/**
 * Every decision record this task has, oldest first. A missing file is zero
 * records. A torn tail refuses rather than dropping the last record.
 */
export async function readTaskDecisions(taskRoot: string): Promise<readonly DecisionRecord[]> {
  const scanned = await scanJournal<DecisionRecord>(decisionsFilePath(taskRoot));
  if (!scanned.ok) throw new Error(`task decision journal corrupt at ${scanned.badKey}`);
  if (scanned.tornTail !== null) {
    throw new Error(`interrupted task decision append at ${decisionsFilePath(taskRoot)}: the file is retained unchanged`);
  }
  return scanned.records.map((record) => {
    assertDecisionRecord(record.event);
    return record.event;
  });
}

export async function appendTaskDecision(taskRoot: string, record: DecisionRecord): Promise<void> {
  assertDecisionRecord(record);
  const journal = new Journal<DecisionRecord>(decisionsFilePath(taskRoot));
  try {
    await journal.append(record);
  } finally {
    await journal.close();
  }
}
