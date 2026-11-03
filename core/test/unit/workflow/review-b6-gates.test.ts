import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { CallBudget } from "../../../src/execution/call-budget.ts";
import type { CorrectionSession, AgentTurn } from "../../../src/workflow/corrections.ts";
import type { CompiledAgentPhase } from "../../../src/workflow/phase.ts";
import {
  PhaseGateFailure,
  runAgentPhase,
  type RunAgentPhaseOptions,
} from "../../../src/workflow/engine.ts";
import { protectedReadOnlyGit } from "../../../src/workflow/protected-files.ts";
import {
  deliverReviewDiff,
  reviewDeliveryDirectory,
} from "../../../src/workflow/review-diff-delivery.ts";
import {
  candidatePathsBetween,
  composeReviewEvidence,
} from "../../../src/workflow/review-evidence.ts";
import { reviewDeliveryFixture } from "../../fixtures/review-diff-delivery.ts";

const validBuildEnvelope = JSON.stringify({
  schema: "awsf.build-output/v1",
  producerStatus: "success",
  summary: "build summary",
  artifacts: [],
  notesForNextPhase: "none",
  changedFiles: ["file.txt"],
  implementationNotes: ["note"],
  commandsRun: [],
  proposedCommitMessage: "feat: change",
});

const mockIdentity = { adapter: "mock", provider: "mock", model: "mock", sessionId: "s1" };

const mockTurn = (rawOutput = validBuildEnvelope): AgentTurn => ({
  identity: mockIdentity,
  rawOutput,
  costUsd: 0.01,
  usage: {
    inputTokens: 10,
    outputTokens: 10,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    reasoningRelation: "unknown",
  },
});

// B6-10: In runAgentPhase, when a correction round produces no new commit after a prior
// verification failure, fail with PhaseGateFailure instead of erroneously accepting or
// re-verifying without changes.
test("B6-10: runAgentPhase fails with PhaseGateFailure when correction produces no new commit after red verification", async () => {
  const failingReports = [
    {
      gateId: "commands_pass" as const,
      checks: [{ item: "unit-tests", ok: false, note: "tests failed" }],
      passed: false,
    },
  ];

  let round = 0;
  const fakeSession: CorrectionSession = {
    identity: mockIdentity,
    send: async () => mockTurn(),
  };

  const phase: CompiledAgentPhase<any> = {
    id: "builder",
    role: "builder",
    owner: "builder",
    schemaId: "awsf.build-output/v1",
    maxCorrections: 2,
    gates: [],
    renderPrompt: () => "mock prompt",
  } as any;

  const commits: (string | null)[] = ["sha-commit-1", null];

  const fakeHostGit = {
    captureDiff: () => ["file.txt"],
    commit: async () => commits[round] ?? null,
  };

  const verifyCandidateCalls: { candidateSha: string | null; correctionRound: number }[] = [];

  const options: RunAgentPhaseOptions<any> = {
    workflowId: "test",
    phase,
    session: fakeSession,
    budget: new CallBudget({ taskId: "T19", tier: 1, allowance: { auto: 2, owner: 0 } }),
    worktree: "/mock/worktree",
    previousEnvelope: null,
    agentSessionId: "s1",
    now: () => "2026-08-08T12:00:00.000Z",
    permissions: { enforce: () => ({ valid: true, breaches: [] }) as any },
    hostGit: fakeHostGit,
    persistence: { persist: async () => undefined } as any,
    verifyCandidate: async (req) => {
      verifyCandidateCalls.push(req);
      if (req.correctionRound === 0) {
        round = 1;
        return { passed: false, reports: failingReports as any, evidence: null };
      }
      return { passed: true, reports: [{ gateId: "commands_pass" as const, checks: [{ item: "unit-tests", ok: true, note: "ok" }], passed: true }] as any, evidence: null };
    },
  };

  await assert.rejects(
    runAgentPhase(options),
    (err: any) => {
      assert.ok(err instanceof PhaseGateFailure);
      assert.match(err.message, /candidate stayed red/);
      assert.deepEqual(err.reports, failingReports);
      return true;
    },
  );

  assert.equal(verifyCandidateCalls.length, 1, "verifyCandidate must not run when correction produces no commit after red verification");
});

