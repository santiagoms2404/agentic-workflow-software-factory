// A system prompt is not public.
//
// Both real adapters take their system prompt as a FILE PATH on argv — Claude
// Code's `--append-system-prompt-file`, pi's `--append-system-prompt` — and both
// also offer a flag that takes the text itself. Reaching for that flag would
// publish the prompt to every other process on the machine, because argv is
// world readable on every platform this harness targets. So the rule lives here,
// once, rather than as two adapters' private good intentions.
//
// It is a separate file from `env.ts` for the same reason `usage.ts` is separate
// from `event-sequencer.ts`: the environment rule is about what a child may
// INHERIT, and this is about what a file on disk may EXPOSE. They are enforced
// at different moments and fail with different codes.

import { lstat, mkdtemp, open } from "node:fs/promises";
import { constants, statSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { platform } from "node:process";
import { AdapterError } from "./interface.ts";

/** The one name the prompt is materialized under inside its directory. */
export const SYSTEM_PROMPT_FILE_NAME = "system-prompt.md";

// Windows has no O_NOFOLLOW; there the lstat refusal below is the guard.
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Refuses a prompt slot that is anything but absent or a plain file of its own.
 *
 * B11-02: the session runtime the prompt is written into is bound WRITABLE
 * into the provider sandbox, so a write-capable agent can plant
 * `<runtime>/system-prompt.md` as a symlink (or a hard link) to any host file.
 * A relaunch into the same runtime then rewrites the prompt there, and a write
 * that follows the link truncates and chmods the host file as the AWSF user.
 * This is the containment check, run BEFORE anything is written: the old
 * realpath check ran after the write had already landed on the target.
 */
export async function assertSystemPromptSlot(adapter: string, directory: string): Promise<void> {
  const path = join(directory, SYSTEM_PROMPT_FILE_NAME);
  const existing = await lstatOrNull(path);
  if (existing !== null && (!existing.isFile() || existing.nlink !== 1)) {
    throw new AdapterError(
      adapter,
      "E_REDACTION",
      `the private system prompt slot ${path} is not a plain file inside its session runtime; refusing to write through it`,
    );
  }
}

/**
 * Writes a system prompt somewhere only this user can read it, and returns the
 * path the adapter will put on argv.
 *
 * The mode is set with an explicit `chmod` rather than left to the open mode:
 * the open mode is masked by `umask`, and a permissive umask would quietly
 * produce a 0644 file that looked deliberate.
 *
 * Nothing here follows a link (B11-02). A new file is created with
 * O_CREAT|O_EXCL|O_NOFOLLOW, so a link or file raced into the slot after the
 * lstat fails the open instead of being written through. A relaunch rewrites
 * the regular file an earlier launch left: it is opened with O_NOFOLLOW and
 * WITHOUT O_TRUNC, re-checked on the opened handle (a regular file with one
 * link), and only then chmodded, truncated and written through that handle.
 * There is no unlink-and-recreate: the no-destructive-paths fence admits no
 * new delete path, and none is needed.
 */
export async function writeSystemPromptFile(text: string, directory?: string): Promise<string> {
  const dir = directory ?? (await mkdtemp(join(tmpdir(), "awsf-system-prompt-")));
  const path = join(dir, SYSTEM_PROMPT_FILE_NAME);
  await assertSystemPromptSlot("system-prompt-file", dir);
  const fresh = (await lstatOrNull(path)) === null;
  const flags = fresh
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW
    : constants.O_WRONLY | O_NOFOLLOW;
  const handle = await open(path, flags, 0o600);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1) {
      throw new AdapterError(
        "system-prompt-file",
        "E_REDACTION",
        `the private system prompt slot ${path} changed under the write; refusing to write through it`,
      );
    }
    await handle.chmod(0o600);
    await handle.truncate(0);
    await handle.writeFile(text);
  } finally {
    await handle.close();
  }
  return path;
}

/**
 * Refuses a system prompt any other account on the machine can read.
 *
 * Checked at LAUNCH rather than only at write, because the file the caller hands
 * over is not necessarily the file `writeSystemPromptFile` created — and a 0600
 * written here is worth nothing if the launch path accepts a 0644 from anywhere
 * else.
 */
export function assertPrivateSystemPrompt(adapter: string, path: string): void {
  if (!isAbsolute(path)) {
    throw new AdapterError(
      adapter,
      "E_INVALID_REQUEST",
      `the system prompt path must be absolute, got ${JSON.stringify(path)}`,
    );
  }
  // EXISTENCE IS CHECKED ON EVERY PLATFORM. The carve-out below is for the
  // mode bits and for nothing else, and the order matters: when the `win32`
  // return sat above this stat, a Windows launch skipped the existence check
  // too — and on the pi route that is not a missing safeguard but a silent
  // substitution, because `--append-system-prompt` falls back to treating its
  // value as literal TEXT when the path does not exist. The run would have gone
  // out with the string `C:\…\system-prompt.md` as its system prompt and
  // nothing anywhere would have said so.
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch (error) {
    throw new AdapterError(
      adapter,
      "E_INVALID_REQUEST",
      `the system prompt file ${path} cannot be read: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // POSIX mode bits are the mechanism, and Windows does not have them.
  //
  // There, `statSync().mode` reflects only the read-only attribute — 0o666, or
  // 0o444 when read-only — no matter what the ACL says, and `chmod` toggles
  // that one bit and nothing else. So `(mode & 0o077) !== 0` is unconditionally
  // true on Windows, and this function would have thrown `E_REDACTION` for
  // every system prompt including the ones `writeSystemPromptFile` had just
  // created: no request carrying a system prompt could ever have launched.
  //
  // This is a documented CARVE-OUT and not a claim. On Windows the file's
  // privacy comes from the ACL on the user profile directory it lives in, which
  // this code neither sets nor reads, and asserting anything stronger would be
  // a platform claim made from a machine that is not that platform — which the
  // plan's cross-platform note forbids. Verifying what protection actually
  // holds there is T27's, per machine — and a file the operator placed
  // somewhere world-readable, `C:\Users\Public\` being the obvious way, is
  // exactly what that verification owes an answer about.
  if (platform === "win32") return;
  if ((mode & 0o077) !== 0) {
    throw new AdapterError(
      adapter,
      "E_REDACTION",
      `the system prompt file ${path} is readable beyond its owner ` +
        `(mode ${(mode & 0o777).toString(8)}); a system prompt is not public`,
    );
  }
}
