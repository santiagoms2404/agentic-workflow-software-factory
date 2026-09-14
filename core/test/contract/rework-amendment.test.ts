import assert from "node:assert/strict";
import { test } from "node:test";
import { assertOwnerAmendmentBinding, composeOwnerAmendment, createOwnerAmendment, ownerAmendmentDeliveryAction, sha256, type ReworkOwnerAmendment } from "../../src/contracts/owner-amendment.ts";

const binding: ReworkOwnerAmendment["binding"] = {
  entry: "rework", project: "project", taskId: "task", attempt: 1, sessionId: "session", authorizationId: "approval",
  operationId: "operation", phaseKey: "owner-rework-1", phaseOrdinal: 4, anchorId: "candidate-anchor", anchorRevision: 12,
  candidateSha: "a".repeat(40), defectDigest: sha256("named concrete defect"), ownerReentry: 1,
  logicalTurnId: "session:owner-rework-1:run", correctionRound: 0, priorAmendmentDigest: null,
  originalRequestDigest: sha256("request"), originalPromptBundleDigest: sha256("bundle"), deliveryFrontier: "rework-input",
};
const create = () => createOwnerAmendment({ id: "instruction", text: '  preserve "this"\nexact text  ', confirmedAt: "2026-09-14T00:00:00Z", binding });

test("rework amendment binds exact text to one defect, candidate, generation and initial input", () => {
  const amendment = create();
  assertOwnerAmendmentBinding(amendment, binding);
  const input = composeOwnerAmendment("original defect handoff", amendment);
  assert.ok(input.composedText.startsWith("original defect handoff"));
  assert.ok(input.composedText.includes(JSON.stringify(amendment.text)));
  assert.equal(composeOwnerAmendment("original defect handoff", null).composedText, "original defect handoff");
  assert.equal(ownerAmendmentDeliveryAction(amendment, null, "new-phase-input", { operationId: binding.operationId,
    logicalTurnId: binding.logicalTurnId, originalInputDigest: input.originalInputDigest, composedDigest: input.composedDigest }), "deliver-initial-input");
});

for (const patch of [{ candidateSha: "b".repeat(40) }, { defectDigest: sha256("another defect") }, { ownerReentry: 2 },
  { anchorRevision: 13 }, { operationId: "another-operation" }, { logicalTurnId: "another-turn" }]) {
  test(`rework amendment refuses changed ${Object.keys(patch)[0]}`, () => {
    assert.throws(() => assertOwnerAmendmentBinding(create(), { ...binding, ...patch }), /binding changed/);
  });
}
