import { open } from "node:fs/promises";
import { journalFilePath } from "./platform-paths.ts";
import { TAIL_CHUNK_BYTES, type TailHandle, type JournalRecord } from "./journal.ts";
import type { AttemptEvent, AttemptStatus } from "../cli/commands/attempt.ts";

export interface ClosureTailOptions {
  readonly chunkBytes?: number;
  /** Read-only seam for byte-counting tests. */
  readonly open?: (path: string) => Promise<TailHandle>;
}

/** Reverse JSONL scan: retain only the LANDED transition and its successors. */
export async function landingJournalTail(attemptDir: string, projection: AttemptStatus,
  options: ClosureTailOptions = {}): Promise<readonly JournalRecord<AttemptEvent>[]> {
  const chunkBytes = options.chunkBytes ?? TAIL_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("invalid closure tail chunk size");
  const handle = await (options.open ?? (path => open(path, "r")))(journalFilePath(attemptDir));
  try {
    let position = (await handle.stat()).size;
    let endChecked = false;
    let pieces: Buffer[] = [];
    const rows: JournalRecord<AttemptEvent>[] = [];
    let expected = projection.revision;
    const accept = (line: Buffer): boolean => {
      if (line.length === 0) return false;
      const row = JSON.parse(line.toString("utf8")) as JournalRecord<AttemptEvent>;
      const next = row.event.next;
      if (!Number.isSafeInteger(row.source_seq) || row.source_seq < 1 || row.source_seq !== expected ||
        next.revision !== row.source_seq) throw new Error("closure refuses a non-contiguous attempt journal or stale projection revision");
      if (next.project !== projection.project || next.taskId !== projection.taskId || next.attempt !== projection.attempt ||
        (next.lifecycleState !== "LANDED" && next.lifecycleState !== "PUBLISHED")) {
        throw new Error("closure refuses a projection inconsistent with the landing tail");
      }
      rows.push(row);
      expected--;
      return row.event.kind === "attempt.transitioned" && next.lifecycleState === "LANDED";
    };
    while (position > 0) {
      const length = Math.min(chunkBytes, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(chunk, read, length - read, position + read);
        if (bytesRead === 0) throw new Error("closure refuses a torn attempt journal");
        read += bytesRead;
      }
      if (!endChecked) {
        if (chunk[length - 1] !== 0x0a) throw new Error("closure refuses a torn attempt journal");
        endChecked = true;
      }
      let end = length;
      for (let index = length - 1; index >= 0; index--) {
        if (chunk[index] !== 0x0a) continue;
        pieces.push(chunk.subarray(index + 1, end));
        if (accept(Buffer.concat(pieces.reverse()))) return rows.reverse();
        pieces = [];
        end = index;
      }
      pieces.push(chunk.subarray(0, end));
    }
    if (accept(Buffer.concat(pieces.reverse()))) return rows.reverse();
    throw new Error("closure inventory has no LANDED transition");
  } finally { await handle.close(); }
}
