// W01 task 13: K1, proved through the CLI (specs/awsf-v3-w01-driver-checks.html).
//
// start-k1.test.ts drives `startCommand` directly. This journey drives the
// command a driver actually types, `awsf start --stub true`, through `main()`,
// so it also proves that no flag of the CLI arm reaches past K1. Three parts:
//
//   1. One refusal per K1 field, each test named with its field id so W02's
//      traps can adopt it: the attempt stays DRAFT, no call is reserved, no
//      worktree exists, no transition is requested, and exactly one
//      preflight-refused record names the field.
//   2. The four stale cases: HEAD moved, configuration changed, request edited
//      and paths edited after the owner confirmed them. Each refuses, leaves the
//      attempt DRAFT, and clears when the driver measures again and the owner
//      confirms again.
//   3. The full stub journey: new, preflight, confirm, start, run and a cancel
//      with a cause and a reason, which `awsf metrics` then counts.
//
// `awsf preflight` and `awsf confirm` take the two seams the CLI arm cannot
// offer a test without becoming a bypass: preflight's gate runner is a recorder
// (running the project's suites inside a synthetic repository would prove
// nothing about K1), and the owner's terminal is a scripted interactive one.
// Every other field is measured from Git, the configuration and the journal.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";
import { nextRevision, persistAttempt, readAttempt } from "../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import { main } from "../../src/cli/main.ts";
import { K1_FIELD_IDS, assertPreflightRefusedRecord, type K1FieldId } from "../../src/contracts/driver-preflight.ts";
import { TrapsReadoutSchema, type TrapsReadout } from "../../src/contracts/traps-readout.ts";
import { writePlacement } from "../../src/registry/placement.ts";
import { readTaskAttributions } from "../../src/persistence/task-attributions.ts";
import type { MetricsResponse } from "../../../dashboard/shared/types.ts";
import { k1Request, prepareK1, recordedGates, refusals, scriptedOwner } from "../fixtures/k1-preflight.ts";

const PROJECT = "agentic-workflow-software-factory";
const REQUEST = k1Request("add an example module", "core/src/example.ts core/src/example-two.ts");
const AUTHOR = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];

interface Box {
  readonly root: string;
  readonly repository: string;
  readonly stateRoot: string;
  readonly worktreeRoot: string;
  readonly configPath: string;
  close(): void;
}

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" });
}

function commit(repository: string, file: string, text: string): void {
  writeFileSync(join(repository, file), text);
  git(repository, "add", ".");
  execFileSync("git", ["-C", repository, ...AUTHOR, "commit", "-q", "-m", `test: ${file}`], { stdio: "ignore" });
}

/** A clean synthetic repository, and this checkout's configuration with two offline gates. */
function box(label: string): Box {
  const root = mkdtempSync(join(tmpdir(), `awsf-k1-journey-${label}-`));
  const repository = join(root, "canonical");
  execFileSync("git", ["init", "-q", "-b", "main", repository], { stdio: "ignore" });
  writeFileSync(join(repository, ".gitignore"), "node_modules/\n");
  commit(repository, "fixture.txt", "offline fixture\n");
  mkdirSync(join(repository, "node_modules"));
  writeFileSync(join(repository, "node_modules", "seeded.txt"), "seed\n");
  const source = readFileSync(resolve("awsf.config.yaml"), "utf8");
  const configText = source.replace(/\ngates:\n(?: {2}.*\n)+/u,
    "\ngates:\n  test: { argv: [npm, run, test:unit], timeout_seconds: 600 }\n  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n");
  assert.notEqual(configText, source);
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText);
  return {
    root, repository, stateRoot: join(root, "state"), worktreeRoot: join(root, "worktrees"), configPath,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

interface Run { readonly code: number; readonly out: string[]; readonly err: string[] }

/** The real CLI on the box's state root and configuration, and its worktree root where the command takes one. */
async function cli(b: Box, argv: readonly string[], terminal?: OwnerTerminal): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main({
    argv: [...argv, "--state-root", b.stateRoot, "--project", PROJECT, "--config", b.configPath,
      ...(argv[0] === "start" ? ["--worktree-root", b.worktreeRoot] : [])],
    cwd: b.repository, env: {}, writeOut: (line) => out.push(line), writeError: (line) => err.push(line),
    ...(terminal === undefined ? {} : { terminal }),
  });
  return { code, out, err };
}

async function draft(b: Box, taskId: string, extra: { request?: string; workflow?: string; tier?: 0 | 1 | 2 } = {}) {
  return newCommand({ stateRoot: b.stateRoot, project: PROJECT, taskId, repository: b.repository, request: extra.request ?? REQUEST,
    workflow: extra.workflow ?? "build-review", tier: extra.tier ?? 2, sessionId: () => `${taskId}-session` });
}

