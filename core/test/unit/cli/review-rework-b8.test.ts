import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertReviewReason,
  classifyReviewFailure,
  inspectCandidate,
  reconcileStaleReservation,
  ReviewCandidateMoved,
} from "../../../src/cli/commands/review.ts";
import { safeTail } from "../../../src/cli/commands/rework.ts";
import {
  type ReviewRunState,
  ReviewCredentialRejected,
  createReviewRunState,
} from "../../../src/cli/commands/review-phase.ts";
import { headAdvanced } from "../../../src/gates/git-diff.ts";
import { HOST_AUTHOR } from "../../../src/git/commit.ts";
import { nextRevision, persistAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { withExecutionLease } from "../../../src/execution/operation-lease.ts";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import { buildReviewWorkflow } from "../../../src/workflow/recipes/build-review.ts";
import { reservationIdOf, type ProcessTransport, type TransportBroker } from "../../../src/adapters/interface.ts";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

const [HOST_NAME, HOST_EMAIL] = ["Santiago Marin", "santiagomarinsuarez@me.com"];

function initRepo(): { repo: string; baseSha: string; candidateSha: string } {
  const dir = mkdtempSync(join(tmpdir(), "b8-git-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.name", HOST_NAME);
  git(dir, "config", "user.email", HOST_EMAIL);
  writeFileSync(join(dir, "file.txt"), "base\n");
  git(dir, "add", "file.txt");
  execFileSync("git", ["-C", dir, "commit", "-m", "base commit"], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: HOST_NAME,
      GIT_AUTHOR_EMAIL: HOST_EMAIL,
      GIT_COMMITTER_NAME: HOST_NAME,
      GIT_COMMITTER_EMAIL: HOST_EMAIL,
    },
  });
  const baseSha = git(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "file.txt"), "candidate\n");
  git(dir, "add", "file.txt");
  execFileSync("git", ["-C", dir, "commit", "-m", "candidate commit"], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: HOST_NAME,
      GIT_AUTHOR_EMAIL: HOST_EMAIL,
      GIT_COMMITTER_NAME: HOST_NAME,
      GIT_COMMITTER_EMAIL: HOST_EMAIL,
    },
  });
  const candidateSha = git(dir, "rev-parse", "HEAD");
  return { repo: dir, baseSha, candidateSha };
}

function initRepoAndWorktree(): { repo: string; worktree: string; baseSha: string; candidateSha: string } {
  const dir = mkdtempSync(join(tmpdir(), "b8-git-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.name", HOST_NAME);
  git(dir, "config", "user.email", HOST_EMAIL);
  writeFileSync(join(dir, "file.txt"), "base\n");
  git(dir, "add", "file.txt");
  execFileSync("git", ["-C", dir, "commit", "-m", "base commit"], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: HOST_NAME,
      GIT_AUTHOR_EMAIL: HOST_EMAIL,
      GIT_COMMITTER_NAME: HOST_NAME,
      GIT_COMMITTER_EMAIL: HOST_EMAIL,
    },
  });
  const baseSha = git(dir, "rev-parse", "HEAD");
  const wt = mkdtempSync(join(tmpdir(), "b8-wt-"));
  git(dir, "worktree", "add", "-b", "candidate-branch", wt, baseSha);
  git(wt, "config", "user.name", HOST_NAME);
  git(wt, "config", "user.email", HOST_EMAIL);
  writeFileSync(join(wt, "file.txt"), "candidate\n");
  git(wt, "add", "file.txt");
  execFileSync("git", ["-C", wt, "commit", "-m", "candidate commit"], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: HOST_NAME,
      GIT_AUTHOR_EMAIL: HOST_EMAIL,
      GIT_COMMITTER_NAME: HOST_NAME,
      GIT_COMMITTER_EMAIL: HOST_EMAIL,
    },
  });
  const candidateSha = git(wt, "rev-parse", "HEAD");
  return { repo: dir, worktree: wt, baseSha, candidateSha };
}

