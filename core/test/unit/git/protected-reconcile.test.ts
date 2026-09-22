import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProtectedCandidateBinding, ProtectedGrantConsumption } from "../../../src/contracts/protected-grant.ts";
import type { ProtectedCommitIntent } from "../../../src/git/protected-commit.ts";
import type { ProtectedState } from "../../../src/workflow/protected-grants.ts";
import { unfinishedProtectedEffect } from "../../../src/git/protected-reconcile.ts";

const consumption = (id: string): ProtectedGrantConsumption =>
  ({ id, grantId: "grant-1", grantDigest: "a".repeat(64), generationId: "generation-1",
    operationId: "operation-1", reservationId: "reservation-1", phaseKey: "builder", phaseOrdinal: 2 });

const binding = (consumptionId: string): ProtectedCandidateBinding =>
  ({ schema: "awsf.protected-candidate-binding/v1", id: `binding-${consumptionId}`, grantId: "grant-1",
    grantDigest: "a".repeat(64), consumptionId, generationId: "generation-1", operationId: "operation-1",
    phaseKey: "builder", phaseOrdinal: 2, parentSha: "b".repeat(40), treeSha: "c".repeat(40),
    candidateSha: "d".repeat(40), deltas: [], sandboxBadge: "os-enforced", createdAt: "2026-09-21T00:00:00.000Z",
    digest: "e".repeat(64) });

const intent = (consumptionId: string): ProtectedCommitIntent =>
  ({ binding: binding(consumptionId), beforeIndexDigest: "f".repeat(64), stagedIndexDigest: "0".repeat(64) });

function state(input: Partial<Pick<ProtectedState, "consumptions" | "intents" | "bindings" | "witnesses">>): ProtectedState {
  return { status: {} as ProtectedState["status"], records: [], grants: [],
    consumptions: input.consumptions ?? [], intents: input.intents ?? [], bindings: input.bindings ?? [],
    witnesses: input.witnesses ?? [] };
}

test("a consumption whose intent and binding are both durable has nothing unfinished", () => {
  assert.equal(unfinishedProtectedEffect(state({
    consumptions: [consumption("c1")], intents: [intent("c1")], bindings: [binding("c1")],
  })), null);
});

test("an intent with no binding is the crash window between them", () => {
  const retained = unfinishedProtectedEffect(state({ consumptions: [consumption("c1")], intents: [intent("c1")] }));
  assert.equal(retained?.binding.consumptionId, "c1");
});

test("a consumption that never reached the transport has no exact outcome to complete", () => {
  // The generation was activated and then crashed before any commit object
  // existed. There is nothing to reconcile, and inventing one would be replay.
  assert.equal(unfinishedProtectedEffect(state({ consumptions: [consumption("c1")] })), null);
});

test("an orphaned consumption suppresses reconciliation even beside a complete one", () => {
  assert.equal(unfinishedProtectedEffect(state({
    consumptions: [consumption("c1"), consumption("c2")], intents: [intent("c1")],
  })), null);
});

test("two unfinished host effects are corruption, not a cut", () => {
  assert.throws(() => unfinishedProtectedEffect(state({
    consumptions: [consumption("c1"), consumption("c2")], intents: [intent("c1"), intent("c2")],
  })), /more than one unfinished host effect/);
});

test("an attempt with no protected generation at all is silent", () => {
  assert.equal(unfinishedProtectedEffect(state({})), null);
});