/** The preflight baseline may exist under the root; an attempt's own worktree may not. */
function attemptTrees(b: Box): string[] {
  return existsSync(b.worktreeRoot) ? readdirSync(b.worktreeRoot).filter((name) => !name.startsWith("awsf-baseline-")) : [];
}

async function transitions(attemptDir: string): Promise<number> {
  return (await readAttemptEvidence(attemptDir)).filter((entry) => entry.type === "transition").length;
}

/**
 * `awsf start --stub true` refused, and the refusal is exactly what K1 promises:
 * named, journalled once, with no call reserved, no worktree and no lifecycle move.
 */
async function assertRefusedByCli(b: Box, taskId: string, attemptDir: string, expected: { refusal: string; field: K1FieldId | null }, reason: RegExp): Promise<void> {
  const before = (await refusals(attemptDir)).length;
  const moves = await transitions(attemptDir);
  const run = await cli(b, ["start", taskId, "--stub", "true"]);
  assert.equal(run.code, 1, run.out.join("\n"));
  const subject = expected.field === null ? `the preflight record \\(${expected.refusal}\\)` : `field ${expected.field}`;
  assert.match(run.err.join("\n"), new RegExp(`K1 ${subject}:`, "u"));
  assert.match(run.err.join("\n"), /stays DRAFT and no call has been reserved/u);
  assert.deepEqual(run.out, [], "a refused start prepares nothing and prints no preparation");
  const status = await readAttempt(attemptDir);
  assert.equal(status.lifecycleState, "DRAFT");
  assert.equal(status.budget.callsReserved, 0);
  assert.equal(status.budget.callsSpent, 0);
  assert.equal(status.worktree, null);
  assert.equal(status.blocker, null);
  const after = await refusals(attemptDir);
  assert.equal(after.length, before + 1, "exactly one preflight-refused record per refusal");
  const record = after.at(-1)!;
  assertPreflightRefusedRecord(record);
  assert.equal(record.refusal, expected.refusal);
  assert.equal(record.field, expected.field);
  assert.match(record.reason, reason);
  assert.equal(await transitions(attemptDir), moves, "a K1 refusal requests no transition");
  assert.deepEqual(attemptTrees(b), []);
}

/** The driver measures again, the owner confirms again, and the same `awsf start --stub true` prepares the attempt. */
async function assertClearsAndStarts(b: Box, taskId: string, attemptDir: string): Promise<void> {
  await prepareK1({ attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
  const run = await cli(b, ["start", taskId, "--stub", "true"]);
  assert.equal(run.code, 0, run.err.join("\n"));
  assert.equal((await readAttempt(attemptDir)).lifecycleState, "PREPARED");
}

// --- One refusal per K1 field, each test named with its field id ---

const FIELD_CASES: Record<K1FieldId, (b: Box, taskId: string) => Promise<{ attemptDir: string; reason: RegExp }>> = {
  suite: async (b, taskId) => {
    const created = await draft(b, taskId);
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot,
      runCommand: recordedGates((argv) => argv.includes("lint") ? 1 : 0) });
    return { attemptDir: created.attemptDir, reason: /gate lint failed at the base/u };
  },
  "write-boundary": async (b, taskId) => {
    const created = await draft(b, taskId);
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, where: ["core/src/elsewhere.ts"] });
    return { attemptDir: created.attemptDir, reason: /does not appear verbatim in the request's Where line/u };
  },
  "protected-paths": async (b, taskId) => {
    const created = await draft(b, taskId, { request: k1Request("mirror core/src/state/task-machine.ts in a module", "core/src/example.ts") });
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    return { attemptDir: created.attemptDir, reason: /protected by core\/src\/state\/\*\* and unclassified/u };
  },
  "git-storage": async (b, taskId) => {
    const created = await draft(b, taskId);
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    // Re-measured at start: the record passed, and the storage changed after it.
    const common = git(b.repository, "rev-parse", "--path-format=absolute", "--git-common-dir").trim();
    for (const path of [join(common, "HEAD"), join(common, "config"), b.worktreeRoot]) chmodSync(path, 0o777);
    return { attemptDir: created.attemptDir, reason: /DrvFs/u };
  },
  duplicate: async (b, taskId) => {
    const created = await draft(b, taskId);
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    // Re-measured at start: another live task took the same request after the preflight.
    await draft(b, `${taskId}-twin`);
    return { attemptDir: created.attemptDir, reason: new RegExp(`task ${taskId}-twin .* already carries the same request`, "u") };
  },
  // A malformed request has no checkable write boundary, so it is shown on a recipe with no writing phase.
  "request-shape": async (b, taskId) => {
    const created = await draft(b, taskId, { request: "Ask: look around\nWhere: nothing is written\nDone means: a report", workflow: "scout", tier: 0 });
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    return { attemptDir: created.attemptDir, reason: /no Out of scope: line/u };
  },
  "prior-attempts": async (b, taskId) => {
    const created = await draft(b, taskId);
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, consulted: ["invented-session"] });
    return { attemptDir: created.attemptDir, reason: /--consulted names invented-session/u };
  },
  confirmation: async (b, taskId) => {
    const created = await draft(b, taskId);
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, confirm: false });
    return { attemptDir: created.attemptDir, reason: /no owner confirmation/u };
  },
};

