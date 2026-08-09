import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorCommand } from "../../../src/cli/commands/doctor.ts";
import { dashCommand, gcCommand, rebuildCommand } from "../../../src/cli/commands/operator.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import { runStubCommand } from "../../../src/cli/commands/run.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import { landCommand } from "../../../src/cli/commands/land.ts";
import { execFileSync } from "node:child_process";
import { get, type Server } from "node:http";
import { getSession, pollEvents, projectionHealth } from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";

function bytes(path: string): string { return readFileSync(path, "utf8"); }

async function httpGet(port: number, path: string, host = `127.0.0.1:${port}`): Promise<{
  status: number;
  headers: import("node:http").IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    get({ hostname: "127.0.0.1", port, path, headers: { host } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    }).once("error", reject);
  });
}

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
    assert.equal(await dashCommand({
      cwd: root,
      assetRoot: join(root, "missing-dist"),
      write: (line) => lines.push(line),
    }), "not-built");
    assert.deepEqual(lines, ["Dashboard is not built yet. Run the dashboard build first; awsf dash never builds it."]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("dash serves built modules with security headers from loopback only", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-dash-built-"));
  let server: Server | null = null;
  try {
    const dist = join(root, "dashboard", "dist");
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "index.html"), "<script type=\"module\" src=\"/assets/app.js\"></script>");
    writeFileSync(join(dist, "assets", "app.js"), "document.body.dataset.ready = 'true';\n");
    assert.equal(await dashCommand({
      cwd: root,
      assetRoot: dist,
      port: 0,
      write: () => {},
      onListening: (running) => { server = running; },
    }), "serving");
    const address = server?.address();
    if (address === null || address === undefined || typeof address === "string") throw new Error("missing dashboard address");
    const script = await httpGet(address.port, "/assets/app.js");
    assert.equal(script.status, 200);
    assert.match(script.headers["content-type"] ?? "", /^text\/javascript/);
    assert.match(script.headers["content-security-policy"] ?? "", /connect-src 'self'/);
    assert.match(script.body, /dataset\.ready/);
    assert.equal((await httpGet(address.port, "/", "example.com")).status, 400);
  } finally {
    if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
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

test("the bounded fixture window is RUNNING in WAL and rebuild preserves its final status", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-live-stub-"));
  const projection = createDashboardProjection(join(root, "state"));
  try {
    const stateRoot = join(root, "state");
    const canonical = join(root, "canonical");
    execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
    writeFileSync(join(canonical, "README.md"), "base\n");
    execFileSync("git", ["-C", canonical, "add", "README.md"]);
    execFileSync("git", ["-C", canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed live stub"], { stdio: "ignore" });
    const created = await newCommand({
      stateRoot, project: "agentic-workflow-software-factory", taskId: "T26-live",
      repository: canonical, request: "bounded live fixture", workflow: "simple-sdlc", tier: 1,
      projectRecord: projection.project,
    });
    await startCommand({
      attemptDir: created.attemptDir,
      worktreeRoot: join(root, "worktrees"),
      configPath: "awsf.config.yaml",
      preflight: () => ({ adapter: true, sandbox: true, observability: true }),
      projectRecord: projection.project,
    });

    const final = await runStubCommand(created.attemptDir, {
      liveMs: 4_000,
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
      wait: async (milliseconds) => {
        assert.equal(milliseconds, 4_000);
        assert.equal((await readAttempt(created.attemptDir)).lifecycleState, "RUNNING");
        const reader = openDatabase(join(stateRoot, "awsf.db"), { readonly: true });
        try {
          assert.equal(getSession(reader, created.status.sessionId)?.lifecycle_state, "RUNNING");
          assert.equal(projectionHealth(reader).journalMode, "wal");
        } finally { reader.close(); }
      },
    });
    assert.equal(final.lifecycleState, "AWAITING_OWNER");
    projection.close();

    const report = await rebuildCommand(stateRoot);
    assert.equal(report.ok, true, report.ok ? undefined : report.reason);
    const rebuilt = openDatabase(join(stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.equal(getSession(rebuilt, created.status.sessionId)?.lifecycle_state, "AWAITING_OWNER");
      assert.equal(pollEvents(rebuilt, created.status.sessionId, 0).length, 0, "CLI records are not fake provider events");
      assert.equal(projectionHealth(rebuilt).journalMode, "wal");
    } finally { rebuilt.close(); }
  } finally {
    projection.close();
    rmSync(root, { recursive: true, force: true });
  }
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
