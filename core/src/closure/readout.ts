import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertClosureRecord, type ClosureRecord } from "../contracts/closure-record.ts";
import { landingJournalTail } from "../persistence/closure-tail.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import { journalFilePath, statusFilePath } from "../persistence/platform-paths.ts";
import { streamProjectClosureJournalRecords } from "../persistence/project-closure-journal.ts";
import { scanJournal } from "../persistence/replay.ts";
import { listDirectories } from "../persistence/directories.ts";
import { tryReadStatus } from "../persistence/status-store.ts";
import { deriveAttemptStatus, withLegacyDefaults, type AttemptEvent, type AttemptStatus } from "../cli/commands/attempt.ts";
import { LANDED_STATES } from "../state/task-machine.ts";

import { CLOSURE_CUT, closureReadout, closureRecordMatches, hasTicketSelection, type ClosureReadout, type LandingClosureFact } from "./model.ts";
export { CLOSURE_CUT, closureReadout, hasTicketSelection, unclosedLandings, closeArgv } from "./model.ts";
export type { ClosureState, ClosureReadout, LandingClosureFact } from "./model.ts";

export type LandingJournalReader = (attemptDir: string, projection: AttemptStatus) => Promise<readonly JournalRecord<AttemptEvent>[]>;

async function readTailClosure(attemptDir: string, status: AttemptStatus, rows: readonly JournalRecord<AttemptEvent>[]): Promise<ClosureReadout> {
  let latest: ClosureRecord | null = null;
  const consider = (record: ClosureRecord): void => {
    assertClosureRecord(record);
    if (closureRecordMatches(status, record)) latest = record;
  };
  for (const row of rows) if (row.event.evidence?.type === "closure-record") consider(row.event.evidence.record);
  const projectDir = resolve(attemptDir, "..", "..", "..");
  for await (const row of streamProjectClosureJournalRecords(projectDir)) {
    if (row.event.project !== status.project || resolve(row.event.repository) !== resolve(status.repository)) continue;
    if (row.event.evidence.type === "closure-record") consider(row.event.evidence.record);
  }
  return closureReadout(status, latest === null ? [] : [latest]);
}

/** A pre-landing projection rules out closure evidence without opening any journal. */
export async function readClosure(attemptDir: string, status: AttemptStatus,
  readJournal: LandingJournalReader = landingJournalTail): Promise<ClosureReadout> {
  if (!isLanded(status) || !hasTicketSelection(status)) {
    return { state: "not closed", record: null };
  }
  return readTailClosure(attemptDir, status, await readJournal(attemptDir, status));
}

const isLanded = (status: AttemptStatus): boolean => (LANDED_STATES as readonly string[]).includes(status.lifecycleState);

/** status.json, or why it could not be read. Never throws: a projection is not the truth (B4-01). */
async function readProjection(dir: string): Promise<{ status: AttemptStatus | null; problem: string | null }> {
  try {
    const status = await tryReadStatus<AttemptStatus>(statusFilePath(dir));
    return status === null ? { status: null, problem: "status.json is missing" } : { status: withLegacyDefaults(status), problem: null };
  } catch (error) {
    return { status: null, problem: `status.json is unreadable (${(error as Error).message})` };
  }
}

/** The torn line's own claim, when it is one whole record: what the writer would adopt on its next append. */
function tornClaimsLanding(text: string): boolean {
  try { return isLanded((JSON.parse(text) as JournalRecord<AttemptEvent>).event.next); }
  catch { return false; }
}

