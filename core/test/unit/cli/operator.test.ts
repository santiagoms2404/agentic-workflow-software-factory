import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorCommand } from "../../../src/cli/commands/doctor.ts";
import { dashCommand, gcCommand, rebuildCommand } from "../../../src/cli/commands/operator.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt } from "../../../src/cli/commands/attempt.ts";
import { runStubCommand } from "../../../src/cli/commands/run.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import { landCommand } from "../../../src/cli/commands/land.ts";
import { execFileSync } from "node:child_process";

function bytes(path: string): string { return readFileSync(path, "utf8"); }

test("doctor only reads a stale recorded PID, while gc only lists terminal candidates", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-operator-"));
  try {
    const stateRoot = join(root, "state");
    const created = await newCommand({
      stateRoot, project: "project", taskId: "T22", repository: root,
      request: "operator command test", workflow: "simple-sdlc", tier: 1,
      sessionId: () => "operator-session", now: () => "2026-08-08T00:00:00.000Z",
    });
    const terminal = nextRevision(created.status, {
      lifecycleState: "CANCELLED",
      process: { pid: process.pid, pgid: process.pid, startIdentity: null, startIdentitySource: "test" },
    });
    await persistAttempt(created.attemptDir, created.status.revision, { kind: "attempt.updated", next: terminal });
    const journalBefore = bytes(join(created.attemptDir, "journal.jsonl"));
    const statusBefore = bytes(join(created.attemptDir, "status.json"));

    const report = await doctorCommand(stateRoot);
    assert.equal(report.healthy, false);
    assert.ok(report.lines.some((line) => line.includes(`orphan pid ${process.pid}`)));
    assert.equal(bytes(join(created.attemptDir, "journal.jsonl")), journalBefore);
    assert.equal(bytes(join(created.attemptDir, "status.json")), statusBefore);

    const candidates = await gcCommand(stateRoot);
    assert.deepEqual(candidates, [`attempt: ${created.attemptDir}`]);
    assert.equal(bytes(join(created.attemptDir, "journal.jsonl")), journalBefore);
    assert.equal(bytes(join(created.attemptDir, "status.json")), statusBefore);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("dash gives a clear message rather than building or serving a missing dashboard", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-dash-"));
  try {
    const lines: string[] = [];
    assert.equal(await dashCommand({ cwd: root, write: (line) => lines.push(line) }), "not-built");
    assert.deepEqual(lines, ["Dashboard is not built yet. Run the dashboard build first; awsf dash never builds it."]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the fixture simple-sdlc reaches the interactive owner boundary without a provider", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-stub-sdlc-"));
  try {
    const canonical = join(root, "canonical");
    execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
    writeFileSync(join(canonical, "README.md"), "base\n");
    execFileSync("git", ["-C", canonical, "add", "README.md"]);
    execFileSync("git", ["-C", canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed stub sdlc"], { stdio: "ignore" });
    const created = await newCommand({ stateRoot: join(root, "state"), project: "agentic-workflow-software-factory", taskId: "T22", repository: canonical, request: "stub", workflow: "simple-sdlc", tier: 2 });
    await startCommand({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath: "awsf.config.yaml", preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
    const status = await runStubCommand(created.attemptDir);
    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    assert.ok(status.candidateSha !== null);
    const landed = await landCommand({ attemptDir: created.attemptDir, terminal: { interactive: true, write: () => {}, confirm: async () => true } });
    assert.equal(landed.status.lifecycleState, "LANDED");
    assert.equal(execFileSync("git", ["-C", canonical, "status", "--porcelain"], { encoding: "utf8" }), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("db rebuild exposes the disposable projection guarantee as an operator command", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-rebuild-command-"));
  try {
    const stateRoot = join(root, "state");
    await newCommand({
      stateRoot, project: "project", taskId: "T22", repository: root,
      request: "rebuild", workflow: "simple-sdlc", tier: 1,
      sessionId: () => "rebuild-session", now: () => "2026-08-08T00:00:00.000Z",
    });
    const report = await rebuildCommand(stateRoot);
    assert.equal(report.ok, true, report.ok ? undefined : report.reason);
    assert.equal(report.sessions, 1);
    assert.ok(bytes(join(stateRoot, "awsf.db")).length > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
