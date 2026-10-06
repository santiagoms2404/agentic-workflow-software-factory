// `awsf start` under K1 (specs/awsf-v3-w01-driver-checks.html, task 11): after
// the DRAFT check and before any recipe, L2, worktree or adapter, start applies
// the freshness rule to the attempt's latest driver-preflight record and its own
// confirmations, with `git-storage` and `duplicate` re-measured. Each refusal
// leaves the attempt DRAFT with zero calls reserved, appends exactly one
// preflight-refused record naming the field or the stale binding, requests no
// transition, and throws an error naming the command that clears it. The stub
// adapter does not skip any of it; prove and intake are exempt by workflow id.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../../src/cli/main.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptProjector } from "../../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextCommand } from "../../../src/cli/commands/next.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { StartPreflightRefused, startCommand, type StartCommandOptions } from "../../../src/cli/commands/start.ts";
import { loadConfig } from "../../../src/config/load.ts";
import {
  assertPreflightRefusedRecord,
  K1_FIELD_IDS,
  PREFLIGHT_REFUSED_SCHEMA_ID,
  type K1FieldId,
} from "../../../src/contracts/driver-preflight.ts";
import { RECORD_SCHEMAS, isEnvelopeSchemaId } from "../../../src/contracts/registry.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { k1Request, prepareK1, recordedGates, refusals, startUnderK1 } from "../../fixtures/k1-preflight.ts";

const PROJECT = "agentic-workflow-software-factory";
const REQUEST = k1Request("add an example module", "core/src/example.ts core/src/example-two.ts");
const AUTHOR = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];
const STUB = { preflight: () => ({ adapter: true, sandbox: true, observability: true }) } as const;

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

function commit(repository: string, file: string, text: string): string {
  writeFileSync(join(repository, file), text);
  git(repository, "add", ".");
  execFileSync("git", ["-C", repository, ...AUTHOR, "commit", "-q", "-m", `test: ${file}`], { stdio: "ignore" });
  return git(repository, "rev-parse", "HEAD").trim();
}

