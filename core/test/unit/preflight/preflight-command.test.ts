// `awsf preflight` (specs/awsf-v3-w01-driver-checks.html, task 9) on synthetic
// repositories: the suite is reused from a landed candidate at the base, then
// from an earlier passing preflight record at the base, or run once in the
// project's one baseline worktree; a dirty baseline is refused and left as it
// is; every measured field's refusal reaches the journal; and the confirmation
// field reads the attempt's own confirmation records.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../../src/cli/main.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { confirmCommand } from "../../../src/cli/commands/confirm.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { rebuildCommand } from "../../../src/cli/commands/operator.ts";
import {
  PreflightAttemptNotDraft,
  preflightCommand,
  renderPreflightLines,
  type PreflightCommandOptions,
} from "../../../src/cli/commands/preflight.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { gatesConfigDigest } from "../../../src/contracts/command-ledger.ts";
import { assertDriverPreflightRecord, K1_FIELD_IDS, type DriverPreflightRecord, type K1FieldId } from "../../../src/contracts/driver-preflight.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { baselineWorktreeName } from "../../../src/preflight/baseline-worktree.ts";
import { preflightSuiteRows, type GateCommandRunner } from "../../../src/preflight/suite.ts";

const PROJECT = "agentic-workflow-software-factory";
const REQUEST = [
  "Ask: add an example module",
  "Where: core/src/example.ts",
  "Done means: the module exists and its test passes",
  "Out of scope: everything else",
].join("\n");
const AUTHOR = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];

interface Fixture {
  readonly root: string;
  readonly repository: string;
  readonly stateRoot: string;
  readonly worktreeRoot: string;
  readonly configPath: string;
  readonly baseline: string;
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

/** A clean synthetic repository with one ignored seed path, and this checkout's configuration with test gates. */
function fixture(label: string, gates = "  test: { argv: [npm, run, test:unit], timeout_seconds: 600 }\n  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n"): Fixture {
  const root = mkdtempSync(join(tmpdir(), `awsf-preflight-${label}-`));
  const repository = join(root, "canonical");
  execFileSync("git", ["init", "-q", "-b", "main", repository], { stdio: "ignore" });
  writeFileSync(join(repository, ".gitignore"), "node_modules/\n");
  commit(repository, "fixture.txt", "offline fixture\n");
  mkdirSync(join(repository, "node_modules"));
  writeFileSync(join(repository, "node_modules", "seeded.txt"), "seed\n");
  const source = readFileSync(resolve("awsf.config.yaml"), "utf8");
  const configText = source.replace(/\ngates:\n(?: {2}.*\n)+/u, `\ngates:\n${gates}`);
  assert.notEqual(configText, source, "the fixture must replace the configured gates");
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText);
  const worktreeRoot = join(root, "worktrees");
  return {
    root, repository, stateRoot: join(root, "state"), worktreeRoot, configPath,
    baseline: join(worktreeRoot, baselineWorktreeName(PROJECT)),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

interface Call { readonly gateId: string; readonly cwd: string | undefined }

/** Records each gate dispatch by its argv; `exit` picks a status per gate. */
function gateRunner(calls: Call[], exit: (gateId: string) => number = () => 0, effect?: (cwd: string) => void): GateCommandRunner {
  return (_executable, argv, options) => {
    const cwd = typeof options === "number" ? undefined : options.cwd;
    const gateId = argv.includes("test:unit") ? "test" : argv.includes("lint") ? "lint" : argv.join(" ");
    calls.push({ gateId, cwd });
    if (effect !== undefined && cwd !== undefined) effect(cwd);
    return { status: exit(gateId), stdout: `${gateId} output\n`, stderr: "", error: null };
  };
}

async function draft(box: Fixture, taskId: string, request = REQUEST, extra: { continuesTask?: string } = {}) {
  return newCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId, repository: box.repository, request,
    workflow: "build-review", tier: 2, ...extra });
}

function options(box: Fixture, attemptDir: string, runCommand: GateCommandRunner, extra: Partial<PreflightCommandOptions> = {}): PreflightCommandOptions {
  return { attemptDir, stateRoot: box.stateRoot, worktreeRoot: box.worktreeRoot, configPath: box.configPath,
    where: ["core/src/example.ts"], read: [], consulted: [], runCommand, ...extra };
}

