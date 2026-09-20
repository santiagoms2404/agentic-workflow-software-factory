import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EFFECTFUL_HOST_VALIDATION_STAGES,
  HOST_VALIDATION_STAGES,
  assertHostValidationProgress,
  isRepeatableStage,
  stageOrdinal,
  type HostCommitIntent,
  type HostValidationProgress,
  type HostValidationStage,
} from "../../../src/contracts/host-validation.ts";

const HASH = "a".repeat(64);
const PARENT = "b".repeat(40);
const COMMIT = "c".repeat(40);

function intent(overrides: Partial<HostCommitIntent> = {}): HostCommitIntent {
  return {
    intentId: "intent-1", phaseKey: "builder", ordinal: 2, round: 0, runId: "run-1",
    parentSha: PARENT, message: "feat: write the bounded source", author: "Owner <owner@example.invalid>",
    committer: "Owner <owner@example.invalid>", changedPaths: ["src/a.ts"], committedPaths: ["src/a.ts", "src/b.ts"],
    contentDigest: HASH, treeDigest: HASH, ...overrides,
  };
}

function progress(stage: HostValidationStage, overrides: Partial<HostValidationProgress> = {}): HostValidationProgress {
  const committing = stageOrdinal(stage) >= stageOrdinal("commit");
  const committed = stageOrdinal(stage) > stageOrdinal("commit");
  return {
    schema: "awsf.host-validation/v1", phaseKey: "builder", ordinal: 2, round: 0, runId: "run-1",
    envelopeId: "session:builder:0", envelopeDigest: HASH, resultCheckpointId: "checkpoint-1", stage,
    commitIntent: committing ? intent() : null,
    commitResult: committed ? { intentId: "intent-1", commitSha: COMMIT, treeDigest: HASH } : null,
    ...overrides,
  };
}

test("the stage order is the order runAgentPhase performs host validation", () => {
  assert.deepEqual([...HOST_VALIDATION_STAGES],
    ["envelope-check", "gates", "permission-enforce", "capture-diff", "commit", "verify-candidate", "accept"]);
});

test("exactly the two acting stages are effectful, and every earlier stage only reads", () => {
  assert.deepEqual([...EFFECTFUL_HOST_VALIDATION_STAGES], ["commit", "verify-candidate"]);
  assert.deepEqual(HOST_VALIDATION_STAGES.filter(stage => !isRepeatableStage(stage)), ["commit", "verify-candidate"]);
  for (const stage of HOST_VALIDATION_STAGES) {
    if (stageOrdinal(stage) < stageOrdinal("commit")) assert.ok(isRepeatableStage(stage), stage);
  }
});

test("every stage accepts its own commit evidence and nothing else", () => {
  for (const stage of HOST_VALIDATION_STAGES) assertHostValidationProgress(progress(stage));
});

test("a stage before the commit may not carry a commit intent", () => {
  assert.throws(() => assertHostValidationProgress(progress("gates", { commitIntent: intent() })),
    /stage disagrees with its recorded commit evidence/);
});

test("the commit stage may not carry a result, and a later stage may not omit one", () => {
  assert.throws(() => assertHostValidationProgress(progress("commit", { commitResult: { intentId: "intent-1", commitSha: COMMIT, treeDigest: HASH } })),
    /stage disagrees with its recorded commit evidence/);
  assert.throws(() => assertHostValidationProgress(progress("accept", { commitResult: null })),
    /stage disagrees with its recorded commit evidence/);
});

test("a commit intent from another turn, round or run is refused", () => {
  for (const override of [{ phaseKey: "reviewer" }, { ordinal: 3 }, { round: 1 }, { runId: "run-2" }]) {
    assert.throws(() => assertHostValidationProgress(progress("commit", { commitIntent: intent(override) })),
      /commit intent belongs to another turn/);
  }
});

test("a result citing a different intent is refused", () => {
  assert.throws(() => assertHostValidationProgress(progress("accept", { commitResult: { intentId: "intent-2", commitSha: COMMIT, treeDigest: HASH } })),
    /result cites another intent/);
});

test("the committed path set must be sorted and free of duplicates", () => {
  for (const paths of [["src/b.ts", "src/a.ts"], ["src/a.ts", "src/a.ts"]]) {
    assert.throws(() => assertHostValidationProgress(progress("commit", { commitIntent: intent({ committedPaths: paths }) })),
      /duplicated or unsorted/);
  }
});

test("an empty change-set can never have produced a commit", () => {
  assert.throws(() => assertHostValidationProgress(progress("accept", { commitIntent: intent({ committedPaths: [] }) })),
    /claims a commit for an empty change-set/);
  assertHostValidationProgress(progress("accept", {
    commitIntent: intent({ committedPaths: [] }),
    commitResult: { intentId: "intent-1", commitSha: null, treeDigest: HASH },
  }));
});

test("an unknown stage or a malformed digest is refused before any field is read", () => {
  assert.throws(() => assertHostValidationProgress(progress("accept", { stage: "commit-and-push" as HostValidationStage })), /invalid/);
  assert.throws(() => assertHostValidationProgress(progress("gates", { envelopeDigest: "not-a-digest" })), /invalid/);
  assert.throws(() => assertHostValidationProgress(progress("commit", { commitIntent: intent({ parentSha: "short" }) })), /invalid/);
});
