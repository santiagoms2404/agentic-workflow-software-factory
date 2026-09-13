import { randomUUID } from "node:crypto";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AttemptLock } from "../persistence/attempt-lock.ts";
import { createHostPort } from "./process-controller.ts";
import { runSystemCommand } from "./transport-broker.ts";

interface Holder { id: string; pid: number; startIdentity: string }
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
