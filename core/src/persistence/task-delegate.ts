// The Delegate's records for a task, stored where the task is (W19 task 5).
//
// Task-scoped like decisions.jsonl: `delegate.jsonl` sits beside the attempt
// directories and holds one `delegate.proposal` per stop. Append-only; a
// record is never corrected in place.

import { join } from "node:path";
import { assertDelegateProposal, type DelegateProposalRecord } from "../delegate/proposal.ts";
import { Journal } from "./journal.ts";
import { scanJournal } from "./replay.ts";

export function delegateFilePath(taskRoot: string): string {
  return join(taskRoot, "delegate.jsonl");
}

/** Every proposal this task has, oldest first. A missing file is zero records; a torn tail refuses. */
export async function readTaskDelegateProposals(taskRoot: string): Promise<readonly DelegateProposalRecord[]> {
  const scanned = await scanJournal<DelegateProposalRecord>(delegateFilePath(taskRoot));
  if (!scanned.ok) throw new Error(`task delegate journal corrupt at ${scanned.badKey}`);
  if (scanned.tornTail !== null) {
    throw new Error(`interrupted task delegate append at ${delegateFilePath(taskRoot)}: the file is retained unchanged`);
  }
  return scanned.records.map((record) => {
    assertDelegateProposal(record.event);
    return record.event;
  });
}

export async function appendTaskDelegateProposal(taskRoot: string, record: DelegateProposalRecord): Promise<void> {
  assertDelegateProposal(record);
  const journal = new Journal<DelegateProposalRecord>(delegateFilePath(taskRoot));
  try {
    await journal.append(record);
  } finally {
    await journal.close();
  }
}
