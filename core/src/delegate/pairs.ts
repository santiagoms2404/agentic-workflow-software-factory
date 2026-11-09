// Reads a task's live pairs from disk (W19 task 6). A thin loader around the
// pure pairing: the task's delegate.jsonl and each attempt's journal.jsonl,
// and, when a continue was proposed, the sibling tasks' statuses, read fresh
// on every call. Nothing is cached or tallied.

import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readDelegateReplays } from "../persistence/delegate-replays.ts";
import { effectiveReplays } from "./replay.ts";
import { latestAttemptNumber, readAttempt, type AttemptEvent } from "../cli/commands/attempt.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import { journalFilePath } from "../persistence/platform-paths.ts";
import { scanJournal } from "../persistence/replay.ts";
import { readTaskDelegateProposals } from "../persistence/task-delegate.ts";
import { pairTask, type Pair, type PairableProposal, type TaskContinuation } from "./agreement.ts";

/** `<taskRoot>/<attempt>/`, the directory `awsf new` and `awsf retry` create. */
export function taskAttemptDir(taskRoot: string, attempt: number): string {
  return join(taskRoot, String(attempt));
}

/**
 * What every other task in the same store continues, read from its latest
 * attempt's status (`awsf new --continues` records it there). This is the only
 * place a continue shows up (W19 task 15: a continuation is a new task), so it
 * is read only when some proposal is a continue. A task directory with no
 * attempt yet continues nothing.
 */
async function readContinuations(taskRoot: string, proposals: readonly PairableProposal[]): Promise<TaskContinuation[]> {
  if (!proposals.some((proposal) => proposal.proposal.act.act === "continue")) return [];
  const tasksDir = dirname(taskRoot);
  const self = basename(taskRoot);
  let entries;
  try {
    entries = await readdir(tasksDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const continuations: TaskContinuation[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === self) continue;
    const latest = await latestAttemptNumber(join(tasksDir, entry.name));
    if (latest === null) continue;
    const status = await readAttempt(taskAttemptDir(join(tasksDir, entry.name), latest));
    continuations.push({ taskId: entry.name, continuesTask: status.continuesTask });
  }
  return continuations;
}

/**
 * The task's replay pairs (task 7): its effective replays from the state
 * root's delegate/replays.jsonl, paired against the attempt journals now.
 * `taskRoot` must sit under `stateRoot` at projects/<project>/tasks/<task>.
 */
export async function readReplayPairs(stateRoot: string, project: string, taskRoot: string): Promise<Pair[]> {
  const taskId = basename(taskRoot);
  const mine = effectiveReplays(await readDelegateReplays(stateRoot)).filter((record) => record.project === project && record.taskId === taskId);
  const journals = new Map<number, readonly JournalRecord<AttemptEvent>[]>();
  for (const attempt of new Set(mine.map((record) => record.attempt))) {
    const scanned = await scanJournal<AttemptEvent>(journalFilePath(taskAttemptDir(taskRoot, attempt)));
    if (!scanned.ok) throw new Error(`attempt journal corrupt at ${scanned.badKey}`);
    journals.set(attempt, scanned.records);
  }
  return pairTask(mine, (attempt) => journals.get(attempt) ?? [], "replay", await readContinuations(taskRoot, mine));
}

export async function readLivePairs(taskRoot: string): Promise<Pair[]> {
  const proposals = await readTaskDelegateProposals(taskRoot);
  const journals = new Map<number, readonly JournalRecord<AttemptEvent>[]>();
  for (const attempt of new Set(proposals.map((proposal) => proposal.attempt))) {
    const scanned = await scanJournal<AttemptEvent>(journalFilePath(taskAttemptDir(taskRoot, attempt)));
    if (!scanned.ok) throw new Error(`attempt journal corrupt at ${scanned.badKey}`);
    journals.set(attempt, scanned.records);
  }
  return pairTask(proposals, (attempt) => journals.get(attempt) ?? [], "live", await readContinuations(taskRoot, proposals));
}