test("B6-10 control: correction round producing a new commit and verifying green is accepted", async () => {
  let round = 0;
  const fakeSession: CorrectionSession = {
    identity: mockIdentity,
    send: async () => mockTurn(),
  };

  const phase: CompiledAgentPhase<any> = {
    id: "builder",
    role: "builder",
    owner: "builder",
    schemaId: "awsf.build-output/v1",
    maxCorrections: 2,
    gates: [],
    renderPrompt: () => "mock prompt",
  } as any;

  const commits = ["sha-commit-1", "sha-commit-2"];
  const fakeHostGit = {
    captureDiff: () => ["file.txt"],
    commit: async () => commits[round]!,
  };

  const options: RunAgentPhaseOptions<any> = {
    workflowId: "test",
    phase,
    session: fakeSession,
    budget: new CallBudget({ taskId: "T19", tier: 1, allowance: { auto: 2, owner: 0 } }),
    worktree: "/mock/worktree",
    previousEnvelope: null,
    agentSessionId: "s1",
    now: () => "2026-08-08T12:00:00.000Z",
    permissions: { enforce: () => ({ valid: true, breaches: [] }) as any },
    hostGit: fakeHostGit,
    persistence: { persist: async () => undefined } as any,
    verifyCandidate: async (req) => {
      if (req.correctionRound === 0) {
        round = 1;
        return { passed: false, reports: [{ gateId: "commands_pass" as const, checks: [{ item: "unit-tests", ok: false, note: "fail" }], passed: false }] as any, evidence: null };
      }
      return { passed: true, reports: [{ gateId: "commands_pass" as const, checks: [{ item: "unit-tests", ok: true, note: "ok" }], passed: true }] as any, evidence: null };
    },
  };

  const result = await runAgentPhase(options);
  assert.equal(result.state, "SUCCEEDED");
  assert.equal(result.candidateSha, "sha-commit-2");
  assert.equal(result.verification?.passed, true);
});

// B6-11: protectedReadOnlyGit strips GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_COMMON_DIR
// so an exported GIT_DIR cannot point git -C <worktree> to a different repository.
test("B6-11: protectedReadOnlyGit strips inherited GIT_DIR and git isolation variables", async () => {
  const world = await reviewDeliveryFixture(true);
  const originalEnv = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
    GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
    GIT_COMMON_DIR: process.env.GIT_COMMON_DIR,
  };

  try {
    // Point GIT_DIR to a nonexistent repository that would break git if forwarded
    process.env.GIT_DIR = join(world.root, "nonexistent-outside-repo", ".git");
    process.env.GIT_WORK_TREE = join(world.root, "nonexistent-outside-worktree");
    process.env.GIT_INDEX_FILE = join(world.root, "nonexistent-index");
    process.env.GIT_COMMON_DIR = join(world.root, "nonexistent-common");

    const runner = protectedReadOnlyGit(world.location.repository);
    const result = runner(["rev-parse", "--is-inside-work-tree"]);

    assert.equal(result.status, 0, `runner should succeed without git env leakage: ${result.stderr}`);
    assert.equal(result.stdout.trim(), "true");
  } finally {
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    world.cleanup();
  }
});

