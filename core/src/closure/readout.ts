import { join, resolve } from "node:path";
import { assertClosureRecord, type ClosureRecord } from "../contracts/closure-record.ts";
import { closureJournalRecords } from "../persistence/closure-journal.ts";
import { projectClosureJournalRecords } from "../persistence/project-closure-journal.ts";
import { deriveAttemptStatus, readAttempt, type AttemptStatus } from "../cli/commands/attempt.ts";
import { discoverAttempts } from "../observability/rebuild.ts";

import { closureReadout, hasTicketSelection, type ClosureReadout, type LandingClosureFact } from "./model.ts";
export { CLOSURE_CUT, closureReadout, hasTicketSelection, unclosedLandings, closeArgv } from "./model.ts";
export type { ClosureState, ClosureReadout, LandingClosureFact } from "./model.ts";

/** Read-only projection of journal evidence, including the owner's commit form. */
export async function readClosure(attemptDir: string, status: AttemptStatus): Promise<ClosureReadout> {
  const rows = await closureJournalRecords(attemptDir);
  const records: ClosureRecord[] = [];
  for (const row of rows) if (row.event.evidence?.type === "closure-record") {
    assertClosureRecord(row.event.evidence.record);
    records.push(row.event.evidence.record);
  }
  const projectDir = resolve(attemptDir, "..", "..", "..");
  for (const row of await projectClosureJournalRecords(projectDir)) {
    if (row.event.project !== status.project || resolve(row.event.repository) !== resolve(status.repository)) continue;
    if (row.event.evidence.type === "closure-record") records.push(row.event.evidence.record);
  }
  return closureReadout(status, records);
}

/** All attempts in this project, not just each task's latest attempt or the base candidate. */
export async function gatherLandingClosures(stateRoot: string, project: string): Promise<readonly LandingClosureFact[]> {
  const facts: LandingClosureFact[] = [];
  // Discover below this project's root; never read another project's attempts.
  const projectRoot = join(stateRoot, "projects", project);
  for (const dir of await discoverAttempts(stateRoot)) {
    if (!resolve(dir).startsWith(`${resolve(projectRoot)}/tasks/`)) continue;
    // The status inventory narrows journal reads to landed attempts, as suite reuse does.
    const projection = await readAttempt(dir);
    if (projection.lifecycleState !== "LANDED" && projection.lifecycleState !== "PUBLISHED") continue;
    const rows = await closureJournalRecords(dir);
    const status = deriveAttemptStatus(rows);
    if (status === null || status.project !== project) throw new Error("closure inventory has no project-bound journal status");
    if (status.lifecycleState !== "LANDED" && status.lifecycleState !== "PUBLISHED") continue;
    const landing = rows.find(row => row.event.next.lifecycleState === "LANDED");
    if (landing === undefined || !Number.isFinite(Date.parse(landing.event.next.lastActivityAt))) {
      throw new Error(`closure inventory has no landing time for ${status.taskId} attempt ${status.attempt}`);
    }
    facts.push({ project, taskId: status.taskId, attempt: status.attempt,
      landedAt: landing.event.next.lastActivityAt, hasSelection: hasTicketSelection(status), closure: await readClosure(dir, status) });
  }
  return facts.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.attempt - b.attempt);
}