for (const field of K1_FIELD_IDS) {
  test(`K1 ${field}: awsf start --stub true refuses, leaves DRAFT with callsReserved 0, and journals one record naming ${field}`, async () => {
    const b = box(field);
    try {
      const taskId = `k1-${field}`;
      const { attemptDir, reason } = await FIELD_CASES[field](b, taskId);
      await assertRefusedByCli(b, taskId, attemptDir, { refusal: "field-failed", field }, reason);
    } finally { b.close(); }
  });
}

// --- The stale cases ---

test("K1 stale: HEAD moved after the preflight, and measuring again clears it", async () => {
  const b = box("stale-head");
  try {
    const created = await draft(b, "stale-head");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    commit(b.repository, "moved.txt", "moved\n");
    await assertRefusedByCli(b, "stale-head", created.attemptDir, { refusal: "stale-base", field: null }, /the base moved/u);
    await assertClearsAndStarts(b, "stale-head", created.attemptDir);
  } finally { b.close(); }
});

test("K1 stale: the configuration changed after the preflight, and measuring again clears it", async () => {
  const b = box("stale-config");
  try {
    const created = await draft(b, "stale-config");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    const text = readFileSync(b.configPath, "utf8");
    const changed = text.replace(/poll_ms: \d+/u, "poll_ms: 750");
    assert.notEqual(changed, text);
    writeFileSync(b.configPath, changed);
    await assertRefusedByCli(b, "stale-config", created.attemptDir, { refusal: "stale-config", field: null }, /configuration changed/u);
    await assertClearsAndStarts(b, "stale-config", created.attemptDir);
  } finally { b.close(); }
});

test("K1 stale: the request was edited after the preflight, and measuring again clears it", async () => {
  const b = box("stale-request");
  try {
    const created = await draft(b, "stale-request");
    const { status } = await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    await persistAttempt(created.attemptDir, status.revision, {
      kind: "attempt.updated", next: nextRevision(status, { request: REQUEST.replace("an example", "a different") }),
    });
    await assertRefusedByCli(b, "stale-request", created.attemptDir, { refusal: "stale-request", field: null }, /request was edited/u);
    await assertClearsAndStarts(b, "stale-request", created.attemptDir);
  } finally { b.close(); }
});

test("K1 stale: the paths were edited after the owner confirmed them, and the owner's fresh confirmation clears it", async () => {
  const b = box("stale-paths");
  try {
    const created = await draft(b, "stale-paths");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, where: ["core/src/example.ts"] });
    // The driver measures again with a wider --where; the confirmation still binds the narrower one.
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, confirm: false });
    await assertRefusedByCli(b, "stale-paths", created.attemptDir, { refusal: "field-failed", field: "confirmation" }, /paths changed after they were confirmed/u);
    // The owner's act through the CLI, not the driver's: the same start now prepares.
    const confirmed = await cli(b, ["confirm", "stale-paths"], scriptedOwner());
    assert.equal(confirmed.code, 0, confirmed.err.join("\n"));
    const run = await cli(b, ["start", "stale-paths", "--stub", "true"]);
    assert.equal(run.code, 0, run.err.join("\n"));
    assert.equal((await readAttempt(created.attemptDir)).lifecycleState, "PREPARED");
  } finally { b.close(); }
});

// --- The full stub journey ---

