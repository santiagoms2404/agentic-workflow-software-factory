import { readFile, open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { AttemptLock } from "./attempt-lock.ts";
import { Journal, type JournalRecord } from "./journal.ts";
import { assertClosureRecord } from "../contracts/closure-record.ts";
import type { ClosureEvidence } from "./closure-journal.ts";

/** Project evidence has no attempt, session or lifecycle transition. */
export interface ProjectClosureEvent {
  readonly kind: "project-closure";
  readonly project: string;
  readonly repository: string;
  readonly operationKey: string;
  readonly evidence: ClosureEvidence;
}
export type ProjectClosureProjector = (record: JournalRecord<ProjectClosureEvent>) => Promise<void> | void;
export function projectClosureJournalPath(projectDir: string): string { return join(projectDir, "closure", "journal.jsonl"); }

export async function projectClosureJournalRecords(projectDir: string): Promise<readonly JournalRecord<ProjectClosureEvent>[]> {
  let text: string;
  try { text = await readFile(projectClosureJournalPath(projectDir), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  if (!text.endsWith("\n")) throw new Error("closure refuses a torn project journal");
  const records = text.split("\n").filter(Boolean).map(line => JSON.parse(line) as JournalRecord<ProjectClosureEvent>);
  for (const [index, row] of records.entries()) {
    const event = row.event;
    if (row.source_seq !== index + 1 || event.kind !== "project-closure" || typeof event.project !== "string" ||
      typeof event.repository !== "string" || typeof event.operationKey !== "string") throw new Error("closure refuses an invalid project journal");
    if (event.evidence.type === "closure-record" || event.evidence.type === "closure-prepared") assertClosureRecord(event.evidence.record);
    else if (event.evidence.type !== "closure-intent" || !/^[a-f0-9]{40}$/u.test(event.evidence.intent.parentSha) ||
      !/^[a-f0-9]{40}$/u.test(event.evidence.intent.candidateSha) || !event.evidence.intent.id) throw new Error("closure refuses invalid project evidence");
  }
  return records;
}

/** Read-only streaming inventory: never materialize the project's journal text. */
export async function* streamProjectClosureJournalRecords(projectDir: string): AsyncGenerator<JournalRecord<ProjectClosureEvent>> {
  let handle;
  try { handle = await open(projectClosureJournalPath(projectDir), "r"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  try {
    const { size } = await handle.stat();
    const last = Buffer.alloc(1);
    if (size === 0 || (await handle.read(last, 0, 1, size - 1)).bytesRead !== 1 || last[0] !== 0x0a) {
      throw new Error("closure refuses a torn project journal");
    }
    const lines = createInterface({ input: handle.createReadStream({ start: 0, end: size - 1, autoClose: false }), crlfDelay: Infinity });
    try {
      let seq = 0;
      for await (const line of lines) {
        if (!line) continue;
        const row = JSON.parse(line) as JournalRecord<ProjectClosureEvent>;
        const event = row.event;
        if (row.source_seq !== ++seq || event.kind !== "project-closure" || typeof event.project !== "string" ||
          typeof event.repository !== "string" || typeof event.operationKey !== "string") throw new Error("closure refuses an invalid project journal");
        if (event.evidence.type === "closure-record" || event.evidence.type === "closure-prepared") assertClosureRecord(event.evidence.record);
        else if (event.evidence.type !== "closure-intent" || !/^[a-f0-9]{40}$/u.test(event.evidence.intent.parentSha) ||
          !/^[a-f0-9]{40}$/u.test(event.evidence.intent.candidateSha) || !event.evidence.intent.id) throw new Error("closure refuses invalid project evidence");
        yield row;
      }
    } finally { lines.close(); }
  } finally { await handle.close(); }
}

export async function withProjectClosureJournal<T>(projectDir: string, identity: Omit<ProjectClosureEvent, "kind" | "evidence">,
  project: ProjectClosureProjector | undefined,
  act: (records: readonly JournalRecord<ProjectClosureEvent>[], append: (evidence: ClosureEvidence) => Promise<void>, reconcile: () => Promise<void>) => Promise<T>): Promise<T> {
  return new AttemptLock(join(projectDir, "closure", "lock")).withLock(async () => {
    const records = await projectClosureJournalRecords(projectDir);
    if (records.some(row => row.event.project !== identity.project || row.event.repository !== identity.repository)) throw new Error("closure project journal identity differs");
    const journal = new Journal<ProjectClosureEvent>(projectClosureJournalPath(projectDir));
    const append = async (evidence: ClosureEvidence): Promise<void> => {
      const record = await journal.append({ kind: "project-closure", ...identity, evidence });
      await project?.(record);
    };
    const reconcile = async (): Promise<void> => { for (const record of records) await project?.(record); };
    try { return await act(records, append, reconcile); }
    finally { await journal.close(); }
  });
}
