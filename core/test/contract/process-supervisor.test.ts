// THE supervision contract. One suite, every platform port.
//
// D8: "One `ProcessSupervisor` port, three implementations, one contract suite.
// A port that cannot enumerate survivors ERRORS, never returns `[]`." This file
// is that suite. Every case below runs three times — against the Linux port over
// a synthetic `/proc`, the darwin port over synthetic `ps` output, and the win32
// port over a synthetic CIM census — because a contract only one implementation
// is measured against is a description of that implementation.
//
// The parsers under test are the real ones. What the suite fakes is the machine,
// which is the only way the darwin and win32 ports can be exercised at all from
// the development platform. Their LIVE verification is T27, per machine, and
// nothing here claims otherwise.
//
// The last section runs the same ladder against real processes through this
// host's own port. It is not skipped by platform name: it runs wherever the host
// port can take a census, so T27 executes it on macOS and Windows by running
// this file and changing nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EnumerationUnavailable, type ProcessIdentity } from "../../src/execution/launcher-barrier.ts";
import {
  ProcessController,
  createHostPort,
  membersOf,
} from "../../src/execution/process-controller.ts";
import { runSystemCommand } from "../../src/execution/transport-broker.ts";
import { WORLDS, type FakeProc, type SupervisorWorld } from "./_supervisor-world.ts";

// ---------------------------------------------------------------------------
// One family, three renderings.
// ---------------------------------------------------------------------------

const LEADER = 4_100;
const CHILD = 4_101;
const GRANDCHILD = 4_102;
const ZOMBIE = 4_103;
const STRANGER = 4_200;

/**
 * The tree the whole suite is about, plus two things that must NOT be in it.
 *
 * The grandchild's parent is the child, not the leader, so an ancestry walk has
 * to recurse rather than list one generation. The stranger shares nothing with
 * the family and would be killed by a supervisor that trusted the group NUMBER
 * without checking membership. The zombie is in the group and is not a survivor.
 */
function family(): FakeProc[] {
  return [
    { pid: LEADER, ppid: 1, group: LEADER, cpu: 10, startedAt: 1_764_000_000_000 },
    { pid: CHILD, ppid: LEADER, group: LEADER, cpu: 20, startedAt: 1_764_000_001_000 },
    { pid: GRANDCHILD, ppid: CHILD, group: LEADER, cpu: 30, startedAt: 1_764_000_002_000 },
    { pid: ZOMBIE, ppid: CHILD, group: LEADER, cpu: 0, startedAt: 1_764_000_003_000, zombie: true },
    { pid: STRANGER, ppid: 1, group: STRANGER, cpu: 40, startedAt: 1_764_000_004_000 },
  ];
}

const FAST = { graceMs: 60, settleMs: 0, pollMs: 5 };

/** Runs one case against one world, and always tears the world down. */
function contract(name: string, body: (world: SupervisorWorld, controller: ProcessController) => Promise<void> | void): void {
  for (const makeWorld of WORLDS) {
    const world = makeWorld();
    test(`[${world.name}] ${name}`, async () => {
      try {
        world.set(family());
        await body(world, new ProcessController({ port: world.port }));
      } finally {
        world.cleanup();
      }
    });
  }
}

function expectError<T>(error: unknown, type: new (...args: never[]) => T, detail = ""): T {
  if (!(error instanceof type)) throw new Error(`expected ${type.name}${detail}, got ${String(error)}`);
  return error;
}

async function caught(work: () => Promise<unknown>): Promise<unknown> {
  return work().then(
    () => null,
    (error: unknown) => error,
  );
}

// ---------------------------------------------------------------------------
// Enumeration.
// ---------------------------------------------------------------------------

contract("enumerates the whole family, generation by generation, zombies excluded", (world, controller) => {
  const identity = world.identityFor(LEADER);
  assert.deepEqual([...controller.groupMembers(identity)], [LEADER, CHILD, GRANDCHILD]);
});

contract("never reports a stranger that merely shares a number", (world, controller) => {
  assert.deepEqual([...controller.groupMembers(world.identityFor(STRANGER))], [STRANGER]);
});

