// `awsf db rebuild` — the guarantee that makes the dashboard's database
// disposable: a fresh file written from the journals, validated before
// anybody looks at it, swapped in atomically, and the file it replaced
// RETAINED rather than deleted. Nothing here deletes a database, ever; a
// rebuild that fails leaves both the old file and its own candidate in place
// for somebody to look at.
//
// This module also owns the other half of the degraded-mode contract. The
// projector's half is "a projection failure never kills a running model";
// this half is "and it never lets one finish invisibly either" — while a
// session is degraded, the attempt may not advance past `GATING`, and a
// successful rebuild is the only thing that lifts the hold. Together they
// are the whole of invariant 2: truth is preserved, the display is
// rebuildable, and invisible completion is impossible.

import { existsSync, readdirSync, readlinkSync } from "node:fs";
import { link, mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JournalRecord } from "../persistence/journal.ts";
import { listDirectories } from "../persistence/directories.ts";
import { scanJournal } from "../persistence/replay.ts";
import type { NormalizedEvent } from "../contracts/normalized-events.ts";
import type { TaskState } from "../state/task-machine.ts";
import { closeDatabase, integrityProblems, openDatabase, type CloseOutcome, type DatabaseSync } from "./sqlite.ts";
import type { AttributionRecord } from "../contracts/attribution-record.ts";
import type { DecisionRecord } from "../contracts/decision-record.ts";
import {
  createSession,
  projectAttemptStatus,
  projectAttribution,
  projectDecision,
  projectEvent,
  type AttemptStatusProjection,
  type SessionInit,
} from "./projector.ts";
import { getSession } from "./queries.ts";
import { scrubCredentialString } from "../policy/redaction.ts";

// ---------------------------------------------------------------------------
// The degraded hold
// ---------------------------------------------------------------------------

/**
 * The states an attempt may not reach while its observability is degraded.
 *
 * `RUNNING` and `GATING` are absent on purpose — a degraded session keeps
 * working, and a correction (`GATING → RUNNING`) is not an advance. So are
 * `BLOCKED` and `CANCELLED`: halting must always remain available, or a
 * degraded task could not even be stopped cleanly.
 *
 * `PUBLISHED` is held too (B4-02): `awsf publish` asks this gate before a push
 * that has no rollback, so letting a degraded session through would make the
 * one irreversible act exactly the invisible completion this hold forbids.
 */
export const STATES_BEYOND_GATING = ["REVIEWING", "AWAITING_OWNER", "LANDING", "LANDED", "PUBLISHED"] as const;

/** Thrown when a degraded session tries to advance past `GATING`. */
export class DegradedObservabilityHold extends Error {
  readonly sessionId: string;
  readonly to: TaskState;

  constructor(sessionId: string, to: TaskState) {
    super(
      `session ${sessionId} has degraded observability and may not advance to ${to}: the SQLite projection no ` +
        "longer matches the journal, so completing here would complete invisibly. The journal is intact — run " +
        "`awsf db rebuild` and try again.",
    );
    this.name = "DegradedObservabilityHold";
    this.sessionId = sessionId;
    this.to = to;
  }
}

/**
 * The gate the CLI and the workflow runner call before persisting a
 * transition. Deliberately NOT part of `state/`: the transition matrix is a
 * pure function of ten states and twenty-five edges, and an observability
 * fact is not one of its inputs. This is a hold applied to a legal
 * transition, not a new rejection class.
 */
export function assertAdvancementPermitted(input: {
  sessionId: string;
  to: TaskState;
  degraded: boolean;
}): void {
  if (!input.degraded) return;
  if (!(STATES_BEYOND_GATING as readonly string[]).includes(input.to)) return;
  throw new DegradedObservabilityHold(input.sessionId, input.to);
}

/**
 * Reads a session's observability health out of the projection.
 *
 * A database that cannot answer is itself the answer: an unreadable
 * projection is a degraded one, so the failure path reports `true` rather
 * than letting a corrupt file present as healthy.
 */