/** A clean synthetic repository and this checkout's configuration with two offline gates. */
function box(label: string): Box {
  const root = mkdtempSync(join(tmpdir(), `awsf-start-k1-${label}-`));
  const repository = join(root, "canonical");
  execFileSync("git", ["init", "-q", "-b", "main", repository], { stdio: "ignore" });
  writeFileSync(join(repository, ".gitignore"), "node_modules/\n");
  commit(repository, "fixture.txt", "offline fixture\n");
  // The configured seed path, ignored as in this checkout.
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

async function draft(b: Box, taskId: string, extra: { request?: string; workflow?: string; tier?: 0 | 1 | 2; projectRecord?: AttemptProjector } = {}) {
  return newCommand({ stateRoot: b.stateRoot, project: PROJECT, taskId, repository: b.repository, request: extra.request ?? REQUEST,
    workflow: extra.workflow ?? "build-review", tier: extra.tier ?? 2, sessionId: () => `${taskId}-session`,
    ...(extra.projectRecord === undefined ? {} : { projectRecord: extra.projectRecord }) });
}

function startOptions(b: Box, attemptDir: string): StartCommandOptions {
  return { attemptDir, worktreeRoot: b.worktreeRoot, configPath: b.configPath, ...STUB };
}

/** Only the preflight baseline may exist under the root: L1 created no worktree. */
function attemptTrees(b: Box): string[] {
  return existsSync(b.worktreeRoot) ? readdirSync(b.worktreeRoot).filter((name) => !name.startsWith("awsf-baseline-")) : [];
}

/** start refused with the named refusal, and the attempt is exactly as the refusal leaves it. */
async function assertRefused(b: Box, attemptDir: string, expected: { refusal: string; field: K1FieldId | null }, reason?: RegExp): Promise<void> {
  const before = await refusals(attemptDir);
  const transitions = (await readAttemptEvidence(attemptDir)).filter((entry) => entry.type === "transition").length;
  await assert.rejects(startCommand(startOptions(b, attemptDir)), (error: unknown) => {
    assert.ok(error instanceof StartPreflightRefused, String(error));
    assert.equal(error.refusal, expected.refusal);
    assert.equal(error.field, expected.field);
    assert.match(error.message, expected.field === "confirmation" ? /awsf confirm/u : /awsf preflight/u);
    assert.match(error.message, /stays DRAFT and no call has been reserved/u);
    return true;
  });
  const status = await readAttempt(attemptDir);
  assert.equal(status.lifecycleState, "DRAFT");
  assert.equal(status.budget.callsReserved, 0);
  assert.equal(status.worktree, null);
  assert.equal(status.blocker, null);
  const after = await refusals(attemptDir);
  assert.equal(after.length, before.length + 1, "exactly one preflight-refused record per refusal");
  const record = after.at(-1)!;
  assertPreflightRefusedRecord(record);
  assert.equal(record.refusal, expected.refusal);
  assert.equal(record.field, expected.field);
  if (reason !== undefined) assert.match(record.reason, reason);
  assert.equal((await readAttemptEvidence(attemptDir)).filter((entry) => entry.type === "transition").length, transitions,
    "a K1 refusal requests no transition, L2 included");
  assert.deepEqual(attemptTrees(b), []);
}

test("the preflight-refused record is a registered host record, and a field is named exactly when one failed", () => {
  assert.equal(isEnvelopeSchemaId(PREFLIGHT_REFUSED_SCHEMA_ID), false);
  assert.ok(Object.hasOwn(RECORD_SCHEMAS, PREFLIGHT_REFUSED_SCHEMA_ID));
  const base = { schema: PREFLIGHT_REFUSED_SCHEMA_ID, project: PROJECT, taskId: "t", attempt: 1, sessionId: "s", reason: "why", preflightAt: null, at: "now" };
  assertPreflightRefusedRecord({ ...base, refusal: "no-record", field: null });
  assertPreflightRefusedRecord({ ...base, refusal: "field-failed", field: "suite" });
  assert.throws(() => assertPreflightRefusedRecord({ ...base, refusal: "field-failed", field: null }), /requires field/u);
  assert.throws(() => assertPreflightRefusedRecord({ ...base, refusal: "stale-base", field: "suite" }), /takes no field/u);
  assert.throws(() => assertPreflightRefusedRecord({ ...base, refusal: "no-record", field: "invented" }), /invalid awsf.preflight-refused/u);
});

test("a fresh preflight and the owner's confirmation let start prepare the attempt", async () => {
  const b = box("pass");
  try {
    const created = await draft(b, "pass");
    const prepared = await startUnderK1(startOptions(b, created.attemptDir));
    assert.equal(prepared.lifecycleState, "PREPARED");
    assert.equal(prepared.baseSha, git(b.repository, "rev-parse", "HEAD").trim());
    assert.deepEqual(await refusals(created.attemptDir), []);
  } finally { b.close(); }
});

test("without any record start refuses before any side effect, and the refusal is projected", async () => {
  const b = box("no-record");
  const projection = createDashboardProjection(b.stateRoot, () => undefined);
  try {
    const created = await draft(b, "bare", { projectRecord: projection.project });
    await assert.rejects(startCommand({ ...startOptions(b, created.attemptDir), projectRecord: projection.project }), StartPreflightRefused);
    const [record] = await refusals(created.attemptDir);
    assert.equal(record?.refusal, "no-record");
    assert.equal(record?.preflightAt, null);
    assert.equal((await readAttempt(created.attemptDir)).lifecycleState, "DRAFT");
    const db = openDatabase(join(b.stateRoot, "awsf.db"));
    try {
      const rows = db.prepare("SELECT name, payload_json FROM events WHERE name = 'preflight refused'").all() as { name: string; payload_json: string }[];
      assert.equal(rows.length, 1);
      assert.equal((JSON.parse(rows[0]!.payload_json) as { refusal: string }).refusal, "no-record");
    } finally { db.close(); }
    assert.equal(existsSync(b.worktreeRoot), false, "no worktree root was created");
  } finally { projection.close(); b.close(); }
});

// One refusal per K1 field on the stub adapter, each named by its field id.
const FIELD_CASES: Record<K1FieldId, (b: Box) => Promise<{ attemptDir: string; reason: RegExp }>> = {
  suite: async (b) => {
    const created = await draft(b, "suite");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot,
      runCommand: recordedGates((argv) => argv.includes("lint") ? 1 : 0) });
    return { attemptDir: created.attemptDir, reason: /gate lint failed at the base/u };
  },
  "write-boundary": async (b) => {
    const created = await draft(b, "write-boundary");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, where: ["core/src/elsewhere.ts"] });
    return { attemptDir: created.attemptDir, reason: /does not appear verbatim in the request's Where line/u };
  },
  "protected-paths": async (b) => {
    const created = await draft(b, "protected-paths", { request: k1Request("mirror core/src/state/task-machine.ts in a module", "core/src/example.ts") });
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    return { attemptDir: created.attemptDir, reason: /protected by core\/src\/state\/\*\* and unclassified/u };
  },
  "git-storage": async (b) => {
    const created = await draft(b, "git-storage");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    // Re-measured at start: the record passed, and the storage changed after it.
    const common = git(b.repository, "rev-parse", "--path-format=absolute", "--git-common-dir").trim();
    for (const path of [join(common, "HEAD"), join(common, "config"), b.worktreeRoot]) chmodSync(path, 0o777);
    return { attemptDir: created.attemptDir, reason: /DrvFs/u };
  },
  duplicate: async (b) => {
    const created = await draft(b, "duplicate");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    // Re-measured at start: another live task took the same request after the preflight.
    await draft(b, "duplicate-twin");
    return { attemptDir: created.attemptDir, reason: /task duplicate-twin .* already carries the same request/u };
  },
  // A malformed request cannot be checked for its write boundary either, so the
  // request-shape refusal is shown on a recipe with no writing phase.
  "request-shape": async (b) => {
    const created = await draft(b, "request-shape", { request: "Ask: look around\nWhere: nothing is written\nDone means: a report", workflow: "scout", tier: 0 });
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    return { attemptDir: created.attemptDir, reason: /no Out of scope: line/u };
  },
  "prior-attempts": async (b) => {
    const created = await draft(b, "prior-attempts");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, consulted: ["invented-session"] });
    return { attemptDir: created.attemptDir, reason: /--consulted names invented-session/u };
  },
  confirmation: async (b) => {
    const created = await draft(b, "confirmation");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, confirm: false });
    return { attemptDir: created.attemptDir, reason: /no owner confirmation/u };
  },
};

