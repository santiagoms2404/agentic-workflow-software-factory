// The Windows port: `Get-CimInstance Win32_Process` for the census, `taskkill`
// for the ladder.
//
// UNVERIFIED ON WINDOWS. Written on WSL2/Linux against the plan's per-platform
// cancellation ladder, compiled, and run against the same contract suite as the
// other two ports with the census command supplied by the suite. A live run is
// T27, per machine. Nothing in this repository claims native Windows behavior
// until then — and the plan's own v1 position is that native Windows hosts the
// dashboard and read-only workflows while mutation routes through WSL2.
//
// Two things are genuinely different here and both are declared rather than
// papered over:
//
//   1. THERE ARE NO PROCESS GROUPS. The grouping strategy is `ancestry`, a walk
//      over parent links from the registered root. That is weaker than a pgid,
//      which is exactly why a recycled root may not be read as an empty tree —
//      see `membersOf` in the controller.
//   2. THERE IS NO JOB OBJECT HERE. `TerminateJobObject` needs a native helper
//      that does not exist in v1, so termination is `taskkill /T`, which walks
//      the same parent links. When it misses something, the enumeration after it
//      reports the survivor and `terminated` is false. That is the design
//      working: the report is what the ladder measured, never what it intended.

import { EnumerationUnavailable, SignalUnavailable } from "../launcher-barrier.ts";
import type { CommandRunner, PlatformPort, ProcessRow } from "../process-controller.ts";

export interface Win32PortOptions {
  /** Runs the census and the kill. Supplied by the broker; absent means "cannot see". */
  command?: CommandRunner;
  platform?: string;
  censusTimeoutMs?: number;
}

/**
 * The census command, exported so the suite asserts against the argv the port
 * actually runs.
 *
 * One line per process, `pid|ppid|created|cpu`, because a fixed separator is a
 * parser one line long and CSV from PowerShell is a parser that has to know
 * about quoting. `CreationDate` is emitted as a FILETIME so it is comparable
 * with `>=` during the ancestry walk, and `0` when the OS will not report one.
 */
export const WIN32_CENSUS = Object.freeze({
  executable: "powershell.exe",
  argv: Object.freeze([
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate," +
      "KernelModeTime,UserModeTime | ForEach-Object { " +
      '"$($_.ProcessId)|$($_.ParentProcessId)|' +
      "$(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 })|" +
      '$($_.KernelModeTime + $_.UserModeTime)" }',
  ]),
});

export const WIN32_TASKKILL = "taskkill.exe";

/** `taskkill` says this when the process is not there — the ESRCH of this platform. */
const TASKKILL_NOT_FOUND = 128;

function parseRow(line: string): ProcessRow | null {
  const fields = line.trim().split("|");
  if (fields.length < 4) return null;
  const pid = Number(fields[0]);
  const ppid = Number(fields[1]);
  const created = Number(fields[2]);
  const cpu = Number(fields[3]);
  if (!Number.isInteger(pid) || !Number.isInteger(ppid)) return null;
  const startedAt = Number.isFinite(created) && created > 0 ? created : null;
  return {
    pid,
    ppid,
    // No process groups. The controller reads this as "ask the ancestry walk".
    pgid: null,
    // CIM lists running processes; there is no zombie state to exclude.
    alive: true,
    cpu: Number.isFinite(cpu) ? cpu : 0,
    startIdentity: startedAt === null ? null : `win32:${pid}:${startedAt}`,
    startedAt,
  };
}

export function createWin32Port(options: Win32PortOptions = {}): PlatformPort {
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.censusTimeoutMs ?? 10_000;
  const unavailable: (detail: string) => never = (detail) => {
    throw new EnumerationUnavailable(platform, detail);
  };

  return {
    platform,
    identitySource: "win32-cim-creationdate",
    grouping: "ancestry",
    // A census is a PowerShell start-up plus a CIM query. It is the most
    // expensive of the three by a wide margin, so the ladder polls it gently.
    minPollMs: 500,

    census(): readonly ProcessRow[] {
      const run = options.command;
      if (run === undefined) {
        unavailable("no census command runner was supplied to this port");
      }
      const result = run(WIN32_CENSUS.executable, WIN32_CENSUS.argv, timeoutMs);
      if (result.error !== null) unavailable(`the census command could not be run: ${result.error}`);
      if (result.status !== 0) {
        unavailable(
          `the census command exited ${String(result.status)}: ${result.stderr.trim().slice(0, 200)}`,
        );
      }
      const rows: ProcessRow[] = [];
      for (const line of result.stdout.split("\n")) {
        if (line.trim().length === 0) continue;
        const row = parseRow(line);
        if (row !== null) rows.push(row);
      }
      // The querying process is itself in the table, so an empty result is a
      // query that failed quietly rather than a machine running nothing.
      if (rows.length === 0) unavailable("the process census returned no parseable rows");
      return rows;
    },

    /**
     * `taskkill` at the root and at every member the controller just enumerated.
     *
     * Naming the members rather than trusting `/T` alone is the only defence
     * available without a Job Object: `/T` walks the same parent links the
     * census walked, so anything it would miss is exactly what the census
     * already found and can therefore be aimed at directly.
     */
    signalGroup(group: number, signal: "SIGTERM" | "SIGKILL", members: readonly number[]): boolean {
      const run = options.command;
      if (run === undefined) {
        throw new SignalUnavailable(platform, "no command runner was supplied to this port");
      }
      const targets = [...new Set([group, ...members])].filter((pid) => Number.isInteger(pid) && pid > 0);
      if (targets.length === 0) return false;
      const argv = [
        ...targets.flatMap((pid) => ["/PID", String(pid)]),
        "/T",
        // Without `/F` this is a close request, which is this platform's TERM:
        // a process that wants to shut down cleanly gets the chance to.
        ...(signal === "SIGKILL" ? ["/F"] : []),
      ];
      const result = run(WIN32_TASKKILL, argv, timeoutMs);
      if (result.error !== null) {
        throw new SignalUnavailable(platform, `taskkill could not be run: ${result.error}`);
      }
      if (result.status === 0) return true;
      // Everything was already gone. Not a failure — the outcome that was asked
      // for, arriving before the request.
      if (result.status === TASKKILL_NOT_FOUND) return false;
      throw new SignalUnavailable(
        platform,
        `taskkill exited ${String(result.status)}: ${result.stderr.trim().slice(0, 200)}`,
      );
    },
  };
}
