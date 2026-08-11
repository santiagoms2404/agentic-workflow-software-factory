// One supervision contract, three implementations — and ONE ladder.
//
//     TERM → grace → KILL → enumerate → report reality
//
// The ladder lives here rather than in each port because it is identical on
// every platform and because its ORDER is the part that has to be right. Three
// copies would be three chances to enumerate after the signal instead of before
// it, or to report `terminated` from what was attempted rather than from what
// was measured. The ports answer two questions — "who is in there?" and "send
// this signal" — and answer neither by guessing.
//
// The rule every path below serves: SURVIVORS ARE ENUMERATED, NEVER ASSUMED. A
// port that cannot enumerate throws, and this file lets the throw out rather
// than converting it into a report; a report is a claim about the machine, and
// a supervisor that cannot see is not entitled to make one. That is the direct
// fix for the predecessor's silent `[]` off Linux.

import {
  EnumerationUnavailable,
  sameProcess,
  type ProcessIdentity,
  type TerminationReport,
} from "./launcher-barrier.ts";
import { createPosixPort } from "./platform/posix.ts";
import { createDarwinPort } from "./platform/darwin.ts";
import { createWin32Port } from "./platform/win32.ts";

// ---------------------------------------------------------------------------
// The supervision port — one contract, three implementations.
// ---------------------------------------------------------------------------

/**
 * One process, as a supervisor needs to see it.
 *
 * Every field is an OBSERVATION. A port that cannot observe one says `null`
 * rather than substituting something plausible, because the whole point of this
 * layer is that a supervisor which cannot see does not get to make claims.
 */
export interface ProcessRow {
  pid: number;
  /** The parent. Load-bearing only where there are no process groups to ask about. */
  ppid: number;
  /** The process group, or `null` on a platform that has none. */
  pgid: number | null;
  /** `false` for a zombie: exited-but-not-yet-reaped bookkeeping is not a running survivor. */
  alive: boolean;
  /** A MONOTONIC cpu counter in whatever units the port reads. Only deltas mean anything. */
  cpu: number;
  /** The PID-reuse-proof identity, or `null` where the port cannot build one. */
  startIdentity: string | null;
  /** A comparable start time, so an ancestry walk can refuse a recycled parent. */
  startedAt: number | null;
}

/**
 * How this platform answers "who else is in there?".
 *
 * `process-group` is the POSIX answer and is exact: the kernel keeps the group
 * alive while it has members. `ancestry` is the Windows answer and is weaker —
 * a walk over parent links, which is why a port that uses it may not infer an
 * empty tree from a recycled root.
 */
export type GroupingStrategy = "process-group" | "ancestry";

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the command could not be run at all, as opposed to running and failing. */
  error: string | null;
}

/**
 * Runs a system command and returns what it said.
 *
 * Injected rather than imported: `node:child_process` is importable in exactly
 * one module, and a platform port is not it. The broker supplies this to the
 * ports that need a census command; a port handed nothing simply cannot
 * enumerate, and says so.
 */
export type CommandRunner = (
  executable: string,
  argv: readonly string[],
  timeoutMs: number,
) => CommandResult;

/**
 * What every platform port owes the controller. Three implementations, and the
 * contract suite runs against all three.
 */
export interface PlatformPort {
  readonly platform: string;
  /** How `startIdentity` was obtained, so a null can explain itself. */
  readonly identitySource: string;
  readonly grouping: GroupingStrategy;
  /** A floor on re-enumeration: a census that costs a subprocess is not free. */
  readonly minPollMs: number;
  /** THROWS `EnumerationUnavailable`. An empty census means "nothing is running", never "I cannot see". */
  census: () => readonly ProcessRow[];
  /**
   * One signal to a whole group. `false` means the group was already gone.
   * THROWS `SignalUnavailable` when the mechanism itself failed.
   *
   * `members` is what the controller just enumerated — free to pass, and the
   * only way a port without process groups can aim at more than the root.
   */
  signalGroup: (group: number, signal: "SIGTERM" | "SIGKILL", members: readonly number[]) => boolean;
}

// ---------------------------------------------------------------------------
// The ladder.
// ---------------------------------------------------------------------------

/** The plan's default grace period, and `runtime.process_grace_seconds` in the config. */
export const DEFAULT_GRACE_MS = 2_000;