async function records(attemptDir: string): Promise<DriverPreflightRecord[]> {
  return (await readAttemptEvidence(attemptDir)).flatMap((evidence) => evidence.type === "driver-preflight" ? [evidence.record] : []);
}

function field(record: DriverPreflightRecord, id: K1FieldId) {
  const found = record.fields.find((entry) => entry.id === id);
  assert.ok(found !== undefined, id);
  return found;
}

test("a missing landed record runs every gate once in the baseline worktree; later runs reuse its rows at that base and its worktree at the next", async () => {
  const box = fixture("baseline");
  try {
    const created = await draft(box, "first");
    const calls: Call[] = [];
    const first = await preflightCommand(options(box, created.attemptDir, gateRunner(calls)));
    const base = git(box.repository, "rev-parse", "HEAD").trim();
    assert.deepEqual(calls, [{ gateId: "test", cwd: box.baseline }, { gateId: "lint", cwd: box.baseline }]);
    assert.equal(first.suite.baseline?.created, true);
    assert.deepEqual(first.suite.baseline?.seeded, ["node_modules"]);
    assert.equal(git(box.baseline, "rev-parse", "HEAD").trim(), base);
    assert.equal(first.record.baseSha, base);
    assert.equal(first.record.suite?.source, "preflight-run");
    assert.deepEqual(first.record.suite?.rows.map((row) => [row.gateId, row.sha, row.passed]), [["test", base, true], ["lint", base, true]]);
    assert.equal(first.measuredPassed, true);
    for (const id of K1_FIELD_IDS.filter((id) => id !== "confirmation")) assert.equal(field(first.record, id).passed, true, id);
    assert.equal(field(first.record, "confirmation").passed, false, "the owner's confirmation is a later act");
    assert.equal(first.status.lifecycleState, "DRAFT");
    assert.equal(first.status.budget.callsReserved, 0);
    assert.ok(existsSync(join(created.attemptDir, "raw", "preflight-test.txt")));

    const second = await preflightCommand(options(box, created.attemptDir, gateRunner(calls), { read: ["AGENTS.md"] }));
    assert.equal(calls.length, 2, "a second run at the same base runs no gate");
    assert.equal(second.suite.baseline, null);
    assert.equal(second.suite.reusedFrom, "driver-preflight");
    assert.equal(second.suite.reused, `first attempt 1's driver preflight at ${first.record.at}`);
    assert.deepEqual(second.record.suite, first.record.suite, "the reused rows keep their source, SHA and digest");
    assert.equal(field(second.record, "suite").passed, true);
    assert.match(renderPreflightLines(second).join("\n"),
      /^Suite: reused the passing gate rows of first attempt 1's driver preflight at .*, measured at this base under the current gate configuration; no gate ran\.$/mu);

    const other = await draft(box, "other-task", REQUEST.replace("an example", "another"), { continuesTask: "first" });
    const reused = await preflightCommand(options(box, other.attemptDir, gateRunner(calls)));
    assert.equal(calls.length, 2, "a task continuing it at the same base runs no gate either");
    assert.match(reused.suite.reused ?? "", /^first attempt 1's driver preflight at /u);

    const moved = commit(box.repository, "second.txt", "moved\n");
    const third = await preflightCommand(options(box, created.attemptDir, gateRunner(calls)));
    assert.equal(calls.length, 4, "a new base runs every gate once");
    assert.equal(third.suite.reused, null);
    assert.equal(third.suite.baseline?.path, box.baseline);
    assert.equal(third.suite.baseline?.created, false);
    assert.deepEqual(third.suite.baseline?.seeded, [], "a seed path already present is kept");
    assert.equal(git(box.baseline, "rev-parse", "HEAD").trim(), moved, "the same tree is re-pointed at the new base");
    assert.ok(third.record.suite?.rows.every((row) => row.sha === moved));
    assert.ok(calls.every((call) => call.cwd === box.baseline), "no gate ever runs in the owner's checkout");
    assert.equal((await records(created.attemptDir)).length, 3, "one record per run");
    const listed = git(box.repository, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree "));
    assert.equal(listed.length, 2, "the canonical checkout and one baseline worktree, never one per run");
  } finally { box.close(); }
});

test("a reused suite runs no gate when a landed candidate is the base under the same gate digest", async () => {
  const box = fixture("reuse");
  try {
    const base = git(box.repository, "rev-parse", "HEAD").trim();
    const config = loadConfig(readFileSync(box.configPath, "utf8"));
    const landed = await draft(box, "landed", "Ask: an earlier landed task\nWhere: core/src/a.ts\nDone means: done\nOut of scope: none");
    const land = async (digest: string): Promise<void> => {
      let status: AttemptStatus = landed.status;
      for (const [gateId, gate] of Object.entries(config.gates)) {
        const intentId = `intent-${gateId}-${digest.slice(0, 6)}`;
        const intent: AttemptEvidence = { type: "command-dispatch-intent", intent: {
          schema: "awsf.command-dispatch-intent/v1", intentId, dispatcherId: "production-run/measure-candidate",
          occurrenceKey: "tests", gateId, origin: "verify-candidate", phaseKey: "tests", phaseOrdinal: 0, round: 0,
          attempt: 1, sessionId: status.sessionId, argv: [...gate.argv], argvDigest: "a".repeat(64), cwd: "/w", worktreeRealPath: "/w",
          timeoutMs: gate.timeout_seconds * 1_000, maxOutputBytes: 1, gateConfigDigest: "b".repeat(64), gatesConfigDigest: digest,
          candidateSha: base, headBefore: base, cleanBefore: true, dispatchedAt: "2026-10-06T00:00:00.000Z",
        } };
        const result: AttemptEvidence = { type: "command-dispatch-result", result: {
          schema: "awsf.command-dispatch-result/v1", intentId, outcome: "exited", exitCode: 0, durationMs: 1,
          outputRef: null, outputBytes: null, outputDigest: null, headAfter: base, cleanAfter: true,
          descendantQuiescence: "unproved", settledAt: "2026-10-06T00:00:01.000Z",
        } };
        for (const evidence of [intent, result]) {
          status = await persistAttempt(landed.attemptDir, status.revision, { kind: "attempt.updated", next: nextRevision(status, {}), evidence });
        }
      }
      await persistAttempt(landed.attemptDir, status.revision, {
        kind: "attempt.transitioned", next: nextRevision(status, { lifecycleState: "LANDED", baseSha: base, candidateSha: base }),
      });
    };
    await land(gatesConfigDigest(config.gates));
    const created = await draft(box, "after-landing");
    const calls: Call[] = [];
    const result = await preflightCommand(options(box, created.attemptDir, gateRunner(calls)));
    assert.deepEqual(calls, [], "no gate runs");
    assert.equal(existsSync(box.worktreeRoot), false, "no baseline worktree is created");
    assert.equal(result.record.suite?.source, "landed-attempt");
    assert.equal(result.suite.reused, "landed attempt 1");
    assert.equal(field(result.record, "suite").passed, true);
    assert.match(renderPreflightLines(result).join("\n"), /reused the gate rows of landed attempt 1/u);

    const later = await draft(box, "later", REQUEST.replace("an example", "a later"));
    const preferred = await preflightCommand(options(box, later.attemptDir, gateRunner(calls)));
    assert.deepEqual(calls, []);
    assert.equal(preferred.suite.reusedFrom, "landed-attempt");
    assert.equal(preferred.suite.reused, "landed attempt 1", "landed rows are preferred over an earlier preflight record at the same base");
  } finally { box.close(); }

  const changed = fixture("reuse-digest");
  try {
    const base = git(changed.repository, "rev-parse", "HEAD").trim();
    const landed = await draft(changed, "landed", "Ask: an earlier landed task\nWhere: core/src/a.ts\nDone means: done\nOut of scope: none");
    await persistAttempt(landed.attemptDir, landed.status.revision, {
      kind: "attempt.transitioned", next: nextRevision(landed.status, { lifecycleState: "LANDED", baseSha: base, candidateSha: base }),
    });
    const created = await draft(changed, "after-landing");
    const calls: Call[] = [];
    const result = await preflightCommand(options(changed, created.attemptDir, gateRunner(calls)));
    assert.equal(calls.length, 2, "a landed attempt without rows under the current gate digest is not the suite");
    assert.equal(result.record.suite?.source, "preflight-run");
  } finally { changed.close(); }
});

test("a dirty baseline worktree is refused, not cleaned, and the refusal is still journalled", async () => {
  const box = fixture("dirty");
  try {
    const created = await draft(box, "dirty");
    const calls: Call[] = [];
    // A red first run, so the second has no passing record to reuse and must use the baseline.
    await preflightCommand(options(box, created.attemptDir, gateRunner(calls, (gateId) => gateId === "lint" ? 1 : 0)));
    const stray = join(box.baseline, "stray.txt");
    writeFileSync(stray, "left by hand\n");
    const refused = await preflightCommand(options(box, created.attemptDir, gateRunner(calls)));
    assert.equal(calls.length, 2, "no gate runs in a dirty baseline");
    assert.equal(refused.record.suite, null);
    assert.match(field(refused.record, "suite").reason ?? "", /baseline worktree was refused.*WorktreeNotClean/u);
    assert.equal(readFileSync(stray, "utf8"), "left by hand\n", "the dirt is kept for whoever needs it");
    assert.equal(refused.measuredPassed, false);
    assert.equal((await records(created.attemptDir)).length, 2);
  } finally { box.close(); }

  const dirtying = fixture("dirtying");
  try {
    const created = await draft(dirtying, "dirtying");
    const calls: Call[] = [];
    const result = await preflightCommand(options(dirtying, created.attemptDir,
      gateRunner(calls, () => 0, (cwd) => writeFileSync(join(cwd, "artifact.txt"), "written by a gate\n"))));
    assert.deepEqual(calls.map((call) => call.gateId), ["test"], "a gate that dirties the tree ends the run");
    assert.equal(result.record.suite, null);
    assert.match(field(result.record, "suite").reason ?? "", /gate test left it dirty in the baseline worktree/u);
    assert.ok(existsSync(join(dirtying.baseline, "artifact.txt")));
  } finally { dirtying.close(); }
});

test("an earlier preflight record is reused only when it is the passing suite at the base under the current gate digest", async () => {
  const box = fixture("earlier");
  try {
    const calls: Call[] = [];
    const created = await draft(box, "earlier");
    const red = await preflightCommand(options(box, created.attemptDir, gateRunner(calls, (gateId) => gateId === "lint" ? 1 : 0)));
    assert.equal(field(red.record, "suite").passed, false);
    const rerun = await preflightCommand(options(box, created.attemptDir, gateRunner(calls)));
    assert.equal(calls.length, 4, "a red earlier record is never reused: every gate runs again");
    assert.equal(rerun.suite.reused, null);
    assert.equal(field(rerun.record, "suite").passed, true);

    // The record-level rule, on the green record's own rows: anything but one
    // passing row per configured gate at the base under the current digest is refused.
    const config = loadConfig(readFileSync(box.configPath, "utf8"));
    const green = rerun.record.suite;
    assert.ok(green !== null);
    const rows = green.rows;
    const measure = (suite: DriverPreflightRecord["suite"]) =>
      preflightSuiteRows({ label: "earlier", record: { ...rerun.record, suite } }, rerun.record.baseSha, config);
    assert.deepEqual(measure(green), rows);
    assert.equal(measure(null), null, "no rows");
    assert.equal(measure({ ...green, rows: rows.slice(1) }), null, "partial");
    assert.equal(measure({ ...green, rows: [rows[0]!, rows[0]!] }), null, "a gate twice in place of another");
    assert.equal(measure({ ...green, rows: [...rows, { ...rows[0]!, gateId: "journeys" }] }), null, "a row for an unconfigured gate");
    assert.equal(measure({ ...green, rows: rows.map((row) => ({ ...row, sha: "f".repeat(40) })) }), null, "another SHA");
    assert.equal(measure({ ...green, rows: rows.map((row) => ({ ...row, gatesConfigDigest: "e".repeat(64) })) }), null, "another gate digest");
    assert.equal(measure({ ...green, rows: rows.map((row, index) => index === 1 ? { ...row, passed: false, exitCode: 1 } : row) }), null, "red");

    const lint = "lint: { argv: [npm, run, lint], timeout_seconds: 300 }";
    writeFileSync(box.configPath, readFileSync(box.configPath, "utf8").replace(lint, lint.replace("300", "301")));
    const changed = await preflightCommand(options(box, created.attemptDir, gateRunner(calls)));
    assert.equal(calls.length, 6, "a record under another gate digest is stale: every gate runs again");
    assert.equal(changed.suite.reused, null);
    assert.notEqual(changed.record.suite?.rows[0]?.gatesConfigDigest, rows[0]!.gatesConfigDigest);

    const again = await preflightCommand(options(box, created.attemptDir, gateRunner(calls)));
    assert.equal(calls.length, 6, "the record under the new digest is reused");
    assert.equal(again.suite.reused, `earlier attempt 1's driver preflight at ${changed.record.at}`);
  } finally { box.close(); }
});

test("the earlier-preflight scan reads only the journals of this task and its continuation chain", async () => {
  const box = fixture("scan");
  try {
    const calls: Call[] = [];
    const created = await draft(box, "scanned");
    const first = await preflightCommand(options(box, created.attemptDir, gateRunner(calls)));
    const unrelated = await draft(box, "unrelated", REQUEST.replace("an example", "an unrelated"));
    const theirs = await preflightCommand(options(box, unrelated.attemptDir, gateRunner(calls)));
    assert.equal(calls.length, 4, "an unrelated task's passing record at the base is not reused");
    assert.equal(theirs.suite.reused, null);
    const corrupt = await draft(box, "corrupt", REQUEST.replace("an example", "a corrupt"));
    writeFileSync(join(corrupt.attemptDir, "journal.jsonl"), "{not json\n");
    const unreadable = await draft(box, "unreadable", REQUEST.replace("an example", "an unreadable"));
    chmodSync(join(unreadable.attemptDir, "journal.jsonl"), 0o000);

    const read: string[] = [];
    const reader = async (attemptDir: string) => {
      read.push(resolve(attemptDir));
      return readAttemptEvidence(attemptDir);
    };
    const second = await preflightCommand(options(box, created.attemptDir, gateRunner(calls), { readEvidence: reader }));
    assert.deepEqual(read, [resolve(created.attemptDir)], "no unrelated journal is read: not the sound, the corrupt or the unreadable one");
    assert.equal(calls.length, 4, "a second preflight of the same task at the same base runs no gate");
    assert.equal(second.suite.reused, `scanned attempt 1's driver preflight at ${first.record.at}`);

    const child = await draft(box, "child", REQUEST.replace("an example", "a child"), { continuesTask: "scanned" });
    const continued = await preflightCommand(options(box, child.attemptDir, gateRunner(calls)));
    assert.equal(calls.length, 4, "a continuing task reuses its ancestor's record");
    read.length = 0;
    const third = await preflightCommand(options(box, created.attemptDir, gateRunner(calls), { readEvidence: reader }));
    assert.deepEqual(read.sort(), [resolve(child.attemptDir), resolve(created.attemptDir)].sort(), "a descendant's journal is read too");
    assert.equal(third.suite.reused, `child attempt 1's driver preflight at ${continued.record.at}`);
    chmodSync(join(unreadable.attemptDir, "journal.jsonl"), 0o600);
  } finally { box.close(); }
});

test("a preflight after the owner's matching confirmation reports it passed, and a later path change reports it refused", async () => {
  const box = fixture("confirmed");
  try {
    const created = await draft(box, "confirmed");
    const before = await preflightCommand(options(box, created.attemptDir, gateRunner([])));
    assert.match(field(before.record, "confirmation").reason ?? "", /no owner confirmation of this request is recorded/u);
    const owner = await confirmCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "confirmed",
      terminal: { interactive: true, write: () => undefined, confirm: () => Promise.resolve(true) } });
    assert.equal(owner.confirmed, true);

    const matching = await preflightCommand(options(box, created.attemptDir, gateRunner([])));
    assert.equal(field(matching.record, "confirmation").passed, true);
    assert.ok(renderPreflightLines(matching).includes("confirmation: pass"));
    assert.equal(matching.measuredPassed, true);

    const moved = await preflightCommand(options(box, created.attemptDir, gateRunner([]), { read: ["AGENTS.md"] }));
    assert.match(field(moved.record, "confirmation").reason ?? "", /bound to other --where or --read paths: the paths changed after they were confirmed/u);
    assert.equal(moved.measuredPassed, true, "the exit status still depends on the measured fields only");
  } finally { box.close(); }
});

test("each measured field's refusal is recorded, and --read resolves a protected path named as context", async () => {
  const box = fixture("refusals");
  try {
    const refusedOn = async (taskId: string, id: K1FieldId, pattern: RegExp, request = REQUEST, extra: Partial<PreflightCommandOptions> = {}, exit?: (gateId: string) => number) => {
      const created = await draft(box, taskId, request);
      const result = await preflightCommand(options(box, created.attemptDir, gateRunner([], exit), extra));
      const [record] = await records(created.attemptDir);
      assert.ok(record !== undefined, `${id}: the record is journalled`);
      assertDriverPreflightRecord(record);
      assert.equal(field(record, id).passed, false, id);
      assert.match(field(record, id).reason ?? "", pattern, id);
      assert.equal(result.measuredPassed, false, id);
      assert.ok(renderPreflightLines(result).includes(`${id}: refused — ${field(record, id).reason ?? ""}`), id);
      assert.equal((await readAttempt(created.attemptDir)).lifecycleState, "DRAFT", id);
      return { created, record };
    };
    await refusedOn("suite-red", "suite", /gate lint failed at the base .* \(exit 1\)/u, REQUEST.replace("an example", "a red-base"), {}, (gateId) => gateId === "lint" ? 1 : 0);
    await refusedOn("boundary", "write-boundary", /--where core\/src\/other\.ts does not appear verbatim/u,
      REQUEST.replace("an example", "a boundary"), { where: ["core/src/other.ts"] });
    const contextual = REQUEST.replace("Ask: add an example module", "Ask: add a module; read core/src/state/guards.ts for context only");
    await refusedOn("protected", "protected-paths", /core\/src\/state\/guards\.ts is protected by core\/src\/state\/\*\* and unclassified/u, contextual);
    await refusedOn("shape", "request-shape", /no Where: line/u, "Ask: do something\nDone means: it is done\nOut of scope: none");
    await refusedOn("duplicate", "duplicate", /task boundary \(latest attempt DRAFT\) already carries the same request/u, REQUEST.replace("an example", "a boundary"));

    const classified = await draft(box, "protected-read", contextual.replace("a module", "a classified module"));
    const read = await preflightCommand(options(box, classified.attemptDir, gateRunner([]), { read: ["core/src/state/guards.ts"] }));
    assert.equal(field(read.record, "protected-paths").passed, true, "the false positive is resolved by --read, not by the scan");
    assert.deepEqual(read.record.protectedPlan, []);

    const parent = await draft(box, "parent", REQUEST.replace("an example", "a parent"));
    const child = await draft(box, "child", REQUEST.replace("an example", "a child"), { continuesTask: "parent" });
    const missing = await preflightCommand(options(box, child.attemptDir, gateRunner([])));
    assert.match(field(missing.record, "prior-attempts").reason ?? "", new RegExp(`--consulted lacks ${parent.status.sessionId}`, "u"));
    const unknown = await preflightCommand(options(box, child.attemptDir, gateRunner([]), { consulted: [parent.status.sessionId, "not-a-session"] }));
    assert.match(field(unknown.record, "prior-attempts").reason ?? "", /names not-a-session, which the journal does not hold/u);
    const consulted = await preflightCommand(options(box, child.attemptDir, gateRunner([]), { consulted: [parent.status.sessionId] }));
    assert.equal(field(consulted.record, "prior-attempts").passed, true);
    assert.equal(field(consulted.record, "duplicate").passed, true, "a continued task is in the chain, not a duplicate");
  } finally { box.close(); }

  const storage = fixture("storage");
  try {
    const created = await draft(storage, "storage");
    mkdirSync(storage.worktreeRoot);
    const common = git(storage.repository, "rev-parse", "--path-format=absolute", "--git-common-dir").trim();
    for (const path of [join(common, "HEAD"), join(common, "config"), storage.worktreeRoot]) chmodSync(path, 0o777);
    const result = await preflightCommand(options(storage, created.attemptDir, gateRunner([])));
    assert.match(field(result.record, "git-storage").reason ?? "", /reads mode 0777, the signature of a DrvFs-mounted drive/u);
  } finally { storage.close(); }
});

test("preflight measures DRAFT only and writes nothing elsewhere", async () => {
  const box = fixture("state");
  try {
    const created = await draft(box, "prepared");
    const prepared = await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.transitioned", next: nextRevision(created.status, { lifecycleState: "PREPARED" }),
    });
    const before = readFileSync(join(created.attemptDir, "journal.jsonl"), "utf8");
    const calls: Call[] = [];
    await assert.rejects(preflightCommand(options(box, created.attemptDir, gateRunner(calls))), PreflightAttemptNotDraft);
    assert.equal(readFileSync(join(created.attemptDir, "journal.jsonl"), "utf8"), before);
    assert.deepEqual(calls, []);
    assert.equal(existsSync(box.worktreeRoot), false);
    assert.equal((await readAttempt(created.attemptDir)).revision, prepared.revision);
  } finally { box.close(); }
});

