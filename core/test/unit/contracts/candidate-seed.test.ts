import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCandidateSeed } from "../../../src/contracts/candidate-seed.ts";
import { createOwnerAmendment } from "../../../src/contracts/owner-amendment.ts";

const digest = "a".repeat(64);

function amendment(phaseOrdinal: number) {
  return createOwnerAmendment({
    id: "approval",
    text: "Proceed with the seeded task.",
    confirmedAt: "2026-09-01T00:00:00Z",
    binding: {
      project: "project",
      taskId: "target",
      attempt: 1,
      sessionId: "target-session",
      authorizationId: "authorization",
      operationId: "authorization",
      phaseKey: "builder",
      phaseOrdinal,
      originalRequestDigest: digest,
      originalPromptBundleDigest: digest,
      entry: "seed",
      anchorId: null,
      logicalTurnId: null,
      correctionRound: 0,
      priorAmendmentDigest: null,
      deliveryFrontier: "first-builder-input",
    },
  });
}

function seed(ownerAmendment: ReturnType<typeof amendment>) {
  return {
    schema: "awsf.candidate-seed/v1",
    authorizationId: "authorization",
    confirmedAt: "2026-09-01T00:00:00Z",
    source: {
      project: "project",
      taskId: "source",
      attempt: 1,
      sessionId: "source-session",
      revision: 1,
      journalDigest: digest,
      lifecycle: "BLOCKED",
    },
    target: { project: "project", taskId: "target", attempt: 1, sessionId: "target-session" },
    integrationBaseSha: "b".repeat(40),
    seedCandidateSha: "c".repeat(40),
    configDigest: digest,
    requestDigest: digest,
    workflow: "build",
    builderPhaseKey: "builder",
    builderPhaseOrdinal: 1,
    builderPromptBundleDigest: digest,
    ownerAmendment,
  };
}

test("candidate seed checks the complete owner-amendment binding", () => {
  assert.doesNotThrow(() => assertCandidateSeed(seed(amendment(1))));
  assert.throws(() => assertCandidateSeed(seed(amendment(2))), /amendment does not bind the seeded target/u);
});
