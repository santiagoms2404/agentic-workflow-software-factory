// The attempt's exclusive lock, its sealing on terminal states, and the
// write protocol that ties lock + journal + status together into one
// function: lock -> validate -> append+fsync -> atomic status replace ->
// project -> unlock.

import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { Journal, JournalRecord } from "./journal.ts";
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
  constructor(lockPath: string, expected: LockHolder, found: LockHolder | null) {
    super(
      `refusing to reclaim ${lockPath}: it was held by pid ${expected.pid} at ${expected.acquiredAt}, ` +
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
export async function reclaimLock(lockPath: string, expected: LockHolder): Promise<void> {
  const found = await readLockHolder(lockPath);
  if (found === null || found.pid !== expected.pid || found.acquiredAt !== expected.acquiredAt) {
    throw new LockHolderChanged(lockPath, expected, found);
  }
  await unlink(lockPath);
}

/**
 * The attempt's exclusive lock.
 *
 * Two layers: an in-process queue, so two writers in the SAME process (the
 * shape the 500-concurrent-writes proof exercises) never interleave their
 * critical sections; and a `wx`-created lock file on disk, so a second
 * PROCESS holding the same attempt directory fails loudly instead of
 * corrupting it. Sealing is checked before every acquisition — including
 * ones already queued when `seal` runs — so nothing queued behind a seal
 * sneaks a write through.
 */
export class AttemptLock {
  private readonly lockPath: string;
  private queue: Promise<void> = Promise.resolve();
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

    const previous = this.queue;
    let release = (): void => {};
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await previous;
      if (this.sealedState !== null) {
        throw new SealedAttempt(this.sealedState);
      }
      await mkdir(dirname(this.lockPath), { recursive: true });
      const handle = await open(this.lockPath, "wx", 0o600);
      try {
        const holder: LockHolder = { pid: process.pid, acquiredAt: new Date().toISOString() };
        await handle.writeFile(JSON.stringify(holder), "utf8");
        return await fn();
      } finally {
        await handle.close();
        await unlink(this.lockPath);
      }
    } finally {
      release();
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
