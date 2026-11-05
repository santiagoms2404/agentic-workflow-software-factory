// B9-11, B9-12, B9-18, B9-20, B9-22, B9-26, B9-27: Tier 4 Batch 9 lifecycle regression tests.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify as toYaml } from "yaml";
import { cancelCommand } from "../../../src/cli/commands/cancel.ts";
import { grantCommand } from "../../../src/cli/commands/grant.ts";
import { retryCommand } from "../../../src/cli/commands/retry.ts";
import { defaultPreflight, startCommand } from "../../../src/cli/commands/start.ts";
import { landCommand } from "../../../src/cli/commands/land.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import { buildMinimalConfig } from "../../../src/config/init-template.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import { readProtectedState } from "../../../src/workflow/protected-grants.ts";
import type { CandidateSeed } from "../../../src/contracts/candidate-seed.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";
import { k1Request, prepareK1, scriptedOwner } from "../../fixtures/k1-preflight.ts";

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function terminal(confirmFn: () => Promise<boolean> = async () => true): OwnerTerminal {
  return {
    interactive: true,
    write: () => {},
    confirm: confirmFn,
  };
}

function createTestRepo(
  dir: string,
  slug = "test-project",
  protectedPaths: string[] = [],
): { configPath: string; baseSha: string; config: ReturnType<typeof loadConfig> } {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test User");

  const minimal = buildMinimalConfig(slug);
  const configObj = {
    ...minimal,
    workflows: { enabled: ["build", "build-review", "intake"] },
    policy: {
      ...minimal.policy,
      protected_paths: protectedPaths,
    },
    adapters: {
      claude: { kind: "claude-code", enabled: true },
      disabled: { kind: "claude-code", enabled: false },
    },
    routing: {
      default_worker: "claude",
      review: "invert-provider",
      no_fallback: true,
    },
    gates: {
      test: { argv: ["true"], timeout_seconds: 60 },
    },
    agents: [
      {
        name: "builder",
        model: "claude-3-5-sonnet",
        thinking: "high",
        color: "#22D3EE",
        purpose: "Implements the plan's steps.",
        prompt: { system: "prompts/builder/system.md", user: "prompts/builder/user.md" },
        harness: { adapter: "claude", continuity: "same-session" },
        tools: { profile: "managed-worker", allow: ["read", "write", "exec"] },
        writes: ["core/src/**", ...protectedPaths],
      },
    ],
  };

  mkdirSync(join(dir, "prompts", "builder"), { recursive: true });
  writeFileSync(join(dir, "prompts", "builder", "system.md"), "system prompt\n");
  writeFileSync(join(dir, "prompts", "builder", "user.md"), "user prompt\n");
  mkdirSync(join(dir, "prompts", "shared"), { recursive: true });
  writeFileSync(join(dir, "prompts", "shared", "headless-role.md"), "headless role\n");

  const configYaml = toYaml(configObj);
  const configPath = join(dir, "awsf.config.yaml");
  writeFileSync(configPath, configYaml);

  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "chore: initial commit");
  const baseSha = git(dir, "rev-parse", "HEAD");
  return { configPath, baseSha, config: loadConfig(configYaml) };
}

// ---------------------------------------------------------------------------
// 1. B9-11 (cancel.ts:105): Re-read attempt status after owner confirmation
// ---------------------------------------------------------------------------

