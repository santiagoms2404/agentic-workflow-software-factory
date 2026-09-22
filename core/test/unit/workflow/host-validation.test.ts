import assert from "node:assert/strict";
import { test } from "node:test";
import { HOST_VALIDATION_STAGES, stageOrdinal, type HostCommitIntent, type HostValidationProgress, type HostValidationStage } from "../../../src/contracts/host-validation.ts";
import { planHostValidationRecovery } from "../../../src/workflow/host-validation.ts";

const HASH = "a".repeat(64);
const PARENT = "b".repeat(40);
const COMMIT = "c".repeat(40);

const intent: HostCommitIntent = {
  intentId: "intent-1", phaseKey: "builder", ordinal: 2, round: 0, runId: "run-1",
  parentSha: PARENT, message: "feat: write the bounded source", author: "Owner <owner@example.invalid>",
  committer: "Owner <owner@example.invalid>", changedPaths: ["src/a.ts"], committedPaths: ["src/a.ts"],
  contentDigest: HASH, treeDigest: HASH,
};

function progress(stage: HostValidationStage): HostValidationProgress {
  const committing = stageOrdinal(stage) >= stageOrdinal("commit");
  const committed = stageOrdinal(stage) > stageOrdinal("commit");
  return {
    schema: "awsf.host-validation/v1", phaseKey: "builder", ordinal: 2, round: 0, runId: "run-1",
    envelopeId: "session:builder:0", envelopeDigest: HASH, resultCheckpointId: "checkpoint-1", stage,
    commitIntent: committing ? intent : null,
    protectedConsumptionId: null,
    commitResult: committed ? { intentId: "intent-1", commitSha: COMMIT, treeDigest: HASH } : null,
  };
}

test("every read-only cut replays the whole read-only prefix and nothing further", () => {
  for (const stage of ["envelope-check", "gates", "permission-enforce", "capture-diff"] as const) {
    assert.deepEqual(planHostValidationRecovery(progress(stage)), { action: "replay", from: "envelope-check" });
  }
});

test("a cut at the commit defers to Git objects instead of committing again", () => {
  const plan = planHostValidationRecovery(progress("commit"));
  assert.equal(plan.action, "reconcile-commit");
  assert.ok(plan.action === "reconcile-commit");
  assert.equal(plan.result, null, "the outcome is unknown at this cut and must not be assumed");
  assert.deepEqual(plan.intent, intent);
  assert.equal(plan.resumeAt, "verify-candidate");
});

test("a cut inside the configured candidate commands refuses rather than re-dispatching one", () => {
  const plan = planHostValidationRecovery(progress("verify-candidate"));
  assert.equal(plan.action, "refuse");
  assert.ok(plan.action === "refuse");
  assert.match(plan.reason, /no durable per-command result/);
  assert.match(plan.reason, /not proof that a command did not run/);
});

test("a cut after every effectful step reconciles the recorded commit and then accepts", () => {
  const plan = planHostValidationRecovery(progress("accept"));
  assert.ok(plan.action === "reconcile-commit");
  assert.equal(plan.result?.commitSha, COMMIT);
  assert.equal(plan.resumeAt, "accept");
});

test("a protected commit stage defers to its own durable intent and binding", () => {
  for (const stage of ["commit", "verify-candidate", "accept"] as const) {
    const plan = planHostValidationRecovery({ ...progress(stage), commitIntent: null, commitResult: null, protectedConsumptionId: "consumption-1" });
    assert.ok(plan.action === "reconcile-protected", stage);
    assert.equal(plan.consumptionId, "consumption-1");
    assert.equal(plan.resumeAt, stage === "commit" ? "verify-candidate" : stage);
  }
});

test("no cut in the table authorizes a model call, a second commit or a reset", () => {
  for (const stage of HOST_VALIDATION_STAGES) {
    const plan = planHostValidationRecovery(progress(stage));
    assert.ok(["replay", "reconcile-commit", "reconcile-protected", "refuse"].includes(plan.action), stage);
    if (plan.action === "replay") assert.equal(plan.from, "envelope-check");
  }
});
