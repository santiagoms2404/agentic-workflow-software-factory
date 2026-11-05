// The attempt's exclusive lock, its sealing on terminal states, and the
// write protocol that ties lock + journal + status together into one
// function: lock -> validate -> append+fsync -> atomic status replace ->
// project -> unlock.

import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJournalTail, type Journal, type JournalRecord } from "./journal.ts";
import { writeStatus } from "./status-store.ts";

/** Thrown when a write is attempted against an attempt already sealed by a terminal status. */
export class SealedAttempt extends Error {
  readonly state: string;

  constructor(state: string) {
    super(`attempt is sealed in terminal state ${state}; no further writes are legal (retry mints a new attempt)`);
    this.name = "SealedAttempt";
    this.state = state;
  }
}

/**
 * Who holds the lock, written INTO the lock file at acquisition.
 *
 * A crash leaves the file behind, and a lock file that names nobody is the
 * `ambiguous-pid` hazard by construction: recovery would have to choose
 * between deadlocking forever and stealing a lock a live host might still
 * hold. Naming the holder makes that a decision somebody can make with
 * evidence instead of a guess.
 */
export interface LockHolder {
  pid: number;
  acquiredAt: string;
}

/** The holder recorded in a lock file, or `null` when there is no lock (or it names nobody). */
export async function readLockHolder(lockPath: string): Promise<LockHolder | null> {
  let text: string;
  try {
    text = await readFile(lockPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(text) as Partial<LockHolder>;
    if (typeof parsed.pid !== "number" || typeof parsed.acquiredAt !== "string") return null;
    return { pid: parsed.pid, acquiredAt: parsed.acquiredAt };
  } catch {
    return null;
  }
}

/** Thrown when a reclaim is asked to remove a lock that a different holder now owns. */
export class LockHolderChanged extends Error {
  constructor(lockPath: string, expected: LockHolder | null, found: LockHolder | null) {
    super(
      `refusing to reclaim ${lockPath}: it was held by ${expected === null ? "an unnamed holder" : `pid ${expected.pid} at ${expected.acquiredAt}`}, ` +
        `and is now held by ${found === null ? "an unnamed holder" : `pid ${found.pid} at ${found.acquiredAt}`}`,
    );
    this.name = "LockHolderChanged";
  }
}

/**
 * Releases a lock left behind by a crashed host — the one repair recovery
 * authorizes, and only against the exact holder recovery observed. If the
 * file changed hands in between, a live host took it and this throws rather
 * than pulling the lock out from under it.
 */
export async function reclaimLock(lockPath: string, expected: LockHolder | null): Promise<void> {
  const found = await readLockHolder(lockPath);
  if (expected === null) {
    if (found !== null) {
      throw new LockHolderChanged(lockPath, expected, found);
    }
    try {
      await unlink(lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new LockHolderChanged(lockPath, expected, null);
      }
      throw err;
    }
    return;
  }
  if (found === null || found.pid !== expected.pid || found.acquiredAt !== expected.acquiredAt) {
    throw new LockHolderChanged(lockPath, expected, found);
  }
  await unlink(lockPath);
}

/**
 * The in-process queue of each lock path. Production builds a new `AttemptLock`
 * per write, so the queue has to outlive any one instance: two instances for
 * one attempt in one process queue here instead of racing for the file (B4-38).
 */
const processQueues = new Map<string, Promise<void>>();

/**
 * The attempt's exclusive lock.
 *
 * Two layers: an in-process queue, shared by every instance for the same lock
 * path, so two writers in the SAME process (the shape the 500-concurrent-writes
 * proof exercises) never interleave their critical sections; and a
 * link-created lock file on disk, so a second PROCESS holding the same attempt
 * directory fails loudly instead of corrupting it. Sealing is checked before
 * every acquisition — including ones already queued when `seal` runs — so
 * nothing queued behind a seal sneaks a write through.
 */
export class AttemptLock {
  private readonly lockPath: string;
  private sealedState: string | null = null;

  constructor(lockPath: string) {
    this.lockPath = lockPath;
  }

  /** Marks the attempt sealed. Every `withLock` call from now on throws `SealedAttempt`. */
  seal(state: string): void {
    this.sealedState = state;
  }

  isSealed(): boolean {
    return this.sealedState !== null;
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.sealedState !== null) {
      throw new SealedAttempt(this.sealedState);
    }

    const key = this.lockPath;
    const previous = processQueues.get(key) ?? Promise.resolve();
    let release = (): void => {};
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    processQueues.set(key, tail);

    try {
      await previous;
      if (this.sealedState !== null) {
        throw new SealedAttempt(this.sealedState);
      }
      const dir = dirname(this.lockPath);
      await mkdir(dir, { recursive: true });
      const tmpPath = join(dir, `.${randomBytes(8).toString("hex")}.lock.tmp`);
      const holder: LockHolder = { pid: process.pid, acquiredAt: new Date().toISOString() };
      await writeFile(tmpPath, JSON.stringify(holder), { mode: 0o600 });
      try {
        await link(tmpPath, this.lockPath);
      } finally {
        await unlink(tmpPath).catch(() => {});
      }
      let outcome: { ok: true; value: T } | { ok: false; error: unknown };
      try {
        outcome = { ok: true, value: await fn() };
      } catch (error) {
        outcome = { ok: false, error };
      }
      // Releasing the file must not replace the callback's own failure (B4-30):
      // when the callback threw, its error is the one the caller needs, even if
      // the lock file has already gone. A release that fails after a clean
      // callback is still reported.
      try {
        await unlink(this.lockPath);
      } catch (error) {
        if (outcome.ok) throw error;
      }
      if (!outcome.ok) throw outcome.error;
      return outcome.value;
    } finally {
      release();
      if (processQueues.get(key) === tail) processQueues.delete(key);
    }
  }
}