for (const field of K1_FIELD_IDS) {
  test(`K1 ${field}: start refuses on the stub adapter, leaves DRAFT with no call reserved, and journals one record naming ${field}`, async () => {
    const b = box(field);
    try {
      const { attemptDir, reason } = await FIELD_CASES[field](b);
      await assertRefused(b, attemptDir, { refusal: "field-failed", field }, reason);
    } finally { b.close(); }
  });
}

test("stale: HEAD moved after the preflight", async () => {
  const b = box("stale-head");
  try {
    const created = await draft(b, "stale-head");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    commit(b.repository, "moved.txt", "moved\n");
    await assertRefused(b, created.attemptDir, { refusal: "stale-base", field: null }, /the base moved/u);
  } finally { b.close(); }
});

test("stale: the configuration changed after the preflight", async () => {
  const b = box("stale-config");
  try {
    const created = await draft(b, "stale-config");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    const text = readFileSync(b.configPath, "utf8");
    const changed = text.replace(/poll_ms: \d+/u, "poll_ms: 750");
    assert.notEqual(changed, text);
    writeFileSync(b.configPath, changed);
    loadConfig(changed);
    await assertRefused(b, created.attemptDir, { refusal: "stale-config", field: null }, /configuration changed/u);
  } finally { b.close(); }
});

test("stale: the request was edited after the preflight", async () => {
  const b = box("stale-request");
  try {
    const created = await draft(b, "stale-request");
    const { status } = await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    await persistAttempt(created.attemptDir, status.revision, {
      kind: "attempt.updated", next: nextRevision(status, { request: REQUEST.replace("an example", "a different") }),
    });
    await assertRefused(b, created.attemptDir, { refusal: "stale-request", field: null }, /request was edited/u);
  } finally { b.close(); }
});

