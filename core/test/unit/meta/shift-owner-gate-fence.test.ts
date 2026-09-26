import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { landCommand } from "../../../src/cli/commands/land.ts";
import { processOwnerTerminal } from "../../../src/cli/tty.ts";
import { ShiftManifestSchema, ShiftManifestTicketSchema } from "../../../src/contracts/shift-selection-record.ts";
import { DETERMINISTIC_REASON_SOURCES, InteractiveOwnerRequired, NonDeterministicEvidence } from "../../../src/state/errors.ts";
import { LEGAL_EDGES, transition, type BudgetState } from "../../../src/state/task-machine.ts";
import { repoRoot, relRepo, walkFiles } from "./_walk.ts";

// W17 INV-1: landing stays human and at a TTY. No module this workstream adds
// may produce L20, and nothing a shift writes may become an input a timer
// could turn into L21. A shift runs up to the owner and stops.
//
// Two halves. The scan proves the shift's own modules cannot reach either
// edge: they never decide a transition, never reach `awsf land`, never name a
// landing state, and never read a clock or arm a timer. The lifecycle half
// proves the edges they would need are still shut: L20 is the one way into
// LANDING and wants a human at a terminal on every tier, a clock is not a
// reason any edge accepts, and `awsf land` refuses a piped stdin before it
// asks anything.
//
// The scope is the modules W17 added, named here so a rename turns this red
// rather than silently shrinking it, plus everything under the shift's own
// directory. A later W17 task that adds a module adds it to this list.

const WORKSTREAM_MODULES = [
  "core/src/cli/commands/preview.ts",
  "core/src/cli/commands/shift.ts",
  "core/src/cli/commands/shift-readout.ts",
  "core/src/contracts/preview-record.ts",
  "core/src/contracts/shift-selection-record.ts",
  "core/src/git/candidate-ref.ts",
  "core/src/persistence/plan-ticket-body.ts",
  "core/src/workflow/compiled-ids.ts",
] as const;
const SHIFT_DIRECTORY = join(repoRoot(), "core", "src", "workflow", "shift");

