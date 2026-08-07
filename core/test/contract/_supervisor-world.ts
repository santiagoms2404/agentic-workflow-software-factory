// A process table the contract suite controls, rendered three ways.
//
// Every port answers the same two questions — "who is in there?" and "send this
// signal" — but reads a completely different source to do it: `/proc` files, the
// stdout of `ps`, the stdout of a CIM query. So the suite owns ONE synthetic
// process table and renders it into whichever of those three shapes the port
// under test is about to parse. The parsers are the real ones; only the machine
// underneath them is fake.
//
// This is what makes "one contract suite, three implementations" literal rather
// than aspirational, and it is the only way the darwin and win32 parsers can be
// exercised at all before T27 puts them on real machines. It is also how the
// forced enumeration failure is forced: a world can be made blind in the way
// its own platform would actually go blind.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessIdentity } from "../../src/execution/launcher-barrier.ts";
import {
  identityFrom,
  type CommandResult,
  type PlatformPort,
} from "../../src/execution/process-controller.ts";
import { createPosixPort } from "../../src/execution/platform/posix.ts";
import { DARWIN_CENSUS, createDarwinPort } from "../../src/execution/platform/darwin.ts";
import { WIN32_CENSUS, WIN32_TASKKILL, createWin32Port } from "../../src/execution/platform/win32.ts";

export interface FakeProc {
  pid: number;
  ppid: number;
  /** The process group. Ignored by a port that groups by ancestry. */
  group: number;
  /** In the port's own units — only ever compared against itself. */
  cpu: number;
  /** Milliseconds since the epoch, rendered into whatever the platform reports. */
  startedAt: number;
  /** Reaped but not collected. Never a survivor. */
  zombie?: boolean;
}

export interface SignalRecord {
  group: number;
  signal: string;
  members: readonly number[];
}

/** Who leaves when a signal arrives. The default is "everybody, on either one". */
export type DeathPolicy = "all" | "none" | readonly number[];

export interface SupervisorWorld {
  readonly name: string;
  readonly port: PlatformPort;
  /** Everything the ladder aimed at, in order. */
  readonly signals: SignalRecord[];
  set: (procs: readonly FakeProc[]) => void;
  dies: (signal: "SIGTERM" | "SIGKILL", policy: DeathPolicy) => void;
  /** The table as it stands, after whatever the signals did to it. */
  living: () => number[];
  /** Break the census the way this platform would actually break. */
  blind: () => void;
  /** The identity a host would have recorded for this process. */
  identityFor: (pid: number) => ProcessIdentity;
  cleanup: () => void;
}

/** Shared bookkeeping: the table, the death policies, and who is left. */
class Table {
  procs: FakeProc[] = [];
  readonly signals: SignalRecord[] = [];
  readonly policy: Record<string, DeathPolicy> = { SIGTERM: "all", SIGKILL: "all" };

  living(): number[] {
    return this.procs.map((proc) => proc.pid).sort((a, b) => a - b);
  }

  /** Applies a signal to a set of targets and returns whether anything was there. */
  deliver(group: number, signal: string, targets: readonly number[]): boolean {
    const present = this.procs.some((proc) => targets.includes(proc.pid));
    const policy = this.policy[signal] ?? "all";
    if (policy === "none") return present;
    const doomed = policy === "all" ? targets : targets.filter((pid) => policy.includes(pid));
    this.procs = this.procs.filter((proc) => !doomed.includes(proc.pid));
    return present;
  }
}

/** Members of a POSIX group, as the kernel would report them to a signal. */
function groupTargets(table: Table, group: number): number[] {
  return table.procs.filter((proc) => proc.group === group).map((proc) => proc.pid);
}

/**
 * Records what the LADDER asked the port for, not what the world then did.
 *
 * The difference matters: `signals` is how the suite asserts that no signal was
 * sent at all on the refusal paths, and that a port without process groups is
 * handed the members it needs to aim at more than the root.
 */
function recording(port: PlatformPort, signals: SignalRecord[]): PlatformPort {
  return {
    ...port,
    signalGroup: (group, signal, members) => {
      signals.push({ group, signal, members: [...members] });
      return port.signalGroup(group, signal, members);
    },
  };
}

