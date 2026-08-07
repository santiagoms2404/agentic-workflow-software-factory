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

import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { platform } from "node:process";
import { AdapterError } from "./interface.ts";

/**
 * Writes a system prompt somewhere only this user can read it, and returns the
 * path the adapter will put on argv.
 *
 * The mode is set with an explicit `chmod` after the write rather than left to
 * the open mode: the open mode is masked by `umask`, and a permissive umask
 * would quietly produce a 0644 file that looked deliberate.
 */
export async function writeSystemPromptFile(text: string, directory?: string): Promise<string> {
  const dir = directory ?? (await mkdtemp(join(tmpdir(), "awsf-system-prompt-")));
  const path = join(dir, "system-prompt.md");
  await writeFile(path, text, { mode: 0o600 });
  await chmod(path, 0o600);
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
  // holds there is T27's, per machine.
  if (platform === "win32") return;
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
  if ((mode & 0o077) !== 0) {
    throw new AdapterError(
      adapter,
      "E_REDACTION",
      `the system prompt file ${path} is readable beyond its owner ` +
        `(mode ${(mode & 0o777).toString(8)}); a system prompt is not public`,
    );
  }
}
