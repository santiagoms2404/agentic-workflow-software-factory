// `journal.jsonl` — the truth the rest of the system is a rebuildable
// projection of. Append-only, fsynced before the write protocol's next step
// may run, byte-prefix immutable by construction.

import { mkdir, open, type FileHandle } from "node:fs/promises";
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
 * An append-only, fsynced log file. `O_APPEND` (the `"a+"` flag) makes every
 * write land at the end atomically at the syscall level, and the handle is
 * opened once and reused so the byte prefix already synced to disk is never
 * reopened for truncation or rewrite — the property the byte-prefix proof
 * exercises. The `+` only adds positional reads, used for the last-byte
 * check below; it opens nothing for truncation.
 *
 * A line is only ever started at the beginning of a line (B4-04, B4-05). A
 * crash can persist a line's bytes without its newline, and an append
 * written straight after them would share that physical line: two JSON
 * objects on one line, which every reader refuses, so an acknowledged write
 * would be unreadable. So before the first write through a handle, and
 * again after any write that failed partway, the file's last byte is read,
 * and when it is not a newline the line is written behind one. The
 * unterminated bytes are never removed: terminating them is the only
 * change, and it is an append.
 */
class AppendOnlyLog {
  private handle: FileHandle | null = null;
  private readonly path: string;
  /** True once the file is known to end in a newline (or be empty). */
  private atLineStart = false;

  constructor(path: string) {
    this.path = path;
  }

  private async ensureOpen(): Promise<FileHandle> {
    if (this.handle === null) {
      await mkdir(dirname(this.path), { recursive: true });
      this.handle = await open(this.path, "a+", 0o600);
      this.atLineStart = false;
    }
    return this.handle;
  }

  private async endsAtLineStart(handle: FileHandle): Promise<boolean> {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const last = Buffer.alloc(1);
    await readFully(handle, last, size - 1);
    return last[0] === NEWLINE;
  }

  /** Appends one line and fsyncs before resolving — durable when this returns. */
  async appendLine(line: string): Promise<void> {
    const handle = await this.ensureOpen();
    const lead = this.atLineStart || (await this.endsAtLineStart(handle)) ? "" : "\n";
    // Until this write and its sync succeed, the file's last byte is unknown.
    this.atLineStart = false;
    await handle.appendFile(`${lead}${line}\n`, "utf8");
    await handle.sync();
    this.atLineStart = true;
  }

  async close(): Promise<void> {
    if (this.handle !== null) {
      const handle = this.handle;
      this.handle = null;
      await handle.close();
    }
  }
}

/** How many bytes of the journal's tail one read takes. */
export const TAIL_CHUNK_BYTES = 64 * 1024;

const NEWLINE = 0x0a;

