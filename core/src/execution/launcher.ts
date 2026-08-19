// The gated child. Eighteen lines of behavior, and the only reason the
// kill-host proof is possible.
//
// It is NOT a library. It is an entry point the broker executes:
//
//     node --no-warnings --experimental-strip-types launcher.ts <payload>
//
// and its whole life is four steps: report who I am, block, verify the release
// token, become the provider. It imports `node:fs` and the wire protocol and
// nothing else — every additional import is another way to die between "report"
// and "block", which is the one window where a failure would be invisible.
//
// Everything is SYNCHRONOUS. An `await` here would return to the event loop
// between the identity report and the blocking read, and a process that is
// idling in the event loop with a live control channel is a process that could
// be doing something other than waiting.

import fs from "node:fs";
import {
  IDENTITY_FD,
  LAUNCHER_EXIT,
  RELEASE_FD,
  RELEASE_TOKEN,
  decodeLaunchPayload,
  formatIdentityLine,
  type LaunchPayload,
  type ProcessIdentity,
} from "./launcher-barrier.ts";

/** `process.execve` is Experimental and POSIX-only; there is no @types/node here to say so. */
type Execve = (file: string, argv: readonly string[], env: Record<string, string>) => never;

/**
 * Says why on stderr and leaves, with a code the host can read.
 *
 * The unreachable `throw` is what makes the return type `never` true to the
 * compiler: without `@types/node`, `process.exit` is not known to be
 * non-returning, and a `die` that might return would leave every check below
 * unnarrowed — including the one guarding the exec.
 */
function die(code: number, message: string): never {
  fs.writeSync(2, `launcher: ${message}\n`);
  process.exit(code);
  throw new Error("unreachable");
}

/**
 * `<boot-id>:<pid>:<starttime>` — an identity that survives PID reuse and, more
 * importantly, survives `execve`.
 *
 * Field 22 of `/proc/<pid>/stat` is the task's start time in jiffies since
 * boot. `execve` replaces the image, not the task, so the number the launcher
 * reads here is still the provider's after it has become the provider. The boot
 * id is in front because jiffies-since-boot repeats across reboots.
 *
 * Off Linux this returns `null` with a source that says why. A null identity is
 * honest; a PID presented as an identity is not — and `sameProcess` refuses to
 * match a null, so a platform without this reader cannot accidentally authorize
 * a kill.
 */
function readIdentity(): ProcessIdentity {
  const pid = process.pid;
  if (process.platform !== "linux") {
    // `detached: true` made this process a session leader, so it leads its own
    // group and pgid is its pid. That is the broker's guarantee, not a guess.
    return { pid, pgid: pid, startIdentity: null, startIdentitySource: `unavailable:${process.platform}` };
  }
  try {
    // The comm field is parenthesized and may contain spaces, so everything up
    // to the last ')' is dropped before splitting. What remains starts at
    // field 3, which puts pgrp (field 5) at index 2 and starttime (22) at 19.
    const fields = fs.readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\)\s/s, "").split(" ");
    const pgid = Number(fields[2]);
    const startTime = fields[19];
    const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    if (!Number.isInteger(pgid) || pgid <= 0 || startTime === undefined || bootId.length === 0) {
      throw new Error("incomplete /proc/self/stat");
    }
    return {
      pid,
      pgid,
      startIdentity: `${bootId}:${pid}:${startTime}`,
      startIdentitySource: "linux-proc-stat",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { pid, pgid: pid, startIdentity: null, startIdentitySource: `unreadable:${detail}` };
  }
}

/**
 * Blocks until a whole line arrives on the control channel.
 *
 * A read of zero bytes is EOF, and EOF means the host is gone — the descriptor
 * this child is holding was the write end of a pipe only the host had. That is
 * the kill-host contract expressed in three lines: no host, no release, no
 * provider. The exit code says which of the two happened so the journal does
 * not have to infer it.
 */
function awaitRelease(): void {
  const buffer = Buffer.alloc(64);
  let received = "";
  while (!received.includes("\n")) {
    // `position: null` reads from the file-descriptor's current offset, which is
    // what a pipe requires; the 4-argument form has no overload.
    const count = fs.readSync(RELEASE_FD, buffer, 0, buffer.length, null);
    if (count === 0) process.exit(LAUNCHER_EXIT.controlChannelClosed);
    received += buffer.toString("utf8", 0, count);
  }
  if (received.slice(0, received.indexOf("\n")).trim() !== RELEASE_TOKEN) {
    process.exit(LAUNCHER_EXIT.refusedRelease);
  }
}

// argv[2] is the payload. argv[3], when present, is the run id — put there by
// the broker so a human at a `ps` can tell which run a child blocked at the
// barrier belongs to. It is never read here.
const payload = ((): LaunchPayload => {
  try {
    return decodeLaunchPayload(process.argv[2] ?? "");
  } catch (error) {
    return die(LAUNCHER_EXIT.badPayload, error instanceof Error ? error.message : String(error));
  }
})();

const execve = (process as unknown as { execve?: Execve }).execve;
if (typeof execve !== "function") {
  // Refused BEFORE the identity report, so the host never registers a process
  // whose PID it could not have kept. Windows keeps PID stability a different
  // way — suspended creation inside a Job Object — and that port is T11's.
  die(LAUNCHER_EXIT.execUnavailable, "this runtime cannot execve; PID stability is not available");
}

fs.writeSync(IDENTITY_FD, formatIdentityLine(readIdentity()));
awaitRelease();

// Closed before the exec so the provider never inherits the control channel.
// A provider holding fd4 could read its own release token; a provider holding
// fd3 could forge an identity for the next launch.
fs.closeSync(IDENTITY_FD);
fs.closeSync(RELEASE_FD);

// PID preserved. stdin/stdout/stderr are inherited across the replacement, so
// the prompt the broker writes next lands in the provider, not in a launcher
// that no longer exists.
execve(payload.executable, [payload.executable, ...payload.argv], process.env as Record<string, string>);
