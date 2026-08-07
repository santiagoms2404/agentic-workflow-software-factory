// The attempt's exclusive lock, its sealing on terminal states, and the
// write protocol that ties lock + journal + status together into one
// function: lock -> validate -> append+fsync -> atomic status replace ->
// project -> unlock.

import { mkdir, open, unlink } from "node:fs/promises";
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
  return deps.lock.withLock(async () => {
    const currentStatus = await deps.readCurrentStatus();
    const { event, nextStatus } = deps.validate(currentStatus);
    const record = await deps.journal.append(event);
    await writeStatus(deps.statusPath, nextStatus);
    if (deps.project) {
      await deps.project(record, nextStatus);
    }
    const terminalLabel = deps.sealWhenTerminal?.(nextStatus) ?? null;
    if (terminalLabel !== null) {
      deps.lock.seal(terminalLabel);
    }
    return nextStatus;
  });
}