/** What a module would need to produce L20, or to hand a timer something that turns into L21. */
const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  ["decides a lifecycle transition", /\btransition\s*\(/u],
  ["reaches `awsf land`", /(['"])[^'"\n]*\/land\.ts\1|\blandCommand\b/u],
  ["names a landing state or edge", /(['"])(?:LANDING|LANDED|L20|L21)\1/u],
  ["reads a clock", /\bDate\.now\b|\bnew Date\s*\(|\bperformance\.now\b|\bprocess\.hrtime\b/u],
  ["arms a timer", /\bset(?:Timeout|Interval|Immediate)\b|\bAbortSignal\.timeout\b|\btimers\/promises\b/u],
];

function workstreamFiles(): string[] {
  return [...new Set([...WORKSTREAM_MODULES, ...walkFiles(SHIFT_DIRECTORY).map(relRepo)])].sort();
}

function offences(source: string): string[] {
  return FORBIDDEN.filter(([, pattern]) => pattern.test(source)).map(([what]) => what);
}

test("every named workstream module exists, so the fence cannot shrink by a rename", () => {
  for (const file of WORKSTREAM_MODULES) assert.ok(existsSync(join(repoRoot(), file)), `${file} is gone; update the INV-1 scope`);
  assert.ok(walkFiles(SHIFT_DIRECTORY).length >= 3, "the shift directory is in scope and not empty");
});

test("no module this workstream adds can decide L20, reach `awsf land`, or read a clock", () => {
  const found = workstreamFiles().flatMap((file) =>
    offences(readFileSync(join(repoRoot(), file), "utf8")).map((what) => `${file} ${what}`));
  assert.deepEqual(found, []);
});

test("the detector sees each offence when one is added", () => {
  assert.deepEqual(offences('transition({ from: "AWAITING_OWNER", to: "LANDING" });'), [
    "decides a lifecycle transition", "names a landing state or edge",
  ]);
  assert.deepEqual(offences('import { landCommand } from "./land.ts";'), ["reaches `awsf land`"]);
  assert.deepEqual(offences("const since = Date.now() - reachedAt;"), ["reads a clock"]);
  assert.deepEqual(offences("setTimeout(() => blockAttempt(), 3_600_000);"), ["arms a timer"]);
  assert.deepEqual(offences('const edge = "L21";'), ["names a landing state or edge"]);
});

test("nothing a shift records carries a time a timer could act on", () => {
  const keys = [ShiftManifestSchema, ShiftManifestTicketSchema].flatMap((schema) => Object.keys(schema.properties));
  assert.deepEqual(keys.filter((key) => /deadline|expir|timeout|ttl|until|due|time|At$/u.test(key)), []);
});

test("L20 is the only way into LANDING, and it is human and interactive with no tier exemption", () => {
  const intoLanding = LEGAL_EDGES.filter((edge) => edge.to === "LANDING");
  assert.deepEqual(intoLanding.map((edge) => edge.id), ["L20"]);
  assert.deepEqual(intoLanding[0]!.actors, ["human"]);
  assert.equal(intoLanding[0]!.interactive, true);
  const budget: BudgetState = {
    attempt: 1, callsSpent: 0, callsReserved: 0, correctionsAuto: 0, correctionsOwner: 0, ownerReentries: 0,
    allowance: { auto: 1, owner: 1, ownerReentries: 1 }, ceiling: 5,
  };
  for (const tier of [0, 1, 2] as const) {
    assert.throws(() => transition({
      from: "AWAITING_OWNER", to: "LANDING", actor: "human", tier, reason: { source: "human" }, interactive: false, budget,
    }), InteractiveOwnerRequired, `T${tier} lands only at a terminal`);
  }
});

test("a clock is no reason: L21 refuses every time-shaped source before anything else is checked", () => {
  for (const source of DETERMINISTIC_REASON_SOURCES) assert.doesNotMatch(source, /clock|time|timer|deadline|schedule/u);
  const budget: BudgetState = {
    attempt: 1, callsSpent: 0, callsReserved: 0, correctionsAuto: 0, correctionsOwner: 0, ownerReentries: 0,
    allowance: { auto: 1, owner: 1, ownerReentries: 1 }, ceiling: 5,
  };
  for (const source of ["clock", "timer", "timeout", "deadline", "schedule"]) {
    assert.throws(() => transition({
      from: "AWAITING_OWNER", to: "BLOCKED", actor: "host", tier: 2, reason: { source }, interactive: false, budget,
    }), NonDeterministicEvidence, `L21 refuses a ${source} reason`);
  }
});

test("`awsf land` refuses a non-interactive stdin before it asks anything, and the process terminal is non-interactive off a TTY", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-inv1-land-"));
  const attemptDir = join(root, "state", "projects", "fixture", "tasks", "fixture-shift", "1");
  const stdinWasTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  try {
    // `attempt.created` rather than a transition, so no candidate ref is written and no Git is needed.
    await persistAttempt(attemptDir, null, { kind: "attempt.created", next: awaitingShift(root) });
    let prompts = 0;
    await assert.rejects(landCommand({
      attemptDir, terminal: { interactive: false, write: () => {}, confirm: async () => { prompts += 1; return true; } },
    }), InteractiveOwnerRequired);
    assert.equal(prompts, 0, "the refusal comes before any confirmation");

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const piped = processOwnerTerminal();
    assert.equal(piped.interactive, false);
    await assert.rejects(piped.confirm("land?"), InteractiveOwnerRequired);
  } finally {
    if (stdinWasTty === undefined) delete (process.stdin as { isTTY?: boolean }).isTTY;
    else Object.defineProperty(process.stdin, "isTTY", stdinWasTty);
    rmSync(root, { recursive: true, force: true });
  }
});

// W17 INV-2 and INV-3, over the same WORKSTREAM_MODULES scope INV-1 uses.
// INV-2: the dashboard records intent; a human-started session compiles and
// drains it. `node:child_process` stays out of every workstream module (AGENTS.md
// invariant 3 bars it repository-wide; this is the workstream's own record of
// it), and no route this workstream adds may be anything but read-only — which
// this repository spells as "adds nothing to API_ROUTE_TABLE", since `preview.ts`
// and the shift commands are CLI, never API handlers.
// INV-3: no push path and no skill in the execution path. AGENTS.md invariant 8
// confines the push token to `publish/argv.ts` repository-wide; this bars it from
// the workstream's own modules the same way.
//
// `preview.ts` is the one W17 module that runs a process, and it does so through
// `runSystemCommand` from `transport-broker.ts`, never `node:child_process`
// directly — so this fence bans the import, not the broker.
const FORBIDDEN_INV23: readonly (readonly [string, RegExp])[] = [
  ["imports node:child_process", /(['"])(node:)?child_process\1/u],
  ["names the push token", /(["'])push\1/u],
  ["registers an API route", /\bAPI_ROUTE_TABLE\b/u],
];

function offencesInv23(source: string): string[] {
  return FORBIDDEN_INV23.filter(([, pattern]) => pattern.test(source)).map(([what]) => what);
}

test("no workstream module imports child_process, names the push token, or registers an API route", () => {
  const found = workstreamFiles().flatMap((file) =>
    offencesInv23(readFileSync(join(repoRoot(), file), "utf8")).map((what) => `${file} ${what}`));
  assert.deepEqual(found, []);
});

test("the INV-2/INV-3 detector sees each offence when one is added", () => {
  assert.deepEqual(offencesInv23('const cp = require("node:child_process");'), ["imports node:child_process"]);
  assert.deepEqual(offencesInv23('await git(["push", "origin", "main"]);'), ["names the push token"]);
  assert.deepEqual(offencesInv23('API_ROUTE_TABLE.concat([{ method: "push", path: "/api/v1/preview", name: "preview" }]);'),
    ["names the push token", "registers an API route"]);
});

function awaitingShift(repository: string): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1", sessionId: "inv1-session", project: "fixture", taskId: "fixture-shift", continuesTask: null,
    groupId: null, planRef: null, attempt: 1, repository, worktree: null, workflow: "shift", tier: 2, request: "run a shift",
    configSnapshotJson: "{}", lifecycleState: "AWAITING_OWNER", baseSha: "0".repeat(40), candidateSha: "1".repeat(40), phase: null,
    budget: { attempt: 1, callsSpent: 3, callsReserved: 0, correctionsAuto: 0, correctionsOwner: 0, ownerReentries: 0,
      allowance: { auto: 1, owner: 1, ownerReentries: 1 }, ceiling: 5 },
    ceilingGrants: [], routeOverrides: {}, reviewDegradation: null, model: null, lastActivityAt: "2026-09-25T00:00:00.000Z",
    lastActivity: "review returned accept", nextAction: "land", gatesPass: true, requiredReviewPresent: true, journeyApproved: true,
    protectedApprovalsValid: true, process: null, landingApproval: null, blocker: null, revision: 1, lastSourceSeq: 1,
  };
}
