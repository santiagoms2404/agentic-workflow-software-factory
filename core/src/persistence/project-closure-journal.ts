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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertProjectClosureRow(value: unknown, expectedSeq: number): asserts value is JournalRecord<ProjectClosureEvent> {
  if (!isRecord(value) || value.source_seq !== expectedSeq || !isRecord(value.event)) {
    throw new Error("closure refuses an invalid project journal");
  }
  const event = value.event;
  if (event.kind !== "project-closure" || typeof event.project !== "string" ||
    typeof event.repository !== "string" || typeof event.operationKey !== "string" || !isRecord(event.evidence)) {
    throw new Error("closure refuses an invalid project journal");
  }
  const evidence = event.evidence;
  if (evidence.type === "closure-record" || evidence.type === "closure-prepared") {
    assertClosureRecord(evidence.record);
    return;
  }
  const intent = evidence.intent;
  if (evidence.type !== "closure-intent" || !isRecord(intent) ||
    typeof intent.parentSha !== "string" || !/^[a-f0-9]{40}$/u.test(intent.parentSha) ||
    typeof intent.candidateSha !== "string" || !/^[a-f0-9]{40}$/u.test(intent.candidateSha) ||
    typeof intent.id !== "string" || intent.id.length === 0) {
    throw new Error("closure refuses invalid project evidence");
  }
}

export function projectClosureJournalPath(projectDir: string): string { return join(projectDir, "closure", "journal.jsonl"); }

export async function projectClosureJournalRecords(projectDir: string): Promise<readonly JournalRecord<ProjectClosureEvent>[]> {
  let text: string;
  try { text = await readFile(projectClosureJournalPath(projectDir), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  if (!text.endsWith("\n")) throw new Error("closure refuses a torn project journal");
  const lines = text.slice(0, -1).split("\n");
  const records = lines.map((line, index): JournalRecord<ProjectClosureEvent> => {
    let value: unknown;
    try { value = JSON.parse(line); }
    catch { throw new Error(`closure refuses an invalid project journal at line ${String(index + 1)}`); }
    assertProjectClosureRow(value, index + 1);
    return value;
  });
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
        seq += 1;
        let value: unknown;
        try { value = JSON.parse(line); }
        catch { throw new Error(`closure refuses an invalid project journal at line ${String(seq)}`); }
        assertProjectClosureRow(value, seq);
        yield value;
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