test("stale: the paths were edited after the owner confirmed them", async () => {
  const b = box("stale-paths");
  try {
    const created = await draft(b, "stale-paths");
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, where: ["core/src/example.ts"] });
    // The driver measures again with a wider --where; the confirmation still binds the narrower one.
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, confirm: false });
    await assertRefused(b, created.attemptDir, { refusal: "field-failed", field: "confirmation" }, /paths changed after they were confirmed/u);
    // The owner's fresh confirmation of the new paths clears it.
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    assert.equal((await startCommand(startOptions(b, created.attemptDir))).lifecycleState, "PREPARED");
  } finally { b.close(); }
});

test("awsf start --stub true still refuses without records, and next lists the requirement with confirm at DRAFT", async () => {
  const b = box("cli");
  try {
    const created = await draft(b, "cli");
    const lines: string[] = [];
    const errors: string[] = [];
    const common = ["--state-root", b.stateRoot, "--project", PROJECT, "--config", b.configPath, "--worktree-root", b.worktreeRoot];
    const run = (argv: string[]) => main({ argv, cwd: b.repository, env: {}, writeOut: (line) => lines.push(line), writeError: (line) => errors.push(line),
      get terminal(): never { throw new Error("start and next take no owner terminal"); } });
    assert.equal(await run(["start", "cli", "--stub", "true", ...common]), 1);
    assert.match(errors.join("\n"), /K1 the preflight record \(no-record\)/u);
    assert.equal((await refusals(created.attemptDir)).length, 1);
    assert.equal((await readAttempt(created.attemptDir)).lifecycleState, "DRAFT");

    lines.length = 0;
    assert.equal(await run(["next", "cli", "--json", ...common]), 0, errors.join("\n"));
    const model = JSON.parse(lines[0]!) as { steps: { verb: string; who: string; requires: unknown[] }[] };
    assert.deepEqual(model.steps.find((step) => step.verb === "start")?.requires, [{ check: "K1", field: "preflight-record", status: "missing" }]);
    assert.equal(model.steps.find((step) => step.verb === "confirm")?.who, "owner");

    // Measured, unconfirmed: the L1 step names the confirmation the owner owes.
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, confirm: false });
    const unconfirmed = await nextCommand(created.attemptDir, { stateRoot: b.stateRoot, worktreeRoot: b.worktreeRoot, config: loadConfig(readFileSync(b.configPath, "utf8")) });
    assert.deepEqual(unconfirmed.model.steps.find((step) => step.verb === "start")?.requires, [{ check: "K1", field: "confirmation", status: "missing" }]);
    assert.match(unconfirmed.lines[0]!, /start is refused until K1 clears: confirmation missing/u);
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot });
    const ready = await nextCommand(created.attemptDir, { stateRoot: b.stateRoot, worktreeRoot: b.worktreeRoot, config: loadConfig(readFileSync(b.configPath, "utf8")) });
    assert.deepEqual(ready.model.steps.find((step) => step.verb === "start")?.requires, []);

    lines.length = 0;
    assert.equal(await run(["start", "cli", "--stub", "true", ...common]), 0, errors.join("\n"));
    assert.equal((await readAttempt(created.attemptDir)).lifecycleState, "PREPARED");
  } finally { b.close(); }
});

test("intake is exempt by workflow id and starts without records", async () => {
  const b = box("intake");
  try {
    mkdirSync(b.worktreeRoot, { recursive: true });
    const created = await draft(b, "intake", { request: "an idea in the owner's words", workflow: "intake", tier: 0 });
    const prepared = await startCommand(startOptions(b, created.attemptDir));
    assert.equal(prepared.lifecycleState, "PREPARED");
    assert.deepEqual(await refusals(created.attemptDir), []);
    const evidence = await readAttemptEvidence(created.attemptDir);
    assert.equal(evidence.some((entry) => entry.type === "driver-preflight" || entry.type === "request-confirmation"), false);
  } finally { b.close(); }
});