/**
 * All attempts of this project only.
 *
 * Whether an attempt landed is read from its journal, not from status.json (B4-01). The journal is
 * the truth and the status a projection written after the append (runWriteProtocol), so a crash
 * between the two leaves status.json one record behind, and a crash before the first status write
 * leaves none at all. Deciding from the projection hid such a landing from the inventory, or threw
 * for every attempt in the project. Now a missing, unreadable or lagging status.json degrades only
 * its own entry, named in `degraded`, and the entry is still read from the journal.
 *
 * A torn tail (an append the crash cut short, `scanJournal`) is never acknowledged, so the durable
 * prefix decides. It stays visible in `degraded` and does not stop the inventory, with one refusal:
 * when the prefix has not landed but the torn line is a whole record claiming the landing, the
 * landing is undecided until the writer adopts that line, so the inventory refuses by name rather
 * than silently skip it. A corrupt or unreadable journal (a gap, a blank or non-JSON line, a denied
 * read) cannot say whether the attempt landed; only a readable projection that has not landed lets
 * the inventory pass it by, which is what it did before it opened journals at all.
 */
export async function gatherLandingClosures(stateRoot: string, project: string,
  readJournal: LandingJournalReader = landingJournalTail): Promise<readonly LandingClosureFact[]> {
  const facts: LandingClosureFact[] = [];
  const tasks = join(stateRoot, "projects", project, "tasks");
  for (const task of await listDirectories(tasks)) for (const attempt of await listDirectories(join(tasks, task))) {
    const dir = join(tasks, task, attempt);
    // Task-level report directories and incomplete directories are not attempts.
    try { await access(journalFilePath(dir)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const scan = await scanJournal<AttemptEvent>(journalFilePath(dir)).catch((error: Error) =>
      ({ ok: false as const, badKey: "journal.jsonl", detail: `unreadable (${error.message})` }));
    if (!scan.ok) {
      const projection = (await readProjection(dir)).status;
      if (projection !== null && !isLanded(projection)) continue;
      throw new Error(`closure inventory refuses a corrupt attempt journal at ${scan.badKey}: ${scan.detail}`);
    }
    const derived = deriveAttemptStatus(scan.records);
    if (derived === null) continue;
    if (!isLanded(derived)) {
      if (scan.tornTail !== null && tornClaimsLanding(scan.tornTail.text)) {
        throw new Error(`closure refuses a torn attempt journal: ${derived.taskId} attempt ${derived.attempt} ends in an unterminated landing record`);
      }
      continue;
    }
    if (!hasTicketSelection(derived) || Date.parse(derived.lastActivityAt) <= Date.parse(CLOSURE_CUT)) continue;
    if (derived.project !== project) throw new Error("closure inventory has no project-bound journal status");
    const degraded: string[] = [];
    const projection = await readProjection(dir);
    if (projection.problem !== null) degraded.push(`${projection.problem}; read from the journal`);
    else if (projection.status!.revision !== derived.revision) {
      degraded.push(`status.json is at revision ${projection.status!.revision} and the journal proves revision ${derived.revision}; read from the journal`);
    }
    let rows: readonly JournalRecord<AttemptEvent>[];
    if (scan.tornTail === null) rows = await readJournal(dir, derived);
    else {
      // The bounded tail reader refuses a torn file; the scan already holds the durable prefix.
      degraded.push(`journal.jsonl ends in ${Buffer.byteLength(scan.tornTail.text, "utf8")} unterminated byte(s) at offset ${scan.tornTail.byteOffset}; read from the durable prefix`);
      const from = scan.records.findLastIndex(row => row.event.kind === "attempt.transitioned" && row.event.next.lifecycleState === "LANDED");
      rows = from < 0 ? [] : scan.records.slice(from);
    }
    const landing = rows.find(row => row.event.kind === "attempt.transitioned" && row.event.next.lifecycleState === "LANDED");
    if (landing === undefined || !Number.isFinite(Date.parse(landing.event.next.lastActivityAt))) {
      throw new Error(`closure inventory has no landing time for ${derived.taskId} attempt ${derived.attempt}`);
    }
    facts.push({ project, taskId: derived.taskId, attempt: derived.attempt,
      landedAt: landing.event.next.lastActivityAt, hasSelection: true, closure: await readTailClosure(dir, derived, rows),
      ...(degraded.length > 0 ? { degraded } : {}) });
  }
  return facts.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.attempt - b.attempt);
}
