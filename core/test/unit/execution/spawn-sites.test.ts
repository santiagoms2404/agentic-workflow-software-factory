// Spawn-site enforcement, proven by the absence of a child.
//
// The claim is not "the broker throws". The claim is "the broker throws BEFORE
// a child exists", and the only honest way to assert that is to point the
// broker at a launcher that leaves a mark on the filesystem when it runs, sweep
// every ordered pair that is not a spawn site, and then show the mark is not
// there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IllegalSpawnSite } from "../../../src/state/errors.ts";
import { LEGAL_EDGES, TASK_STATES, edgeFor, type TaskState } from "../../../src/state/task-machine.ts";
import {
  ExecutableNotFound,
  ProcessTransportBroker,
  SPAWN_SITE_EDGES,
  SpawnRegistrationInvalid,
  resolveExecutable,
} from "../../../src/execution/transport-broker.ts";
import {
  groupMembers,
  observeIdentity,
  terminateGroup,
} from "../../../src/execution/process-controller.ts";
import type { ProcessRegistration, ProcessSpec } from "../../../src/adapters/interface.ts";
import { CallBudget } from "../../../src/execution/call-budget.ts";

// ---------------------------------------------------------------------------
// A launcher that tells on itself.
// ---------------------------------------------------------------------------

/**
 * The rejection, typed.
 *
 * `assert.ok(error instanceof X)` reads fine but narrows nothing here — without
 * `@types/node` the compiler cannot see `assert.ok`'s assertion signature — so
 * the check and the narrowing happen in one place instead of drifting apart.
 */
function expectError<T>(error: unknown, type: new (...args: never[]) => T, detail = ""): T {
  if (!(error instanceof type)) {
    throw new Error(`expected ${type.name}${detail}, got ${String(error)}`);
  }
  return error;
}

interface Sentinel {
  dir: string;
  marker: string;
  launcherPath: string;
}

function makeSentinel(): Sentinel {
  const dir = mkdtempSync(join(tmpdir(), "awsf-spawn-site-"));
  const marker = join(dir, "a-child-existed");
  const launcherPath = join(dir, "sentinel.mjs");
  writeFileSync(
    launcherPath,
    `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'a child existed');\n`,
  );
  return { dir, marker, launcherPath };
}

function brokerFor(sentinel: Sentinel): { broker: ProcessTransportBroker; budget: CallBudget } {
  const budget = new CallBudget({ taskId: "T99", tier: 2 });
  const broker = new ProcessTransportBroker({
    register: async () => {},
    ledger: budget,
    launcherPath: sentinel.launcherPath,
    handshakeMs: 250,
  });
  return { broker, budget };
}

function specFor(overrides: Partial<ProcessSpec> = {}): ProcessSpec {
  return {
    // Deliberately unresolvable: a request that gets past the site check must
    // die on the executable, not on a child.
    executable: "awsf-no-such-executable-anywhere",
    argv: ["--flag"],
    cwd: tmpdir(),
    env: { PATH: "" },
    stdin: "the prompt",
    shell: false,
    ...overrides,
  };
}

function registrationFor(from: TaskState, to: TaskState): ProcessRegistration {
  return {
    runId: `run-${from}-${to}`,
    sessionId: "s1",
    from,
    to,
    edge: edgeFor(from, to)?.id ?? "L4",
    reservationId: "r1",
    adapterId: "stub",
    role: "worker",
  };
}

// ---------------------------------------------------------------------------
// The six, and the hundred fifteen.
// ---------------------------------------------------------------------------

test("the broker's spawn sites are derived from the L-table and are exactly the plan's six", () => {
  assert.deepEqual(
    SPAWN_SITE_EDGES.map((edge) => edge.id),
    ["L4", "L10", "L11", "L16", "L19", "L25"],
  );
  // Derived, not restated: every one of them enters an executing state.
  for (const edge of SPAWN_SITE_EDGES) {
    assert.ok(edge.to === "RUNNING" || edge.to === "REVIEWING", `${edge.id} enters ${edge.to}`);
  }
  assert.equal(LEGAL_EDGES.filter((edge) => edge.spawnSite).length, 6);
});

test("every ordered pair that is not a spawn site is refused, and no child is ever created", async () => {
  const sentinel = makeSentinel();
  try {
    const { broker } = brokerFor(sentinel);
    const spawnSitePairs = new Set(SPAWN_SITE_EDGES.map((edge) => `${edge.from}->${edge.to}`));
    let refused = 0;

    for (const from of TASK_STATES) {
      for (const to of TASK_STATES) {
        if (spawnSitePairs.has(`${from}->${to}`)) continue;
        const error = await broker
          .startProcess(registrationFor(from, to), specFor(), new AbortController().signal)
          .then(
            () => null,
            (caught: unknown) => caught,
          );
        const refusal = expectError(error, IllegalSpawnSite, ` for ${from} -> ${to}`);
        assert.equal(refusal.from, from);
        assert.equal(refusal.to, to);
        assert.equal(refusal.declared, true);
        refused += 1;
      }
    }

    // Eleven states, 121 ordered pairs, six of which may spawn.
    assert.equal(refused, 115);
    assert.equal(
      existsSync(sentinel.marker),
      false,
      "a rejection that arrives after spawn() has already failed",
    );
  } finally {
    rmSync(sentinel.dir, { recursive: true, force: true });
  }
});