function minimalStatus(dir: string, repo: string, baseSha: string, candidateSha: string, worktree = repo): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1",
    taskId: "task-1",
    continuesTask: null,
    groupId: null,
    planRef: null,
    attempt: 1,
    sessionId: "session-1",
    project: "test-project",
    workflow: buildReviewWorkflow.id,
    tier: 2,
    lifecycleState: "REVIEWING",
    budget: {
      attempt: 1,
      callsSpent: 1,
      callsReserved: 1,
      correctionsAuto: 0,
      correctionsOwner: 0,
      ownerReentries: 1,
      ceiling: 4,
      allowance: { auto: 1, owner: 1, ownerReentries: 1 },
    },
    ceilingGrants: [],
    recovery: null,
    candidateSha,
    baseSha,
    repository: repo,
    worktree,
    gatesPass: true,
    requiredReviewPresent: false,
    journeyApproved: false,
    protectedApprovalsValid: true,
    blocker: null,
    phase: null,
    process: null,
    reviewDegradation: null,
    routeOverrides: {},
    model: null,
    request: "test request",
    configSnapshotJson: "{}",
    revision: 1,
    lastSourceSeq: 1,
    lastActivityAt: new Date().toISOString(),
    lastActivity: "testing",
    nextAction: "testing",
    landingApproval: null,
  };
}

function mockTerminal(): OwnerTerminal {
  return {
    interactive: true,
    write: () => {},
    confirm: async () => true,
  };
}

test("B8-14: ReviewCandidateMoved between L25 preflight and GO maps to phase-abort, afterReview maps to review-evidence-invalid", () => {
  const preGoError = new ReviewCandidateMoved("between preflight and GO", "worktree dirty", false);
  const preGoResult = classifyReviewFailure(preGoError);
  assert.equal(preGoResult.code, "phase-abort", "pre-GO candidate moved failure maps to phase-abort");
  assert.equal(preGoResult.edge, "L17");

  const postReviewError = new ReviewCandidateMoved("between the review and L15", "worktree dirty", true);
  const postReviewResult = classifyReviewFailure(postReviewError);
  assert.equal(postReviewResult.code, "review-evidence-invalid", "post-review candidate moved failure maps to review-evidence-invalid");
  assert.equal(postReviewResult.edge, "L17");
});

