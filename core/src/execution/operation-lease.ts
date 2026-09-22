import { randomUUID } from "node:crypto";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AttemptLock } from "../persistence/attempt-lock.ts";
import { createHostPort } from "./process-controller.ts";
import { runSystemCommand } from "./transport-broker.ts";

export interface Holder { id: string; pid: number; startIdentity: string }
const pathFor = (directory: string) => join(directory, "execution-lease.json");
async function holder(directory: string): Promise<Holder | null> {
  try {
    const path = pathFor(directory);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.nlink !== 1 || (process.getuid !== undefined && info.uid !== process.getuid())) throw new Error("unsafe execution lease");
    const value = JSON.parse(await readFile(path, "utf8")) as Holder;
    if (!Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.id !== "string" || !value.id || typeof value.startIdentity !== "string" || !value.startIdentity) throw new Error("ambiguous execution lease");
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
/**
 * THIS process holds the attempt's execution lease, right now.
 *
 * `assertNoExecutionController` proves nobody else is driving; this proves the
 * caller is. A recovery that adopts an interrupted run's leftovers needs both:
 * the lease was the thing that dead run held, so holding it now is what makes
 * "the writer is gone" a fact rather than an assumption.
 */
export async function ownExecutionLease(directory: string): Promise<Holder> {
  const current = await holder(directory);
  if (current === null || current.pid !== process.pid) throw new Error("this process does not hold the attempt's execution lease");
  return current;
}

export async function assertOwnExecutionLease(directory: string): Promise<void> {
  await ownExecutionLease(directory);
}

/**
 * The controller a durable record names is not running now.
 *
 * `assertNoExecutionController` asks about whoever holds the lease *file*;
 * this asks about one specific, already-recorded process — the one that created
 * an artefact a recovery is about to adopt. A lease file can be gone while its
 * writer lives, so "no controller" is not the same fact as "that writer is
 * dead", and the second is the one an adoption needs. `startIdentity` is what
 * makes it proof against PID reuse; a port that cannot report one is treated as
 * a live match, never as an absence.
 */
export function assertControllerSettled(controller: { pid: number; startIdentity: string }, what: string): void {
  const live = createHostPort({ command: runSystemCommand }).census().find(row => row.pid === controller.pid && row.alive);
  if (live !== undefined && (live.startIdentity === null || live.startIdentity === controller.startIdentity)) {
    throw new Error(`${what} was created by process ${String(controller.pid)}, which is still running; recovery never takes over from a live writer`);
  }
}

export async function assertNoExecutionController(directory: string): Promise<void> {
  const old = await holder(directory);
  if (old === null) return;
  const rows = createHostPort({ command: runSystemCommand }).census();
  const live = rows.find(row => row.pid === old.pid && row.alive);
  if (live !== undefined && (live.startIdentity === null || live.startIdentity === old.startIdentity)) throw new Error("attempt already has a live or unknown execution controller");
}
/** A separate claim lock serializes lease takeover without colliding with journal write locks. */
export async function withExecutionLease<T>(directory: string, validate: () => Promise<void>, execute: (id: string) => Promise<T>): Promise<T> {
  const id = randomUUID();
  await new AttemptLock(join(directory, "execution-claim.lock")).withLock(async () => {
    await assertNoExecutionController(directory);
    await validate();
    const self = createHostPort({ command: runSystemCommand }).census().find(row => row.pid === process.pid && row.alive);
    if (!self?.startIdentity) throw new Error("cannot establish controller identity");
    const old = await holder(directory);
    if (old !== null) await unlink(pathFor(directory));
    const file = await open(pathFor(directory), "wx", 0o600);
    try { await file.writeFile(JSON.stringify({ id, pid: process.pid, startIdentity: self.startIdentity })); await file.sync(); }
    finally { await file.close(); }
    const parent = await open(directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
  });
  try { return await execute(id); }
  finally {
    await new AttemptLock(join(directory, "execution-claim.lock")).withLock(async () => {
      if ((await holder(directory))?.id !== id) throw new Error("execution lease changed owner");
      await unlink(pathFor(directory));
    });
  }
}
