// The Linux port: `/proc` for the census, `kill(-pgid)` for the signal.
//
// This is the reference implementation of `PlatformPort` and the only one this
// repository can honestly say anything about — it is the platform the plan is
// developed on. The darwin and win32 ports beside it are written to the same
// contract and exercised by the same suite, and their live verification is T27,
// per machine.
//
// The rule the whole file exists to keep is one sentence long: a supervisor
// that cannot see is not entitled to say the tree is dead. Everything below
// either reports enumerated truth or throws.
//
// Nothing here decides anything. The TERM → grace → KILL ladder, the identity
// comparison and the survivor report all live in `process-controller.ts`,
// because they are the same on every platform and a ladder per port would be
// three chances to get the ordering wrong.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EnumerationUnavailable, SignalUnavailable } from "../launcher-barrier.ts";
// Type-only, and therefore erased: the controller imports this port for real, so
// a value import in this direction would be a cycle.
import type { PlatformPort, ProcessRow } from "../process-controller.ts";

export interface PosixPortOptions {
  /**
   * Where `/proc` is mounted. Injected so the contract suite can drive the real
   * parser against a synthetic process table — the alternative is testing a
   * `/proc` reader by hoping the machine contains the shapes it needs.
   */
  procRoot?: string;
  /** The platform this port believes it is on. Defaults to the real one. */
  platform?: string;
  /** Delivers the signal. Injected for the same reason as `procRoot`. */
  kill?: (target: number, signal: string) => void;
}

/**
 * Fields 3, 4, 5, 14, 15 and 22 of `/proc/<pid>/stat`.
 *
 * The comm field is parenthesized and may itself contain spaces and brackets,
 * so everything up to the LAST ')' is dropped before splitting. What remains
 * starts at field 3, which puts every index below at `field - 3`.
 */
function parseStat(pid: number, text: string, bootId: string): ProcessRow | null {
  const fields = text.replace(/^.*\)\s/s, "").split(" ");
  const pgid = Number(fields[2]);
  const ppid = Number(fields[1]);
  const startTime = fields[19];
  if (!Number.isInteger(pgid) || !Number.isInteger(ppid) || startTime === undefined) return null;
  return {
    pid,
    ppid,
    pgid,
    // A zombie has been reaped and is waiting to be collected. Counting it as a
    // survivor would turn every successful cancellation into a failed one.
    alive: fields[0] !== "Z",
    cpu: Number(fields[11] ?? 0) + Number(fields[12] ?? 0),
    // The boot id is in front because jiffies-since-boot repeat across reboots.
    startIdentity: `${bootId}:${pid}:${startTime}`,
    startedAt: Number(startTime),
  };
}

/**
 * The signal half of POSIX, shared with the darwin port.
 *
 * The negative pid is the whole point: one call reaches every member of the
 * group, including the ones the host never spawned and cannot name. `false`
 * means the group went away on its own, which is the outcome that was asked
 * for; anything else is a mechanism that did not work and must not be dressed
 * up as one that did.
 */
export function sendGroupSignal(
  platform: string,
  kill: (target: number, signal: string) => void,
  group: number,
  signal: "SIGTERM" | "SIGKILL",
): boolean {
  try {
    kill(-group, signal);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ESRCH") return false;
    // EPERM in particular: the group is somebody else's. That is a refusal, and
    // a refusal reported as a delivered signal is how a tree survives silently.
    throw new SignalUnavailable(platform, `kill(-${group}, ${signal}) failed: ${code ?? String(error)}`);
  }
}

/**
 * The Linux port.
 *
 * Constructed with no arguments it reads the real `/proc` and signals with the
 * real `process.kill`; every argument exists so the contract suite can point the
 * same code at a process table it controls.
 */
export function createPosixPort(options: PosixPortOptions = {}): PlatformPort {
  const procRoot = options.procRoot ?? "/proc";
  const platform = options.platform ?? process.platform;
  const kill = options.kill ?? ((target: number, signal: string): void => {
    process.kill(target, signal);
  });

  // Annotated rather than inferred: without the explicit `never` on the
  // declaration the compiler will not treat a call to it as an exit, and every
  // check below would go on narrowing as if it had returned.
  const unavailable: (detail: string) => never = (detail) => {
    throw new EnumerationUnavailable(platform, detail);
  };

  return {
    platform,
    identitySource: "linux-proc-stat",
    grouping: "process-group",
    // Reading `/proc` is a directory walk and a handful of small files: cheap
    // enough that the ladder can poll it hard and return the moment a tree dies.
    minPollMs: 25,

    census(): readonly ProcessRow[] {
      // The platform check is first because it is the one failure that would
      // otherwise look like success: a machine with no `/proc` returns an empty
      // directory listing, and an empty census is a claim that nothing is alive.
      // A caller that supplies both a `procRoot` and a `platform` is the
      // contract suite driving this parser against a table it built.
      if (platform !== "linux") unavailable("this port reads /proc, which only Linux has");
      let bootId: string;
      let entries: string[];
      try {
        bootId = readFileSync(join(procRoot, "sys", "kernel", "random", "boot_id"), "utf8").trim();
        entries = readdirSync(procRoot);
      } catch (error) {
        return unavailable(`${procRoot} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (bootId.length === 0) unavailable(`${procRoot} reported an empty boot id`);

      const rows: ProcessRow[] = [];
      for (const entry of entries) {
        if (!/^\d+$/.test(entry)) continue;
        let text: string;
        try {
          text = readFileSync(join(procRoot, entry, "stat"), "utf8");
        } catch {
          // Exited between the listing and the read. Not a failure to see — it
          // is the thing we were looking for, arriving early.
          continue;
        }
        const row = parseStat(Number(entry), text, bootId);
        if (row !== null) rows.push(row);
      }
      return rows;
    },

    signalGroup(group: number, signal: "SIGTERM" | "SIGKILL"): boolean {
      return sendGroupSignal(platform, kill, group, signal);
    },
  };
}