test("B9-11: cancelCommand refuses if attempt revision changed during owner confirmation", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-11-"));
  try {
    const repo = join(root, "repo");
    createTestRepo(repo);
    const stateRoot = join(root, "state");

    const created = await newCommand({
      stateRoot,
      project: "test-project",
      taskId: "task-cancel-race",
      repository: repo,
      request: "cancellation race test",
      workflow: "build",
      tier: 1,
    });

    let terminateCalled = false;
    const raceTerminal = terminal(async () => {
      // Simulate another process advancing revision while confirm is open
      const current = await readAttempt(created.attemptDir);
      await persistAttempt(created.attemptDir, current.revision, {
        kind: "attempt.updated",
        next: nextRevision(current, { lastActivity: "concurrent modification" }),
      });
      return true;
    });

    await assert.rejects(
      cancelCommand({
        attemptDir: created.attemptDir,
        terminal: raceTerminal,
        cause: "owner",
        reason: "obsolete request",
        terminate: async () => {
          terminateCalled = true;
          return { termSent: false, killSent: false, survivors: [], terminated: true, skipped: null };
        },
      }),
      /attempt revision changed: expected 1, found 2/,
    );

    assert.equal(terminateCalled, false, "terminate must not be called when revision moved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. B9-12 (grant.ts:45): options.now for confirmedAt and lastActivityAt
// ---------------------------------------------------------------------------

test("B9-12: grantCommand uses options.now for confirmedAt and lastActivityAt", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-12-"));
  try {
    const repo = join(root, "repo");
    const { configPath, baseSha, config } = createTestRepo(repo, "test-project", ["core/src/protected.ts"]);
    const stateRoot = join(root, "state");

    const created = await newCommand({
      stateRoot,
      project: "test-project",
      taskId: "task-grant-now",
      repository: repo,
      request: "grant now test",
      workflow: "build",
      tier: 1,
      configSnapshotJson: toConfigSnapshotJson(config),
    });

    // Create a detached worktree for the attempt
    const worktree = join(root, "worktree");
    git(repo, "worktree", "add", "--detach", worktree, baseSha);

    // Advance to PREPARED
    await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.transitioned",
      next: nextRevision(created.status, {
        lifecycleState: "PREPARED",
        baseSha,
        worktree,
      }),
    });

    const fixedConfirmationTime = "2026-09-01T15:30:00.000Z";

    const result = await grantCommand({
      attemptDir: created.attemptDir,
      config,
      configPath,
      stateRoot,
      phase: "builder",
      files: ["core/src/protected.ts"],
      reason: "Allow writing protected file",
      terminal: terminal(async () => true),
      sandboxProbe: () => true,
      now: () => fixedConfirmationTime,
    });

    assert.equal(result.confirmed, true);
    assert.equal(result.status.lastActivityAt, fixedConfirmationTime);

    const facts = readProtectedState(created.attemptDir);
    assert.equal(facts.grants.length, 1);
    assert.equal(facts.grants[0]?.confirmedAt, fixedConfirmationTime);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. B9-18 (retry.ts:71): When retrying a seeded attempt, clear seed and document
// ---------------------------------------------------------------------------

test("B9-18: retryCommand clears seed and documents seed clearance in lastActivity", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-18-"));
  try {
    const repo = join(root, "repo");
    createTestRepo(repo);
    const stateRoot = join(root, "state");

    const created = await newCommand({
      stateRoot,
      project: "test-project",
      taskId: "task-seeded-retry",
      repository: repo,
      request: "seeded retry test",
      workflow: "build",
      tier: 1,
    });

    const fakeSeed = {
      schema: "awsf.candidate-seed/v1",
      id: "seed-123",
      workflow: "build",
      integrationBaseSha: "b".repeat(40),
      seedCandidateSha: "c".repeat(40),
      source: { project: "test-project", taskId: "source-task", attempt: 1, sessionId: "sess-1", revision: 1, journalDigest: "d".repeat(64) },
      target: { project: "test-project", taskId: "task-seeded-retry", attempt: 1, sessionId: created.status.sessionId },
      configDigest: "e".repeat(64),
      requestDigest: "f".repeat(64),
      ownerAmendment: null,
    } as unknown as CandidateSeed;

    // Transition attempt 1 to CANCELLED with seed attached
    await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.transitioned",
      next: nextRevision(created.status, {
        lifecycleState: "CANCELLED",
        seed: fakeSeed,
        baseSha: fakeSeed.integrationBaseSha,
      }),
    });

    const retried = await retryCommand({
      attemptDir: created.attemptDir,
      stateRoot,
      configSnapshotJson: "{}",
      allowance: { auto: 1, owner: 1 },
    });

    assert.equal(retried.status.attempt, 2);
    assert.equal(retried.status.seed, null, "seed must be cleared on retry");
    assert.equal(retried.status.baseSha, null, "baseSha must be cleared on retry");
    assert.match(
      retried.status.lastActivity,
      /cleared candidate seed from attempt 1/,
      "lastActivity must clearly state that candidate seed was cleared",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. B9-20 (start.ts:71): defaultPreflight checks effective routed adapter for first phase
// ---------------------------------------------------------------------------

test("B9-20: defaultPreflight checks the effective routed adapter including routeOverrides", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-20-"));
  try {
    const repo = join(root, "repo");
    const { configPath } = createTestRepo(repo);
    const stateRoot = join(root, "state");

    const created = await newCommand({
      stateRoot,
      project: "test-project",
      taskId: "task-route-preflight",
      repository: repo,
      request: "preflight route override test",
      workflow: "build",
      tier: 1,
    });

    // With disabled adapter in routeOverrides for the first phase ("builder"),
    // preflight should return adapter: false even though default_worker is enabled claude.
    const statusWithDisabledRoute = {
      ...created.status,
      routeOverrides: {
        builder: { adapter: "disabled" },
      },
    };

    const preflightRefused = await defaultPreflight(statusWithDisabledRoute, configPath);
    assert.equal(preflightRefused.adapter, false, "must be false when routed adapter for first phase is disabled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. B9-22 (start.ts:378): Run adapter preflight and L1 check BEFORE creating worktree
// ---------------------------------------------------------------------------

test("B9-22: failed adapter preflight stops before worktree creation and leaves no worktree on disk", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-22-"));
  try {
    const repo = join(root, "repo");
    const { configPath } = createTestRepo(repo, "test-project", ["core/src/protected.ts"]);
    const stateRoot = join(root, "state");
    const worktreeRoot = join(root, "worktrees");
    mkdirSync(worktreeRoot);

    const taskId = "task-preflight-fail";
    const request = k1Request("add feature", "core/src/protected.ts");
    const created = await newCommand({
      stateRoot,
      project: "test-project",
      taskId,
      repository: repo,
      request,
      workflow: "build",
      tier: 1,
    });

    // Prepare K1 records so K1 passes and execution reaches adapter preflight
    await prepareK1({
      attemptDir: created.attemptDir,
      configPath,
      worktreeRoot,
      where: ["core/src/protected.ts"],
    });

    // Provide a preflight seam that reports adapter unavailable
    await assert.rejects(
      startCommand({
        attemptDir: created.attemptDir,
        worktreeRoot,
        configPath,
        preflight: () => ({ adapter: false, sandbox: true, observability: true }),
      }),
      /the adapter preflight did not pass/,
    );

    // Verify that NO attempt worktree was created under worktreeRoot
    assert.equal(
      existsSync(join(worktreeRoot, created.status.sessionId)),
      false,
      "attempt worktree must not exist when preflight fails",
    );

    // Attempt remains DRAFT
    const status = await readAttempt(created.attemptDir);
    assert.equal(status.lifecycleState, "DRAFT");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. B9-32 (land.ts:311): protected landing uses the injected confirmation clock
// ---------------------------------------------------------------------------

test("B9-32: protected landing authorization uses options.now", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-32-"));
  try {
    const repo = join(root, "repo");
    const { configPath, config } = createTestRepo(repo, "test-project", ["core/src/protected.ts"]);
    mkdirSync(join(repo, "core", "src"), { recursive: true });
    writeFileSync(join(repo, "core", "src", "protected.ts"), "base\n");
    git(repo, "add", "core/src/protected.ts");
    git(repo, "commit", "-m", "chore: add protected fixture");
    const baseSha = git(repo, "rev-parse", "HEAD");
    const worktree = join(root, "worktree");
    git(repo, "worktree", "add", "--detach", worktree, baseSha);
    const stateRoot = join(root, "state");
    const created = await newCommand({
      stateRoot,
      project: "test-project",
      taskId: "task-protected-land-clock",
      repository: repo,
      request: "pin protected landing time",
      workflow: "build",
      tier: 1,
      configSnapshotJson: toConfigSnapshotJson(config),
    });
    await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.transitioned",
      next: nextRevision(created.status, { lifecycleState: "PREPARED", baseSha, worktree }),
    });
    await grantCommand({
      attemptDir: created.attemptDir,
      config,
      configPath,
      stateRoot,
      phase: "builder",
      files: ["core/src/protected.ts"],
      reason: "Allow writing protected fixture",
      terminal: terminal(),
      sandboxProbe: () => true,
      now: () => "2026-09-01T15:30:00.000Z",
    });
    assert.equal(readProtectedState(created.attemptDir).grants.length, 1);

    writeFileSync(join(worktree, "README.md"), "candidate\n");
    git(worktree, "add", "README.md");
    git(worktree, "commit", "-m", "feat: candidate fixture");
    const candidateSha = git(worktree, "rev-parse", "HEAD");
    const prepared = await readAttempt(created.attemptDir);
    await persistAttempt(created.attemptDir, prepared.revision, {
      kind: "attempt.transitioned",
      next: nextRevision(prepared, {
        lifecycleState: "AWAITING_OWNER", candidateSha, gatesPass: true,
        requiredReviewPresent: true, journeyApproved: true, protectedApprovalsValid: true,
      }),
    });

    const injected = "2026-09-02T10:00:00.000Z";
    let clockReads = 0;
    const landed = await landCommand({
      attemptDir: created.attemptDir,
      terminal: terminal(),
      now: () => { clockReads += 1; return injected; },
    });
    assert.equal(landed.confirmed, true);
    assert.equal(clockReads, 3, "protected authorization, landing approval, and completion use the injected clock");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. B9-26 (land.ts:224): Failure after completeLanding moves HEAD does not seal as BLOCKED
// ---------------------------------------------------------------------------

test("B9-26: failure after completeLanding moves canonical HEAD does not seal attempt as BLOCKED", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-26-"));
  try {
    const repo = join(root, "repo");
    // protectedPaths empty so no protected approvals are required
    const { baseSha } = createTestRepo(repo, "test-project", []);
    const stateRoot = join(root, "state");

    // Create candidate commit in repo
    writeFileSync(join(repo, "README.md"), "# Candidate\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "feat: candidate commit");
    const candidateSha = git(repo, "rev-parse", "HEAD");
    // Reset HEAD back to baseSha so canonical is behind candidate
    git(repo, "reset", "--hard", baseSha);

    const created = await newCommand({
      stateRoot,
      project: "test-project",
      taskId: "task-landing-preserve",
      repository: repo,
      request: "landing preserve outcome test",
      workflow: "build",
      tier: 1,
    });

    // Advance attempt to AWAITING_OWNER
    await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.transitioned",
      next: nextRevision(created.status, {
        lifecycleState: "AWAITING_OWNER",
        baseSha,
        candidateSha,
        worktree: repo,
        gatesPass: true,
        requiredReviewPresent: true,
        journeyApproved: true,
        protectedApprovalsValid: true,
      }),
    });

    // Run landCommand with a projector that throws AFTER completeLanding has already fast-forwarded HEAD (on LANDED)
    await assert.rejects(
      landCommand({
        attemptDir: created.attemptDir,
        terminal: scriptedOwner(true),
        projectRecord: (_record, next) => {
          if (next.lifecycleState === "LANDED") throw new Error("database-projection-write-failed");
        },
      }),
      /database-projection-write-failed/,
    );

    // Canonical HEAD moved to candidateSha
    assert.equal(git(repo, "rev-parse", "HEAD"), candidateSha);

    // The attempt must NOT be sealed as BLOCKED
    const status = await readAttempt(created.attemptDir);
    assert.notEqual(status.lifecycleState, "BLOCKED", "attempt must not be sealed as BLOCKED when canonical HEAD moved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. B9-27 (new.ts:114): Atomic initialization and empty attempt directory cleanup
// ---------------------------------------------------------------------------

test("B9-27: newCommand cleans up empty attempt directory so new/retry is not blocked", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-27-"));
  try {
    const repo = join(root, "repo");
    createTestRepo(repo);
    const stateRoot = join(root, "state");

    // Simulate an aborted attempt 1 that created the directory but left no status.json
    const emptyAttemptDir = join(stateRoot, "projects", "test-project", "tasks", "task-atomic-new", "1");
    mkdirSync(emptyAttemptDir, { recursive: true });
    assert.ok(existsSync(emptyAttemptDir));

    // Calling newCommand should clean up the empty directory and succeed
    const created = await newCommand({
      stateRoot,
      project: "test-project",
      taskId: "task-atomic-new",
      repository: repo,
      request: "atomic new test",
      workflow: "build",
      tier: 1,
    });

    assert.equal(created.status.attempt, 1);
    assert.equal(created.status.lifecycleState, "DRAFT");
    assert.ok(existsSync(join(created.attemptDir, "status.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