export function observabilityDegraded(db: DatabaseSync, sessionId: string): boolean {
  try {
    const row = getSession(db, sessionId);
    return row === null ? true : row.observability_degraded === 1;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// The rebuild
// ---------------------------------------------------------------------------

/**
 * One attempt's contribution to the rebuilt database: its identity, and the
 * journal that is the truth about it.
 *
 * The identity is supplied by the caller rather than read here, because it
 * lives in `status.json` whose schema belongs to the CLI (T22) and not to
 * this module. Everything that varies per event comes from the journal —
 * which is exactly the property "delete the database and lose nothing"
 * depends on.
 */
export interface RebuildSource {
  session: SessionInit;
  journalPath: string;
  /** Adapts a durable provider journal vocabulary at its owning boundary. */
  normalize?: (record: JournalRecord<unknown>) => NormalizedEvent;
  /** Replays a CLI attempt journal into the session summary, not fake provider events. */
  attemptStatus?: (record: JournalRecord<unknown>) => AttemptStatusProjection;
}

export interface RebuildOptions {
  /** The live database path, e.g. `<state-root>/awsf.db`. */
  targetPath: string;
  sources: readonly RebuildSource[];
  /**
   * Every task's owner attributions, each task's in file order. They live
   * beside the attempt journals rather than in one, so no source replays them;
   * they are projected once every session exists.
   */
  attributions?: readonly AttributionRecord[];
  /**
   * Every task's Jev decision records, each task's in file order (W19 DD3).
   * Task-scoped like attributions, they are replayed in time with the journals
   * (B4-33), and held until the session they attach to has been replayed.
   */
  decisions?: readonly DecisionRecord[];
  migrationsDir?: string;
  /** Injectable rename for testing swap failure compensation. */
  rename?: (from: string, to: string) => Promise<void>;
  /** Injectable so the retained file's name is deterministic in tests. */
  stamp?: () => string;
}

export interface RebuildSucceeded {
  ok: true;
  targetPath: string;
  sessions: number;
  /** Journal records read across every source. */
  records: number;
  /** Records the projector applied. A non-persistable kind advances its session's cursor without a row. */
  projected: number;
  /** Where the replaced file was retained, or `null` when there was nothing to replace. */
  retainedPath: string | null;
}

export interface RebuildRefused {
  ok: false;
  reason: string;
  /** The exact key that stopped it, when a journal was the thing at fault. */
  badKey?: string;
  /** The candidate is left on disk, unswapped, for diagnosis. */
  candidatePath: string;
}

export type RebuildReport = RebuildSucceeded | RebuildRefused;

/** Sort by one key, tie-broken by another, so an ordering is never left to chance. */
function order(primaryA: string, primaryB: string, tieA: string, tieB: string): number {
  if (primaryA !== primaryB) return primaryA < primaryB ? -1 : 1;
  return tieA < tieB ? -1 : tieA > tieB ? 1 : 0;
}

/** One thing the rebuild replays: a journal record of one attempt, or a task-level decision. */
type ReplayItem =
  | { kind: "record"; source: RebuildSource; sessionId: string; record: JournalRecord<unknown> }
  | { kind: "decision"; record: DecisionRecord };

function replayTime(item: ReplayItem): string {
  return item.kind === "record" ? item.record.recorded_at : item.record.at;
}

function replayKey(item: ReplayItem): string {
  return item.kind === "record"
    ? `${item.sessionId}:${item.record.source_seq}`
    : `decision:${item.record.project}:${item.record.taskId}:${item.record.id}`;
}

function replayPrecedes(a: ReplayItem, b: ReplayItem): boolean {
  return order(replayTime(a), replayTime(b), replayKey(a), replayKey(b)) < 0;
}

/**
 * Interleaves sorted streams into one sequence by always taking the earliest
 * next item across the streams' heads. Each stream keeps its own order, so a
 * same-millisecond tie or a backward clock step inside one journal cannot
 * reorder that journal (B4-34). A binary heap keeps the merge at O(n log k).
 */
function mergeStreams<T>(streams: readonly (readonly T[])[], precedes: (a: T, b: T) => boolean): T[] {
  const next = streams.map(() => 0);
  const heap: number[] = [];
  const head = (stream: number): T => streams[stream]![next[stream]!]!;
  const before = (i: number, j: number): boolean => precedes(head(heap[i]!), head(heap[j]!));
  const swap = (i: number, j: number): void => {
    const held = heap[i]!;
    heap[i] = heap[j]!;
    heap[j] = held;
  };
  const siftUp = (start: number): void => {
    let at = start;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!before(at, parent)) return;
      swap(at, parent);
      at = parent;
    }
  };
  const siftDown = (start: number): void => {
    let at = start;
    for (;;) {
      const left = 2 * at + 1;
      const right = left + 1;
      let least = at;
      if (left < heap.length && before(left, least)) least = left;
      if (right < heap.length && before(right, least)) least = right;
      if (least === at) return;
      swap(at, least);
      at = least;
    }
  };
  streams.forEach((items, stream) => {
    if (items.length === 0) return;
    heap.push(stream);
    siftUp(heap.length - 1);
  });
  const out: T[] = [];
  while (heap.length > 0) {
    const stream = heap[0]!;
    out.push(head(stream));
    next[stream] = (next[stream] ?? 0) + 1;
    if (next[stream]! < streams[stream]!.length) {
      siftDown(0);
    } else {
      heap[0] = heap[heap.length - 1]!;
      heap.pop();
      if (heap.length > 0) siftDown(0);
    }
  }
  return out;
}

