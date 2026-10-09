import { readFile } from "node:fs/promises";
import { AttemptLock } from "./attempt-lock.ts";
import { Journal, type JournalRecord } from "./journal.ts";
import { journalFilePath, lockFilePath, statusFilePath } from "./platform-paths.ts";
import { writeStatus } from "./status-store.ts";
import { deriveAttemptStatus, nextRevision, type AttemptEvent, type AttemptProjector, type AttemptStatus } from "../cli/commands/attempt.ts";
import type { AttemptEvidence } from "../observability/attempt-evidence.ts";

export type ClosureEvidence = Extract<AttemptEvidence, { type: "closure-intent" | "closure-prepared" | "closure-record" }>;

export async function closureJournalRecords(attemptDir: string): Promise<readonly JournalRecord<AttemptEvent>[]> {
  const text = await readFile(journalFilePath(attemptDir), "utf8");
  if (!text.endsWith("\n")) throw new Error("closure refuses a torn attempt journal");
  const records = text.split("\n").filter(Boolean).map(line => JSON.parse(line) as JournalRecord<AttemptEvent>);
  if (records.some((record, index) => record.source_seq !== index + 1 || record.event.next.revision !== record.source_seq)) {
    throw new Error("closure refuses a non-contiguous attempt journal");
  }
  return records;
}

/** Narrow post-LANDED evidence writer. It cannot move lifecycle, candidate, selection or budget. */
export async function withClosureJournal<T>(attemptDir: string, project: AttemptProjector | undefined,
  act: (status: AttemptStatus, records: readonly JournalRecord<AttemptEvent>[], append: (evidence: ClosureEvidence) => Promise<void>, reconcile: () => Promise<void>) => Promise<T>): Promise<T> {
  return new AttemptLock(lockFilePath(attemptDir)).withLock(async () => {
    const records = await closureJournalRecords(attemptDir);
    let status = deriveAttemptStatus(records);
    if (status === null || status.lifecycleState !== "LANDED") throw new Error("closure requires a LANDED attempt");
    const journal = new Journal<AttemptEvent>(journalFilePath(attemptDir));
    const append = async (evidence: ClosureEvidence): Promise<void> => {
      const next = nextRevision(status!, { lastActivity: evidence.type, lastActivityAt: evidence.type === "closure-intent" ? evidence.intent.at : evidence.record.at });
      const record = await journal.append({ kind: "attempt.updated", next, evidence });
      status = next;
      await writeStatus(statusFilePath(attemptDir), next);
      await project?.(record, next);
    };
    const reconcile = async (): Promise<void> => {
      // Replay only this act's durable evidence; the ordinary attempt writer stays sealed.
      for (const record of records) {
        const type = record.event.evidence?.type;
        if (type === "closure-intent" || type === "closure-prepared" || type === "closure-record") await project?.(record, record.event.next);
      }
      await writeStatus(statusFilePath(attemptDir), status!);
    };
    try { return await act(status, records, append, reconcile); }
    finally { await journal.close(); }
  });
}
