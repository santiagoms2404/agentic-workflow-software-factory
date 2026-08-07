// Crash recovery: read an attempt back off the disk a crash left behind and
// either reconstruct it EXACTLY or refuse, naming the exact key that could
// not be reconstructed. There is no third answer — "probably this" is the
// defect class this system exists to eliminate.
//
// The rule that decides every case: the journal is truth and the status is a
// derivation of it. So a status that disagrees with the journal is repaired
// FROM the journal when the disagreement is one a crash can explain (the
// status write is the step after the append), and is a refusal when it is
// not — a status ahead of the journal, or one that differs in a key no
// journal record could have produced, is a record somebody else wrote and
// this layer will not guess which of the two is real.
//
// Recovery never writes. It reads, decides, and reports; the caller repairs
// (`writeStatus`), reclaims (`reclaimLock`), or blocks. Every corrupt file it
// finds is left exactly as found — byte-identical, retained alongside the
// recovery rather than cleaned up, because the bytes are the evidence.

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { JournalRecord } from "./journal.ts";
import { readLockHolder, type LockHolder } from "./attempt-lock.ts";
import { journalFilePath, lockFilePath, statusFilePath } from "./platform-paths.ts";
import { TASK_STATES } from "../state/task-machine.ts";

/**
 * The blocker codes recovery may raise, both drawn from L21's vocabulary
 * (`EDGE_BLOCKER_CODES.L21`) so a refusal here transcribes straight onto the
 * `AWAITING_OWNER → BLOCKED` edge without inventing a code for it.
 */
export type RecoveryBlockerCode = "record-corrupt" | "unknown-state";

export interface RecoveryRefusal {
  ok: false;
  code: RecoveryBlockerCode;
  /** The exact key recovery refused to guess, e.g. `journal.jsonl#line:7.source_seq`. */
  badKey: string;
  detail: string;
  /** The file holding that key. Retained byte-identical; recovery does not touch it. */
  file: string;
}

function refuse(
  file: string,
  locator: string,
  key: string | null,
  code: RecoveryBlockerCode,
  detail: string,
): RecoveryRefusal {
  const suffix = key === null ? "" : `.${key}`;
  return { ok: false, code, badKey: `${basename(file)}#${locator}${suffix}`, detail, file };
}

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

/**
 * A trailing line the crash caught mid-append.
 *
 * `Journal` fsyncs every line before its `append()` resolves, so an
 * unterminated final line is a write the journal never acknowledged to
 * anybody: no status, no projection, and no caller ever saw it succeed.
 * Discarding it is exact reconstruction, not a repair — the byte prefix
 * before it is the whole of what was ever promised. It stays in the file.
 */
export interface TornTail {
  /** The unterminated bytes, as found. */
  text: string;
  /** Byte offset where the torn line begins — where the durable prefix ends. */
  byteOffset: number;
}

export interface JournalScan<Event> {
  ok: true;
  records: JournalRecord<Event>[];
  tornTail: TornTail | null;
}

function isRecordShaped(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses `journal.jsonl` into records, or refuses naming the exact line and
 * key that stopped it. A gap in `source_seq` is a refusal and not a repair:
 * the missing record's event is gone, so every derivation downstream of it
 * would be a reconstruction of something nobody recorded.
 */
export function scanJournalText<Event>(text: string, file: string): JournalScan<Event> | RecoveryRefusal {
  const records: JournalRecord<Event>[] = [];
  let tornTail: TornTail | null = null;

  const lines = text.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  if (lastLine.length > 0) {
    tornTail = { text: lastLine, byteOffset: Buffer.byteLength(text, "utf8") - Buffer.byteLength(lastLine, "utf8") };
  }
  const complete = lines.slice(0, -1);

  for (const [index, line] of complete.entries()) {
    const lineNumber = index + 1;
    const locator = `line:${lineNumber}`;
    if (line.length === 0) {
      return refuse(file, locator, null, "record-corrupt", "a blank line interrupts the append-only sequence");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      return refuse(file, locator, null, "record-corrupt", `line is not valid JSON: ${(err as Error).message}`);
    }
    if (!isRecordShaped(parsed)) {
      return refuse(file, locator, null, "record-corrupt", "line is not a JSON object");
    }

    const sourceSeq = parsed.source_seq;
    if (typeof sourceSeq !== "number" || !Number.isInteger(sourceSeq) || sourceSeq < 1) {
      return refuse(file, locator, "source_seq", "record-corrupt", `source_seq is ${JSON.stringify(sourceSeq)}`);
    }
    if (sourceSeq !== lineNumber) {
      return refuse(
        file,
        locator,
        "source_seq",
        "record-corrupt",
        `expected source_seq ${lineNumber}, found ${sourceSeq}; the journal has a gap or a reordering, ` +
          "and the missing record's event cannot be reconstructed from the ones that survived",
      );
    }
    if (typeof parsed.recorded_at !== "string" || parsed.recorded_at.length === 0) {
      return refuse(file, locator, "recorded_at", "record-corrupt", "recorded_at is missing or empty");
    }
    if (!("event" in parsed)) {
      return refuse(file, locator, "event", "record-corrupt", "the record carries no event");
    }

    records.push({
      source_seq: sourceSeq,
      recorded_at: parsed.recorded_at,
      event: parsed.event as Event,
    });
  }

  return { ok: true, records, tornTail };
}

/** `scanJournalText` over a file. A journal that does not exist scans as empty. */
export async function scanJournal<Event>(path: string): Promise<JournalScan<Event> | RecoveryRefusal> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, records: [], tornTail: null };
    throw err;
  }
  return scanJournalText<Event>(text, path);
}