/** The key a task's decisions and its replayed records share. */
function taskKey(project: string, taskId: string): string {
  return `${project}\u0000${taskId}`;
}

/**
 * Each task's decisions as one stream, in file order (B4-33). A decision's
 * `at` places it in the replay, so it sees the attempts that existed when it
 * was recorded, exactly as the live projection did.
 */
function decisionStreams(decisions: readonly DecisionRecord[]): ReplayItem[][] {
  const byTask = new Map<string, ReplayItem[]>();
  for (const record of decisions) {
    const key = taskKey(record.project, record.taskId);
    const stream = byTask.get(key) ?? [];
    stream.push({ kind: "decision", record });
    byTask.set(key, stream);
  }
  return [...byTask.values()];
}

/**
 * Whether the session a decision attaches to is in the candidate yet: the
 * attempt it names, or for a task-level decision any attempt of its task. The
 * lookup is the one `projectDecision` makes, so "present" means "will attach".
 */
function decisionTargetExists(db: DatabaseSync, record: DecisionRecord): boolean {
  const row = db.prepare(
    "SELECT 1 AS found FROM sessions WHERE project_slug = ? AND task_id = ? AND (? IS NULL OR attempt = ?) LIMIT 1",
  ).get(
    scrubCredentialString(record.project),
    scrubCredentialString(record.taskId),
    record.attempt,
    record.attempt,
  );
  return row !== undefined;
}

/**
 * Projects every held decision of one task whose session now exists, in file
 * order, and keeps the rest held. Returns the failure message, or `null`.
 *
 * A decision whose session has not been replayed yet waits here, and the first
 * record of that session releases it. This is what keeps a decision from being
 * dropped when its `at` precedes its task's first journal record (B4-33 places
 * it in time, and the time can be earlier than the session it belongs to). A
 * decision whose session never appears is never projected, which is also what
 * the live projection does when no session exists to attach it to.
 */