contract("reports an identity that survives PID reuse, and says how it read it", (world, controller) => {
  const identity = world.identityFor(LEADER);
  assert.equal(identity.pid, LEADER);
  assert.equal(identity.startIdentitySource, world.port.identitySource);
  assert.ok(
    identity.startIdentity !== null && identity.startIdentity.length > 0,
    "a port that cannot identify a process cannot authorize a kill on it",
  );
  // Two processes started at different moments never share one.
  assert.notEqual(identity.startIdentity, world.identityFor(CHILD).startIdentity);
  assert.equal(controller.observeIdentity(9_999), null, "an unused pid has no identity to report");
});

contract("sums the group's cpu, and nobody else's", (world, controller) => {
  assert.equal(controller.groupCpu(world.identityFor(LEADER)), 60);
  assert.equal(controller.groupCpu(world.identityFor(STRANGER)), 40);
});

// ---------------------------------------------------------------------------
// The rule the whole layer exists for: cannot see ⇒ ERROR, never `[]`.
// ---------------------------------------------------------------------------

contract("a census it cannot take is an ERROR, never an empty list", (world, controller) => {
  const identity = world.identityFor(LEADER);
  world.blind();

  for (const [label, read] of [
    ["census", (): unknown => controller.census()],
    ["groupMembers", (): unknown => controller.groupMembers(identity)],
    ["groupCpu", (): unknown => controller.groupCpu(identity)],
    ["observeIdentity", (): unknown => controller.observeIdentity(LEADER)],
  ] as const) {
    let thrown: unknown = null;
    try {
      read();
    } catch (error) {
      thrown = error;
    }
    const failure = expectError(thrown, EnumerationUnavailable, ` from ${label}`);
    assert.equal(failure.platform, world.port.platform);
    assert.match(failure.message, /would be a lie/);
  }
});

contract("the ladder refuses to REPORT when it cannot enumerate", async (world, controller) => {
  const identity = world.identityFor(LEADER);
  world.blind();

  const error = await caught(() => controller.terminateTree(identity, FAST));
  expectError(error, EnumerationUnavailable, " from terminateTree");
  // Not "it returned survivors: [] and terminated: false" — a report is a claim
  // about the machine, and a supervisor that cannot see may not make one.
  assert.deepEqual(world.signals, [], "a supervisor that cannot see must not signal either");
});

// ---------------------------------------------------------------------------
// TERM → grace → KILL → enumerate → report.
// ---------------------------------------------------------------------------

contract("an empty group is not signalled at all", async (world, controller) => {
  const identity = world.identityFor(LEADER);
  world.set([{ pid: STRANGER, ppid: 1, group: STRANGER, cpu: 40, startedAt: 1_764_000_004_000 }]);

  const report = await controller.terminateTree(identity, FAST);
  assert.deepEqual(report, {
    termSent: false,
    killSent: false,
    survivors: [],
    terminated: true,
    skipped: null,
  });
  assert.deepEqual(world.signals, []);
  assert.deepEqual(world.living(), [STRANGER], "and the stranger was never in danger");
});

contract("TERM alone, when TERM is enough: no KILL is sent", async (world, controller) => {
  const report = await controller.terminateTree(world.identityFor(LEADER), FAST);

  assert.equal(report.termSent, true);
  assert.equal(report.killSent, false, "a tree that left on request is not escalated to");
  assert.deepEqual(report.survivors, []);
  assert.equal(report.terminated, true);
  assert.equal(report.skipped, null);
  assert.deepEqual(world.signals.map((sent) => sent.signal), ["SIGTERM"]);
  for (const pid of [LEADER, CHILD, GRANDCHILD]) {
    assert.equal(world.living().includes(pid), false, `${pid} outlived the ladder`);
  }
  assert.equal(world.living().includes(STRANGER), true, "and the stranger was never in danger");
});

contract("the signal is aimed at everyone the census just found", async (world, controller) => {
  await controller.terminateTree(world.identityFor(LEADER), FAST);
  // A port without process groups can only reach the family it is handed; a port
  // with them ignores this, and both get the same enumerated list.
  assert.deepEqual([...(world.signals[0]?.members ?? [])], [LEADER, CHILD, GRANDCHILD]);
});

