import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { attributeCommand, type AttributeCommandOptions } from "../../../src/cli/commands/attribute.ts";
import { cancelCommand } from "../../../src/cli/commands/cancel.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, taskRoot } from "../../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { rebuildCommand } from "../../../src/cli/commands/operator.ts";
import { main } from "../../../src/cli/main.ts";
import { assertAttributionRecord, type AttributionRecord } from "../../../src/contracts/attribution-record.ts";
import { appendTaskAttribution, attributionsFilePath, readTaskAttributions } from "../../../src/persistence/task-attributions.ts";
import { Journal } from "../../../src/persistence/journal.ts";
import { projectAttribution } from "../../../src/observability/projector.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { readRunFacts } from "../../../src/metrics/role-rows.ts";
import { readMetricsPayload } from "../../../src/cli/commands/metrics.ts";

const PROJECT = "agentic-workflow-software-factory";
const AT = "2026-10-08T10:00:00.000Z";
const credential = (): string => `ghp_${"a".repeat(36)}`;

function snapshot(root: string): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      const path = join(directory, entry.name);
      const stat = statSync(path);
      files[name] = { mode: stat.mode, mtimeMs: stat.mtimeMs, size: stat.size,
        bytes: entry.isDirectory() ? null : readFileSync(path).toString("base64") };
      if (entry.isDirectory()) walk(path, `${name}/`);
    }
  };
  walk(root, "");
  return files;
}

