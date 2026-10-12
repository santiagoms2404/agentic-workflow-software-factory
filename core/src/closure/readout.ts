import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertClosureRecord, type ClosureRecord } from "../contracts/closure-record.ts";
import { landingJournalTail } from "../persistence/closure-tail.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import { streamProjectClosureJournalRecords } from "../persistence/project-closure-journal.ts";
import { readAttempt, type AttemptEvent, type AttemptStatus } from "../cli/commands/attempt.ts";

import { CLOSURE_CUT, closureReadout, hasTicketSelection, type ClosureReadout, type LandingClosureFact } from "./model.ts";
export { CLOSURE_CUT, closureReadout, hasTicketSelection, unclosedLandings, closeArgv } from "./model.ts";
export type { ClosureState, ClosureReadout, LandingClosureFact } from "./model.ts";

export type LandingJournalReader = (attemptDir: string, projection: AttemptStatus) => Promise<readonly JournalRecord<AttemptEvent>[]>;

async function readTailClosure(attemptDir: string, status: AttemptStatus, rows: readonly JournalRecord<AttemptEvent>[]): Promise<ClosureReadout> {
  let result: ClosureReadout = { state: "not closed", record: null };
  const consider = (record: ClosureRecord): void => {
    assertClosureRecord(record);
    const matched = closureReadout(status, [record]);
    if (matched.record !== null) result = matched;
  };
  for (const row of rows) if (row.event.evidence?.type === "closure-record") consider(row.event.evidence.record);
  const projectDir = resolve(attemptDir, "..", "..", "..");
  for await (const row of streamProjectClosureJournalRecords(projectDir)) {
    if (row.event.project !== status.project || resolve(row.event.repository) !== resolve(status.repository)) continue;
    if (row.event.evidence.type === "closure-record") consider(row.event.evidence.record);
  }
  return result;
}

/** A pre-landing projection rules out closure evidence without opening any journal. */
export async function readClosure(attemptDir: string, status: AttemptStatus,
  readJournal: LandingJournalReader = landingJournalTail): Promise<ClosureReadout> {
  if ((status.lifecycleState !== "LANDED" && status.lifecycleState !== "PUBLISHED") || !hasTicketSelection(status)) {
    return { state: "not closed", record: null };
  }
  return readTailClosure(attemptDir, status, await readJournal(attemptDir, status));
}

async function directories(path: string): Promise<string[]> {
  try { return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

/** All attempts of this project only; projections rule out irrelevant journals. */
export async function gatherLandingClosures(stateRoot: string, project: string,
  readJournal: LandingJournalReader = landingJournalTail): Promise<readonly LandingClosureFact[]> {
  const facts: LandingClosureFact[] = [];
  const tasks = join(stateRoot, "projects", project, "tasks");
  for (const task of await directories(tasks)) for (const attempt of await directories(join(tasks, task))) {
    const dir = join(tasks, task, attempt);
    // Task-level report directories and incomplete directories are not attempts.
    try { await access(join(dir, "journal.jsonl")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const projection = await readAttempt(dir);
    if (projection.lifecycleState !== "LANDED" && projection.lifecycleState !== "PUBLISHED") continue;
    if (!hasTicketSelection(projection) || Date.parse(projection.lastActivityAt) <= Date.parse(CLOSURE_CUT)) continue;
    if (projection.project !== project) throw new Error("closure inventory has no project-bound journal status");
    const rows = await readJournal(dir, projection);
    const landing = rows.find(row => row.event.kind === "attempt.transitioned" && row.event.next.lifecycleState === "LANDED");
    if (landing === undefined || !Number.isFinite(Date.parse(landing.event.next.lastActivityAt))) {
      throw new Error(`closure inventory has no landing time for ${projection.taskId} attempt ${projection.attempt}`);
    }
    facts.push({ project, taskId: projection.taskId, attempt: projection.attempt,
      landedAt: landing.event.next.lastActivityAt, hasSelection: true, closure: await readTailClosure(dir, projection, rows) });
  }
  return facts.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.attempt - b.attempt);
}
