import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../../src/cli/main.ts";
import { toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { cancelCommand } from "../../../src/cli/commands/cancel.ts";
import { AlreadyInState } from "../../../src/state/errors.ts";
import { SealedAttempt } from "../../../src/persistence/attempt-lock.ts";
import { locateAttempt, nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { retryCommand } from "../../../src/cli/commands/retry.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import { formatStatusEvidence, statusCommand } from "../../../src/cli/commands/status.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function repository(root: string): string {
  const repo = join(root, "canonical");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  writeFileSync(join(repo, "README.md"), "base\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  git(repo, "add", "README.md", ".gitignore");
  git(repo, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed cli commands");
  mkdirSync(join(repo, "node_modules", "fixture"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "fixture", "index.js"), "dependency\n");
  return repo;
}

const yesTerminal = { interactive: true, write: () => {}, confirm: async () => true } as const;

test("a missing configured seed fails actionably before PREPARED", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-cli-missing-seed-"));
  try {
    const repo = repository(root);
    const stateRoot = join(root, "state");
    const created = await newCommand({
      stateRoot, project: "agentic-workflow-software-factory", taskId: "missing-seed",
      repository: repo, request: "prove preparation refusal", workflow: "build", tier: 1,
    });
    const configPath = join(root, "awsf.config.yaml");
    writeFileSync(configPath, readFileSync(resolve("awsf.config.yaml"), "utf8").replace("seed_paths: [node_modules]", "seed_paths: [missing-cache]"));
    await assert.rejects(
      startCommand({
        attemptDir: created.attemptDir,
        worktreeRoot: join(root, "worktrees"),
        configPath,
        preflight: () => ({ adapter: true, sandbox: true, observability: true }),
      }),
      /cannot seed "missing-cache" before PREPARED: configured source is missing in the canonical repository/,
    );
    const blocked = await readAttempt(created.attemptDir);
    assert.equal(blocked.lifecycleState, "BLOCKED");
    assert.equal(blocked.blocker?.code, "preflight-failed");
    assert.match(blocked.nextAction, /awsf retry missing-seed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("start rejects a missing configured prompt before worktree creation or adapter preflight", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-cli-missing-prompt-"));
  try {
    const repo = repository(root);
    const stateRoot = join(root, "state");
    const configPath = join(root, "awsf.config.yaml");
    writeFileSync(
      configPath,
      readFileSync(resolve("awsf.config.yaml"), "utf8")
        .replace("system: prompts/builder/system.md", "system: prompts/builder/missing-system.md"),
    );
    mkdirSync(join(root, "prompts", "builder"), { recursive: true });
    mkdirSync(join(root, "prompts", "shared"), { recursive: true });
    writeFileSync(join(root, "prompts", "builder", "user.md"), readFileSync(resolve("prompts/builder/user.md"), "utf8"));
    writeFileSync(join(root, "prompts", "shared", "headless-role.md"), readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));
    const created = await newCommand({
      stateRoot,
      project: "agentic-workflow-software-factory",
      taskId: "missing-prompt",
      repository: repo,
      request: "refuse before spending a call",
      workflow: "build",
      tier: 1,
    });

    await assert.rejects(
      startCommand({
        attemptDir: created.attemptDir,
        worktreeRoot: join(root, "worktrees"),
        configPath,
      }),
      /missing-system\.md/,
    );
    const blocked = await readAttempt(created.attemptDir);
    assert.equal(blocked.lifecycleState, "BLOCKED");
    assert.equal(blocked.worktree, null);
    assert.equal(blocked.baseSha, null);
    assert.equal(blocked.budget.callsSpent, 0);
    assert.equal(blocked.blocker?.code, "preflight-failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the retry CLI snapshots the currently loaded effective config and allowance", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-cli-retry-config-"));
  try {
    const stateRoot = join(root, "state");
    const configPath = join(root, "corrected.config.yaml");
    const correctedText = readFileSync(resolve("awsf.config.yaml"), "utf8")
      .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", "test: { argv: [npm, run, test:journeys], timeout_seconds: 600 }")
      .replace("correction_allowance: { auto: 1, owner: 1 }", "correction_allowance: { auto: 2, owner: 0 }");
    writeFileSync(configPath, correctedText);
    const created = await newCommand({
      stateRoot, project: "agentic-workflow-software-factory", taskId: "retry-current-config",
      repository: resolve("."), request: "retain task identity", workflow: "build", tier: 1,
      configSnapshotJson: JSON.stringify({ gates: { test: { argv: ["npm", "run", "old"] } } }),
      allowance: { auto: 1, owner: 1 }, sessionId: () => "prior-cli-session",
    });
    const blocked = nextRevision(created.status, {
      lifecycleState: "BLOCKED",
      budget: { ...created.status.budget, callsSpent: 1, correctionsAuto: 1 },
      blocker: { code: "phase-abort", detail: "owner corrected config", ahead: null, behind: null },
    });
    await persistAttempt(created.attemptDir, created.status.revision, { kind: "attempt.transitioned", next: blocked });

    const errors: string[] = [];
    assert.equal(await main({
      argv: ["retry", "retry-current-config", "--state-root", stateRoot, "--config", configPath],
      cwd: resolve("."), writeOut: () => {}, writeError: (line) => errors.push(line),
    }), 0, errors.join("\n"));
    const retried = await readAttempt(join(stateRoot, "projects", created.status.project, "tasks", created.status.taskId, "2"));
    assert.equal(retried.configSnapshotJson, toConfigSnapshotJson(loadConfig(correctedText)));
    assert.match(retried.configSnapshotJson, /test:journeys/);
    assert.doesNotMatch(retried.configSnapshotJson, /\["npm","run","old"\]/);
    assert.deepEqual(retried.budget.allowance, { auto: 2, owner: 0, ownerReentries: 0 });
    assert.equal(retried.budget.callsSpent, 1);
    assert.equal(retried.budget.callsReserved, 0);
    assert.equal(retried.project, created.status.project);
    assert.equal(retried.taskId, created.status.taskId);
    assert.equal(retried.workflow, created.status.workflow);
    assert.equal(retried.request, created.status.request);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status evidence names failed checks, the last envelope, and retained process outcome", () => {
  const records = [
    {
      type: "gate", id: "gate-1", phaseId: "session:builder", round: 0,
      gateId: "commands_pass", kind: "subprocess", candidateSha: "a".repeat(40), passed: false,
      exitCode: 2, checks: [{ item: "npm test", ok: false, note: "exit 2: assertion failed" }],
      violations: [], outputPath: null, startedAt: "2026-08-07T00:00:00.000Z", endedAt: "2026-08-07T00:00:01.000Z",
    },
    {
      type: "envelope", phaseId: "session:builder", envelope: {
        envelopeId: "envelope-1", sessionId: "session", phaseId: "session:builder", correctionRound: 0,
        agent: "builder", schemaId: "awsf.build-output/v1", valid: false,
        payload: null, violations: [{ path: "/changedFiles", kind: "schema-mismatch", message: "is required", received: null }],
        rawOutputPath: "raw/builder.txt", createdAt: "2026-08-07T00:00:00.000Z",
      },
    },
    {
      type: "process", phaseId: "session:builder", adapterId: "pi", role: "builder", status: "EXITED",
      registeredAt: "2026-08-07T00:00:00.000Z", releasedAt: "2026-08-07T00:00:00.100Z",
      endedAt: "2026-08-07T00:00:01.000Z", exitCode: 2, exitSignal: null,
      record: {
        identity: { pid: 42, pgid: 42, startIdentity: "fixture:42", startIdentitySource: "fixture" },
        runId: "run-1", edge: null, reservationId: "reservation-1", command: ["pi", "--mode", "json"], cwd: "/managed/worktree",
      },
    },
  ] as const satisfies readonly AttemptEvidence[];

  const lines = formatStatusEvidence(records).join("\n");
  assert.match(lines, /commands_pass: FAIL/);
  assert.match(lines, /npm test: exit 2: assertion failed/);
  assert.match(lines, /awsf\.build-output\/v1 valid=false/);
  assert.match(lines, /changedFiles/);
  assert.match(lines, /exit=2/);
  assert.match(lines, /command=\["pi","--mode","json"\]/);
});

test("new, start, status, cancel, and retry preserve the lifecycle and task-lifetime budget", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-cli-commands-"));
  try {
    const repo = repository(root);
    const stateRoot = join(root, "state");
    const created = await newCommand({
      stateRoot,
      project: "agentic-workflow-software-factory",
      taskId: "T21-unit",
      repository: repo,
      request: "exercise owner commands",
      workflow: "build-review",
      tier: 2,
      configSnapshotJson: JSON.stringify({ gates: { test: { argv: ["npm", "run", "old-test"] } } }),
      allowance: { auto: 1, owner: 1 },
      sessionId: () => "cli-command-session",
      now: () => "2026-08-07T00:00:00.000Z",
    });
    assert.equal(created.status.lifecycleState, "DRAFT");
    assert.deepEqual(await locateAttempt(stateRoot, created.status.project, created.status.taskId), {
      attemptDir: created.attemptDir,
      attempt: 1,
    });

    const prepared = await startCommand({
      attemptDir: created.attemptDir,
      worktreeRoot: join(root, "worktrees"),
      configPath: resolve("awsf.config.yaml"),
      preflight: () => ({ adapter: true, sandbox: true, observability: true }),
      now: () => "2026-08-07T00:01:00.000Z",
    });
    assert.equal(prepared.lifecycleState, "PREPARED");
    assert.equal(prepared.baseSha, git(repo, "rev-parse", "HEAD"));
    assert.equal(readFileSync(join(prepared.worktree!, "node_modules", "fixture", "index.js"), "utf8"), "dependency\n");
    assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
    await assert.rejects(
      startCommand({
        attemptDir: created.attemptDir,
        worktreeRoot: join(root, "worktrees"),
        configPath: resolve("awsf.config.yaml"),
        preflight: () => ({ adapter: true, sandbox: true, observability: true }),
      }),
      AlreadyInState,
    );
    await assert.rejects(
      newCommand({
        stateRoot,
        project: created.status.project,
        taskId: created.status.taskId,
        repository: repo,
        request: "must use retry",
        workflow: "build-review",
        tier: 2,
      }),
      /already has attempt 1/,
    );

    const lines = await statusCommand(created.attemptDir);
    for (const label of ["State:", "Phase:", "Rounds:", "Calls:", "Model:", "Last activity:", "Budget:", "Owner re-entries:", "Next action:"]) {
      assert.ok(lines.some((line) => line.startsWith(label)), `missing ${label}`);
    }
    assert.ok(lines.every((line) => line.includes("—")), "every status line explains what its value means");

    // A projected ledger snapshot represents spend accumulated by the workflow;
    // cancellation and retry must carry it rather than buy a fresh ceiling.
    const withSpend = nextRevision(prepared, {
      budget: { ...prepared.budget, callsSpent: 2 },
    });
    await persistAttempt(created.attemptDir, prepared.revision, {
      kind: "attempt.updated",
      next: withSpend,
    });
    const cancelled = await cancelCommand({
      attemptDir: created.attemptDir,
      terminal: yesTerminal,
      now: () => "2026-08-07T00:02:00.000Z",
    });
    assert.equal(cancelled.status.lifecycleState, "CANCELLED");
    assert.deepEqual(cancelled.report.survivors, []);
    await assert.rejects(
      persistAttempt(created.attemptDir, cancelled.status.revision, {
        kind: "attempt.updated",
        next: nextRevision(cancelled.status, { lastActivity: "illegal post-seal write" }),
      }),
      SealedAttempt,
    );

    const currentSnapshot = JSON.stringify({ gates: { lint: { argv: ["npm", "run", "lint"] } } });
    const retried = await retryCommand({
      attemptDir: created.attemptDir,
      stateRoot,
      configSnapshotJson: currentSnapshot,
      allowance: { auto: 2, owner: 0 },
      sessionId: () => "cli-retry-session",
      now: () => "2026-08-07T00:03:00.000Z",
    });
    assert.equal(retried.status.attempt, 2);
    assert.equal(retried.status.lifecycleState, "DRAFT");
    assert.equal(retried.status.budget.callsSpent, 2);
    assert.equal(retried.status.budget.callsReserved, 0);
    assert.equal(retried.status.budget.correctionsAuto, 0);
    assert.equal(retried.status.budget.correctionsOwner, 0);
    assert.equal(retried.status.budget.ownerReentries, 0, "a new attempt buys the owner another re-entry");
    // `ownerReentries` is not a separate configuration key: D3 couples it to
    // the configured owner allowance, so an owner allowance of 0 means no
    // re-entry either.
    assert.deepEqual(retried.status.budget.allowance, { auto: 2, owner: 0, ownerReentries: 0 });
    assert.equal(retried.status.configSnapshotJson, currentSnapshot);
    assert.notEqual(retried.status.configSnapshotJson, created.status.configSnapshotJson);
    for (const field of ["project", "taskId", "repository", "workflow", "tier", "request"] as const) {
      assert.equal(retried.status[field], created.status[field], `${field} is task identity and must not change`);
    }
    assert.equal((await readAttempt(retried.attemptDir)).sessionId, "cli-retry-session");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
