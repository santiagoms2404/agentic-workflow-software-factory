import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landCommand } from "../../src/cli/commands/land.ts";
import { persistAttempt, readAttempt, type AttemptStatus } from "../../src/cli/commands/attempt.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function owner(interactive: boolean, answer = true): OwnerTerminal {
  return { interactive, write: () => {}, confirm: async () => answer };
}

async function fixture(root: string): Promise<{ attemptDir: string; repository: string; base: string; candidate: string }> {
  const repository = join(root, "canonical");
  execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
  writeFileSync(join(repository, "base.txt"), "base\n");
  git(repository, "add", "base.txt");
  git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed landing crash");
  const base = git(repository, "rev-parse", "HEAD");
  git(repository, "checkout", "-b", "candidate");
  writeFileSync(join(repository, "candidate.txt"), "candidate\n");
  git(repository, "add", "candidate.txt");
  git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "feat: crash candidate");
  const candidate = git(repository, "rev-parse", "HEAD");
  git(repository, "checkout", "main");

  const attemptDir = join(root, "state", "projects", "crash-project", "tasks", "T21", "1");
  const status: AttemptStatus = {
    schema: "awsf/attempt-status/v1",
    sessionId: "landing-crash-session",
    project: "crash-project",
    taskId: "T21",
    continuesTask: null,
    groupId: null,
    planRef: null,
    attempt: 1,
    repository,
    worktree: join(root, "candidate-worktree"),
    workflow: "build-review",
    tier: 2,
    request: "prove persisted landing recovery",
    configSnapshotJson: "{}",
    lifecycleState: "AWAITING_OWNER",
    baseSha: base,
    candidateSha: candidate,
    phase: { name: "reviewer", state: "SUCCEEDED", round: 0, maximumRounds: 1 },
    budget: {
      attempt: 1,
      callsSpent: 2,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
      ownerReentries: 0,
      allowance: { auto: 1, owner: 1, ownerReentries: 1 },
      ceiling: 5,
    },
    ceilingGrants: [],
    routeOverrides: {},
    reviewDegradation: null,
    model: { resolved: "stub/review", provenance: "stream-authoritative" },
    lastActivityAt: "2026-08-07T00:00:00.000Z",
    lastActivity: "awaiting owner",
    nextAction: "run `awsf land T21`",
    gatesPass: true,
    requiredReviewPresent: true,
    journeyApproved: true,
    protectedApprovalsValid: true,
    process: null,
    landingApproval: null,
    blocker: null,
    revision: 1,
    lastSourceSeq: 1,
  };
  await persistAttempt(attemptDir, null, { kind: "attempt.created", next: status });
  return { attemptDir, repository, base, candidate };
}

async function crashAfterL20(attemptDir: string): Promise<void> {
  await assert.rejects(
    landCommand({
      attemptDir,
      terminal: owner(true),
      afterLandingPersisted: () => { throw new Error("injected crash after durable L20"); },
    }),
    /injected crash/,
  );
  assert.equal((await readAttempt(attemptDir)).lifecycleState, "LANDING");
}

test("crash after persisted LANDING resumes the one approved fast-forward without another prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-land-recover-"));
  try {
    const value = await fixture(root);
    await crashAfterL20(value.attemptDir);
    assert.equal(git(value.repository, "rev-parse", "HEAD"), value.base);
    const result = await landCommand({ attemptDir: value.attemptDir, terminal: owner(false, false) });
    assert.equal(result.status.lifecycleState, "LANDED");
    assert.equal(git(value.repository, "rev-parse", "HEAD"), value.candidate);
    assert.equal(git(value.repository, "status", "--porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a divergent canonical branch after the crash blocks with exact ahead/behind counts", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-land-diverged-"));
  try {
    const value = await fixture(root);
    await crashAfterL20(value.attemptDir);
    writeFileSync(join(value.repository, "canonical.txt"), "canonical moved\n");
    git(value.repository, "add", "canonical.txt");
    git(value.repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: diverge canonical");

    const result = await landCommand({ attemptDir: value.attemptDir, terminal: owner(false, false) });
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.blocker?.code, "non-fast-forward");
    assert.equal(result.status.blocker?.ahead, 1);
    assert.equal(result.status.blocker?.behind, 1);
    assert.match(result.status.blocker?.detail ?? "", /ahead 1, behind 1/);
    assert.notEqual(git(value.repository, "rev-parse", "HEAD"), value.candidate);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a dirty canonical checkout after the crash blocks and reports the divergence meter", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-land-dirty-"));
  try {
    const value = await fixture(root);
    await crashAfterL20(value.attemptDir);
    writeFileSync(join(value.repository, "dirty.txt"), "uncommitted\n");
    const result = await landCommand({ attemptDir: value.attemptDir, terminal: owner(false, false) });
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.blocker?.code, "dirty-canonical-tree");
    assert.equal(result.status.blocker?.ahead, 0);
    assert.equal(result.status.blocker?.behind, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unreadable Git reality after the crash is ambiguous and blocks rather than guessing", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-land-ambiguous-"));
  try {
    const value = await fixture(root);
    await crashAfterL20(value.attemptDir);
    renameSync(value.repository, `${value.repository}-missing`);
    const result = await landCommand({ attemptDir: value.attemptDir, terminal: owner(false, false) });
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.blocker?.code, "ambiguous-recovery");
    assert.match(result.status.blocker?.detail ?? "", /ambiguous|not a git repository|cannot change/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
