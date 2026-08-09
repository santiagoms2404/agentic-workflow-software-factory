import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cancelCommand } from "../../../src/cli/commands/cancel.ts";
import { AlreadyInState } from "../../../src/state/errors.ts";
import { SealedAttempt } from "../../../src/persistence/attempt-lock.ts";
import { locateAttempt, nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { retryCommand } from "../../../src/cli/commands/retry.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import { statusCommand } from "../../../src/cli/commands/status.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function repository(root: string): string {
  const repo = join(root, "canonical");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "README.md");
  git(repo, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed cli commands");
  return repo;
}

const yesTerminal = { interactive: true, write: () => {}, confirm: async () => true } as const;

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
    for (const label of ["State:", "Phase:", "Rounds:", "Calls:", "Model:", "Last activity:", "Budget:", "Next action:"]) {
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

    const retried = await retryCommand({
      attemptDir: created.attemptDir,
      stateRoot,
      sessionId: () => "cli-retry-session",
      now: () => "2026-08-07T00:03:00.000Z",
    });
    assert.equal(retried.status.attempt, 2);
    assert.equal(retried.status.lifecycleState, "DRAFT");
    assert.equal(retried.status.budget.callsSpent, 2);
    assert.equal((await readAttempt(retried.attemptDir)).sessionId, "cli-retry-session");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
