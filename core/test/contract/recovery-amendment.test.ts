import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  SeedOwnerAmendmentSchema, assertOwnerAmendment, assertOwnerAmendmentBinding, assertOwnerAmendmentDelivery,
  canonicalJson, composeOwnerAmendment, composeOwnerAmendmentChain, createOwnerAmendment,
  ownerAmendmentDeliveryAction, sha256, type OwnerAmendment, type OwnerAmendmentDelivery,
} from "../../src/contracts/owner-amendment.ts";

function recovery(entry: "resume" | "rescue", prior: OwnerAmendment | null = null) {
  const common = { project: "fixture", taskId: "target", attempt: 1, sessionId: "target-session",
    authorizationId: "fixture-authorization", operationId: "fixture-operation", phaseKey: "builder", phaseOrdinal: 2,
    anchorId: "fixture-anchor", anchorRevision: 7, originalRequestDigest: sha256("request"),
    originalPromptBundleDigest: sha256("bundle"), priorAmendmentDigest: prior?.digest ?? null };
  return createOwnerAmendment({ id: `fixture-${entry}`, confirmedAt: "fixture-time", text: "  Retain the prior result.\n",
    binding: entry === "resume"
      ? { ...common, entry, logicalTurnId: null, correctionRound: 0, deliveryFrontier: "next-phase-input" }
      : { ...common, entry, logicalTurnId: "original-turn", correctionRound: 0, reconnectGeneration: 1,
        inputFrontierDigest: sha256("frontier"), deliveryFrontier: "original-turn-input" } });
}

function target(amendment: OwnerAmendment) {
  return { operationId: amendment.binding.operationId,
    logicalTurnId: amendment.binding.logicalTurnId ?? "newly-admitted-turn",
    originalInputDigest: sha256("original"), composedDigest: composeOwnerAmendment("original", amendment).composedDigest };
}

function delivery(amendment: OwnerAmendment, state: OwnerAmendmentDelivery["state"]): OwnerAmendmentDelivery {
  return { schema: "awsf.owner-amendment-delivery/v1", amendmentId: amendment.id, amendmentDigest: amendment.digest,
    bindingDigest: sha256(canonicalJson(amendment.binding)), operationId: amendment.binding.operationId,
    logicalTurnId: amendment.binding.logicalTurnId ?? "newly-admitted-turn", originalInputDigest: sha256("original"),
    composedDigest: composeOwnerAmendment("original", amendment).composedDigest, state,
    providerAcknowledgementDigest: state === "acknowledged" ? sha256("private provider acknowledgement") : null };
}

for (const entry of ["resume", "rescue"] as const) {
  test(`${entry}: exact owner text and binding are immutable and cannot enter a seed`, () => {
    const amendment = recovery(entry);
    assertOwnerAmendment(amendment);
    assert.equal(amendment.text, "  Retain the prior result.\n");
    assert.equal(Object.isFrozen(amendment), true);
    assert.equal(Object.isFrozen(amendment.binding), true);
    assert.equal(Value.Check(SeedOwnerAmendmentSchema, amendment), false);
    assert.throws(() => assertOwnerAmendment({ ...amendment, budgetOverride: 50 }));
    assert.throws(() => assertOwnerAmendment({ ...amendment, binding: { ...amendment.binding, grant: "new-authority" } }));
  });

  for (const key of ["anchorId", "anchorRevision", "operationId", "phaseKey", "originalRequestDigest", "originalPromptBundleDigest"] as const) {
    test(`${entry}: stale ${key} refuses before delivery`, () => {
      const amendment = recovery(entry);
      const changed = key === "anchorRevision" ? 8 : key.endsWith("Digest") ? sha256("changed") : "changed";
      assert.throws(() => assertOwnerAmendmentBinding(amendment, { ...amendment.binding, [key]: changed }), /binding changed/);
    });
  }
}

test("resume null-turn binding and rescue exact-turn/frontier binding cannot be interchanged", () => {
  const resume = recovery("resume");
  const rescue = recovery("rescue");
  assert.throws(() => assertOwnerAmendment({ ...resume, binding: { ...resume.binding, entry: "rescue" } }));
  assert.throws(() => assertOwnerAmendment({ ...rescue, binding: { ...rescue.binding, logicalTurnId: null } }));
  assert.throws(() => assertOwnerAmendmentBinding(rescue, { ...rescue.binding, reconnectGeneration: 2 } as typeof rescue.binding));
});