// ---------------------------------------------------------------------------
// Linux: a synthetic /proc.
// ---------------------------------------------------------------------------

const BOOT_ID = "0f9c1b2e-4d3a-4c5b-9e6f-7a8b9c0d1e2f";

/**
 * `/proc/<pid>/stat`, with the fields the parser reads at their real indices.
 *
 * The comm is deliberately ugly. It is the one field that can contain spaces and
 * brackets, and a parser that splits before dropping it reads a process name as
 * a process group.
 */
function statLine(proc: FakeProc): string {
  const tail: string[] = Array.from({ length: 20 }, () => "0");
  tail[0] = proc.zombie === true ? "Z" : "S"; // field 3, state
  tail[1] = String(proc.ppid); //               field 4, ppid
  tail[2] = String(proc.group); //              field 5, pgrp
  tail[11] = String(proc.cpu); //               field 14, utime
  tail[12] = "0"; //                            field 15, stime
  tail[19] = String(proc.startedAt); //         field 22, starttime (jiffies)
  return `${proc.pid} (node (worker) :-)) ${tail.join(" ")}\n`;
}

function posixWorld(): SupervisorWorld {
  const table = new Table();
  const root = mkdtempSync(join(tmpdir(), "awsf-proc-"));
  let broken = false;

  const render = (): void => {
    rmSync(root, { recursive: true, force: true });
    if (broken) return;
    mkdirSync(join(root, "sys", "kernel", "random"), { recursive: true });
    writeFileSync(join(root, "sys", "kernel", "random", "boot_id"), `${BOOT_ID}\n`);
    for (const proc of table.procs) {
      mkdirSync(join(root, String(proc.pid)), { recursive: true });
      writeFileSync(join(root, String(proc.pid), "stat"), statLine(proc));
    }
  };
  render();

  const raw = createPosixPort({
    procRoot: root,
    platform: "linux",
    kill: (target, signal) => {
      const group = -target;
      const delivered = table.deliver(group, signal, groupTargets(table, group));
      render();
      if (!delivered) {
        const error = new Error("no such process group") as Error & { code: string };
        error.code = "ESRCH";
        throw error;
      }
    },
  });

  const port = recording(raw, table.signals);
  return {
    name: "posix",
    port,
    signals: table.signals,
    set: (procs) => {
      table.procs = procs.map((proc) => ({ ...proc }));
      render();
    },
    dies: (signal, policy) => {
      table.policy[signal] = policy;
    },
    living: () => table.living(),
    blind: () => {
      // The mount is gone. A directory walk that returns nothing here would be a
      // machine with no processes on it, which is not a state that exists.
      broken = true;
      render();
    },
    identityFor: (pid) => identityOf(raw, pid),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// macOS: the stdout of `ps`.
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** BSD `lstart`: exactly five whitespace-separated tokens, the last field on the line. */
function lstart(startedAt: number): string {
  const at = new Date(startedAt);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const two = (n: number): string => String(n).padStart(2, "0");
  return (
    `${days[at.getUTCDay()] ?? "Mon"} ${MONTHS[at.getUTCMonth()] ?? "Jan"} ` +
    `${String(at.getUTCDate()).padStart(2, " ")} ` +
    `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())} ${at.getUTCFullYear()}`
  );
}

/** `ps -o time=` prints `[mm]:ss.cc`. */
function psTime(hundredths: number): string {
  const seconds = Math.floor(hundredths / 100);
  const rest = hundredths % 100;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${String(rest).padStart(2, "0")}`;
}

function darwinWorld(): SupervisorWorld {
  const table = new Table();
  let broken = false;

  const command = (executable: string, argv: readonly string[]): CommandResult => {
    if (executable !== DARWIN_CENSUS.executable || argv.join(" ") !== DARWIN_CENSUS.argv.join(" ")) {
      return { status: 127, stdout: "", stderr: `unexpected command ${executable}`, error: null };
    }
    if (broken) return { status: 1, stdout: "", stderr: "ps: cannot open /dev/kmem", error: null };
    const lines = table.procs.map(
      (proc) =>
        ` ${proc.pid} ${proc.ppid} ${proc.group} ${proc.zombie === true ? "Z" : "Ss"} ` +
        `${psTime(proc.cpu)} ${lstart(proc.startedAt)}`,
    );
    // `ps` itself is always in its own output; a table with nothing in it is a
    // census that did not happen, and the port is expected to say so.
    return { status: 0, stdout: `${lines.join("\n")}\n`, stderr: "", error: null };
  };

  const raw = createDarwinPort({
    platform: "darwin",
    command,
    kill: (target, signal) => {
      const group = -target;
      if (!table.deliver(group, signal, groupTargets(table, group))) {
        const error = new Error("no such process group") as Error & { code: string };
        error.code = "ESRCH";
        throw error;
      }
    },
  });

  const port = recording(raw, table.signals);
  return {
    name: "darwin",
    port,
    signals: table.signals,
    set: (procs) => {
      table.procs = procs.map((proc) => ({ ...proc }));
    },
    dies: (signal, policy) => {
      table.policy[signal] = policy;
    },
    living: () => table.living(),
    blind: () => {
      broken = true;
    },
    identityFor: (pid) => identityOf(raw, pid),
    cleanup: () => {},
  };
}

// ---------------------------------------------------------------------------
// Windows: the stdout of a CIM query, and taskkill.
// ---------------------------------------------------------------------------

/** FILETIME: 100-nanosecond ticks since 1601-01-01, which is what the census emits. */
const FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000;
const fileTime = (startedAt: number): number => (startedAt + FILETIME_EPOCH_OFFSET_MS) * 10_000;

function win32World(): SupervisorWorld {
  const table = new Table();
  let broken = false;

  const command = (executable: string, argv: readonly string[]): CommandResult => {
    if (executable === WIN32_CENSUS.executable) {
      if (argv.join(" ") !== WIN32_CENSUS.argv.join(" ")) {
        return { status: 1, stdout: "", stderr: "unexpected census argv", error: null };
      }
      if (broken) {
        return { status: null, stdout: "", stderr: "", error: "spawn powershell.exe ENOENT" };
      }
      // A zombie is a POSIX state. Windows has nothing like it and a reaped
      // process is simply not in `Win32_Process`, so the world does not render
      // one — the difference belongs in the machine, not in the parser.
      const lines = table.procs
        .filter((proc) => proc.zombie !== true)
        .map((proc) => `${proc.pid}|${proc.ppid}|${fileTime(proc.startedAt)}|${proc.cpu}`);
      return { status: 0, stdout: `${lines.join("\r\n")}\r\n`, stderr: "", error: null };
    }
    if (executable === WIN32_TASKKILL) {
      const targets: number[] = [];
      for (const [index, arg] of argv.entries()) {
        if (arg === "/PID") targets.push(Number(argv[index + 1]));
      }
      const signal = argv.includes("/F") ? "SIGKILL" : "SIGTERM";
      const delivered = table.deliver(targets[0] ?? 0, signal, targets);
      return delivered
        ? { status: 0, stdout: "SUCCESS", stderr: "", error: null }
        : { status: 128, stdout: "", stderr: "ERROR: The process was not found.", error: null };
    }
    return { status: 127, stdout: "", stderr: `unexpected command ${executable}`, error: null };
  };

  const raw = createWin32Port({ platform: "win32", command });
  const port = recording(raw, table.signals);

  return {
    name: "win32",
    port,
    signals: table.signals,
    set: (procs) => {
      table.procs = procs.map((proc) => ({ ...proc }));
    },
    dies: (signal, policy) => {
      table.policy[signal] = policy;
    },
    living: () => table.living(),
    blind: () => {
      broken = true;
    },
    identityFor: (pid) => identityOf(raw, pid),
    cleanup: () => {},
  };
}

/** The identity a host would have recorded — read through the port, never invented. */
function identityOf(port: PlatformPort, pid: number): ProcessIdentity {
  const identity = identityFrom(port.census(), pid, port);
  if (identity === null) throw new Error(`the world has no process ${pid} to identify`);
  return identity;
}

/** The three ports, each over a table the suite controls. */
export const WORLDS: readonly (() => SupervisorWorld)[] = [posixWorld, darwinWorld, win32World];
