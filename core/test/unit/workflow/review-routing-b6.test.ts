import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { HostCommitResult, HostValidationProgress } from "../../../src/contracts/host-validation.ts";
import type { PhaseRecovery } from "../../../src/contracts/phase-recovery.ts";
import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { AgentDefinition } from "../../../src/config/schema.ts";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import { promptSha256, composePromptBundle } from "../../../src/workflow/prompt-composition.ts";
import type { CorrectionSession, AgentTurn } from "../../../src/workflow/corrections.ts";
import type { CompiledAgentPhase } from "../../../src/workflow/phase.ts";
import type { PhaseState } from "../../../src/state/phase-machine.ts";
import {
  PhaseGateFailure,
  runAgentPhase,
  type RunAgentPhaseOptions,
} from "../../../src/workflow/engine.ts";
import { reconcileHostValidation } from "../../../src/workflow/phase-recovery.ts";
import { runMandatoryReview, oppositeProvider, providerPairFrom } from "../../../src/workflow/review-routing.ts";

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

function fakeGit(headSha: string, _treeDigest = "tree-sha-mock"): any {
  return (args: readonly string[]) => {
    const sub = args.join(" ");
    if (sub.includes("rev-parse HEAD")) return { status: 0, stdout: `${headSha}\n`, stderr: "" };
    if (sub.includes("rev-parse --abbrev-ref HEAD")) return { status: 0, stdout: "HEAD\n", stderr: "" };
    if (sub.includes("rev-parse --show-toplevel")) return { status: 0, stdout: "/mock/worktree\n", stderr: "" };
    if (sub.includes("rev-parse --path-format=absolute --git-common-dir")) return { status: 0, stdout: "/mock/common\n", stderr: "" };
    if (sub.includes("status --porcelain")) return { status: 0, stdout: "", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
}

test("B6-03: reconcileHostValidation on reconcile-commands binds HEAD and returns durable commit as candidateSha", async () => {
  const durableSha = "1111111111111111111111111111111111111111";
  const movedSha = "2222222222222222222222222222222222222222";
  const treeDigest = "d".repeat(64);

  const commitResult: HostCommitResult = {
    intentId: "intent-1",
    commitSha: durableSha,
    treeDigest,
  };

  const progress: HostValidationProgress = {
    schema: "awsf.host-validation/v1",
    phaseKey: "builder",
    ordinal: 2,
    round: 0,
    runId: "run-1",
    envelopeId: "env-1",
    envelopeDigest: "e".repeat(64),
    resultCheckpointId: "rc-1",
    stage: "verify-candidate",
    commitIntent: {
      intentId: "intent-1",
      phaseKey: "builder",
      ordinal: 2,
      round: 0,
      runId: "run-1",
      parentSha: "0".repeat(40),
      message: "feat: change",
      author: "Santiago Marin",
      committer: "Santiago Marin",
      changedPaths: ["file.txt"],
      committedPaths: ["file.txt"],
      contentDigest: "c".repeat(64),
      treeDigest,
    },
    commitResult,
    protectedConsumptionId: null,
  };

  const checkpoint = {
    schema: "awsf.phase-recovery/v1",
    recoveryId: "rec-1",
    kind: "validating",
    commonGitDir: "/mock/common",
    repository: "/mock/repo",
    worktree: "/mock/worktree",
    integrationBaseSha: "0".repeat(40),
    worktreeHeadSha: durableSha,
    prefix: [],
    pending: {
      schema: "awsf.saved-phase-result/v1",
      phaseKey: "builder",
      ordinal: 2,
      round: 0,
      runId: "run-1",
      envelopeId: "env-1",
      envelopeDigest: "e".repeat(64),
      worktreeDigest: treeDigest,
      clean: true,
      model: { adapter: "mock", provider: "mock", requestedModel: "mock" },
    },
    validation: progress,
  } as unknown as PhaseRecovery;

  const status = {
    schema: "awsf/attempt-status/v1",
    sessionId: "sess-1",
    phaseOrdinal: 2,
    phaseKey: "builder",
    phaseStatus: "VALIDATING",
    state: "RUNNING",
    repository: "/mock/repo",
    worktree: "/mock/worktree",
    baseSha: "0".repeat(40),
    headSha: durableSha,
    worktreeSha: durableSha,
    reconciliation: null,
    failure: null,
    interrupted: null,
  } as unknown as AttemptStatus;

  // 1. HEAD matches durable commit: accepted and returns candidateSha = durableSha
  const matchingGit = fakeGit(durableSha, treeDigest);
  const result = await reconcileHostValidation(
    status,
    checkpoint,
    matchingGit,
    [],
    { action: "resume", gateIds: ["gate-1"] },
  );

  assert.equal(result.plan.action, "reconcile-commands");
  assert.equal(result.candidateSha, durableSha);
  assert.equal(result.commit, null);

  // 2. HEAD moved ahead past durable commit: refused
  const movedGit = fakeGit(movedSha, treeDigest);
  await assert.rejects(
    reconcileHostValidation(
      status,
      checkpoint,
      movedGit,
      [],
      { action: "resume", gateIds: ["gate-1"] },
    ),
    /worktree HEAD does not match the durable commit/,
  );
});

test("B6-05: engine phase execution state transitions emit FAILED on early failure", async () => {
  const states: PhaseState[] = [];
  const phase: CompiledAgentPhase<any> = {
    id: "builder",
    role: "builder",
    owner: "builder",
    schemaId: "awsf.build-output/v1",
    maxCorrections: 1,
    gates: [],
    renderPrompt: () => "mock prompt",
  } as any;

  const fakeSession: CorrectionSession = {
    identity: mockIdentity,
    send: async () => mockTurn(),
  };

  const options: RunAgentPhaseOptions<any> = {
    workflowId: "test",
    phase,
    session: fakeSession,
    budget: new CallBudget({ taskId: "T19", tier: 1, allowance: { auto: 1, owner: 0 } }),
    worktree: "/mock/worktree",
    previousEnvelope: null,
    agentSessionId: "s1",
    initialEnvelope: {
      schemaId: "awsf.build-output/v1",
      phaseId: "wrong-phase-id",
      sessionId: "s1",
      envelopeId: "env-1",
      correctionRound: 0,
      valid: true,
      payload: null,
      createdAt: "2026-08-08T12:00:00.000Z",
    } as any,
    initialUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as any,
    permissions: { enforce: () => ({ valid: true, breaches: [] }) as any },
    hostGit: { captureDiff: () => [], commit: async () => null },
    persistence: { persist: async () => undefined } as any,
    onPhaseState: (state) => states.push(state),
  };

  await assert.rejects(
    runAgentPhase(options),
    /saved envelope belongs to another phase/,
  );

  assert.deepEqual(states, ["QUEUED", "FAILED"]);
});

test("B6-06: workflow recovery invariant: persistAgentSession failure prevents phase acceptance", async () => {
  const states: PhaseState[] = [];
  let acceptedCalled = false;
  const phase: CompiledAgentPhase<any> = {
    id: "builder",
    role: "builder",
    owner: "builder",
    schemaId: "awsf.build-output/v1",
    maxCorrections: 1,
    gates: [],
    renderPrompt: () => "mock prompt",
  } as any;

  const fakeSession: CorrectionSession = {
    identity: mockIdentity,
    send: async () => mockTurn(),
  };

  const options: RunAgentPhaseOptions<any> = {
    workflowId: "test",
    phase,
    session: fakeSession,
    budget: new CallBudget({ taskId: "T19", tier: 1, allowance: { auto: 1, owner: 0 } }),
    worktree: "/mock/worktree",
    previousEnvelope: null,
    agentSessionId: "s1",
    permissions: { enforce: () => ({ valid: true, breaches: [] }) as any },
    hostGit: { captureDiff: () => ["file.txt"], commit: async () => "commit-sha" },
    persistence: {
      persist: async () => undefined,
      persistAgentSession: async () => { throw new Error("database write failed"); },
    } as any,
    onAccepted: async () => { acceptedCalled = true; },
    onPhaseState: (state) => states.push(state),
  };

  await assert.rejects(
    runAgentPhase(options),
    /database write failed/,
  );

  assert.equal(acceptedCalled, false, "onAccepted must not be called when persistence fails");
  assert.equal(states.at(-1), "FAILED", "phase must end in FAILED");
  assert.equal(states.includes("SUCCEEDED"), false, "phase must not have transitioned to SUCCEEDED");
});

test("B6-09: reconcileHostValidation on replay refuses when HEAD moved during read-only validation", async () => {
  const treeDigest = "d".repeat(64);
  const headSha = "1111111111111111111111111111111111111111";
  const movedSha = "2222222222222222222222222222222222222222";

  const checkpoint = {
    schema: "awsf.phase-recovery/v1",
    recoveryId: "rec-1",
    kind: "result-ready",
    commonGitDir: "/mock/common",
    repository: "/mock/repo",
    worktree: "/mock/worktree",
    integrationBaseSha: "0".repeat(40),
    worktreeHeadSha: headSha,
    prefix: [],
    pending: {
      schema: "awsf.saved-phase-result/v1",
      phaseKey: "builder",
      ordinal: 2,
      round: 0,
      runId: "run-1",
      envelopeId: "env-1",
      envelopeDigest: "e".repeat(64),
      worktreeDigest: treeDigest,
      clean: true,
      model: { adapter: "mock", provider: "mock", requestedModel: "mock" },
    },
    validation: {
      schema: "awsf.host-validation/v1",
      phaseKey: "builder",
      ordinal: 2,
      round: 0,
      runId: "run-1",
      envelopeId: "env-1",
      envelopeDigest: "e".repeat(64),
      resultCheckpointId: "rc-1",
      stage: "envelope-check",
      commitIntent: null,
      commitResult: null,
      protectedConsumptionId: null,
    },
  } as unknown as PhaseRecovery;

  const status = {
    schema: "awsf/attempt-status/v1",
    sessionId: "sess-1",
    phaseOrdinal: 2,
    phaseKey: "builder",
    phaseStatus: "VALIDATING",
    state: "RUNNING",
    repository: "/mock/repo",
    worktree: "/mock/worktree",
    baseSha: "0".repeat(40),
    headSha: movedSha,
    worktreeSha: movedSha,
    reconciliation: null,
    failure: null,
    interrupted: null,
  } as unknown as AttemptStatus;

  const movedGit = fakeGit(movedSha, treeDigest);
  await assert.rejects(
    reconcileHostValidation(status, checkpoint, movedGit, []),
    /recovery refused: HEAD moved during read-only host validation/,
  );
});

test("B6-10: a correction round that commits nothing after a red verification throws PhaseGateFailure", async () => {
  const failingReports = [
    {
      gateId: "commands_pass" as const,
      checks: [{ item: "unit-tests", ok: false, note: "tests failed" }],
      passed: false,
    },
  ];

  let round = 0;
  const sends: string[] = [];

  const fakeSession: CorrectionSession = {
    identity: mockIdentity,
    send: async () => {
      sends.push(`send-round-${round}`);
      return mockTurn();
    },
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

  assert.equal(verifyCandidateCalls.length, 1, "verifyCandidate was called for round 0, but not for round 1 commit-less");
});

test("B6-10: control: correction round that produces a new commit and verifies green is accepted", async () => {
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

test("B6-26 and B6-48: prompt composition containment allows directories prefixed with two dots, and promptSha256 matches sha256", async () => {
  assert.equal(
    promptSha256("test-content"),
    "0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e",
  );

  const tmp = await mkdtemp(join(tmpdir(), "prompt-comp-test-"));
  try {
    const configPath = join(tmp, "awsf.config.yaml");
    await writeFile(configPath, "");

    const dotDir = join(tmp, "..custom-prompts");
    await mkdir(dotDir, { recursive: true });
    await writeFile(join(dotDir, "user.md"), "User prompt content");
    await writeFile(join(dotDir, "system.md"), "System prompt content");
    const sharedDir = join(tmp, "prompts", "shared");
    await mkdir(sharedDir, { recursive: true });
    await writeFile(join(sharedDir, "headless-role.md"), "Shared prompt content");

    const agent: AgentDefinition = {
      name: "builder",
      model: "openai/gpt-5-codex",
      thinking: "high",
      color: "#000000",
      purpose: "Builder",
      prompt: {
        user: "..custom-prompts/user.md",
        system: "..custom-prompts/system.md",
      },
      harness: {
        adapter: "openai-codex",
        continuity: "none",
      },
      tools: {
        profile: "builder",
        allow: [],
      },
      writes: [],
    };

    const bundle = await composePromptBundle({ configPath, agent });
    assert.match(bundle.userPrompt, /User prompt content/);
    assert.match(bundle.systemPrompt, /System prompt content/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("review routing: runMandatoryReview and pair validation", async () => {
  const pair = providerPairFrom(["openai", "anthropic"]);
  assert.deepEqual(pair, ["openai", "anthropic"]);
  assert.equal(oppositeProvider("openai", pair), "anthropic");
  assert.equal(oppositeProvider("anthropic", pair), "openai");

  let executed = 0;
  const res = await runMandatoryReview({
    workerProvider: "openai",
    providers: pair,
    execute: async (provider) => {
      executed++;
      return `reviewed-by-${provider}`;
    },
    isTransportFailure: () => false,
  });

  assert.equal(executed, 1);
  assert.equal(res, "reviewed-by-anthropic");
});