/** The part of a `FileHandle` a tail read uses. */
export interface TailHandle {
  stat(): Promise<{ size: number }>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface LastSourceSeqOptions {
  chunkBytes?: number;
  /** Opens the journal for reading. Injected so a test can count the bytes read. */
  open?: (path: string) => Promise<TailHandle>;
}

/**
 * A final line the crash cut short: unterminated and not a whole record.
 * Same meaning as `TornTail` in `replay.ts` — a write the journal never
 * acknowledged — and the same rule: it stays in the file, as found.
 */
export interface JournalTornTail {
  /** The unterminated bytes, decoded as UTF-8 (a cut mid-character decodes lossily; the file does not change). */
  text: string;
  /** Byte offset where the torn line begins — where the durable prefix ends. */
  byteOffset: number;
}

/** What the end of a journal says, read without reading the whole file. */
export interface JournalTail {
  /** The `source_seq` of the last whole record, or 0 when there is none. */
  lastSourceSeq: number;
  /** The torn final line, when there is one. Reported, never removed. */
  tornTail: JournalTornTail | null;
}

/** The last non-empty line ending at or before byte `end`, read backwards in bounded chunks. */
async function lastLineBefore(
  handle: TailHandle,
  end: number,
  chunkBytes: number,
): Promise<{ bytes: Buffer; start: number; terminated: boolean } | null> {
  // The line's bytes, in reverse chunk order.
  const pieces: Buffer[] = [];
  let found = false;
  let trailingNewlines = 0;
  let start = 0;
  let position = end;
  while (position > 0) {
    const length = Math.min(chunkBytes, position);
    position -= length;
    const chunk = Buffer.alloc(length);
    await readFully(handle, chunk, position);
    let last = length - 1;
    if (!found) {
      while (last >= 0 && chunk[last] === NEWLINE) last -= 1;
      trailingNewlines += length - 1 - last;
      if (last < 0) continue;
      found = true;
    }
    const newline = chunk.lastIndexOf(NEWLINE, last);
    pieces.push(chunk.subarray(newline + 1, last + 1));
    if (newline >= 0) {
      start = position + newline + 1;
      break;
    }
  }
  if (!found) return null;
  return { bytes: Buffer.concat(pieces.reverse()), start, terminated: trailingNewlines > 0 };
}

/** The `source_seq` of a line that is one whole record, or null when it is not. */
function wholeRecordSeq(line: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const seq = (parsed as { source_seq?: unknown }).source_seq;
  return typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 1 ? seq : null;
}

/**
 * The journal's end: the `source_seq` of its last whole record, and the torn
 * final line when a crash left one (B4-04, B4-05). Missing, empty and
 * newline-only files have neither.
 *
 * Read backwards from the end in bounded chunks, never the whole file: every
 * status write constructs a fresh `Journal`, so a whole-file read here made
 * each write cost the size of the journal. The bytes read are the trailing
 * newlines, the last line, at most one more line when the last is torn, and
 * at most one chunk more. Nothing is written, so a read never changes the
 * file.
 *
 * Which line is torn follows `scanJournalText` in `replay.ts`, so the writer
 * and every reader agree on what the file holds:
 *
 * - A terminated last line is a whole line. If it does not parse, that is
 *   corruption, not a crash mid-append, and `JSON.parse` still throws.
 * - An unterminated last line that is one whole record (the crash kept its
 *   JSON but not its newline) counts: the next append writes the newline in
 *   front of itself, after which every reader sees that record complete.
 * - An unterminated last line that is not one whole record is the torn tail.
 *   It is reported, not thrown, and `lastSourceSeq` is the line before it —
 *   which must parse: torn-tail tolerance covers the final line only, so an
 *   unparsable line earlier in the file still throws.
 */
export async function readJournalTail(path: string, options: LastSourceSeqOptions = {}): Promise<JournalTail> {
  const chunkBytes = options.chunkBytes ?? TAIL_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) {
    throw new RangeError(`tail chunk size must be a positive integer, got ${String(chunkBytes)}`);
  }
  let handle: TailHandle;
  try {
    handle = await (options.open ?? ((target: string) => open(target, "r")))(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { lastSourceSeq: 0, tornTail: null };
    throw err;
  }
  try {
    const { size } = await handle.stat();
    const last = await lastLineBefore(handle, size, chunkBytes);
    if (last === null) return { lastSourceSeq: 0, tornTail: null };
    const lastLine = last.bytes.toString("utf8");
    if (last.terminated) {
      return { lastSourceSeq: (JSON.parse(lastLine) as JournalRecord<unknown>).source_seq, tornTail: null };
    }
    const seq = wholeRecordSeq(lastLine);
    if (seq !== null) return { lastSourceSeq: seq, tornTail: null };
    const previous = await lastLineBefore(handle, last.start, chunkBytes);
    const previousSeq =
      previous === null ? 0 : (JSON.parse(previous.bytes.toString("utf8")) as JournalRecord<unknown>).source_seq;
    return { lastSourceSeq: previousSeq, tornTail: { text: lastLine, byteOffset: last.start } };
  } finally {
    await handle.close();
  }
}

/**
 * The `source_seq` of the journal's last whole record, or 0 when there is
 * none — `readJournalTail` without its torn-tail report. A torn tail is not a
 * record, so it does not count; a caller that will append must use
 * `readJournalTail` instead, so the torn tail stays visible to it.
 */
export async function lastSourceSeq(path: string, options: LastSourceSeqOptions = {}): Promise<number> {
  return (await readJournalTail(path, options)).lastSourceSeq;
}

async function readFully(handle: TailHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (bytesRead === 0) throw new Error("journal shrank while its tail was being read");
    offset += bytesRead;
  }
}

/**
 * A journal append refused because the file ends in a torn record. Carries
 * the torn tail so the caller can report it; the file is left as found.
 */
export class TornJournalTailError extends Error {
  readonly path: string;
  readonly tornTail: JournalTornTail;

  constructor(path: string, tornTail: JournalTornTail) {
    super(
      `${path} ends in a torn record at byte ${String(tornTail.byteOffset)} ` +
        `(${String(Buffer.byteLength(tornTail.text, "utf8"))} unterminated bytes that are not a whole record); ` +
        "appending would bury it mid-file where every reader refuses the journal, " +
        "so the journal is retained unchanged and owner recovery is required",
    );
    this.name = "TornJournalTailError";
    this.path = path;
    this.tornTail = tornTail;
  }
}

/**
 * `journal.jsonl` for one attempt. `source_seq` starts at 1 and is
 * recovered from the file on first use, so a host restarted after a crash
 * resumes the sequence exactly where the file left off instead of reissuing
 * a number the crash already wrote.
 *
 * A torn tail refuses the append with `TornJournalTailError`, and keeps
 * refusing until the file no longer ends in one (B4-04). There is no third
 * way that keeps both the evidence and the journal readable: writing past
 * the torn bytes turns them into a whole line that is not JSON, which
 * `scanJournalText` refuses for every reader, and removing them truncates
 * evidence, which invariants 8 and 10 rule out. Refusing keeps the file
 * exactly as found and still readable (`scanJournal` reports the torn tail
 * and returns every record before it), and it names the tail instead of
 * surfacing a bare `SyntaxError`. A complete record that only lost its
 * newline is not torn: it is adopted, and the append starts on a new line.
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
      const tail = await readJournalTail(this.path);
      if (tail.tornTail !== null) throw new TornJournalTailError(this.path, tail.tornTail);
      this.nextSeq = tail.lastSourceSeq + 1;
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