// B6-12: immutableFile and deliverReviewDiff recover from torn partial writes or corrupted index.json
// on same runId retries instead of wedging permanently.
test("B6-12: deliverReviewDiff cleans up and recovers from torn partial files and corrupt index.json", async () => {
  const world = await reviewDeliveryFixture(true);
  try {
    const tornLocation = { ...world.location, runId: "torn-recovery-run" };
    const dir = reviewDeliveryDirectory(tornLocation);
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    // Simulate a torn 000001.diff (mode 0400, partial content)
    const tornDiffPath = join(dir, "000001.diff");
    writeFileSync(tornDiffPath, "partial diff truncated mid-write\n", { mode: 0o400 });

    // Simulate a torn / corrupt index.json (mode 0400, truncated invalid json)
    const tornIndexPath = join(dir, "index.json");
    writeFileSync(tornIndexPath, '{"schema":"awsf.review-diff-index/v1","to', { mode: 0o400 });

    const whole = "diff --git a/small.ts b/small.ts\n--- a/small.ts\n+++ b/small.ts\n@@ -1 +1 @@\n-before\n+after\n";
    const sections = [{ path: "small.ts", text: whole }];

    // deliverReviewDiff should succeed instead of throwing "review delivery changed" or SyntaxError
    const delivery = await deliverReviewDiff(tornLocation, whole, sections, [], []);

    assert.equal(delivery.files.length, 1);
    assert.equal(readFileSync(join(dir, "000001.diff"), "utf8"), whole);
    const parsedIndex = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    assert.ok(typeof parsedIndex.token === "string" && parsedIndex.token.length === 64);
  } finally {
    world.cleanup();
  }
});

// B6-13: candidateDiff and candidatePathsBetween pass --no-color, --no-ext-diff, --no-textconv
// to isolate review evidence from user git config (such as color.ui=always).
test("B6-13: composeReviewEvidence and candidatePathsBetween isolate git diff from color and ext-diff", async () => {
  const world = await reviewDeliveryFixture(true);
  const originalEnv = {
    GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
    GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
    GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
    GIT_CONFIG_KEY_1: process.env.GIT_CONFIG_KEY_1,
    GIT_CONFIG_VALUE_1: process.env.GIT_CONFIG_VALUE_1,
  };

  try {
    // Inject operator git config: color.ui=always and diff.external=/bin/false
    process.env.GIT_CONFIG_COUNT = "2";
    process.env.GIT_CONFIG_KEY_0 = "color.ui";
    process.env.GIT_CONFIG_VALUE_0 = "always";
    process.env.GIT_CONFIG_KEY_1 = "diff.external";
    process.env.GIT_CONFIG_VALUE_1 = "/bin/false";

    // candidatePathsBetween should succeed and list paths cleanly
    const paths = candidatePathsBetween(world.location.worktree, world.composed.context.baseSha, world.composed.context.candidateSha);
    assert.ok(paths.includes("huge.ts"));

    // Diff captured during review evidence composition should have standard diff hunks (@@)
    // without ANSI escapes even when color.ui=always is set in git config
    let retainedDiff = "";
    const composed = await composeReviewEvidence({
      worktree: world.location.worktree,
      baseSha: world.composed.context.baseSha,
      candidateSha: world.composed.context.candidateSha,
      intent: {
        request: "Review change",
        goals: ["review"],
        nonGoals: [],
        acceptanceCriteria: ["all files inspectable"],
        testStrategy: ["unit-tests"],
      },
      testOutput: {
        schema: "awsf.test-output/v1",
        producerStatus: "success",
        summary: "gates pass",
        artifacts: [],
        notesForNextPhase: "review",
        passed: true,
        candidateSha: world.composed.context.candidateSha,
        commands: [],
        failures: [],
        outputTail: "pass",
      },
      delivery: { ...world.location, runId: "config-isolation-run" },
      diffRef: "raw/full.diff",
      retainFullDiff: async (_ref, text) => {
        retainedDiff = text;
        return text;
      },
    });

    assert.ok(composed.context.diffSha256.length === 64);
    assert.ok(!retainedDiff.includes("\u001b["), "retained diff must not contain ANSI color escape sequences");
    assert.ok(retainedDiff.includes("@@ "), "retained diff must contain standard hunk headers");
  } finally {
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    world.cleanup();
  }
});
