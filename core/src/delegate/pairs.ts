// Reads a task's live pairs from disk (W19 task 6). A thin loader around the
// pure pairing: the task's delegate.jsonl and each attempt's journal.jsonl,
// read fresh on every call. Nothing is cached or tallied.

import { join } from "node:path";
import type { AttemptEvent } from "../cli/commands/attempt.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import { journalFilePath } from "../persistence/platform-paths.ts";
import { scanJournal } from "../persistence/replay.ts";
import { readTaskDelegateProposals } from "../persistence/task-delegate.ts";
import { pairTask, type Pair } from "./agreement.ts";

/** `<taskRoot>/<attempt>/`, the directory `awsf new` and `awsf retry` create. */
export function taskAttemptDir(taskRoot: string, attempt: number): string {
  return join(taskRoot, String(attempt));
}

export async function readLivePairs(taskRoot: string): Promise<Pair[]> {
  const proposals = await readTaskDelegateProposals(taskRoot);
  const journals = new Map<number, readonly JournalRecord<AttemptEvent>[]>();
  for (const attempt of new Set(proposals.map((proposal) => proposal.attempt))) {
    const scanned = await scanJournal<AttemptEvent>(journalFilePath(taskAttemptDir(taskRoot, attempt)));
    if (!scanned.ok) throw new Error(`attempt journal corrupt at ${scanned.badKey}`);
    journals.set(attempt, scanned.records);
  }
  return pairTask(proposals, (attempt) => journals.get(attempt) ?? [], "live");
}
