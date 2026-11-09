import assert from "node:assert/strict";
import { test } from "node:test";

import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { HostValidationProgress } from "../../../src/contracts/host-validation.ts";
import type { PhaseRecovery } from "../../../src/contracts/phase-recovery.ts";
import type { GitRunner } from "../../../src/git/changes.ts";
import { reconcileHostValidation } from "../../../src/workflow/phase-recovery.ts";

// B6-23: the reconcile-protected branch returned the previous accepted phase's
// candidate as this phase's candidate. A protected publication is identified by
// its own durable evidence, which this function does not read, so no revision
// is named here.
test("B6-23: a protected host effect does not inherit the previous phase's candidate", async () => {
  const priorSha = "3".repeat(40);
  const progress = {
    schema: "awsf.host-validation/v1",
    phaseKey: "builder",
    ordinal: 2,
    round: 0,
    runId: "run-1",
    envelopeId: "env-1",
    envelopeDigest: "e".repeat(64),
    resultCheckpointId: "rc-1",
    stage: "commit",
    commitIntent: null,
    commitResult: null,
    protectedConsumptionId: "consumption-1",
  } as unknown as HostValidationProgress;
  const checkpoint = {
    schema: "awsf.phase-recovery/v1",
    recoveryId: "rec-1",
    kind: "validating",
    prefix: [{ candidateSha: priorSha }],
    pending: undefined,
    validation: progress,
  } as unknown as PhaseRecovery;
  const status = { schema: "awsf/attempt-status/v1", sessionId: "sess-1", phaseKey: "builder" } as unknown as AttemptStatus;
  const untouchedGit = (() => {
    throw new Error("the protected branch must not read the repository");
  }) as unknown as GitRunner;

  const result = await reconcileHostValidation(status, checkpoint, untouchedGit, []);

  assert.equal(result.plan.action, "reconcile-protected");
  assert.equal(result.commit, null);
  assert.notEqual(result.candidateSha, priorSha, "the previous phase's candidate is not this phase's revision");
  assert.equal(result.candidateSha, null, "no revision is named until the protected evidence is reconciled");
});