// ---------------------------------------------------------------------------
// The attempt
// ---------------------------------------------------------------------------

/** What recovery had to reconstruct. An attempt that crashed between two writes reports none of these. */
export type ReconstructionKind =
  | "torn-tail-discarded"
  | "status-missing"
  | "status-unreadable"
  | "status-stale";

export interface Reconstruction {
  kind: ReconstructionKind;
  detail: string;
}

export interface RecoveredAttempt<Event, Status> {
  outcome: "recovered";
  records: readonly JournalRecord<Event>[];
  /** The status the journal proves. Identical to what an uninterrupted run would have written. */
  status: Status | null;
  /** The next `source_seq` a resumed host must issue. */
  nextSourceSeq: number;
  reconstructions: readonly Reconstruction[];
  /**
   * A lock file the crash left behind, with whoever wrote it. Recovery
   * reports it and stops: removing it is `reclaimLock`, an explicit act
   * against this exact holder, because a lock is only stale if its holder is
   * really gone and this layer cannot see processes.
   */
  heldLock: { path: string; holder: LockHolder | null } | null;
  /** Files retained byte-identical alongside the recovery. */
  retained: readonly string[];
}

export interface BlockedAttempt extends RecoveryRefusal {
  outcome: "blocked";
  /** Files retained byte-identical alongside the refusal — the evidence, untouched. */
  retained: readonly string[];
}

export type AttemptRecovery<Event, Status> = RecoveredAttempt<Event, Status> | BlockedAttempt;

export interface RecoverAttemptOptions<Event, Status> {
  attemptDir: string;
  /**
   * The deterministic fold from journal records to status. This is what makes
   * "reconstruct exactly" mean something: the same records must always
   * produce the same status, or a crash between the append and the status
   * write would be unrecoverable by definition.
   */
  derive: (records: readonly JournalRecord<Event>[]) => Status | null;
  /**
   * Pulls the lifecycle state out of a status, when the status carries one.
   * A state outside the plan's ten is `unknown-state` — refused by name
   * rather than carried forward as if the record were readable.
   */
  lifecycleStateOf?: (status: Status) => unknown;
  /** The key `lifecycleStateOf` reads, for the refusal's `badKey`. */
  lifecycleKey?: string;
}

/** Key order must not decide whether two statuses agree. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Top-level keys on which two statuses disagree, in sorted order. */
function disagreeingKeys(recorded: unknown, derived: unknown): string[] {
  if (!isRecordShaped(recorded) || !isRecordShaped(derived)) {
    return canonical(recorded) === canonical(derived) ? [] : ["(whole document)"];
  }
  const keys = [...new Set([...Object.keys(recorded), ...Object.keys(derived)])].sort();
  return keys.filter((key) => canonical(recorded[key]) !== canonical(derived[key]));
}

/**
 * Reads one attempt directory back and reconstructs it, or blocks.
 *
 * The cases, and why each is exact or a refusal:
 *
 * - Crash before the append — journal and status agree. Nothing to do.
 * - Crash between append and status write — the status is exactly the one
 *   the previous record derives. Unambiguous: re-derive and repair.
 * - Crash mid-append — an unterminated final line the fsync never
 *   acknowledged. Discard it; the durable prefix is the whole promise.
 * - Crash after the status write, before projection or seal — journal and
 *   status agree; the projection catches up by replay (it is idempotent) and
 *   the seal is re-derived from the terminal status.
 * - Status missing or unreadable — it is a derivation; rebuild it.
 * - Status AHEAD of the journal, or differing in a key the previous record
 *   does not explain — refuse, naming that key. Two records disagree about
 *   what happened and only one of them can be true.
 */
