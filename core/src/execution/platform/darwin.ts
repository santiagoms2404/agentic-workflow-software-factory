// The macOS port: `ps` for the census, the same POSIX signals for the ladder.
//
// UNVERIFIED ON A MAC. This file is written on WSL2/Linux against the plan's
// per-platform cancellation ladder ("same signals; survivors via
// `ps -o pid=,pgid=,stat=`"), it compiles, and it passes the same contract suite
// the Linux port passes — driven by a census command the suite supplies. What it
// does NOT have is a run on real macOS, and that is T27's, per machine. Nothing
// in this repository claims macOS behavior until then.
//
// The one structural difference from the Linux port is where the census comes
// from. There is no `/proc`, so the process table arrives as the stdout of a
// command — and a port may not spawn, because `node:child_process` is importable
// in exactly one module. The runner is therefore injected, and a port handed no
// runner cannot enumerate and says so, rather than returning `[]`.

import { EnumerationUnavailable } from "../launcher-barrier.ts";
import type { CommandRunner, PlatformPort, ProcessRow } from "../process-controller.ts";
import { sendGroupSignal } from "./posix.ts";

export interface DarwinPortOptions {
  /** Runs the census command. Supplied by the broker; absent means "cannot see". */
  command?: CommandRunner;
  /** The platform this port believes it is on. Defaults to the real one. */
  platform?: string;
  kill?: (target: number, signal: string) => void;
  censusTimeoutMs?: number;
}

/**
 * The census command, as one exported constant so the contract suite and any
 * future capture fixture assert against the same argv the port actually runs.
 *
 * `lstart` is LAST because it is the only field containing spaces — everything
 * before it is a fixed count of tokens, and everything after the fifth is the
 * date. `stat` rather than `state` is the spelling the plan's ladder names.
 */
export const DARWIN_CENSUS = Object.freeze({
  executable: "/bin/ps",
  argv: Object.freeze(["-A", "-o", "pid=,ppid=,pgid=,stat=,time=,lstart="]),
});

/**
 * `[[hh:]mm:]ss[.cc]` to hundredths.
 *
 * The units are arbitrary — the monitor compares this against its previous
 * reading and cares only whether it moved — but they have to be MONOTONIC and
 * they have to be the same units every time, which is why this parses rather
 * than trusting the string to compare.
 */
function cpuHundredths(value: string): number {
  const parts = value.split(":");
  let total = 0;
  for (const part of parts) {
    const parsed = Number(part);
    if (!Number.isFinite(parsed)) return 0;
    total = total * 60 + parsed;
  }
  return Math.round(total * 100);
}

function parseRow(line: string): ProcessRow | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 6) return null;
  const pid = Number(tokens[0]);
  const ppid = Number(tokens[1]);
  const pgid = Number(tokens[2]);
  const stat = tokens[3] ?? "";
  if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(pgid)) return null;

  // Whitespace-collapsed so the identity is stable across `ps` padding the day
  // of the month to two columns. Only string equality is ever asked of it.
  const started = tokens.slice(5).join(" ");
  const startedAt = Date.parse(started);
  return {
    pid,
    ppid,
    pgid,
    // BSD `stat` puts the state first and flags after it: "Z", "Ss", "S+".
    alive: !stat.startsWith("Z"),
    cpu: cpuHundredths(tokens[4] ?? "0"),
    startIdentity: started.length === 0 ? null : `darwin:${pid}:${started}`,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
  };
}

export function createDarwinPort(options: DarwinPortOptions = {}): PlatformPort {
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.censusTimeoutMs ?? 5_000;
  const kill = options.kill ?? ((target: number, signal: string): void => {
    process.kill(target, signal);
  });
  const unavailable: (detail: string) => never = (detail) => {
    throw new EnumerationUnavailable(platform, detail);
  };

  return {
    platform,
    identitySource: "darwin-ps-lstart",
    grouping: "process-group",
    // A census here costs a `fork`+`exec` of `ps`. Polling it at the Linux
    // port's rate would spend more time enumerating the tree than killing it.
    minPollMs: 250,

    census(): readonly ProcessRow[] {
      const run = options.command;
      if (run === undefined) {
        unavailable("no census command runner was supplied to this port");
      }
      const result = run(DARWIN_CENSUS.executable, DARWIN_CENSUS.argv, timeoutMs);
      if (result.error !== null) unavailable(`ps could not be run: ${result.error}`);
      if (result.status !== 0) {
        unavailable(`ps exited ${String(result.status)}: ${result.stderr.trim().slice(0, 200)}`);
      }
      const lines = result.stdout.split("\n").filter((line) => line.trim().length > 0);
      // `ps -A` always lists at least itself, so an empty table is not a machine
      // with nothing running on it — it is a census that did not happen.
      if (lines.length === 0) unavailable("ps listed no processes at all");

      const rows: ProcessRow[] = [];
      for (const line of lines) {
        const row = parseRow(line);
        if (row !== null) rows.push(row);
      }
      if (rows.length === 0) unavailable("no line of ps output parsed as a process");
      return rows;
    },

    signalGroup(group: number, signal: "SIGTERM" | "SIGKILL"): boolean {
      return sendGroupSignal(platform, kill, group, signal);
    },
  };
}