test("a full stub journey: new, preflight, confirm, start, run and a cancel with a cause and a reason, which awsf metrics counts", async () => {
  const b = box("full-stub");
  try {
    const taskId = "full-stub";
    const created = await cli(b, ["new", taskId, k1Request("a stub journey", "core/src/example.ts"), "--workflow", "simple-sdlc", "--tier", "T2"]);
    assert.equal(created.code, 0, created.err.join("\n"));
    const [attemptDir] = readdirSync(join(b.stateRoot, "projects", PROJECT, "tasks", taskId)).map((attempt) => join(b.stateRoot, "projects", PROJECT, "tasks", taskId, attempt));
    assert.ok(attemptDir !== undefined);

    // Before any record, even `--stub true` is refused with the first thing it lacks.
    const bare = await cli(b, ["start", taskId, "--stub", "true"]);
    assert.equal(bare.code, 1);
    assert.match(bare.err.join("\n"), /K1 the preflight record \(no-record\)/u);
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "DRAFT");

    // Measured but unconfirmed: the owner's act is the missing field.
    // The preflight's record is projected, as the CLI arm projects it; a run
    // later refuses to advance an attempt whose projection lags its journal.
    const projection = createDashboardProjection(b.stateRoot);
    try {
      await prepareK1({ attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, confirm: false, projectRecord: projection.project });
    } finally { projection.close(); }
    const unconfirmed = await cli(b, ["start", taskId, "--stub", "true"]);
    assert.equal(unconfirmed.code, 1);
    assert.match(unconfirmed.err.join("\n"), /K1 field confirmation:/u);

    // The owner's attestation, through the CLI arm and an interactive terminal.
    const owner = scriptedOwner();
    const confirmed = await cli(b, ["confirm", taskId], owner);
    assert.equal(confirmed.code, 0, confirmed.err.join("\n"));

    const started = await cli(b, ["start", taskId, "--stub", "true"]);
    assert.equal(started.code, 0, started.err.join("\n"));
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "PREPARED");
    assert.equal((await refusals(attemptDir)).length, 2, "the two refusals before the confirmation, and none after it");

    const ran = await cli(b, ["run", taskId, "--stub", "true"]);
    assert.equal(ran.code, 0, ran.err.join("\n"));
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "AWAITING_OWNER");

    // `awsf cancel` takes both a cause and a reason, and neither is a placeholder.
    const cause = "driver";
    const reason = "The stub candidate was exercised and is not wanted.";
    const bareCancel = await cli(b, ["cancel", taskId], scriptedOwner());
    assert.equal(bareCancel.code, 1);
    assert.match(bareCancel.err.join("\n"), /usage: awsf cancel <task> --cause/u);
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "AWAITING_OWNER", "a refused cancel moves nothing");
    const cancelled = await cli(b, ["cancel", taskId, "--cause", cause, "--reason", reason, "--trap", "TR-01"], scriptedOwner());
    assert.equal(cancelled.code, 0, cancelled.err.join("\n"));
    assert.deepEqual(cancelled.out, ["CANCELLED: survivors []"]);
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "CANCELLED");

    // awsf metrics counts the cancel under its cause, and lists nothing without one.
    const lines: string[] = [];
    const metrics = await main({ argv: ["metrics", "--state-root", b.stateRoot], cwd: b.repository, env: {}, writeOut: (line) => lines.push(line), writeError: (line) => lines.push(`ERR ${line}`) });
    assert.equal(metrics, 0, lines.join("\n"));
    assert.ok(lines.includes(`Cancels (CANCELLED) by cause: ${cause} 1 · 1 total · 0 without a cause`), lines.join("\n"));
    assert.ok(lines.includes("Stops (BLOCKED) by cause: none · 0 total · 0 without a cause"), lines.join("\n"));
    assert.equal(lines[lines.indexOf("Without a cause:") + 1], "  none");

    const json: string[] = [];
    assert.equal(await main({ argv: ["metrics", "--json", "--state-root", b.stateRoot], cwd: b.repository, env: {}, writeOut: (line) => json.push(line), writeError: () => undefined }), 0);
    const payload = JSON.parse(json[0]!) as MetricsResponse;
    assert.deepEqual(payload.causes.cancels, { total: 1, byCause: { [cause]: 1 } });
    assert.deepEqual(payload.causes.withoutCause, []);
    const run = payload.runs.find((candidate) => candidate.taskId === taskId);
    assert.equal(run?.attribution, cause);
    assert.equal(run?.attributionSource, "owner");
  } finally { b.close(); }
});