contract("a tree that ignores TERM is escalated to KILL", async (world, controller) => {
  world.dies("SIGTERM", "none");

  const report = await controller.terminateTree(world.identityFor(LEADER), FAST);
  assert.equal(report.termSent, true);
  assert.equal(report.killSent, true);
  assert.deepEqual(report.survivors, []);
  assert.equal(report.terminated, true);
  assert.deepEqual(world.signals.map((sent) => sent.signal), ["SIGTERM", "SIGKILL"]);
});

contract("a survivor of BOTH signals is reported, and `terminated` is false", async (world, controller) => {
  world.dies("SIGTERM", "none");
  world.dies("SIGKILL", [LEADER, CHILD]);

  const report = await controller.terminateTree(world.identityFor(LEADER), FAST);
  assert.equal(report.killSent, true);
  // The whole point. The ladder ran, the ladder failed, and the report says so
  // rather than inferring success from having sent the signals.
  //
  // This is also the case that catches an ancestry port re-walking a tree whose
  // middle has just been killed: the grandchild's parent link now points at a
  // PID that is gone, so a fresh walk cannot reach it and would report the tree
  // empty. It is visible here because the ladder carries forward everyone it has
  // already seen and re-checks them against the census.
  assert.deepEqual(report.survivors, [GRANDCHILD]);
  assert.equal(report.terminated, false);
  assert.ok(world.living().includes(GRANDCHILD));
});

contract("the report carries exactly the contract's five fields", async (world, controller) => {
  const report = await controller.terminateTree(world.identityFor(LEADER), FAST);
  assert.deepEqual(Object.keys(report).sort(), [
    "killSent",
    "skipped",
    "survivors",
    "termSent",
    "terminated",
  ]);
});

// ---------------------------------------------------------------------------
// Refusals: a signal is only ever sent at a target we can prove is ours.
// ---------------------------------------------------------------------------

contract("a recycled PID is never signalled", async (world, controller) => {
  const recorded: ProcessIdentity = { ...world.identityFor(LEADER), startIdentity: "some-other-boot:0:1" };

  if (world.port.grouping === "process-group") {
    // POSIX keeps a process group alive while anything is in it, so a PID that
    // has been handed out again PROVES the old group is empty.
    const report = await controller.terminateTree(recorded, FAST);
    assert.equal(report.skipped, "identity-changed");
    assert.deepEqual(report.survivors, []);
    assert.equal(report.terminated, true);
  } else {
    // Ancestry has no such guarantee: a recycled root cannot be walked back to
    // the tree it used to head, so the honest answer is an enumeration failure.
    const error = await caught(() => controller.terminateTree(recorded, FAST));
    expectError(error, EnumerationUnavailable, " for a recycled ancestry root");
  }

  assert.deepEqual(world.signals, [], "no signal may be aimed at a stranger's tree");
  assert.deepEqual(world.living(), [LEADER, CHILD, GRANDCHILD, ZOMBIE, STRANGER]);
});

contract("an identity nothing can verify is never signalled, and survivors are still enumerated", async (world, controller) => {
  const recorded: ProcessIdentity = { ...world.identityFor(LEADER), startIdentity: null };

  const report = await controller.terminateTree(recorded, FAST);
  assert.equal(report.skipped, "identity-unverifiable");
  assert.equal(report.termSent, false);
  assert.equal(report.killSent, false);
  // "I could not prove it was yours" is not the same claim as "it is gone".
  assert.deepEqual(report.survivors, [LEADER, CHILD, GRANDCHILD]);
  assert.equal(report.terminated, false);
  assert.deepEqual(world.signals, []);
});

// ---------------------------------------------------------------------------
// The grouping strategies, stated rather than assumed.
// ---------------------------------------------------------------------------

test("ancestry refuses a parent link a child could not have had", () => {
  // The Windows defence against a recycled parent: a process cannot have started
  // before the parent it claims. The impostor below reuses the child's PID space
  // but predates the root, so it is not in the tree.
  const rows = [
    { pid: 10, ppid: 1, pgid: null, alive: true, cpu: 0, startIdentity: "a", startedAt: 500 },
    { pid: 11, ppid: 10, pgid: null, alive: true, cpu: 0, startIdentity: "b", startedAt: 600 },
    { pid: 12, ppid: 10, pgid: null, alive: true, cpu: 0, startIdentity: "c", startedAt: 100 },
  ];
  assert.deepEqual(membersOf(rows, 10, "ancestry"), [10, 11]);
  // With no start times to compare, the link is KEPT: an over-long survivor list
  // produces a loud `terminated: false`, and a short one produces a quiet lie.
  const undated = rows.map((row) => ({ ...row, startedAt: null }));
  assert.deepEqual(membersOf(undated, 10, "ancestry"), [10, 11, 12]);
});

