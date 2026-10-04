// The owner's BLOCKED or CANCELLED attributions for a task's attempts, stored where the task
// is, not inside one of its attempts.
//
// An attribution is only ever made about a BLOCKED or CANCELLED attempt, and
// both are sealed. Writing the override into it would mean reopening sealed
// bytes after the fact, which is the exact wall `task-relations.ts` ran into
// for `awsf relate`. So the record sits beside the attempt directories, as the
// relation does: it touches no sealed bytes, it needs no attempt to be
// writable, and `awsf db rebuild` replays it by reading this same file.
//
// Append-only. A corrected attribution is a new record; the latest record for
// an attempt wins, and every earlier one stays on file as the history of the
// owner's judgement.

import { join } from "node:path";
import { assertAttributionRecord, type AttributionRecord } from "../contracts/attribution-record.ts";
import { Journal } from "./journal.ts";
import { scanJournal } from "./replay.ts";

export function attributionsFilePath(taskRoot: string): string {
  return join(taskRoot, "attributions.jsonl");
}

/**
 * Every attribution this task has recorded, oldest first.
 *
 * A missing file is zero records: almost every task has none. A torn tail
 * refuses rather than silently dropping the last record, because a
 * half-written override is exactly the case where guessing is worst.
 */
export async function readTaskAttributions(taskRoot: string): Promise<readonly AttributionRecord[]> {
  const scanned = await scanJournal<AttributionRecord>(attributionsFilePath(taskRoot));
  if (!scanned.ok) throw new Error(`task attribution journal corrupt at ${scanned.badKey}`);
  if (scanned.tornTail !== null) {
    throw new Error(`interrupted task attribution append at ${attributionsFilePath(taskRoot)}: the file is retained unchanged`);
  }
  return scanned.records.map((record) => {
    assertAttributionRecord(record.event);
    return record.event;
  });
}

/** The attribution in force for one attempt, or null. The latest wins. */
export async function attemptAttribution(taskRoot: string, attempt: number): Promise<AttributionRecord | null> {
  return (await readTaskAttributions(taskRoot)).findLast((record) => record.attempt === attempt) ?? null;
}

export async function appendTaskAttribution(taskRoot: string, record: AttributionRecord): Promise<void> {
  assertAttributionRecord(record);
  const journal = new Journal<AttributionRecord>(attributionsFilePath(taskRoot));
  try {
    await journal.append(record);
  } finally {
    await journal.close();
  }
}