test("M3: stub cancels through main link a fixed reason and expose a missing trap without repairing it", async (context) => {
  const b = box("trap-links");
  const at = "2026-10-08T12:00:00.000Z";
  context.mock.timers.enable({ apis: ["Date"], now: new Date(at) });
  try {
    await writePlacement(b.stateRoot, PROJECT, { version: "awsf.placement/v1", project: PROJECT,
      repositories: { main: { path: b.repository } } });
    const readout = async (code: number): Promise<TrapsReadout> => {
      const json: string[] = [];
      const errors: string[] = [];
      const terminal = { interactive: false, write: () => assert.fail("readout asks no owner"),
        confirm: async () => { assert.fail("readout asks no confirmation"); return false; } };
      assert.equal(await main({ argv: ["traps", "--json", "--state-root", b.stateRoot], cwd: b.repository, env: {},
        terminal, writeOut: line => json.push(line), writeError: line => errors.push(line) }), code, errors.join("\n"));
      assert.deepEqual(errors, []);
      assert.equal(json.length, 1);
      const model = JSON.parse(json[0]!);
      assert.equal(Value.Check(TrapsReadoutSchema, model), true);
      return model as TrapsReadout;
    };
    for (const [taskId, flags, trap] of [
      ["fixed-cancel", ["--no-trap", "fixed", "synthetic regression keeps the defect fixed"],
        { kind: "none", because: "fixed", reason: "synthetic regression keeps the defect fixed" }],
      ["missing-cancel", ["--trap", "TR-99"], { kind: "trap", id: "TR-99" }],
    ] as const) {
      const created = await cli(b, ["new", taskId, REQUEST, "--workflow", "simple-sdlc"]);
      assert.equal(created.code, 0, created.err.join("\n"));
      const attemptDir = join(b.stateRoot, "projects", PROJECT, "tasks", taskId, "1");
      const projection = createDashboardProjection(b.stateRoot);
      try { await prepareK1({ attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot,
        confirm: false, projectRecord: projection.project }); } finally { projection.close(); }
      for (const argv of [["confirm", taskId], ["start", taskId, "--stub", "true"], ["run", taskId, "--stub", "true"]]) {
        const result = await cli(b, argv, scriptedOwner());
        assert.equal(result.code, 0, result.err.join("\n"));
      }
      const before = await readAttempt(attemptDir);
      assert.equal(before.lifecycleState, "AWAITING_OWNER");
      assert.equal(before.budget.callsReserved, 0);
      const owner = scriptedOwner();
      const cancelled = await cli(b, ["cancel", taskId, "--cause", "factory", "--reason", "synthetic stop diagnosis", ...flags], owner);
      assert.equal(cancelled.code, 0, cancelled.err.join("\n"));
      const after = await readAttempt(attemptDir);
      assert.equal(after.lifecycleState, "CANCELLED");
      assert.equal(after.budget.callsSpent, before.budget.callsSpent, "the owner act buys no provider call");
      const records = await readTaskAttributions(join(attemptDir, ".."));
      assert.equal(records.length, 1);
      assert.equal(records[0]?.schema, "awsf.attribution/v2");
      if (records[0]?.schema !== "awsf.attribution/v2") throw new Error("missing v2 cancellation record");
      assert.deepEqual(records[0].trap, trap);
      const model = await readout(taskId === "fixed-cancel" ? 0 : 1);
      assert.deepEqual(model.stops.linkedToTrap, []);
      assert.deepEqual(model.stops.unlinked, []);
      assert.deepEqual(model.stops.linkedToNoTrap, [{ project: PROJECT, taskId: "fixed-cancel", attempt: 1,
        terminalAt: at, lifecycleState: "CANCELLED", trap: { kind: "none", because: "fixed", reason: "synthetic regression keeps the defect fixed" } }]);
      assert.equal(model.stops.total, taskId === "fixed-cancel" ? 1 : 2);
      assert.deepEqual(model.stops.missingTrap, taskId === "fixed-cancel" ? [] : [{ project: PROJECT,
        taskId: "missing-cancel", attempt: 1, terminalAt: at, lifecycleState: "CANCELLED", trap: { kind: "trap", id: "TR-99" } }]);
    }
    const text: string[] = [];
    assert.equal(await main({ argv: ["traps", "--state-root", b.stateRoot], cwd: b.repository, env: {},
      writeOut: line => text.push(line), writeError: line => assert.fail(line) }), 1);
    assert.ok(text.includes(`  ${PROJECT}/missing-cancel attempt 1 (CANCELLED, ${at}) · TR-99`));
    assert.ok(text.includes("Coverage red: unlinked stops or missing traps remain (exit 1)."));
    assert.ok(text.includes("awsf traps reports and never repairs. It writes nothing and never runs the trap layer."));
    assert.deepEqual((await readout(1)).stops.missingTrap.map(item => item.taskId), ["missing-cancel"], "reading never repairs the gap");
  } finally { context.mock.timers.reset(); b.close(); }
});