test("every port declares its grouping, its identity source and a poll floor", () => {
  for (const makeWorld of WORLDS) {
    const world = makeWorld();
    try {
      assert.ok(["process-group", "ancestry"].includes(world.port.grouping), world.name);
      assert.ok(world.port.identitySource.length > 0, world.name);
      // A census that costs a subprocess may not be polled like a file read.
      assert.ok(world.port.minPollMs >= 25, world.name);
    } finally {
      world.cleanup();
    }
  }
});

// ---------------------------------------------------------------------------
// The same ladder, against real processes, through this host's own port.
// ---------------------------------------------------------------------------

/** A real detached group whose leader spawns a child the host never registered. */
const GROUP_SCRIPT = [
  "const cp = require('node:child_process');",
  "const g = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
  "process.stdout.write(String(g.pid) + '\\n');",
  "setInterval(() => {}, 1000);",
].join("");

/**
 * Wait, bounded, for the kernel to agree with a report.
 *
 * `terminateTree` returning is the signal having been sent and the ladder
 * having run; it is not the kernel having finished. A process that has exited
 * but not yet been reaped is still observable, so an instantaneous re-read sees
 * a corpse and calls it a survivor. Under a full-suite run on a loaded machine
 * that is exactly what happened. The claim is unchanged — a process still
 * observable after this deadline is a real survivor — only the moment it is
 * asked at is.
 */
async function settles(deadlineMs: number, predicate: () => boolean): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function hostCanSupervise(): boolean {
  try {
    createHostPort({ command: runSystemCommand }).census();
    return true;
  } catch {
    return false;
  }
}

test(
  "the ladder ends a real process tree, and the grandchild goes with it",
  { skip: hostCanSupervise() ? false : "this host's port cannot take a census; T27 runs this per machine" },
  async () => {
    const controller = new ProcessController({ port: createHostPort({ command: runSystemCommand }) });
    const child = spawn(process.execPath, ["-e", GROUP_SCRIPT], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let grandchild = 0;
    try {
      grandchild = await new Promise<number>((resolve, reject) => {
        let text = "";
        const timer = setTimeout(() => reject(new Error("the leader never named its child")), 10_000);
        child.stdout?.on("data", (chunk: Buffer) => {
          text += chunk.toString("utf8");
          if (!text.includes("\n")) return;
          clearTimeout(timer);
          resolve(Number(text.slice(0, text.indexOf("\n")).trim()));
        });
      });

      const identity = controller.observeIdentity(child.pid ?? 0);
      assert.notEqual(identity, null, "a process this host just created must be observable");
      if (identity === null) return;

      const before = controller.groupMembers(identity);
      assert.ok(before.includes(child.pid ?? 0), `the leader is in its own group: ${before.join(", ")}`);
      assert.ok(
        before.includes(grandchild),
        `a child the host never spawned is still in the group it will kill: ${before.join(", ")}`,
      );

      const report = await controller.terminateTree(identity);
      assert.equal(report.termSent, true);
      assert.deepEqual(report.survivors, [], "survivors are enumerated after the ladder, not assumed");
      assert.equal(report.terminated, true);

      // Asked again, of the machine rather than of the report — and bounded,
      // because the report is the ladder having run, not the kernel having
      // finished reaping.
      assert.equal(
        await settles(5_000, () => controller.observeIdentity(grandchild) === null),
        true,
        "the grandchild was reaped",
      );
      assert.deepEqual([...controller.groupMembers(identity)], []);
    } finally {
      for (const pid of [child.pid ?? 0, grandchild]) {
        try {
          if (pid > 0) process.kill(pid, "SIGKILL");
        } catch {
          // Already gone, which is what the assertions wanted anyway.
        }
      }
    }
  },
);