export async function recoverAttempt<Event, Status>(
  options: RecoverAttemptOptions<Event, Status>,
): Promise<AttemptRecovery<Event, Status>> {
  const { attemptDir, derive } = options;
  const journalPath = journalFilePath(attemptDir);
  const statusPath = statusFilePath(attemptDir);
  const lockPath = lockFilePath(attemptDir);
  const retained: string[] = [];
  const reconstructions: Reconstruction[] = [];

  const scan = await scanJournal<Event>(journalPath);
  if (!scan.ok) {
    return { ...scan, outcome: "blocked", retained: [journalPath] };
  }
  if (scan.tornTail !== null) {
    retained.push(journalPath);
    reconstructions.push({
      kind: "torn-tail-discarded",
      detail:
        `${journalPath} ends with ${scan.tornTail.text.length} unterminated byte(s) at offset ` +
        `${scan.tornTail.byteOffset}; fsync never acknowledged that append, so the durable prefix is the record`,
    });
  }

  const derived = derive(scan.records);

  let recordedText: string | null = null;
  try {
    recordedText = await readFile(statusPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // An attempt with no journal records and no status was never written to:
    // there is nothing to reconstruct, and calling that a repair would report
    // damage where none happened.
    if (scan.records.length > 0) {
      reconstructions.push({
        kind: "status-missing",
        detail: `${statusPath} does not exist; it is a derivation of the journal and was rebuilt from it`,
      });
    }
  }

  if (recordedText !== null) {
    let recorded: unknown;
    let readable = true;
    try {
      recorded = JSON.parse(recordedText);
    } catch (err) {
      readable = false;
      retained.push(statusPath);
      reconstructions.push({
        kind: "status-unreadable",
        detail: `${statusPath} is not valid JSON (${(err as Error).message}); rebuilt from the journal, file retained`,
      });
    }

    if (readable) {
      const status = recorded as Status;
      const stateReader = options.lifecycleStateOf;
      if (stateReader !== undefined && recorded !== null) {
        const state = stateReader(status);
        if (state !== undefined && !(TASK_STATES as readonly unknown[]).includes(state)) {
          return {
            ...refuse(
              statusPath,
              options.lifecycleKey ?? "lifecycle_state",
              null,
              "unknown-state",
              `${JSON.stringify(state)} is not one of the ten task states; the record cannot be read forward`,
            ),
            outcome: "blocked",
            retained: [statusPath],
          };
        }
      }

      const differing = disagreeingKeys(recorded, derived);
      if (differing.length > 0) {
        // The one disagreement a crash explains: the status is the one the
        // journal proved BEFORE the last record — the kill landed between
        // the append and the status write.
        const previous = derive(scan.records.slice(0, -1));
        if (scan.records.length > 0 && canonical(recorded) === canonical(previous)) {
          reconstructions.push({
            kind: "status-stale",
            detail:
              `${statusPath} is the status of source_seq ${scan.records.length - 1}; the journal proves ` +
              `${scan.records.length}. The kill landed between the append and the status write`,
          });
        } else {
          const key = differing[0] ?? "(whole document)";
          return {
            ...refuse(
              statusPath,
              key,
              null,
              "record-corrupt",
              `status.json records ${canonical(isRecordShaped(recorded) ? recorded[key] : recorded)} ` +
                `and the journal proves ${canonical(isRecordShaped(derived) ? derived[key] : derived)}; ` +
                "no crash between two protocol steps produces this pair, so recovery will not choose between them",
            ),
            outcome: "blocked",
            retained: [journalPath, statusPath],
          };
        }
      }
    }
  }

  const holder = await readLockHolder(lockPath);
  let heldLock: RecoveredAttempt<Event, Status>["heldLock"] = null;
  if (holder !== null) {
    heldLock = { path: lockPath, holder };
  } else {
    // No holder record and no file are different facts: an unnamed lock file
    // still blocks the next write, and still has to be reported.
    const present = await stat(lockPath).then(
      () => true,
      () => false,
    );
    if (present) heldLock = { path: lockPath, holder: null };
  }

  return {
    outcome: "recovered",
    records: scan.records,
    status: derived,
    nextSourceSeq: scan.records.length + 1,
    reconstructions,
    heldLock,
    retained,
  };
}
