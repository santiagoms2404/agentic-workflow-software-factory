import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { PlanOutput } from "../../src/contracts/plan-output.ts";
import type { TestOutput } from "../../src/contracts/test-output.ts";
import type { TokenUsage } from "../../src/contracts/normalized-events.ts";
import { CallBudget } from "../../src/execution/call-budget.ts";
import { commandsPass } from "../../src/gates/commands.ts";
import { GateReport } from "../../src/gates/interface.ts";
import { createHostPhaseGit, runAgentPhase } from "../../src/workflow/engine.ts";
import { compileWorkflow } from "../../src/workflow/compiler.ts";
import type { AgentTurn, CorrectionSession } from "../../src/workflow/corrections.ts";
import type { CompiledAgentPhase } from "../../src/workflow/phase.ts";
import { planBuildTestWorkflow } from "../../src/workflow/recipes/plan-build-test.ts";
import { PermissionSession } from "../../src/policy/sandbox-broker.ts";
import { transition } from "../../src/state/task-machine.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

const usage: TokenUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
  reasoningRelation: "unknown",
};

function planPayload(): PlanOutput {
  return {
    schema: "awsf.plan-output/v1",
    producerStatus: "success",
    summary: "implement one bounded source change",
    artifacts: [],
    notesForNextPhase: "write src/change.ts",
    goals: ["implement the requested behavior"],
    nonGoals: ["change unrelated files"],
    implementationSteps: [{
      id: "step-1",
      title: "write the source file",
      files: ["src/change.ts"],
      acceptanceCriteria: ["the injected quality check passes"],
    }],
    testStrategy: ["run the host quality gate against the candidate SHA"],
    risks: [],
    openQuestions: [],
  };
}

function buildPayload(summary: string): BuildOutput {
  return {
    schema: "awsf.build-output/v1",
    producerStatus: "success",
    summary,
    artifacts: [{ path: "src/change.ts", kind: "source", description: "bounded implementation" }],
    notesForNextPhase: "run host tests",
    changedFiles: ["src/change.ts"],
    implementationNotes: [summary],
    commandsRun: [],
    proposedCommitMessage: "feat: implement correction journey",
  };
}

function agentPhase<T extends PlanOutput | BuildOutput>(
  workflow: ReturnType<typeof compileWorkflow>,
  id: string,
): CompiledAgentPhase<T> {
  const phase = workflow.phases.find((candidate) => candidate.id === id);
  if (phase?.kind !== "agent") throw new Error(`missing compiled agent phase ${id}`);
  return phase as CompiledAgentPhase<T>;
}

class StubSession implements CorrectionSession {
  readonly identity;
  readonly prompts: string[] = [];
  readonly #sendTurn: (round: number) => AgentTurn;

  constructor(sessionId: string, sendTurn: (round: number) => AgentTurn) {
    this.identity = { adapter: "fixture", provider: "stub", model: "stub/success", sessionId };
    this.#sendTurn = sendTurn;
  }

  async send(prompt: string): Promise<AgentTurn> {
    this.prompts.push(prompt);
    return this.#sendTurn(this.prompts.length - 1);
  }
}