/**
 * The write protocol's steps, in order — the boundaries the crash-injection
 * matrix kills between. Named here rather than in the test so the suite
 * cannot drift into killing a protocol the implementation no longer runs:
 * adding a step to `runWriteProtocol` without adding it here is a type error
 * at the call site, and the simulation sweeps this list.
 */
export const WRITE_PROTOCOL_STEPS = [
  "locked",
  "validated",
  "appended",
  "status-written",
  "projected",
  "sealed",
  "unlocked",
] as const;
export type WriteProtocolStep = (typeof WRITE_PROTOCOL_STEPS)[number];

export interface WriteProtocolDeps<Event, Status> {
  lock: AttemptLock;
  journal: Journal<Event>;
  statusPath: string;
  /** Reads the current projection, or `null` when this is the attempt's first write. */
  readCurrentStatus: () => Promise<Status | null>;
  /** Validates against the current status and produces the event + next status. Throws to reject. */
  validate: (currentStatus: Status | null) => { event: Event; nextStatus: Status };
  /** The rebuildable-projection step. Optional: T6 ships no projector, T7 supplies one. */
  project?: (record: JournalRecord<Event>, status: Status) => Promise<void> | void;
  /** Returns the terminal state label to seal on, or `null` if `nextStatus` is not terminal. */
  sealWhenTerminal?: (status: Status) => string | null;
  /**
   * Called after each step completes. The crash-injection simulation kills
   * the host from here, so a kill lands on a real protocol boundary with
   * real durable state behind it rather than on a re-implementation of the
   * protocol that could be wrong in exactly the way the test is checking.
   */
  onStep?: (step: WriteProtocolStep) => Promise<void> | void;
}

/**
 * Thrown when the journal already holds a record the status was not written from (B4-03).
 *
 * A crash, or a thrown status write, between the append and the status write leaves the journal one
 * record ahead of status.json, and the lock is released either way. A writer that then validated
 * against that status would append a record whose `source_seq` (taken from the journal tail) no
 * longer matches the revision it carries, forking the journal from the status for good. The write
 * is refused instead and appends nothing: the journal is the truth, and repairing the status from
 * it is recovery's job (`recoverAttempt`), not a guess this layer makes. Nothing is removed.
 */
export class JournalAheadOfStatus extends Error {
  constructor(journalPath: string, journalSeq: number, statusSeq: number) {
    super(
      `${journalPath} is at source_seq ${journalSeq} but the status was written from source_seq ${statusSeq}; ` +
        "the status write after the last append was lost, so this write is refused until the status is recovered from the journal",
    );
    this.name = "JournalAheadOfStatus";
  }
}

/**
 * The `source_seq` a status was written from. The protocol is generic over the status, so this reads
 * the attempt status's own `lastSourceSeq`; a status type without one is not checked. No status at
 * all was written from no record.
 */
function statusSourceSeq(status: unknown): number | null {
  if (status === null) return 0;
  const seq = (status as { lastSourceSeq?: unknown }).lastSourceSeq;
  return typeof seq === "number" && Number.isSafeInteger(seq) ? seq : null;
}

async function refuseJournalAhead(journalPath: string, status: unknown): Promise<void> {
  const statusSeq = statusSourceSeq(status);
  if (statusSeq === null) return;
  const { lastSourceSeq: journalSeq } = await readJournalTail(journalPath);
  if (journalSeq > statusSeq) throw new JournalAheadOfStatus(journalPath, journalSeq, statusSeq);
}

/**
 * The write protocol, in one function: lock -> validate -> append+fsync ->
 * atomic status replace -> project -> unlock. Every step after acquiring the
 * lock runs inside the same critical section, so a reader can never observe
 * the journal and `status.json` disagree about which event produced which
 * status, and a terminal status seals the attempt before the lock releases.
 */
export async function runWriteProtocol<Event, Status>(
  deps: WriteProtocolDeps<Event, Status>,
): Promise<Status> {
  const step = async (name: WriteProtocolStep): Promise<void> => {
    await deps.onStep?.(name);
  };

  const nextStatus = await deps.lock.withLock(async () => {
    await step("locked");
    const currentStatus = await deps.readCurrentStatus();
    const { event, nextStatus: next } = deps.validate(currentStatus);
    await refuseJournalAhead(deps.journal.path, currentStatus);
    await step("validated");
    const record = await deps.journal.append(event);
    await step("appended");
    await writeStatus(deps.statusPath, next);
    await step("status-written");
    if (deps.project) {
      await deps.project(record, next);
    }
    await step("projected");
    const terminalLabel = deps.sealWhenTerminal?.(next) ?? null;
    if (terminalLabel !== null) {
      deps.lock.seal(terminalLabel);
    }
    await step("sealed");
    return next;
  });
  await step("unlocked");
  return nextStatus;
}
