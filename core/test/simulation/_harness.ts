// Shared fixtures for the M2 simulations.
//
// One reducer defines the whole simulated world: `applyEvent` folds a journal
// record into a status, `validate` uses it to produce the next status during
// the write protocol, and recovery uses it as its `derive`. That is the point
// — "reconstruct exactly" is only meaningful when the status is a function of
// the journal, so the simulation is built the way the real system claims to
// be rather than around a status the journal could not have produced.
//
// Identity comes from the attempt's own path, history from its journal.
// Between them, nothing outside the attempt directory is needed to rebuild
// everything a dashboard displays.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { JournalRecord } from "../../src/persistence/journal.ts";
import { Journal } from "../../src/persistence/journal.ts";
import {
  AttemptLock,
  runWriteProtocol,
  type WriteProtocolStep,
} from "../../src/persistence/attempt-lock.ts";
import { tryReadStatus } from "../../src/persistence/status-store.ts";
import { attemptDir, statusFilePath } from "../../src/persistence/platform-paths.ts";
import type { TaskState } from "../../src/state/task-machine.ts";
import type { SessionInit } from "../../src/observability/projector.ts";

export const PROJECT = "sim-project";
export const TASK = "T99";
export const ATTEMPT = "1";
export const STARTED_AT = "2026-08-06T00:00:00.000Z";

export interface SimStatus {
  session_id: string;
  project_slug: string;
  task_id: string;
  attempt: number;
  lifecycle_state: TaskState;
  last_source_seq: number;
  last_event_kind: string;
  events_seen: number;
  revision: number;
}

/**
 * Identity read out of the attempt's path — `<root>/projects/<p>/tasks/<t>/<a>`.
 *
 * Deliberately not read from `status.json`: the rebuild guarantee says the
 * journals are enough, and a fixture that needed the status document to
 * reconstruct identity would quietly weaken that claim.
 */
export function identityFromAttemptDir(dir: string): { project: string; task: string; attempt: number } {
  const parts = dir.split(sep).filter((p) => p.length > 0);
  // …/projects/<project>/tasks/<task>/<attempt>
  const attempt = parts[parts.length - 1] ?? "1";
  const task = parts[parts.length - 2] ?? "unknown-task";
  const project = parts[parts.length - 4] ?? "unknown-project";
  return { project, task, attempt: Number(attempt) };
}

export function sessionIdFor(dir: string): string {
  const { project, task, attempt } = identityFromAttemptDir(dir);
  return `${project}:${task}:${attempt}`;
}

/** Run ids are host-minted and globally unique — `events.event_id` is built from one. */
export function runIdFor(dir: string): string {
  const { project, task, attempt } = identityFromAttemptDir(dir);
  return `run-${project}-${task}-${attempt}`;
}

export function sessionInitFor(dir: string): SessionInit {
  const { project, task, attempt } = identityFromAttemptDir(dir);
  return {
    sessionId: sessionIdFor(dir),
    projectSlug: project,
    taskId: task,
    continuesTask: null,
    groupId: null,
    attempt,
    workflowId: "plan-build-test",
    riskTier: 1,
    isProtected: false,
    requestText: `simulated request for ${task}`,
    callCeiling: 12,
    configSnapshotJson: "{}",
    journalPath: join(dir, "journal.jsonl"),
    startedAt: STARTED_AT,
  };
}

export function initialStatus(dir: string): SimStatus {
  const { project, task, attempt } = identityFromAttemptDir(dir);
  return {
    session_id: sessionIdFor(dir),
    project_slug: project,
    task_id: task,
    attempt,
    lifecycle_state: "DRAFT",
    last_source_seq: 0,
    last_event_kind: "(none)",
    events_seen: 0,
    revision: 0,
  };
}

const LIFECYCLE_BY_KIND: Partial<Record<NormalizedEvent["kind"], TaskState>> = {
  "run.started": "RUNNING",
  "run.completed": "GATING",
  "run.failed": "BLOCKED",
};

/** The one reducer. Deterministic in the record alone — no clock, no counter of its own. */
export function applyEvent(status: SimStatus, event: NormalizedEvent, sourceSeq: number): SimStatus {
  return {
    ...status,
    lifecycle_state: LIFECYCLE_BY_KIND[event.kind] ?? status.lifecycle_state,
    last_source_seq: sourceSeq,
    last_event_kind: event.kind,
    events_seen: status.events_seen + 1,
    revision: status.revision + 1,
  };
}

export function deriveFor(dir: string) {
  return (records: readonly JournalRecord<NormalizedEvent>[]): SimStatus =>
    records.reduce<SimStatus>((status, record) => applyEvent(status, record.event, record.source_seq), initialStatus(dir));
}