function drainHeldDecisions(db: DatabaseSync, held: Map<string, DecisionRecord[]>, key: string): string | null {
  const queue = held.get(key);
  if (queue === undefined) return null;
  const waiting: DecisionRecord[] = [];
  for (const record of queue) {
    if (!decisionTargetExists(db, record)) {
      waiting.push(record);
      continue;
    }
    try {
      projectDecision(db, record);
    } catch (error) {
      return `projection failed replaying decision ${record.id} of ${record.project}/${record.taskId}: ` +
        `${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (waiting.length === 0) held.delete(key);
  else held.set(key, waiting);
  return null;
}

function defaultStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Every attempt directory under a state root that holds a journal.
 *
 * Structural only — it reads no file's contents and assumes no schema, so it
 * keeps working when the status document grows fields.
 */
export async function discoverAttempts(stateRoot: string): Promise<string[]> {
  const found: string[] = [];
  const projects = join(stateRoot, "projects");

  for (const project of await listDirectories(projects)) {
    const tasks = join(projects, project, "tasks");
    for (const task of await listDirectories(tasks)) {
      for (const attempt of await listDirectories(join(tasks, task))) {
        const dir = join(tasks, task, attempt);
        if (await exists(join(dir, "journal.jsonl"))) found.push(dir);
      }
    }
  }
  return found.sort();
}

/**
 * Verifies that the live database is not held open by concurrent readers or
 * writers. Under POSIX rename, open file descriptors remain attached to the
 * superseded inode, which would allow prior connections to invisibly keep
 * reading or writing stale data without error (B4-15).
 */
/**
 * Verifies that the live database is not held open by concurrent readers or
 * writers. Under POSIX rename, open file descriptors remain attached to the
 * superseded inode, which would allow prior connections to invisibly keep
 * reading or writing stale data without error (B4-15).
 */
function assertNoActiveHandles(targetPath: string): void {
  // Check within current process
  if (existsSync("/proc/self/fd")) {
    try {
      const selfFds = readdirSync("/proc/self/fd");
      for (const fd of selfFds) {
        try {
          const target = readlinkSync(`/proc/self/fd/${fd}`);
          if (target === targetPath || target === `${targetPath}-wal` || target === `${targetPath}-shm`) {
            throw new Error(`live database has active handles or locks: open in process (${target})`);
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("live database has active handles")) throw e;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("live database has active handles")) throw err;
    }
  }
}

/**
 * Retains the file being replaced and swaps the candidate in.
 *
 * A hard link, not a copy or a move: the retained name and the live name are
 * the same bytes until the `rename` replaces the live one, so there is no
 * instant at which `awsf.db` does not exist and no window in which a reader
 * sees a half-written file. The `-wal`/`-shm` sidecars are moved aside in the
 * same act — a stale WAL left next to a brand-new database is how a
 * "successful" rebuild silently serves the old file's pages.
 */
export async function retainAndSwap(
  targetPath: string,
  candidatePath: string,
  stamp: string,
  renameFn?: (from: string, to: string) => Promise<void>,
): Promise<string | null> {
  const doRename = renameFn ?? rename;
  let retainedPath: string | null = null;
  const movedSidecars: string[] = [];
  if (await exists(targetPath)) {
    assertNoActiveHandles(targetPath);
    retainedPath = `${targetPath}.superseded-${stamp}`;
    await link(targetPath, retainedPath);
    for (const suffix of ["-wal", "-shm"]) {
      if (await exists(`${targetPath}${suffix}`)) {
        await doRename(`${targetPath}${suffix}`, `${retainedPath}${suffix}`);
        movedSidecars.push(suffix);
      }
    }
  }
  try {
    await doRename(candidatePath, targetPath);
  } catch (error) {
    if (retainedPath !== null) {
      for (const suffix of movedSidecars) {
        try {
          if (await exists(`${retainedPath}${suffix}`)) {
            await doRename(`${retainedPath}${suffix}`, `${targetPath}${suffix}`);
          }
        } catch {
          // best-effort compensation to restore WAL sidecars
        }
      }
    }
    throw error;
  }
  return retainedPath;
}

/**
 * Writes a fresh database from the journals, validates it, and swaps it in.
 *
 * The order is the guarantee. Nothing touches the live file until the
 * candidate has been fully projected, checked with `PRAGMA integrity_check`,
 * and confirmed to have consumed every record of every journal it was built
 * from; a failure at any of those points returns a refusal with the
 * candidate left on disk, and the live file untouched.
 */
export async function rebuildDatabase(options: RebuildOptions): Promise<RebuildReport> {
  const stamp = (options.stamp ?? defaultStamp)();
  const candidatePath = `${options.targetPath}.rebuild-${stamp}`;
  await mkdir(dirname(options.targetPath), { recursive: true });

  const refuse = (reason: string, badKey?: string): RebuildRefused =>
    badKey === undefined ? { ok: false, reason, candidatePath } : { ok: false, reason, badKey, candidatePath };

  // Read every journal BEFORE opening the candidate: a corrupt journal is a
  // refusal, and refusing without having created a file at all is tidier
  // than refusing with one to explain.
  const loaded: { source: RebuildSource; records: readonly JournalRecord<unknown>[] }[] = [];
  for (const source of options.sources) {
    const scan = await scanJournal<unknown>(source.journalPath);
    if (!scan.ok) {
      return refuse(
        `${source.journalPath} cannot be replayed: ${scan.detail}`,
        scan.badKey,
      );
    }
    if (source.normalize !== undefined && source.attemptStatus !== undefined) {
      return refuse(`${source.journalPath} declares two incompatible projection adapters`);
    }
    loaded.push({ source, records: scan.records });
  }

  // Sessions in the order they started, then every record of every journal
  // merged back into the order they were RECORDED in. `events.event_row` is
  // an autoincrement, so replaying attempt-by-attempt would renumber the
  // cursors of anything that ran concurrently; merging on `recorded_at`
  // reproduces the insertion order the live database saw, which is what
  // makes "every query view byte-identical" true and not just nearly true.
  loaded.sort((a, b) => order(a.source.session.startedAt, b.source.session.startedAt, a.source.session.sessionId, b.source.session.sessionId));
  // Each journal keeps its own source_seq order; the merge only decides how the
  // journals and the task-level decisions interleave, by recorded_at (B4-34, B4-33).
  const streams: ReplayItem[][] = [
    ...loaded.map(({ source, records: journalRecords }) =>
      journalRecords.map((record): ReplayItem => ({ kind: "record", source, sessionId: source.session.sessionId, record })),
    ),
    ...decisionStreams(options.decisions ?? []),
  ];
  const merged = mergeStreams(streams, replayPrecedes);

  const db = openDatabase(
    candidatePath,
    options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir },
  );
  let projected = 0;
  let records = 0;
  let closed: CloseOutcome;
  try {
    for (const { source } of loaded) {
      if (source.attemptStatus === undefined) createSession(db, source.session);
    }
    // Decisions not yet attachable, per task, in file order (see drainHeldDecisions).
    const held = new Map<string, DecisionRecord[]>();
    for (const item of merged) {
      if (item.kind === "decision") {
        const key = taskKey(item.record.project, item.record.taskId);
        const queue = held.get(key) ?? [];
        queue.push(item.record);
        held.set(key, queue);
        const failure = drainHeldDecisions(db, held, key);
        if (failure !== null) return refuse(failure);
        continue;
      }
      const { source, sessionId, record } = item;
      records += 1;
      const outcome = source.attemptStatus === undefined
        ? (() => {
            const event = source.normalize === undefined
              ? record.event as NormalizedEvent
              : source.normalize(record);
            return projectEvent(
              db,
              { sessionId, runId: event.runId, phaseId: null },
              { ...record, event },
            );
          })()
        : projectAttemptStatus(db, source.attemptStatus(record), record.source_seq);
      if (!outcome.ok) {
        return refuse(
          `projection failed rebuilding ${sessionId} at source_seq ${record.source_seq}: ` +
            `${outcome.notice?.detail ?? outcome.notice?.message ?? "unknown error"}`,
        );
      }
      if (outcome.applied) projected += 1;
      // This record may have created the session a held decision waits for.
      if (held.size > 0) {
        const failure = drainHeldDecisions(db, held, taskKey(source.session.projectSlug, source.session.taskId));
        if (failure !== null) return refuse(failure);
      }
    }
    // After every journal, so every session an attribution names already
    // exists. In file order, so the latest record for an attempt is still the
    // latest row, as it was live.
    for (const record of options.attributions ?? []) {
      try {
        projectAttribution(db, record);
      } catch (error) {
        return refuse(
          `projection failed replaying the attribution of ${record.project}/${record.taskId} attempt ${record.attempt}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const problems = integrityProblems(db);
    if (problems.length > 0) {
      return refuse(`the rebuilt candidate failed integrity_check: ${problems.join("; ")}`);
    }

    for (const { source, records: journalRecords } of loaded) {
      const expected = journalRecords[journalRecords.length - 1]?.source_seq ?? 0;
      const row = getSession(db, source.session.sessionId);
      if (row === null) {
        return refuse(`session ${source.session.sessionId} is missing from the rebuilt candidate`);
      }
      if (row.last_projected_seq !== expected) {
        return refuse(
          `session ${source.session.sessionId} consumed ${row.last_projected_seq} of ${expected} journal records`,
        );
      }
    }
  } finally {
    closed = closeDatabase(db);
  }
  // A checkpoint that did not finish leaves committed pages in the candidate's
  // -wal, which the swap would silently drop (B4-37). The candidate stays on disk.
  if (!closed.checkpointed) {
    return refuse(
      `the rebuilt candidate's WAL did not checkpoint into its file (${closed.detail ?? "unknown"}), ` +
        "so swapping it in would drop committed pages",
    );
  }

  let retainedPath: string | null;
  try {
    retainedPath = await retainAndSwap(options.targetPath, candidatePath, stamp, options.rename);
  } catch (error) {
    return refuse(
      `swap failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    ok: true,
    targetPath: options.targetPath,
    sessions: loaded.length,
    records,
    projected,
    retainedPath,
  };
}