for (const act of ["attribute", "cancel"] as const) {
  test(`${act}: invalid links and declines leave every byte unchanged, no prompt or signal on refusal`, async () => {
    const root = mkdtempSync(join(tmpdir(), "awsf-link-refusal-"));
    const stateRoot = join(root, "state");
    try {
      const created = await newCommand({ stateRoot, project: PROJECT, taskId: "link-test", repository: root,
        workflow: "build", tier: 1, request: "synthetic link validation" });
      // A cancel must protect a recorded live-shaped tree, not just an empty DRAFT.
      // The injected terminator is the only signal path; no actual process is targeted.
      await persistAttempt(created.attemptDir, created.status.revision, {
        kind: "attempt.updated", next: nextRevision(created.status, act === "attribute"
          ? { lifecycleState: "BLOCKED" }
          : { lifecycleState: "RUNNING", process: { pid: 424242, pgid: 424242,
            startIdentity: "synthetic", startIdentitySource: "test" } }),
      });
      let prompts = 0;
      let signals = 0;
      let projections = 0;
      const terminal = { interactive: true, write: () => { prompts++; }, confirm: async () => { prompts++; return true; } };
      const base = { stateRoot, project: PROJECT, taskId: "link-test", attempt: 1, attemptDir: created.attemptDir,
        cause: "factory", reason: "synthetic reason", terminal,
        projectAttribution: () => { projections++; }, projectRecord: () => { projections++; },
        terminate: async () => { signals++; return { termSent: true, killSent: false, survivors: [], terminated: true, skipped: null }; } };
      const before = snapshot(root);
      const bad: Partial<AttributeCommandOptions>[] = [
        {}, { trap: "TR-1" }, { trap: "TR-001" }, { trap: "TR-01\n" },
        { trap: "TR-01", reason: credential() },
        { noTrap: { because: "unknown-kind", reason: "synthetic" } },
        { noTrap: { because: "fixed", reason: " " } },
        { noTrap: { because: "fixed", reason: credential() } },
        { noTrap: { because: "fixed", reason: `${"a".repeat(2_001)} ${credential()}` } },
        { noTrap: { because: "fixed", reason: "[REDACTED]" } },
        { trap: "TR-01", noTrap: { because: "fixed", reason: "synthetic" } },
      ];
      for (const invalid of bad) {
        const options = { ...base, ...invalid };
        await assert.rejects(act === "attribute" ? attributeCommand(options) : cancelCommand(options));
        assert.deepEqual(snapshot(root), before);
        assert.deepEqual([prompts, signals, projections], [0, 0, 0]);
      }
      const declined = { ...base, trap: "TR-99", terminal: { ...terminal, confirm: async () => false } };
      await (act === "attribute" ? attributeCommand(declined) : cancelCommand(declined));
      assert.deepEqual(snapshot(root), before);
      assert.deepEqual([signals, projections], [0, 0]);
      // Positive control proves the same seams would signal/project a confirmed act.
      await (act === "attribute" ? attributeCommand({ ...base, trap: "TR-99" }) : cancelCommand({ ...base, trap: "TR-99" }));
      assert.deepEqual([signals, projections], act === "attribute" ? [0, 1] : [1, 2]);
      const records = await readTaskAttributions(taskRoot(stateRoot, PROJECT, "link-test"));
      assert.equal(records.length, 1);
      assert.equal(records[0]?.schema, "awsf.attribution/v2");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

for (const act of ["attribute", "cancel"] as const) {
  test(`main ${act}: refusals and declines create no journal, projection, lock or status change`, async () => {
    const root = mkdtempSync(join(tmpdir(), "awsf-link-main-refusal-"));
    const stateRoot = join(root, "state");
    try {
      const created = await newCommand({ stateRoot, project: PROJECT, taskId: "main-link", repository: root,
        workflow: "build", tier: 1, request: "synthetic CLI link refusal" });
      if (act === "attribute") await persistAttempt(created.attemptDir, created.status.revision, {
        kind: "attempt.updated", next: nextRevision(created.status, { lifecycleState: "BLOCKED" }),
      });
      const before = snapshot(root);
      const prompts: string[] = [];
      let confirmations = 0;
      const terminal = { interactive: true, write: (line: string) => prompts.push(line),
        confirm: async () => { confirmations++; return false; } };
      const cli = async (flags: readonly string[], owner = terminal) => {
        const errors: string[] = [];
        const code = await main({ cwd: resolve("."), env: {}, argv: [act, "main-link", "--state-root", stateRoot,
          "--attempt", "1", "--cause", "factory", ...flags], terminal: owner,
          writeOut: () => {}, writeError: line => errors.push(line) });
        assert.deepEqual(snapshot(root), before, "even a missing SQLite file must stay absent");
        return { code, errors };
      };
      const cases: readonly [readonly string[], RegExp][] = [
        [["--reason", "synthetic"], /this cause requires --trap/],
        [["--reason", "synthetic", "--trap", "TR-1"], /invalid trap link/],
        [["--reason", "synthetic", "--no-trap", "unknown-kind", "why"], /invalid trap link/],
        [["--reason", "synthetic", "--no-trap", "fixed", credential()], /credential-shaped/],
        [["--reason", credential(), "--trap", "TR-01"], /credential-shaped/],
        [["--reason", "synthetic", "--no-trap", "fixed"], /requires <kind>/],
        [["--reason", "synthetic", "--trap", "TR-01", "--trap", "TR-99"], /only once/],
        [["--reason", "synthetic", "--no-trap", "fixed", "why", "--no-trap", "owner", "why"], /only once/],
        [["--reason", "synthetic", "--trap", "TR-01", "--no-trap", "fixed", "why"], /mutually exclusive/],
      ];
      for (const [flags, refusal] of cases) {
        const result = await cli(flags);
        assert.equal(result.code, 1);
        assert.match(result.errors.join("\n"), refusal);
        assert.equal(prompts.length, 0);
        assert.equal(confirmations, 0);
      }
      assert.equal((await cli(["--reason", "synthetic", "--trap", "TR-99"], { ...terminal, interactive: false })).code, 1);
      assert.equal(prompts.length, 0);
      assert.equal(confirmations, 0);
      for (const [flags, shown] of [
        [["--trap", "TR-99"], "Trap link: TR-99"],
        [["--no-trap", "fixed", "synthetic regression proof"], "Trap link: none (fixed): synthetic regression proof"],
      ] as const) {
        const result = await cli(["--reason", "synthetic", ...flags]);
        assert.equal(result.code, 1);
        assert.deepEqual(result.errors, []);
        assert.ok(prompts.includes(shown));
      }
      assert.equal(confirmations, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("CLI consumes both no-trap values, shows the link, and persists/project/rebuild agree", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-link-cli-"));
  const stateRoot = join(root, "state");
  try {
    const projection = createDashboardProjection(stateRoot);
    const created = await newCommand({ stateRoot, project: PROJECT, taskId: "linked", repository: root,
      workflow: "build", tier: 1, request: "synthetic cancellation", projectRecord: projection.project });
    projection.close();
    const lines: string[] = [];
    const terminal = { interactive: true, write: (line: string) => lines.push(line), confirm: async () => true };
    assert.equal(await main({ cwd: resolve("."), argv: ["cancel", "linked", "--state-root", stateRoot,
      "--cause", "factory", "--reason", "removed defect", "--no-trap", "fixed", "regression test keeps it fixed"],
      terminal, writeOut: () => {}, writeError: (line) => lines.push(line) }), 0, lines.join("\n"));
    assert.ok(lines.includes("Trap link: none (fixed): regression test keeps it fixed"));
    const [record] = await readTaskAttributions(taskRoot(stateRoot, PROJECT, "linked"));
    assert.equal(record?.schema, "awsf.attribution/v2");
    if (record?.schema !== "awsf.attribution/v2") throw new Error("missing v2 record");
    assert.deepEqual(record.trap, { kind: "none", because: "fixed", reason: "regression test keeps it fixed" });
    const rows = (): unknown[] => {
      const db = openDatabase(join(stateRoot, "awsf.db"), { readonly: true });
      try { return db.prepare("SELECT payload_json FROM events WHERE type = 'attribution' ORDER BY event_row").all(); }
      finally { db.close(); }
    };
    const live = rows();
    assert.equal(live.length, 1);
    assert.deepEqual(JSON.parse((live[0] as { payload_json: string }).payload_json).trap, record.trap);
    assert.equal((await rebuildCommand(stateRoot)).ok, true);
    assert.deepEqual(rows(), live);
    const before = snapshot(root);
    for (const flags of [["--trap", "bad"], ["--no-trap", "bad", "why"],
      ["--trap", "TR-01", "--no-trap", "fixed", "why"], ["--no-trap", "fixed"],
      ["--trap", "bad", "--trap", "TR-01"]]) {
      assert.equal(await main({ cwd: resolve("."), argv: ["attribute", "linked", "--state-root", stateRoot,
        "--attempt", "1", "--cause", "factory", "--reason", "synthetic", ...flags], terminal,
        writeOut: () => {}, writeError: () => {} }), 1);
      assert.deepEqual(snapshot(root), before);
    }
    assert.equal(created.status.taskId, "linked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("v1 remains readable, projects and counts as pre-link; v2 latest wins across rebuild", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-link-legacy-"));
  const stateRoot = join(root, "state");
  const projection = createDashboardProjection(stateRoot);
  try {
    const created = await newCommand({ stateRoot, project: PROJECT, taskId: "legacy", repository: root,
      workflow: "build", tier: 1, request: "synthetic legacy", projectRecord: projection.project });
    await persistAttempt(created.attemptDir, created.status.revision, { kind: "attempt.updated",
      next: nextRevision(created.status, { lifecycleState: "CANCELLED" }) }, projection.project);
    const task = taskRoot(stateRoot, PROJECT, "legacy");
    const legacy: AttributionRecord = { schema: "awsf.attribution/v1", project: PROJECT, taskId: "legacy",
      attempt: 1, cause: "factory", reason: "historical synthetic record", at: AT };
    // Historical fixture bytes use the journal directly; the live writer must require v2.
    const journal = new Journal<AttributionRecord>(attributionsFilePath(task));
    try { await journal.append(legacy); } finally { await journal.close(); }
    projection.projectAttribution(legacy);
    assert.deepEqual(await readTaskAttributions(task), [legacy]);
    assert.deepEqual(readMetricsPayload(join(stateRoot, "awsf.db"), AT).causes.cancels, { total: 1, byCause: { factory: 1 } });
    const readOwner = () => {
      const db = openDatabase(join(stateRoot, "awsf.db"), { readonly: true });
      try { return readRunFacts(db)[0]!.ownerAttribution; } finally { db.close(); }
    };
    assert.equal(readOwner()?.trap, undefined, "v1 is pre-link, not a no-trap reason");
    const latest = await attributeCommand({ stateRoot, project: PROJECT, taskId: "legacy", attempt: 1,
      cause: "driver", reason: "new evidence", trap: "TR-99", now: () => "2026-10-07T10:00:00.000Z",
      terminal: { interactive: true, write: () => {}, confirm: async () => true }, projectAttribution: projection.projectAttribution });
    projection.close();
    assert.deepEqual(readOwner()?.trap, { kind: "trap", id: "TR-99" });
    assert.equal(readOwner()?.cause, "driver", "append order wins, not timestamp or schema version");
    assert.deepEqual(readMetricsPayload(join(stateRoot, "awsf.db"), AT).causes.cancels, { total: 1, byCause: { driver: 1 } });
    assert.equal((await rebuildCommand(stateRoot)).ok, true);
    assert.deepEqual(readOwner()?.trap, { kind: "trap", id: "TR-99" });
    assert.deepEqual(readMetricsPayload(join(stateRoot, "awsf.db"), AT).causes.cancels, { total: 1, byCause: { driver: 1 } });
    const rebuilt = openDatabase(join(stateRoot, "awsf.db"), { readonly: true });
    try {
      const events = rebuilt.prepare("SELECT payload_json FROM events WHERE type = 'attribution' ORDER BY event_row").all() as { payload_json: string }[];
      assert.equal(events.length, 2);
      assert.equal(Object.hasOwn(JSON.parse(events[0]!.payload_json), "trap"), false, "v1 still projects as pre-link");
      assert.deepEqual(JSON.parse(events[1]!.payload_json).trap, { kind: "trap", id: "TR-99" });
    } finally { rebuilt.close(); }
    assert.equal((await readTaskAttributions(task)).length, 2);
    assert.equal(latest.previous?.schema, "awsf.attribution/v1");
  } finally { projection.close(); rmSync(root, { recursive: true, force: true }); }
});

test("writers and projector independently reject unchecked links before opening a journal or writing an event", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-link-writer-"));
  const db = openDatabase(join(root, "awsf.db"));
  try {
    const base = { schema: "awsf.attribution/v2", project: PROJECT, taskId: "synthetic", attempt: 1,
      cause: "factory", reason: "synthetic", at: AT };
    for (const trap of [undefined, { kind: "trap", id: "bad" }, { kind: "trap", id: "TR-01", unchecked: true },
      { kind: "none", because: "unknown-kind", reason: "synthetic" }, { kind: "none", because: "fixed", reason: " " },
      { kind: "none", because: "fixed", reason: credential() }, { kind: "none", because: "fixed", reason: "[REDACTED]" }]) {
      const bad = { ...base, trap } as unknown as AttributionRecord;
      assert.throws(() => assertAttributionRecord(bad));
      await assert.rejects(appendTaskAttribution(join(root, "task"), bad));
      assert.throws(() => projectAttribution(db, bad));
      assert.equal(readdirSync(root).includes("task"), false);
    }
    await assert.rejects(appendTaskAttribution(join(root, "task"), { ...base, schema: "awsf.attribution/v1" } as AttributionRecord), /new attributions require/);
    assert.equal(readdirSync(root).includes("task"), false, "v1 is readable but cannot bypass the live link writer");
    assert.equal((db.prepare("SELECT count(*) AS n FROM events WHERE type = 'attribution'").get() as { n: number }).n, 0);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