/**
 * The nth event of the simulated run. Every field is a function of `n` —
 * including `hostAt` — so two runs of the same length are byte-identical and
 * a comparison between them means something.
 */
export function simEvent(runId: string, n: number, terminal: "completed" | "failed" | null = null): NormalizedEvent {
  const hostAt = `2026-08-06T00:00:${String(n).padStart(2, "0")}.000Z`;
  const base = { seq: n, runId, hostAt, providerAt: null };
  if (terminal === "completed") return { ...base, kind: "run.completed", exitCode: 0 };
  if (terminal === "failed") return { ...base, kind: "run.failed", errorCode: "E_BACKEND_FAILURE", message: "simulated fault" };
  if (n === 1) return { ...base, kind: "run.started", adapter: "stub", requestedModel: "stub-model" };
  if (n % 3 === 2) return { ...base, kind: "text.delta", text: `chunk ${n}` };
  return { ...base, kind: "thinking.delta", text: `pondering ${n}` };
}

// This simulation mirrors the lifecycle vocabulary by hand. No fence ties this
// literal to `core/src/state/task-machine.ts`, so lifecycle changes must move it.
export const TERMINAL_STATES: readonly TaskState[] = ["LANDED", "PUBLISHED", "BLOCKED", "CANCELLED"];

export interface DriveOptions {
  attemptDir: string;
  /** 1-based index of the first write this call performs. */
  from: number;
  count: number;
  /** The last write carries a terminal event, so the seal step has something to do. */
  terminal?: "completed" | "failed" | null;
  dbPath?: string | null;
  onStep?: (write: number, step: WriteProtocolStep) => void | Promise<void>;
  afterWrite?: (write: number, status: SimStatus) => void | Promise<void>;
  /** Pre-seals the lock when a recovered status says the attempt already ended. */
  sealedState?: string | null;
}

/**
 * Drives `count` writes of the real write protocol against a real attempt
 * directory. The crash child and the control run are the same code path with
 * a different `onStep`, so a kill lands on the protocol the system actually
 * runs.
 */
export async function driveWrites(options: DriveOptions): Promise<SimStatus | null> {
  const dir = options.attemptDir;
  const statusPath = statusFilePath(dir);
  const lock = new AttemptLock(join(dir, "attempt.lock"));
  if (options.sealedState != null) lock.seal(options.sealedState);
  const journal = new Journal<NormalizedEvent>(join(dir, "journal.jsonl"));

  // Loaded on demand: the crash child spawns once per boundary in the matrix,
  // and pulling the projector's schema graph in for a run that projects
  // nothing costs more than the kill it is there to inject.
  let projectRecord: ((record: JournalRecord<NormalizedEvent>) => void) | null = null;
  let closeDb: (() => void) | null = null;
  if (options.dbPath != null) {
    const [{ openDatabase, closeDatabase }, { createSession, projectEvent }] = await Promise.all([
      import("../../src/observability/sqlite.ts"),
      import("../../src/observability/projector.ts"),
    ]);
    const db = openDatabase(options.dbPath);
    createSession(db, sessionInitFor(dir));
    projectRecord = (record) => {
      projectEvent(db, { sessionId: sessionIdFor(dir), runId: record.event.runId, phaseId: null }, record);
    };
    closeDb = () => closeDatabase(db);
  }

  let last: SimStatus | null = null;
  try {
    const end = options.from + options.count - 1;
    for (let write = options.from; write <= end; write += 1) {
      const isLast = write === end;
      const event = simEvent(runIdFor(dir), write, isLast ? (options.terminal ?? null) : null);
      last = await runWriteProtocol<NormalizedEvent, SimStatus>({
        lock,
        journal,
        statusPath,
        readCurrentStatus: () => tryReadStatus<SimStatus>(statusPath),
        validate: (current) => ({
          event,
          nextStatus: applyEvent(current ?? initialStatus(dir), event, write),
        }),
        project: (record) => projectRecord?.(record),
        sealWhenTerminal: (status) =>
          TERMINAL_STATES.includes(status.lifecycle_state) ? status.lifecycle_state : null,
        onStep: (step) => options.onStep?.(write, step),
      });
      await options.afterWrite?.(write, last);
    }
  } finally {
    await journal.close();
    closeDb?.();
  }
  return last;
}

export async function makeStateRoot(prefix = "awsf-sim-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export function simAttemptDir(stateRoot: string, project = PROJECT, task = TASK, attempt = ATTEMPT): string {
  return attemptDir(stateRoot, project, task, attempt);
}

/** Key order must not decide whether two documents are the same document. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