export interface TerminateOptions {
  /** A CEILING on how long a well-behaved process may take to leave. Default 2 s. */
  graceMs?: number;
  /** How long after the KILL to let the kernel finish before the last census. */
  settleMs?: number;
  /** How often the grace period re-enumerates. Raised to the port's floor. */
  pollMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Which number identifies "the group" on a platform that groups this way. */
export function groupKeyOf(recorded: ProcessIdentity, grouping: GroupingStrategy): number {
  return grouping === "ancestry" ? recorded.pid : recorded.pgid;
}

/**
 * Everyone alive in the registered process's family.
 *
 * `process-group` is an exact answer the kernel maintains, and it is the reason
 * a grandchild the host never spawned is still reachable: the child inherits the
 * group, so membership does not depend on anyone remembering to record it.
 *
 * `ancestry` is a walk, and it is weaker. Its one defence against a parent link
 * that points at a recycled PID is that a child cannot have started before its
 * parent; a link that violates that is dropped. Where a start time is missing on
 * either end the link is KEPT, because an over-long survivor list produces a
 * loud `terminated: false` and a short one produces a quiet lie.
 */
export function membersOf(
  rows: readonly ProcessRow[],
  root: number,
  grouping: GroupingStrategy,
): number[] {
  if (grouping === "process-group") {
    return rows
      .filter((row) => row.alive && row.pgid === root)
      .map((row) => row.pid)
      .sort((a, b) => a - b);
  }

  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.ppid);
    if (siblings === undefined) children.set(row.ppid, [row]);
    else siblings.push(row);
  }

  const found = new Set<number>();
  const rootRow = byPid.get(root);
  if (rootRow !== undefined && rootRow.alive) found.add(root);
  // Walked with an explicit visited set rather than relying on `found`: a
  // process table can name a parent that is not in it, and `pid 0` names
  // itself. A walk that can revisit a node is a walk that can loop.
  const visited = new Set<number>([root]);
  const frontier = [root];
  for (let index = 0; index < frontier.length; index += 1) {
    const pid = frontier[index] ?? root;
    const parent = byPid.get(pid);
    for (const child of children.get(pid) ?? []) {
      if (visited.has(child.pid)) continue;
      const predatesParent =
        parent !== undefined &&
        parent.startedAt !== null &&
        child.startedAt !== null &&
        child.startedAt < parent.startedAt;
      if (predatesParent) continue;
      visited.add(child.pid);
      if (child.alive) found.add(child.pid);
      frontier.push(child.pid);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** The identity of whoever holds this PID right now, as this port reads it. */
export function identityFrom(
  rows: readonly ProcessRow[],
  pid: number,
  port: PlatformPort,
): ProcessIdentity | null {
  const row = rows.find((candidate) => candidate.pid === pid);
  if (row === undefined) return null;
  return {
    pid,
    pgid: row.pgid ?? pid,
    startIdentity: row.startIdentity,
    startIdentitySource: port.identitySource,
  };
}

export interface ProcessControllerOptions {
  port: PlatformPort;
  terminate?: TerminateOptions;
}

export class ProcessController {
  readonly port: PlatformPort;
  readonly #defaults: TerminateOptions;

  constructor(options: ProcessControllerOptions) {
    this.port = options.port;
    this.#defaults = options.terminate ?? {};
  }

  get platform(): string {
    return this.port.platform;
  }

  /** THROWS `EnumerationUnavailable` rather than describing a machine it cannot see. */
  census(): readonly ProcessRow[] {
    return this.port.census();
  }

  observeIdentity(pid: number): ProcessIdentity | null {
    return identityFrom(this.port.census(), pid, this.port);
  }

  groupMembers(recorded: ProcessIdentity): readonly number[] {
    return membersOf(this.port.census(), groupKeyOf(recorded, this.port.grouping), this.port.grouping);
  }

  /**
   * Total CPU consumed by the group, in the port's own units.
   *
   * Only the DIFFERENCE between two readings means anything, and that is all the
   * liveness monitor asks of it: a process that is doing something moves this
   * number, and one that is wedged does not.
   */
  groupCpu(recorded: ProcessIdentity): number {
    const rows = this.port.census();
    const members = new Set(membersOf(rows, groupKeyOf(recorded, this.port.grouping), this.port.grouping));
    let total = 0;
    for (const row of rows) if (members.has(row.pid)) total += row.cpu;
    return total;
  }

  /**
   * TERM to the group → grace → KILL → enumerate → report reality.
   *
   * Two refusals sit in front of the ladder, and both exist so a signal is only
   * ever sent at a target we can prove is ours:
   *
   * - If the PID is now held by a DIFFERENT process, the group is already gone
   *   WHERE THE PLATFORM GUARANTEES IT. POSIX keeps a process group alive while
   *   anything is in it, so a PID cannot be recycled while its group still has
   *   members: a changed identity therefore PROVES an empty group, and
   *   `kill(-pgid)` would have reached a stranger's. A platform that groups by
   *   ancestry has no such guarantee, so it gets an enumeration failure instead
   *   of an inference it cannot support.
   *
   * - If nothing can prove the PID is still ours — no start identity on either
   *   side — no signal is sent at all, and the survivors are whatever the port
   *   could actually see.
   *
   * If the group enumerates empty, nothing is sent either. Enumerating first is
   * also what makes the ladder safe once the leader has exited: a non-empty
   * group proves the group key is still the one we were given.
   *
   * The grace period is POLLED rather than slept, so "up to 2 s" becomes "as
   * long as it actually needs" and a cancellation returns when the tree is
   * really gone.
   *
   * The residual race — the last member exiting between the enumeration and the
   * signal — is not closeable with the APIs Node exposes. `pidfd_send_signal`
   * would close it on Linux; that is a platform-port question for T27, recorded
   * here rather than papered over.
   */
  async terminateTree(recorded: ProcessIdentity, options: TerminateOptions = {}): Promise<TerminationReport> {
    const graceMs = options.graceMs ?? this.#defaults.graceMs ?? DEFAULT_GRACE_MS;
    const settleMs = options.settleMs ?? this.#defaults.settleMs ?? 50;
    const pollMs = Math.max(options.pollMs ?? this.#defaults.pollMs ?? 25, this.port.minPollMs);
    const grouping = this.port.grouping;
    const group = groupKeyOf(recorded, grouping);

    // Everyone this ladder has ever seen in this tree, and who they were.
    //
    // Re-walking the tree each poll is not enough on its own. Under `ancestry`
    // grouping, killing a process ORPHANS its children — their parent link now
    // points at a PID that is gone — so a tree re-walked after the KILL loses
    // exactly the survivors the report exists to name. Carrying the set forward
    // and re-checking each member against the census is what keeps a survivor
    // visible after the process that connected it to the root has died.
    //
    // The identity is carried with the PID so a number handed out again inside
    // the grace period is not counted as something that refused to die. Where
    // either identity is unknown the member is COUNTED: an over-long survivor
    // list is loud, and a short one is the lie this whole layer exists to stop.
    const known = new Map<number, string | null>();
    const members = (rows: readonly ProcessRow[]): number[] => {
      const byPid = new Map(rows.map((row) => [row.pid, row]));
      for (const pid of membersOf(rows, group, grouping)) {
        if (!known.has(pid)) known.set(pid, byPid.get(pid)?.startIdentity ?? null);
      }
      const survivors: number[] = [];
      for (const [pid, identity] of known) {
        const row = byPid.get(pid);
        if (row === undefined || !row.alive) continue;
        if (identity !== null && row.startIdentity !== null && identity !== row.startIdentity) continue;
        survivors.push(pid);
      }
      return survivors.sort((a, b) => a - b);
    };

    const rows = this.port.census();
    const observed = identityFrom(rows, recorded.pid, this.port);
    if (observed !== null) {
      if (recorded.startIdentity === null || observed.startIdentity === null) {
        const survivors = members(rows);
        return {
          termSent: false,
          killSent: false,
          survivors,
          terminated: survivors.length === 0,
          skipped: "identity-unverifiable",
        };
      }
      if (!sameProcess(recorded, observed)) {
        if (grouping === "ancestry") {
          throw new EnumerationUnavailable(
            this.port.platform,
            `pid ${recorded.pid} belongs to a different process now and this platform has no process ` +
              "groups, so the registered tree can no longer be walked",
          );
        }
        return { termSent: false, killSent: false, survivors: [], terminated: true, skipped: "identity-changed" };
      }
    }

    let survivors = members(rows);
    if (survivors.length === 0) {
      return { termSent: false, killSent: false, survivors: [], terminated: true, skipped: null };
    }

    const termSent = this.port.signalGroup(group, "SIGTERM", survivors);
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
      survivors = members(this.port.census());
      if (survivors.length === 0) break;
    }

    let killSent = false;
    if (survivors.length > 0) {
      killSent = this.port.signalGroup(group, "SIGKILL", survivors);
      if (settleMs > 0) await sleep(settleMs);
      survivors = members(this.port.census());
    }
    return { termSent, killSent, survivors, terminated: survivors.length === 0, skipped: null };
  }
}

export interface HostPortOptions {
  /**
   * Runs the census command the darwin and win32 ports need. Supplied by the
   * broker, which is the only module in the repository allowed to create a
   * process. A port that is handed nothing cannot enumerate, and says so
   * instead of reporting an empty machine.
   */
  command?: CommandRunner;
  /** Overrides `process.platform`. The contract suite builds ports directly; this is for wiring. */
  platform?: string;
}

/** The port for the machine this host is running on. */
export function createHostPort(options: HostPortOptions = {}): PlatformPort {
  const platform = options.platform ?? process.platform;
  const command = options.command;
  switch (platform) {
    case "darwin":
      return createDarwinPort(command === undefined ? { platform } : { platform, command });
    case "win32":
      return createWin32Port(command === undefined ? { platform } : { platform, command });
    default:
      // Every other POSIX name lands here, and lands on a port that refuses to
      // enumerate anything that is not Linux. An unknown platform gets an error,
      // never a `/proc` reader quietly returning nothing.
      return createPosixPort({ platform });
  }
}

export function createHostController(options: HostPortOptions & { terminate?: TerminateOptions } = {}): ProcessController {
  const { terminate, ...portOptions } = options;
  return new ProcessController(
    terminate === undefined
      ? { port: createHostPort(portOptions) }
      : { port: createHostPort(portOptions), terminate },
  );
}

// ---------------------------------------------------------------------------
// Conveniences for callers that hold an identity and nothing else.
// ---------------------------------------------------------------------------

export function terminateGroup(
  recorded: ProcessIdentity,
  options: TerminateOptions = {},
): Promise<TerminationReport> {
  return createHostController().terminateTree(recorded, options);
}

export function groupMembers(recorded: ProcessIdentity): readonly number[] {
  return createHostController().groupMembers(recorded);
}

export function observeIdentity(pid: number): ProcessIdentity | null {
  return createHostController().observeIdentity(pid);
}
