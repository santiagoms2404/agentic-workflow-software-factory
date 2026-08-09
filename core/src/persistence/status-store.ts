// `status.json` and `private/continuity.json` — atomically replaced, never
// partially observable. Every write goes to a fresh temp file and is then
// renamed into place; POSIX and NTFS both make `rename` a single atomic
// syscall, so a concurrent reader either sees the old complete file or the
// new complete file and nothing in between.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { scrubCredentials } from "../policy/redaction.ts";

async function writeAtomic(path: string, value: unknown, mode: number): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(tmp, JSON.stringify(value), { mode });
  await rename(tmp, path);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function tryReadJson<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
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