test("the six spawn sites get past the site check — and are stopped by the next one", async () => {
  const sentinel = makeSentinel();
  try {
    const { broker } = brokerFor(sentinel);
    for (const edge of SPAWN_SITE_EDGES) {
      const error = await broker
        .startProcess(registrationFor(edge.from, edge.to), specFor(), new AbortController().signal)
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expectError(error, ExecutableNotFound, ` for ${edge.id}`);
    }
    assert.equal(existsSync(sentinel.marker), false, "an unresolvable executable never becomes a child");
  } finally {
    rmSync(sentinel.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Shape refusals, once the site is legal.
// ---------------------------------------------------------------------------

test("a registration that misnames its own edge is a different complaint from an illegal site", async () => {
  const sentinel = makeSentinel();
  try {
    const { broker } = brokerFor(sentinel);
    const error = await broker
      .startProcess(
        { ...registrationFor("GATING", "RUNNING"), edge: "L4" },
        specFor(),
        new AbortController().signal,
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    const refusal = expectError(error, SpawnRegistrationInvalid);
    assert.match(refusal.message, /GATING -> RUNNING is L10, but the registration declares L4/);
    assert.equal(existsSync(sentinel.marker), false);
  } finally {
    rmSync(sentinel.dir, { recursive: true, force: true });
  }
});

const SHAPE_REFUSALS: [string, Partial<ProcessRegistration>, Partial<ProcessSpec>, RegExp][] = [
  ["no reservation", { reservationId: "" }, {}, /reserved before launch/],
  ["no run id", { runId: "" }, {}, /run id/],
  ["shell execution", {}, { shell: true as unknown as false }, /shell execution is not available/],
  ["a command line", {}, { argv: "sh -c whoami" as unknown as string[] }, /argv must be an array/],
  ["no executable", {}, { executable: "" }, /no executable named/],
  [
    "the prompt in argv",
    {},
    { argv: ["--prompt", "the prompt"], stdin: "the prompt" },
    /the prompt is in argv/,
  ],
  [
    "the prompt inside a longer argument",
    {},
    {
      argv: ["--prompt=summarize the repository and report every finding you can"],
      stdin: "summarize the repository and report every finding you can",
    },
    /the prompt is in argv/,
  ],
];

for (const [label, registration, spec, message] of SHAPE_REFUSALS) {
  test(`a launch carrying ${label} is refused before a child exists`, async () => {
    const sentinel = makeSentinel();
    try {
      const { broker } = brokerFor(sentinel);
      const error = await broker
        .startProcess(
          { ...registrationFor("PREPARED", "RUNNING"), ...registration },
          specFor(spec),
          new AbortController().signal,
        )
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      const refusal = expectError(error, SpawnRegistrationInvalid, ` carrying ${label}`);
      assert.match(refusal.message, message);
      assert.equal(existsSync(sentinel.marker), false);
    } finally {
      rmSync(sentinel.dir, { recursive: true, force: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Resolution: the process that runs is the one the descriptor described.
// ---------------------------------------------------------------------------

test("an executable NAME resolves against the spec's own PATH, never the host's", () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-path-"));
  try {
    const tool = join(dir, "awsf-fake-tool");
    writeFileSync(tool, "#!/bin/sh\nexit 0\n");
    chmodSync(tool, 0o755);

    assert.equal(resolveExecutable("awsf-fake-tool", { PATH: dir }), tool);
    assert.throws(() => resolveExecutable("awsf-fake-tool", { PATH: "" }), ExecutableNotFound);
    assert.throws(() => resolveExecutable("awsf-fake-tool", {}), ExecutableNotFound);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-executable file and a relative path are both refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-path-"));
  try {
    const plain = join(dir, "not-executable");
    writeFileSync(plain, "data\n");
    chmodSync(plain, 0o644);
    assert.throws(() => resolveExecutable(plain, {}), ExecutableNotFound);
    // A relative path means "relative to whatever cwd this child happens to
    // hold", which is not a description of anything.
    assert.throws(() => resolveExecutable("./tools/run", { PATH: dir }), ExecutableNotFound);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Enumeration and recycled PIDs.
// ---------------------------------------------------------------------------

test("enumeration reports real members, and this process is one of them", { skip: process.platform !== "linux" }, () => {
  const self = observeIdentity(process.pid);
  assert.notEqual(self, null);
  if (self === null) return;
  assert.ok(groupMembers(self).includes(process.pid));
  assert.equal(observeIdentity(2_147_483_640), null, "an unused pid has no identity to report");
});

test("a recycled PID is never signalled", { skip: process.platform !== "linux" }, async () => {
  // The recorded identity names THIS process's pid with somebody else's start
  // time — exactly the shape of a PID the kernel handed out again. Killing the
  // group would kill the test runner, so the assertion that this returns at all
  // is the assertion that no signal was sent.
  const recorded = {
    pid: process.pid,
    pgid: process.pid,
    startIdentity: "some-other-boot:0:1",
    startIdentitySource: "linux-proc-stat",
  };
  const report = await terminateGroup(recorded, { graceMs: 10, settleMs: 0 });

  assert.equal(report.skipped, "identity-changed");
  assert.equal(report.termSent, false);
  assert.equal(report.killSent, false);
  assert.deepEqual(report.survivors, []);
});
