// `journal.jsonl` — the truth the rest of the system is a rebuildable
// projection of. Append-only, fsynced before the write protocol's next step
// may run, byte-prefix immutable by construction.

import { mkdir, open, readFile, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { scrubCredentials, stringifyRedacted } from "../policy/redaction.ts";

/**
 * One line of `journal.jsonl`: the canonical event plus the journal's own
 * append-order stamp. `source_seq` is the journal's position — distinct from
 * a normalized event's own `seq` — and is what a crash-recovery reader
 * trusts to detect a gap, because it is recovered from the file itself
 * rather than kept only in memory.
 */
export interface JournalRecord<T> {
  source_seq: number;
  recorded_at: string;
  event: T;
}

/**
 * An append-only, fsynced log file. `O_APPEND` (the `"a"` flag) makes every
 * write atomic at the syscall level, and the handle is opened once and
 * reused so the byte prefix already synced to disk is never reopened for
 * truncation or rewrite — the property the byte-prefix proof exercises.
 */
class AppendOnlyLog {
  private handle: FileHandle | null = null;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  private async ensureOpen(): Promise<FileHandle> {
    if (this.handle === null) {
      await mkdir(dirname(this.path), { recursive: true });
      this.handle = await open(this.path, "a", 0o600);
    }
    return this.handle;
  }

  /** Appends one line and fsyncs before resolving — durable when this returns. */
  async appendLine(line: string): Promise<void> {
    const handle = await this.ensureOpen();
    await handle.appendFile(`${line}\n`, "utf8");
    await handle.sync();
  }

  async close(): Promise<void> {
    if (this.handle !== null) {
      const handle = this.handle;
      this.handle = null;
      await handle.close();
    }
  }
}

async function lastSourceSeq(path: string): Promise<number> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  const lines = text.split("\n").filter((line) => line.length > 0);
  const lastLine = lines[lines.length - 1];
  if (lastLine === undefined) return 0;
  return (JSON.parse(lastLine) as JournalRecord<unknown>).source_seq;
}

/**
 * `journal.jsonl` for one attempt. `source_seq` starts at 1 and is
 * recovered from the file on first use, so a host restarted after a crash
 * resumes the sequence exactly where the file left off instead of reissuing
 * a number the crash already wrote.
 */
export class Journal<T = unknown> {
  readonly path: string;
  private readonly log: AppendOnlyLog;
  private nextSeq: number | null = null;

  constructor(path: string) {
    this.path = path;
    this.log = new AppendOnlyLog(path);
  }

  private async ensureNextSeq(): Promise<number> {
    if (this.nextSeq === null) {
      this.nextSeq = (await lastSourceSeq(this.path)) + 1;
    }
    return this.nextSeq;
  }

  /** Appends the next canonical event, fsyncs, and returns the stamped record. */
  async append(event: T): Promise<JournalRecord<T>> {
    const source_seq = await this.ensureNextSeq();
    const record: JournalRecord<T> = {
      source_seq,
      recorded_at: new Date().toISOString(),
      event: scrubCredentials(event),
    };
    await this.log.appendLine(stringifyRedacted(record));
    this.nextSeq = source_seq + 1;
    return record;
  }

  async close(): Promise<void> {
    await this.log.close();
  }
}

export interface RawStream {
  /** Appends one raw chunk (already a complete line) and fsyncs. */
  appendChunk: (chunk: string) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Opens `raw/<run-id>.jsonl`: the private, unredacted provider stream
 * capture. Same append-only + fsync guarantee as the canonical journal, but
 * no envelope — invariant 9 already keeps thinking text out of the canonical
 * journal, and this file exists so the raw bytes stay recoverable without
 * ever being projected or displayed.
 */
export function openRawStream(path: string): RawStream {
  const log = new AppendOnlyLog(path);
  return {
    appendChunk: (chunk: string) => log.appendLine(chunk),
    close: () => log.close(),
  };
}