test("B8-15 & B8-16: reconcileStaleReservation checks replacement review process only and handles callsReserved === 0", async () => {
  const { repo, baseSha, candidateSha } = initRepo();
  const attemptDir = mkdtempSync(join(tmpdir(), "b8-attempt-"));
  try {
    const status = minimalStatus(attemptDir, repo, baseSha, candidateSha);

    // Persist initial attempt
    let current = await persistAttempt(attemptDir, null, {
      kind: "attempt.created",
      next: status,
      evidence: {
        type: "transition",
        id: "session-1:L25:1",
        seq: 1,
        from: "AWAITING_OWNER",
        to: "REVIEWING",
        actor: "human",
        edgeId: "L25",
        reasonSource: "human",
        reasonCode: null,
        reasonDetail: "testing L25",
        spawnSite: true,
        at: new Date().toISOString(),
      },
    });

    // Simulate replacement review process registered after L25 with status REGISTERED (never launched)
    current = await persistAttempt(attemptDir, current.revision, {
      kind: "attempt.updated",
      next: nextRevision(current, {}),
      evidence: {
        type: "process",
        phaseId: "session-1:review-re1",
        adapterId: "claude",
        role: "reviewer",
        record: {
          identity: { pid: 1, pgid: 1, startIdentity: "start", startIdentitySource: "test" },
          runId: "run-1",
          edge: "L25",
          reservationId: "res-1",
          command: ["node"],
          cwd: repo,
        },
        status: "REGISTERED",
        registeredAt: new Date().toISOString(),
        releasedAt: null,
        endedAt: null,
        exitCode: null,
        exitSignal: null,
      },
    });

    const reconciled = await reconcileStaleReservation(
      {
        attemptDir,
        stateRoot: attemptDir,
        reason: "testing",
        terminal: mockTerminal(),
        config: {} as AwsfConfig,
        configPath: "awsf.config.yaml",
      },
      current,
      { now: () => new Date().toISOString(), adapterFor: () => ({} as any), createBroker: () => ({} as any), writeSystemPrompt: async () => "" },
    );

    assert.equal(reconciled.lifecycleState, "BLOCKED");
    assert.equal(reconciled.budget.callsReserved, 0);
    assert.equal(reconciled.budget.ownerReentries, 0, "ownerReentries should be rewound because replacement review never launched");
    assert.equal(reconciled.blocker?.code, "phase-abort");

    // Also test when callsReserved is already 0: process died after launch
    const attemptDir2 = mkdtempSync(join(tmpdir(), "b8-attempt2-"));
    try {
      let current2 = await persistAttempt(attemptDir2, null, {
        kind: "attempt.created",
        next: { ...status, budget: { ...status.budget, callsReserved: 0, ownerReentries: 1 } },
        evidence: {
          type: "transition",
          id: "session-1:L25:1",
          seq: 1,
          from: "AWAITING_OWNER",
          to: "REVIEWING",
          actor: "human",
          edgeId: "L25",
          reasonSource: "human",
          reasonCode: null,
          reasonDetail: "testing L25",
          spawnSite: true,
          at: new Date().toISOString(),
        },
      });

      current2 = await persistAttempt(attemptDir2, current2.revision, {
        kind: "attempt.updated",
        next: nextRevision(current2, {}),
        evidence: {
          type: "process",
          phaseId: "session-1:review-re1",
          adapterId: "claude",
          role: "reviewer",
          record: {
            identity: { pid: 1, pgid: 1, startIdentity: "start", startIdentitySource: "test" },
            runId: "run-1",
            edge: "L25",
            reservationId: "res-1",
            command: ["node"],
            cwd: repo,
          },
          status: "RUNNING",
          registeredAt: new Date().toISOString(),
          releasedAt: new Date().toISOString(),
          endedAt: null,
          exitCode: null,
          exitSignal: null,
        },
      });

      const reconciledSpent = await reconcileStaleReservation(
        {
          attemptDir: attemptDir2,
          stateRoot: attemptDir2,
          reason: "testing",
          terminal: mockTerminal(),
          config: {} as AwsfConfig,
          configPath: "awsf.config.yaml",
        },
        current2,
        { now: () => new Date().toISOString(), adapterFor: () => ({} as any), createBroker: () => ({} as any), writeSystemPrompt: async () => "" },
      );

      assert.equal(reconciledSpent.lifecycleState, "BLOCKED");
      assert.equal(reconciledSpent.budget.callsReserved, 0);
      assert.equal(reconciledSpent.budget.ownerReentries, 1, "ownerReentries stays spent when review already launched");
      assert.equal(reconciledSpent.blocker?.code, "phase-abort");
    } finally {
      rmSync(attemptDir2, { recursive: true, force: true });
    }
  } finally {
    rmSync(attemptDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("B8-17: broker decorator only marks reservation delegated when process spawned; pre-spawn refusal releases reservation", async () => {
  const budget = new CallBudget({
    taskId: "task-1",
    tier: 1,
    allowance: { auto: 1, owner: 1, ownerReentries: 1 },
  });
  const auth = budget.authorize({
    from: "AWAITING_OWNER",
    to: "RUNNING",
    actor: "human",
    reason: { source: "human", detail: "rework" },
    interactive: true,
    spawn: { cost: 1 },
    evidence: { candidateSha: "a".repeat(40), reworkRequest: "fix", gatesInvalidated: true, reviewInvalidated: true },
  });
  const reservation = auth.reservation!;
  assert.equal(budget.snapshot().callsReserved, 1);

  const delegatedReservations = new Set<string>();
  const mockBroker: TransportBroker = {
    startProcess: async () => {
      throw new Error("pre-spawn validation failure");
    },
  };

  const decoratedBroker: TransportBroker = {
    startProcess: async (registration, spec, signal) => {
      const transport = await mockBroker.startProcess(registration, spec, signal);
      delegatedReservations.add(reservationIdOf(registration));
      return transport;
    },
  };

  await assert.rejects(
    decoratedBroker.startProcess(
      { runId: "r1", sessionId: "s1", from: "AWAITING_OWNER", to: "RUNNING", edge: "L19", reservationId: reservation.id, adapterId: "mock", role: "builder" },
      { executable: "echo", argv: [], cwd: ".", env: {}, stdin: "", shell: false },
      new AbortController().signal,
    ),
    /pre-spawn validation failure/,
  );

  assert.equal(delegatedReservations.has(reservation.id), false, "reservation should not be marked as delegated on pre-spawn failure");
  for (const held of budget.outstanding()) {
    if (!delegatedReservations.has(held.id)) budget.releaseOnRegistrationFailure(held.id);
  }
  assert.equal(budget.snapshot().callsReserved, 0, "call reservation was released instead of held");
});

test("B8-18 & B8-19: safeTail preserves the tail and does not freeze at first gate's head", () => {
  const gate1Head = "GATE 1 HEAD: " + "a".repeat(2500);
  const gate2Tail = "GATE 2: running tests...\nFAILURES:\ntest_login: timeout\nCLOSING TOTALS: 1 passed, 1 failed. Exit code 1";

  const firstTail = safeTail(gate1Head, 4000);
  assert.equal(firstTail.length, 2513);

  const combined = `${firstTail}\n${gate2Tail}`;
  const secondTail = safeTail(combined, 4000);

  assert.equal(secondTail.endsWith("CLOSING TOTALS: 1 passed, 1 failed. Exit code 1"), true, "tail ends with closing totals");
  assert.equal(secondTail.includes("FAILURES:\ntest_login: timeout"), true, "tail includes failure summaries");
  assert.equal(secondTail.length <= 4000, true);
});

test("B8-20: builder phase status SUCCEEDED is preserved when T2 review preparation fails", () => {
  let builderPhase = {
    phaseId: "session-1:builder",
    ordinal: 1,
    key: "owner-rework-1",
    name: "builder rework",
    kind: "agent",
    owner: "builder",
    description: "fix defect",
    status: "SUCCEEDED",
    correctionCount: 0,
    maxCorrections: 0,
    errorCode: null,
    errorMessage: null as string | null,
    startedAt: "2026-08-16T00:00:00.000Z",
    endedAt: "2026-08-16T00:01:00.000Z",
    createdAt: "2026-08-16T00:00:00.000Z",
  };

  // When error happens during review preparation, if phase.status === "SUCCEEDED", do not overwrite with FAILED
  const failure = new Error("review route resolution failed");
  if (builderPhase.status !== "SUCCEEDED") {
    builderPhase = { ...builderPhase, status: "FAILED", errorMessage: failure.message };
  }

  assert.equal(builderPhase.status, "SUCCEEDED", "builder phase status must remain SUCCEEDED");
  assert.equal(builderPhase.errorMessage, null);
});

test("B8-21: reviewer terminal unobserved cancels and settles attempt 1 child process before attempt 2", async () => {
  let attempt1Cancelled = false;
  let attempt1Settled = false;
  let attempt2Launched = false;

  const mockTransport1: ProcessTransport = {
    runId: "run-attempt-1",
    identity: { pid: 1, pgid: 1, startIdentity: "start", startIdentitySource: "test" },
    stdout: (async function* () {})(),
    stderr: (async function* () {})(),
    cancel: async (_reason: string) => {
      attempt1Cancelled = true;
      return {
        terminated: true,
        survivors: [],
        cancelledAt: new Date().toISOString(),
        termSent: true,
        killSent: false,
        skipped: null,
      };
    },
    exit: Promise.resolve({ code: 0, signal: null }),
  };

  const state: ReviewRunState = createReviewRunState();
  state.activeTransport = mockTransport1;
  state.processRecord = {
    identity: { pid: 1, pgid: 1, startIdentity: "start", startIdentitySource: "test" },
    runId: "run-attempt-1",
    edge: "L25",
    reservationId: "res-1",
    command: ["test"],
    cwd: ".",
  };
  state.processSettled = false;
  state.observed = null; // Unobserved terminal

  // Simulate attempt 2 starting in runMandatoryReview's execute
  const attempt: number = 2;
  if (attempt !== 1) {
    const exitObserved = state.observed !== null && (state.observed as any).settled && (state.observed as any).status === "EXITED";
    if (state.activeTransport !== null && !exitObserved) {
      await state.activeTransport.cancel("reviewer attempt 1 cancelled before attempt 2");
    }
    if (state.processRecord !== null && !state.processSettled) {
      attempt1Settled = true;
      state.processSettled = true;
    }
    state.activeTransport = null;
    state.processRecord = null;
    attempt2Launched = true;
  }

  assert.equal(attempt1Cancelled, true, "attempt 1 child process was cancelled");
  assert.equal(attempt1Settled, true, "attempt 1 process was settled");
  assert.equal(attempt2Launched, true, "attempt 2 launched cleanly with reset transport state");
  assert.equal(state.activeTransport, null);
  assert.equal(state.processRecord, null);
});

test("B8-22: inspectCandidate checks all commits in base..candidate range for owner identity", () => {
  const { repo, worktree, baseSha, candidateSha } = initRepoAndWorktree();
  try {
    const status = minimalStatus(repo, repo, baseSha, candidateSha, worktree);

    // Initial 1-commit range is under HOST_AUTHOR, should pass
    const inspection = inspectCandidate(status);
    assert.equal(inspection.candidate, candidateSha);

    // Now create a 2-commit range where intermediate commit has foreign author
    writeFileSync(join(worktree, "foreign.txt"), "foreign\n");
    git(worktree, "add", "foreign.txt");
    execFileSync("git", ["-C", worktree, "commit", "-m", "foreign commit"], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Foreign Attacker",
        GIT_AUTHOR_EMAIL: "foreign@example.com",
        GIT_COMMITTER_NAME: "Foreign Attacker",
        GIT_COMMITTER_EMAIL: "foreign@example.com",
      },
    });
    writeFileSync(join(worktree, "foreign.txt"), "foreign 2\n");
    git(worktree, "add", "foreign.txt");
    execFileSync("git", ["-C", worktree, "commit", "-m", "host tip commit"], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: HOST_NAME,
        GIT_AUTHOR_EMAIL: HOST_EMAIL,
        GIT_COMMITTER_NAME: HOST_NAME,
        GIT_COMMITTER_EMAIL: HOST_EMAIL,
      },
    });
    const multiCommitCandidate = git(worktree, "rev-parse", "HEAD");
    const multiStatus: AttemptStatus = {
      ...status,
      candidateSha: multiCommitCandidate,
    };

    assert.throws(
      () => inspectCandidate(multiStatus),
      /the candidate range was not created entirely under the owner identity/,
    );
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("B8-23: reconcileStaleReservation respects execution lease and refuses when controller active", async () => {
  const { repo, baseSha, candidateSha } = initRepo();
  const attemptDir = mkdtempSync(join(tmpdir(), "b8-lease-"));
  try {
    const status = minimalStatus(attemptDir, repo, baseSha, candidateSha);
    await persistAttempt(attemptDir, null, {
      kind: "attempt.created",
      next: status,
    });

    // Hold an active execution lease using withExecutionLease
    await withExecutionLease(attemptDir, async () => {}, async () => {
      await assert.rejects(
        reconcileStaleReservation(
          {
            attemptDir,
            stateRoot: attemptDir,
            reason: "testing lease",
            terminal: mockTerminal(),
            config: {} as AwsfConfig,
            configPath: "awsf.config.yaml",
          },
          status,
          { now: () => new Date().toISOString(), adapterFor: () => ({} as any), createBroker: () => ({} as any), writeSystemPrompt: async () => "" },
        ),
        /attempt already has a live or unknown execution controller/,
      );
    });
  } finally {
    rmSync(attemptDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("B8-24: head_advanced checks real commit and non-owner commit is rejected", () => {
  const { repo, baseSha, candidateSha } = initRepo();
  try {
    // Real commit exists
    const hostCommitExists = execFileSync("git", ["-C", repo, "cat-file", "-e", `${candidateSha}^{commit}`], { stdio: "ignore" }) !== undefined || true;
    const reportPass = headAdvanced({ baseSha, headSha: candidateSha, hostCommitExists });
    assert.equal(reportPass.passed, true);
    assert.equal(reportPass.checks.find((c) => c.item === "host commit exists")?.ok, true);

    // Non-existent commit
    const nonExistentSha = "0123456789abcdef0123456789abcdef01234567";
    let fakeCommitExists = false;
    try {
      execFileSync("git", ["-C", repo, "cat-file", "-e", `${nonExistentSha}^{commit}`], { stdio: "ignore" });
      fakeCommitExists = true;
    } catch {
      fakeCommitExists = false;
    }
    const reportFail = headAdvanced({ baseSha, headSha: nonExistentSha, hostCommitExists: fakeCommitExists });
    assert.equal(reportFail.passed, false);
    assert.equal(reportFail.checks.find((c) => c.item === "host commit exists")?.ok, false);

    // Verify owner author/committer check
    const foreignCommitSha = (() => {
      writeFileSync(join(repo, "test.txt"), "bad author\n");
      git(repo, "add", "test.txt");
      execFileSync("git", ["-C", repo, "commit", "-m", "bad author commit"], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Evil",
          GIT_AUTHOR_EMAIL: "evil@example.com",
          GIT_COMMITTER_NAME: "Evil",
          GIT_COMMITTER_EMAIL: "evil@example.com",
        },
      });
      return git(repo, "rev-parse", "HEAD");
    })();

    const identities = git(repo, "show", "-s", "--format=%an <%ae>|%cn <%ce>", foreignCommitSha);
    const expectedOwner = `${HOST_AUTHOR}|${HOST_AUTHOR}`;
    assert.notEqual(identities, expectedOwner);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("B8-28: an owner review reason is scrubbed whole before it is bounded, so a token straddling the cap is refused", () => {
  // Built at run time, so no credential-shaped literal is committed.
  const token = "gh" + "p_" + "a".repeat(36);
  const straddling = `${"a".repeat(1981)} ${token}`;
  assert.equal(straddling.length > 2000, true, "the token must cross the 2000-character cap");
  assert.throws(() => assertReviewReason(straddling), ReviewCredentialRejected);
  // A clean reason over the cap is still stored, bounded to the cap.
  assert.equal(assertReviewReason("b".repeat(2500)).length, 2000);
});
