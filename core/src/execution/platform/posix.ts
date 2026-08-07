// Reading and ending process groups on Linux.
//
// The broker's job is to create a child; keeping a child's whole family
// accounted for is a different job with a per-platform answer, and this is the
// first of the three ports the plan names. T10 needs exactly two things from it
// — "who is in this group?" and "end this group and tell me what survived" —
// because the barrier's failure path has to destroy a tree it just created.
//
// T11 owns the rest: the `ProcessSupervisor` interface these functions will
// implement, the darwin and win32 ports beside this one, the single contract
// suite run against all three, and the liveness monitor that drives them.
//
// The rule this file exists to keep is one sentence long: a supervisor that
// cannot see is not entitled to say the tree is dead. Everything below either
// reports enumerated truth or throws.

import { readFileSync, readdirSync } from "node:fs";
import {
  EnumerationUnavailable,
  sameProcess,
  type ProcessIdentity,
  type TerminationReport,
} from "../launcher-barrier.ts";

interface ProcStat {
  state: string;
  pgid: number;
  startTime: string;
}

/**
 * Fields 3, 5 and 22 of `/proc/<pid>/stat`.
 *
 * The comm field is parenthesized and may itself contain spaces and brackets,
 * so everything up to the LAST ')' is dropped before splitting. What remains
 * starts at field 3, which puts pgrp (5) at index 2 and starttime (22) at 19.
 */
function readProcStat(pid: number): ProcStat | null {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\)\s/s, "").split(" ");
    const pgid = Number(fields[2]);
    const startTime = fields[19];
    if (!Number.isInteger(pgid) || startTime === undefined) return null;
    return { state: fields[0] ?? "?", pgid, startTime };
  } catch {
    return null;
  }
}

/** In front of the start time because jiffies-since-boot repeat across reboots. */
function bootId(): string {
  return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
}

/**
 * The identity of whoever holds this PID right now, or `null` if nobody does.
 *
 * Built exactly the way `launcher.ts` builds its own, so the two are comparable
 * by string equality and neither has to know how the other computed it.
 */
export function observeIdentity(pid: number): ProcessIdentity | null {
  if (process.platform !== "linux") return null;
  const stat = readProcStat(pid);
  if (stat === null) return null;
  return {
    pid,
    pgid: stat.pgid,
    startIdentity: `${bootId()}:${pid}:${stat.startTime}`,
    startIdentitySource: "linux-proc-stat",
  };
}

/**
 * Who is in this process group, from `/proc`. Zombies are excluded: a reaped-
 * but-not-yet-collected entry is not a survivor, it is bookkeeping.
 *
 * Throws where it cannot look. A supervisor that answers `[]` because it has no
 * way to check has told the caller the tree is dead, which is the single most
 * dangerous thing it could say and be wrong about.
 */
export function groupMembers(pgid: number): number[] {
  if (process.platform !== "linux") {
    throw new EnumerationUnavailable(process.platform, "no /proc; the darwin and win32 ports land in T11");
  }
  const members: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = readProcStat(Number(entry));
    if (stat !== null && stat.pgid === pgid && stat.state !== "Z") members.push(Number(entry));
  }
  return members.sort((a, b) => a - b);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface TerminateOptions {
  /** A CEILING on how long a well-behaved process may take to leave. Default 2 s. */
  graceMs?: number;
  settleMs?: number;
  pollMs?: number;
}

/**
 * TERM to the group → grace → KILL → enumerate → report reality.
 *
 * Two refusals sit in front of the ladder, and both exist so a signal is only
 * ever sent at a target we can prove is ours:
 *
 * - If the PID is now held by a DIFFERENT process, the group is already gone.
 *   Linux keeps a `struct pid` alive while anything references it as a process
 *   group, so a PID number cannot be reused while its group still has members.
 *   A changed identity therefore proves an empty group — and signalling
 *   `-pgid` would reach a stranger's.
 *
 * - If the group enumerates empty, there is nothing to signal and none is sent.
 *   Enumerating first is also what makes `kill(-pgid)` safe once the leader has
 *   exited: a non-empty group proves the pgid number is still the one we were
 *   given.
 *
 * The residual race — the last member exiting between the enumeration and the
 * signal — is not closeable with the APIs Node exposes. `pidfd_send_signal` is
 * what would close it, and that is a platform-port question for T11/T27. It is
 * recorded here rather than papered over.
 */
export async function terminateGroup(
  recorded: ProcessIdentity,
  options: TerminateOptions = {},
): Promise<TerminationReport> {
  const graceMs = options.graceMs ?? 2_000;
  const settleMs = options.settleMs ?? 50;
  const pollMs = options.pollMs ?? 25;

  const observed = observeIdentity(recorded.pid);
  if (observed !== null && !sameProcess(recorded, observed)) {
    return { termSent: false, killSent: false, survivors: [], terminated: true, skipped: "identity-changed" };
  }

  const send = (signal: string): boolean => {
    try {
      process.kill(-recorded.pgid, signal);
      return true;
    } catch (error) {
      // ESRCH means the group went away on its own, which is the outcome asked for.
      if ((error as { code?: string }).code === "ESRCH") return false;
      throw error;
    }
  };

  let survivors = groupMembers(recorded.pgid);
  if (survivors.length === 0) {
    return { termSent: false, killSent: false, survivors: [], terminated: true, skipped: null };
  }

  const termSent = send("SIGTERM");
  // Polling turns "up to 2 s" into "as long as it actually needs" — the same
  // guarantee, and a cancellation that returns when the tree is actually gone.
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    survivors = groupMembers(recorded.pgid);
    if (survivors.length === 0) break;
  }

  let killSent = false;
  if (survivors.length > 0) {
    killSent = send("SIGKILL");
    if (settleMs > 0) await sleep(settleMs);
    survivors = groupMembers(recorded.pgid);
  }
  return { termSent, killSent, survivors, terminated: survivors.length === 0, skipped: null };
}