test("the CLI arm takes no owner terminal, prints the record, and db rebuild reproduces its events row", async () => {
  // A real gate through the transport broker: node on PATH, as the configured npm gates are.
  const box = fixture("cli", `  test: { argv: [node, "-e", "process.exit(0)"], timeout_seconds: 600 }\n`);
  try {
    const output: string[] = [];
    const errors: string[] = [];
    const invoke = (argv: string[]) => main({ argv: [...argv, "--state-root", box.stateRoot, "--config", box.configPath], cwd: box.repository,
      env: { ...process.env, AWSF_WORKTREE_ROOT: box.worktreeRoot },
      get terminal(): never { throw new Error("preflight accessed an owner terminal"); },
      writeOut: (line) => output.push(line), writeError: (line) => errors.push(line) });
    assert.equal(await invoke(["new", "cli-task", REQUEST, "--workflow", "build-review", "--tier", "2"]), 0, errors.join("\n"));
    assert.equal(await invoke(["preflight", "cli-task", "--where", "core/src/example.ts", "--stub", "true"]), 1);
    assert.match(errors.at(-1) ?? "", /usage: awsf preflight/u);
    output.length = 0;
    assert.equal(await invoke(["preflight", "cli-task", "--where", "core/src/example.ts", "--read", "AGENTS.md", "--json"]), 0, errors.join("\n"));
    const record: unknown = JSON.parse(output[0]!);
    assertDriverPreflightRecord(record);
    assert.deepEqual(record.where, ["core/src/example.ts"]);
    assert.deepEqual(record.read, ["AGENTS.md"]);
    assert.equal(record.suite?.source, "preflight-run");
    output.length = 0;
    assert.equal(await invoke(["preflight", "cli-task", "--where", "core/src/other.ts"]), 1);
    assert.match(output.join("\n"), /^write-boundary: refused — --where core\/src\/other\.ts/mu);
    assert.ok(output.includes("suite: pass"));

    const rows = (): unknown[] => {
      const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
      try {
        return db.prepare("SELECT event_id, session_id, type, name, payload_json, started_at FROM events WHERE name = 'driver preflight' ORDER BY event_id").all();
      } finally { db.close(); }
    };
    const live = rows();
    assert.equal(live.length, 2, "one events row per record");
    const report = await rebuildCommand(box.stateRoot);
    assert.equal(report.ok, true);
    assert.deepEqual(rows(), live);
  } finally { box.close(); }
});

test("the dashboard projection writes the record as one notice row", async () => {
  const box = fixture("projection");
  try {
    const projection = createDashboardProjection(box.stateRoot);
    try {
      const created = await newCommand({ stateRoot: box.stateRoot, project: PROJECT, taskId: "projected", repository: box.repository,
        request: REQUEST, workflow: "build-review", tier: 2, projectRecord: projection.project });
      await preflightCommand(options(box, created.attemptDir, gateRunner([]), { projectRecord: projection.project }));
    } finally { projection.close(); }
    const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
    try {
      const row = db.prepare("SELECT type, payload_json FROM events WHERE name = 'driver preflight'").get() as { type: string; payload_json: string };
      assert.equal(row.type, "notice");
      assertDriverPreflightRecord(JSON.parse(row.payload_json));
    } finally { db.close(); }
  } finally { box.close(); }
});