test("input reconstruction starts with original bytes and verifies the whole additive chain", () => {
  const original = "unchanged request\n";
  assert.deepEqual(composeOwnerAmendmentChain(original, []), composeOwnerAmendment(original, null));
  const first = recovery("resume");
  const next = recovery("rescue", first);
  const chain = composeOwnerAmendmentChain(original, [first, next]);
  assert.equal(chain.originalInputDigest, sha256(original));
  assert.equal(chain.ownerAmendmentDigest, next.digest);
  assert.equal(chain.composedText, composeOwnerAmendment(composeOwnerAmendment(original, first).composedText, next).composedText);
  assert.throws(() => composeOwnerAmendmentChain(original, [next]), /incomplete/);
  assert.throws(() => composeOwnerAmendmentChain(original, [first, first]), /duplicated/);
  const foreign = createOwnerAmendment({ id: "foreign", confirmedAt: "fixture", text: "no transfer",
    binding: { ...next.binding, sessionId: "another-session" } });
  assert.throws(() => composeOwnerAmendmentChain(original, [first, foreign]), /crosses/);
});

test("unsupported native steering refuses even when the owner amendment is valid", () => {
  const amendment = recovery("rescue");
  assert.equal(ownerAmendmentDeliveryAction(amendment, null, "unavailable", target(amendment)), "refuse");
  assert.equal(ownerAmendmentDeliveryAction(amendment, null, "new-phase-input", target(amendment)), "refuse");
  assert.equal(ownerAmendmentDeliveryAction(amendment, null, "idempotent-in-turn", target(amendment)), "deliver-in-turn-idempotently");
});

test("lost acknowledgement is queried by original identity and acknowledged input is never resent", () => {
  const amendment = recovery("rescue");
  for (const state of ["submitted", "unknown"] as const) {
    assert.equal(ownerAmendmentDeliveryAction(amendment, delivery(amendment, state), "idempotent-in-turn", target(amendment)), "query-acknowledgement");
  }
  assert.equal(ownerAmendmentDeliveryAction(amendment, delivery(amendment, "acknowledged"), "idempotent-in-turn", target(amendment)), "already-acknowledged");
  const acknowledged = delivery(amendment, "acknowledged");
  assert.throws(() => assertOwnerAmendmentDelivery({ ...acknowledged, providerAcknowledgementDigest: null }, amendment, target(amendment)), /unproved/);
  assert.throws(() => assertOwnerAmendmentDelivery({ ...acknowledged, logicalTurnId: "replacement-turn" }, amendment, target(amendment)), /another activation/);
  assert.throws(() => assertOwnerAmendmentDelivery({ ...acknowledged, providerSessionId: "private-value" }, amendment, target(amendment)), /invalid/);
});

test("a persisted resume delivery intent is not proof that initial input was never sent", () => {
  const amendment = recovery("resume");
  assert.equal(ownerAmendmentDeliveryAction(amendment, null, "new-phase-input", target(amendment)), "deliver-initial-input");
  for (const state of ["intent", "submitted", "unknown"] as const) {
    assert.equal(ownerAmendmentDeliveryAction(amendment, delivery(amendment, state), "new-phase-input", target(amendment)), "refuse");
  }
});

for (const entry of ["resume", "rescue"] as const) {
  test(`${entry}: acknowledgements cannot transfer to different original or composed input bytes`, () => {
    const amendment = recovery(entry);
    const acknowledged = delivery(amendment, "acknowledged");
    for (const key of ["originalInputDigest", "composedDigest"] as const) {
      assert.throws(() => assertOwnerAmendmentDelivery({ ...acknowledged, [key]: sha256("other input") }, amendment, target(amendment)), /host input/);
    }
    assert.throws(() => assertOwnerAmendmentDelivery(acknowledged, amendment, { ...target(amendment), logicalTurnId: "other-turn" }), /logical turn|current activation/);
  });
}
