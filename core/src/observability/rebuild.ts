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

import { link, mkdir, readdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JournalRecord } from "../persistence/journal.ts";
import { scanJournal } from "../persistence/replay.ts";
import type { NormalizedEvent } from "../contracts/normalized-events.ts";
import type { TaskState } from "../state/task-machine.ts";
import { closeDatabase, integrityProblems, openDatabase, type DatabaseSync } from "./sqlite.ts";
import {
  createSession,
  projectAttemptStatus,
  projectEvent,
  type AttemptStatusProjection,
  type SessionInit,
} from "./projector.ts";
import { getSession } from "./queries.ts";

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
 */
export const STATES_BEYOND_GATING = ["REVIEWING", "AWAITING_OWNER", "LANDING", "LANDED"] as const;

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
 * pure function of ten states and twenty-four edges, and an observability
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
  migrationsDir?: string;
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

  const entries = async (dir: string): Promise<string[]> => {
    try {
      return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  };

  for (const project of await entries(projects)) {
    const tasks = join(projects, project, "tasks");
    for (const task of await entries(tasks)) {
      for (const attempt of await entries(join(tasks, task))) {
        const dir = join(tasks, task, attempt);
        if (await exists(join(dir, "journal.jsonl"))) found.push(dir);
      }
    }
  }
  return found.sort();
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
async function retainAndSwap(targetPath: string, candidatePath: string, stamp: string): Promise<string | null> {
  let retainedPath: string | null = null;
  if (await exists(targetPath)) {
    retainedPath = `${targetPath}.superseded-${stamp}`;
    await link(targetPath, retainedPath);
    for (const suffix of ["-wal", "-shm"]) {
      if (await exists(`${targetPath}${suffix}`)) {
        await rename(`${targetPath}${suffix}`, `${retainedPath}${suffix}`);
      }
    }
  }
  await rename(candidatePath, targetPath);
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
  const merged = loaded
    .flatMap(({ source, records: journalRecords }) =>
      journalRecords.map((record) => ({ source, sessionId: source.session.sessionId, record })),
    )
    .sort((a, b) =>
      order(a.record.recorded_at, b.record.recorded_at, `${a.sessionId}:${a.record.source_seq}`, `${b.sessionId}:${b.record.source_seq}`),
    );

  const db = openDatabase(
    candidatePath,
    options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir },
  );
  let projected = 0;
  let records = 0;
  try {
    for (const { source } of loaded) {
      if (source.attemptStatus === undefined) createSession(db, source.session);
    }
    for (const { source, sessionId, record } of merged) {
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
    closeDatabase(db);
  }

  const retainedPath = await retainAndSwap(options.targetPath, candidatePath, stamp);
  return {
    ok: true,
    targetPath: options.targetPath,
    sessions: loaded.length,
    records,
    projected,
    retainedPath,
  };
}