test("plan-build-test corrects one injected failure in-session and gates the exact host candidate", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-correction-journey-"));
  const canonical = join(root, "canonical");
  const worktree = join(root, "worktrees", "attempt-1");
  const runtime = join(root, "state", "attempt-1");
  try {
    mkdirSync(canonical, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    git(canonical, "init", "-b", "main");
    writeFileSync(join(canonical, "README.md"), "base\n");
    git(canonical, "add", "README.md");
    git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed correction journey");
    mkdirSync(join(root, "worktrees"), { recursive: true });
    git(canonical, "worktree", "add", "--detach", worktree, "HEAD");
    const baseSha = git(worktree, "rev-parse", "HEAD");

    const compiled = compileWorkflow(planBuildTestWorkflow, planBuildTestWorkflow.tier);
    const budget = new CallBudget({ taskId: "journey-correction", tier: 1 });
    budget.admitWorkflow(compiled);

    const plannerReservation = budget.reserve({ cost: 1, subject: "planner" });
    budget.spendOnGo(plannerReservation.id);
    const plannerSession = new StubSession("stub-plan", () => ({
      identity: { adapter: "fixture", provider: "stub", model: "stub/success", sessionId: "stub-plan" },
      rawOutput: JSON.stringify(planPayload()),
      usage,
      costUsd: null,
    }));
    const planResult = await runAgentPhase({
      workflowId: compiled.id,
      phase: agentPhase<PlanOutput>(compiled, "planner"),
      worktree,
      previousEnvelope: null,
      session: plannerSession,
      budget,
      permissions: { enforce: () => ({ changedPaths: [], sandboxBadge: "tool-policy" }) },
      hostGit: { captureDiff: () => [], commit: () => null },
      persistence: { persist: () => undefined },
      agentSessionId: "planner-session",
    });

    const builderReservation = budget.reserve({ cost: 1, subject: "builder" });
    budget.spendOnGo(builderReservation.id);
    const permissions = new PermissionSession({
      canonicalRepository: canonical,
      worktree,
      sessionRuntime: runtime,
      stateRoot: join(root, "state"),
      profile: "managed-worker",
      tools: ["read", "write"],
      writes: ["src/**"],
      protectedPaths: [],
      platform: "linux",
      sandboxProbe: () => false,
    });
    const hostGit = createHostPhaseGit<BuildOutput>({
      repository: worktree,
      commitMessage: (envelope) => envelope.proposedCommitMessage,
    });
    let gateRuns = 0;
    const injectedGate = {
      id: "commands_pass" as const,
      run: () => new GateReport("commands_pass").check(
        "injected quality check",
        readFileSync(join(worktree, "src", "change.ts"), "utf8").includes("fixed"),
        `round=${gateRuns++}`,
      ),
    };
    const recipeBuilder = agentPhase<BuildOutput>(compiled, "builder");
    const builder = { ...recipeBuilder, gates: [injectedGate] };
    const builderSession = new StubSession("stub-build", (round) => {
      mkdirSync(join(worktree, "src"), { recursive: true });
      writeFileSync(join(worktree, "src", "change.ts"), round === 0 ? "bad\n" : "fixed\n");
      return {
        identity: { adapter: "fixture", provider: "stub", model: "stub/success", sessionId: "stub-build" },
        rawOutput: JSON.stringify(buildPayload(round === 0 ? "initial output" : "same-session fix")),
        usage,
        costUsd: null,
      };
    });
    const callsBeforeCorrection = budget.callsSpent;
    const buildResult = await runAgentPhase({
      workflowId: compiled.id,
      phase: builder,
      worktree,
      previousEnvelope: planResult.envelope.payload,
      session: builderSession,
      budget,
      permissions,
      hostGit,
      persistence: { persist: () => undefined },
      agentSessionId: "builder-session",
    });

    assert.equal(builderSession.prompts.length, 2);
    assert.equal(budget.callsSpent, callsBeforeCorrection, "same-session correction must spend no tier call");
    assert.equal(budget.callsReserved, 0);
    assert.equal(budget.snapshot().correctionsAuto, 1);
    assert.equal(buildResult.candidateSha, git(worktree, "rev-parse", "HEAD"));
    assert.notEqual(buildResult.candidateSha, baseSha);

    const testOutput: TestOutput = {
      schema: "awsf.test-output/v1",
      producerStatus: "success",
      summary: "host test passed",
      artifacts: [],
      notesForNextPhase: "await owner",
      passed: true,
      candidateSha: buildResult.candidateSha!,
      commands: [{
        gateId: "test",
        argv: ["npm", "test"],
        exitCode: 0,
        durationMs: 1,
        outputRef: "journal://journey/test",
      }],
      failures: [],
      outputTail: "pass",
    };
    const candidateGate = commandsPass(testOutput, { gateId: "test", argv: ["npm", "test"] }, {
      candidateSha: buildResult.candidateSha!,
      cleanBefore: true,
      cleanAfter: true,
    });
    assert.equal(candidateGate.passed, true);
    assert.ok(candidateGate.checks.some((check) => check.item === "candidate SHA exact" && check.ok));

    const gating = transition({
      from: "RUNNING",
      to: "GATING",
      actor: "host",
      tier: 1,
      reason: { source: "git" },
      interactive: false,
      budget: budget.snapshot(),
      evidence: {
        requiredPhasesTerminalSuccess: true,
        hostCommitCreated: true,
        baseSha,
        candidateSha: buildResult.candidateSha!,
      },
    });
    assert.equal(gating.to, "GATING");
    const awaiting = transition({
      from: "GATING",
      to: "AWAITING_OWNER",
      actor: "host",
      tier: 1,
      reason: { source: "gate" },
      interactive: false,
      budget: budget.snapshot(),
      evidence: { gatesPass: candidateGate.passed, candidateSha: buildResult.candidateSha! },
    });
    assert.equal(awaiting.to, "AWAITING_OWNER");
    assert.equal(plannerSession.identity.provider, "stub");
    assert.equal(builderSession.identity.provider, "stub");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
