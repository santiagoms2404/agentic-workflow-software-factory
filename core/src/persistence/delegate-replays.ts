// The replay's records, in the state root only (W19 task 7):
// `<state-root>/delegate/replays.jsonl`. Append-only. A live replay's
// stop-judgment records go beside it in `<state-root>/delegate/decisions.jsonl`,
// so no replay writes into any task.

import { join } from "node:path";
import { assertDelegateReplay, type DelegateReplayRecord } from "../delegate/replay.ts";
import { Journal } from "./journal.ts";
import { scanJournal } from "./replay.ts";

export function delegateStateDir(stateRoot: string): string {
  return join(stateRoot, "delegate");
}

export function replaysFilePath(stateRoot: string): string {
  return join(delegateStateDir(stateRoot), "replays.jsonl");
}

export async function readDelegateReplays(stateRoot: string): Promise<readonly DelegateReplayRecord[]> {
  const scanned = await scanJournal<DelegateReplayRecord>(replaysFilePath(stateRoot));
  if (!scanned.ok) throw new Error(`delegate replay journal corrupt at ${scanned.badKey}`);
  if (scanned.tornTail !== null) throw new Error(`interrupted delegate replay append at ${replaysFilePath(stateRoot)}: the file is retained unchanged`);
  return scanned.records.map((record) => {
    assertDelegateReplay(record.event);
    return record.event;
  });
}

export async function appendDelegateReplays(stateRoot: string, records: readonly DelegateReplayRecord[]): Promise<void> {
  if (records.length === 0) return;
  for (const record of records) assertDelegateReplay(record);
  const journal = new Journal<DelegateReplayRecord>(replaysFilePath(stateRoot));
  try {
    for (const record of records) await journal.append(record);
  } finally {
    await journal.close();
  }
}
