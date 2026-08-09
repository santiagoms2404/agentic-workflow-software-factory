import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import type { TestOutput } from "../../src/contracts/test-output.ts";
import { CallBudget } from "../../src/execution/call-budget.ts";
import { verdictConsistent } from "../../src/gates/review.ts";
import { compileWorkflow } from "../../src/workflow/compiler.ts";
import type { CorrectionSession } from "../../src/workflow/corrections.ts";
import { runAgentPhase } from "../../src/workflow/engine.ts";
import type { CompiledAgentPhase } from "../../src/workflow/phase.ts";
import { buildReviewWorkflow } from "../../src/workflow/recipes/build-review.ts";
import {
  MandatoryReviewUnavailable,
  runMandatoryReview,
} from "../../src/workflow/review-routing.ts";

const candidateSha = "a".repeat(40);
const providers = ["stub-anthropic", "stub-openai"] as const;

function reviewPayload(): ReviewOutput {
  return {
    schema: "awsf.review-output/v1",
    producerStatus: "success",
    summary: "candidate accepted",
    artifacts: [],
    notesForNextPhase: "await owner",
    verdict: "accept",
    reviewedSha: candidateSha,
    findings: [],
    limitations: [],
  };
}

function previousTestOutput(): TestOutput {
  return {
    schema: "awsf.test-output/v1",
    producerStatus: "success",
    summary: "host gates passed",
    artifacts: [{ path: "src/change.ts", kind: "source", description: "candidate context" }],
    notesForNextPhase: "review exact candidate",
    passed: true,
    candidateSha,
    commands: [],
    failures: [],
    outputTail: "pass",
  };
}

class TransportFault extends Error {}

function enterReview(budget: CallBudget): void {
  const authorization = budget.authorize({
    from: "GATING",
    to: "REVIEWING",
    actor: "host",
    reason: { source: "gate" },
    interactive: false,
    evidence: { gatesPass: true, candidateSha },
    spawn: { cost: 1 },
  });
  assert.equal(authorization.result.to, "REVIEWING");
  assert.ok(authorization.reservation);
  budget.spendOnGo(authorization.reservation.id);
}

test("T2 gates route review to the opposite stub provider, validate the verdict, then await owner", async () => {
  const compiled = compileWorkflow(buildReviewWorkflow, buildReviewWorkflow.tier);
  const selected = compiled.phases.find((phase) => phase.id === "reviewer");
  if (selected?.kind !== "agent") throw new Error("build-review recipe has no reviewer phase");
  const phase = {
    ...(selected as CompiledAgentPhase<ReviewOutput>),
    gates: [{
      id: "verdict_consistent" as const,
      run: ({ envelope }: { envelope: ReviewOutput }) => verdictConsistent(envelope, {
        candidateSha,
        candidatePaths: ["src/change.ts"],
      }),
    }],
  };
  const budget = new CallBudget({ taskId: "journey-review", tier: 2, carried: { callsSpent: 1 } });
  enterReview(budget);
  const routedProviders: string[] = [];
  const result = await runMandatoryReview({
    workerProvider: "stub-openai",
    providers,
    isTransportFailure: (error) => error instanceof TransportFault,
    execute: async (reviewProvider) => {
      routedProviders.push(reviewProvider);
      const identity = {
        adapter: "fixture",
        provider: reviewProvider,
        model: "stub/review",
        sessionId: "review-session",
      };
      const session: CorrectionSession = {
        identity,
        send: async () => ({
          identity,
          rawOutput: JSON.stringify(reviewPayload()),
          usage: {
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            reasoningTokens: null,
            reasoningRelation: "unknown" as const,
          },
          costUsd: null,
        }),
      };
      return runAgentPhase({
        workflowId: compiled.id,
        phase,
        worktree: "/fixture/worktree",
        previousEnvelope: previousTestOutput(),
        session,
        budget,
        permissions: { enforce: () => ({ changedPaths: [], sandboxBadge: "tool-policy" }) },
        hostGit: { captureDiff: () => [], commit: () => null },
        persistence: { persist: () => undefined },
        agentSessionId: "review-agent-session",
      });
    },
  });

  assert.deepEqual(routedProviders, ["stub-anthropic"]);
  assert.equal(result.gateReports[0]?.gateId, "verdict_consistent");
  assert.equal(result.gateReports[0]?.passed, true);
  const review = result.envelope.payload!;
  const awaiting = budget.authorize({
    from: "REVIEWING",
    to: "AWAITING_OWNER",
    actor: "host",
    reason: { source: "gate" },
    interactive: false,
    evidence: {
      candidateSha,
      review: {
        verdict: review.verdict,
        reviewedSha: review.reviewedSha,
        findings: review.findings,
      },
    },
  });
  assert.equal(awaiting.result.to, "AWAITING_OWNER");
  assert.equal(awaiting.reservation, null);
  assert.equal(budget.callsSpent, 2);
  assert.equal(budget.callsReserved, 0);
});

test("mandatory review unavailability blocks after one fixed-route transport retry and never substitutes", async () => {
  const budget = new CallBudget({ taskId: "journey-review-unavailable", tier: 2, carried: { callsSpent: 1 } });
  enterReview(budget);
  const attempts: string[] = [];
  let unavailable: MandatoryReviewUnavailable | null = null;
  await assert.rejects(
    runMandatoryReview({
      workerProvider: "stub-openai",
      providers,
      isTransportFailure: (error) => error instanceof TransportFault,
      execute: async (provider) => {
        attempts.push(provider);
        throw new TransportFault("fixture transport unavailable");
      },
    }),
    (error: Error) => {
      if (!(error instanceof MandatoryReviewUnavailable)) return false;
      unavailable = error;
      return true;
    },
  );

  assert.deepEqual(attempts, ["stub-anthropic", "stub-anthropic"]);
  assert.deepEqual(unavailable?.attemptedProviders, attempts);
  assert.equal(unavailable?.transportRetries, 1);
  assert.equal(unavailable?.substituteAttempted, false);
  const blocked = budget.authorize({
    from: "REVIEWING",
    to: "BLOCKED",
    actor: "host",
    reason: { source: "process", code: "review-unavailable" },
    interactive: false,
    evidence: { reviewTransportRetries: unavailable?.transportRetries },
  });
  assert.equal(blocked.result.to, "BLOCKED");
  assert.equal(blocked.reservation, null);
  assert.equal(budget.callsSpent, 2);
  assert.equal(budget.callsReserved, 0);
});
