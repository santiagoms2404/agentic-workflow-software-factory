// `status.json` and `private/continuity.json` — atomically replaced, never
// partially observable. Every write goes to a fresh temp file, is fsynced,
// and is then renamed into place; POSIX and NTFS both make `rename` a single
// atomic syscall, so a concurrent reader either sees the old complete file
// or the new complete file and nothing in between.

import { mkdir, open, readFile, rename, lstat, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { scrubCredentials } from "../policy/redaction.ts";

type TempIdentity = { readonly dev: number; readonly ino: number; readonly mode: number };
interface OwnedTemp {
  readonly path: string;
  readonly identity: TempIdentity;
  expected: Buffer;
}

function sameTemp(stat: { readonly dev: number; readonly ino: number; readonly mode: number; readonly nlink: number; isFile(): boolean; isSymbolicLink(): boolean }, owned: OwnedTemp, links = 1): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === links &&
    stat.dev === owned.identity.dev && stat.ino === owned.identity.ino &&
    (stat.mode & 0o777) === owned.identity.mode;
}

async function tempMatches(owned: OwnedTemp): Promise<boolean> {
  try {
    const before = await lstat(owned.path);
    if (!sameTemp(before, owned)) return false;
    const bytes = await readFile(owned.path);
    const after = await lstat(owned.path);
    return sameTemp(after, owned) && bytes.equals(owned.expected);
  } catch { return false; }
}

/** Removes only the exclusive-created inode while it still contains our exact written prefix. */
async function removeOwnedTemp(owned: OwnedTemp): Promise<void> {
  if (!await tempMatches(owned)) return;
  try { await unlink(owned.path); } catch { /* preserve uncertain or no-longer-present paths */ }
}

async function writeAtomic(path: string, value: unknown, mode: number): Promise<void> {
  // Serialize before creating anything: caller data that cannot be encoded must
  // not be mistaken for a temporary-file failure or trigger cleanup by name.
  const json = JSON.stringify(value);
  if (typeof json !== "string") throw new TypeError("status value is not JSON serializable");
  const bytes = Buffer.from(json, "utf8");
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${randomBytes(16).toString("hex")}.tmp`);
  let handle: FileHandle | undefined;
  let owned: OwnedTemp | undefined;
  let failed = false;
  let failure: unknown;
  try {
    handle = await open(tmp, "wx", mode);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("status temporary is not an exclusive regular file");
    owned = { path: tmp, identity: { dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777 }, expected: Buffer.alloc(0) };
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.write(bytes, offset, bytes.length - offset, null);
      if (result.bytesWritten === 0) throw new Error("status temporary write made no progress");
      offset += result.bytesWritten;
      owned.expected = Buffer.from(bytes.subarray(0, offset));
    }
    await handle.sync();
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (handle !== undefined) {
    try { await handle.close(); }
    catch (error) { if (!failed) { failed = true; failure = error; } }
  }
  if (failed) {
    if (owned !== undefined) await removeOwnedTemp(owned);
    throw failure;
  }
  if (owned === undefined || !await tempMatches(owned)) {
    if (owned !== undefined) await removeOwnedTemp(owned);
    throw new Error("status temporary changed before publication");
  }
  try {
    await rename(tmp, path);
  } catch (error) {
    await removeOwnedTemp(owned);
    throw error;
  }
  try {
    const dirHandle = await open(dir, "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    // Ignore platforms where directory fsync is unsupported
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function tryReadJson<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, "utf8");
    if (text.trim().length === 0) return null;
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Replaces `status.json` atomically. Never truncated-then-written in place. */
export function writeStatus(path: string, status: unknown): Promise<void> {
  return writeAtomic(path, scrubCredentials(status), 0o644);
}

export function readStatus<T>(path: string): Promise<T> {
  return readJson<T>(path);
}

/** `null` when no status has been written yet, rather than throwing ENOENT. */
export function tryReadStatus<T>(path: string): Promise<T | null> {
  return tryReadJson<T>(path);
}

/** `private/continuity.json`, mode 0600 — never world- or group-readable. */
export function writeContinuity(path: string, continuity: unknown): Promise<void> {
  return writeAtomic(path, scrubCredentials(continuity), 0o600);
}

export function readContinuity<T>(path: string): Promise<T> {
  return readJson<T>(path);
}

export function tryReadContinuity<T>(path: string): Promise<T | null> {
  return tryReadJson<T>(path);
}
