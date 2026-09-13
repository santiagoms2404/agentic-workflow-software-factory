import assert from "node:assert/strict";
import { test } from "node:test";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import type { VerifiedReconnectAuthorization } from "../../../src/workflow/turn-reconnect-authorization.ts";
import { reconnectFixture } from "../../fixtures/interrupted-turn.ts";

function registered(w: ReturnType<typeof reconnectFixture>) {
  const intent = w.verifier.verify(w.registration, w.spec);
  w.ledger.claimReconnectLaunch(intent);
  w.state = { ...w.state, reconnectStage: "registered" };
  return w.verifier.verify(w.registration, w.spec, "before-go");
}

for (const state of ["held", "spent"] as const) {
  test(`reconnect reuses an original ${state} reservation and repeated accounting is idempotent`, () => {
    const w = reconnectFixture(state);
    const before = w.ledger.snapshot();
    w.ledger.spendOnGo = () => assert.fail("reconnect must not call spendOnGo");
    const proof = registered(w);
    const debit = w.ledger.authorizeReconnect(proof);
    assert.equal(debit.id, w.reservation.id);
    assert.equal(debit.state, "spent");
    assert.equal(w.ledger.callsSpent, 1);
    assert.equal(w.ledger.callsReserved, 0);
    assert.deepEqual(w.ledger.authorizeReconnect(proof), debit);
    assert.equal(w.ledger.snapshot().correctionsAuto, before.correctionsAuto);
    assert.equal(w.ledger.snapshot().ownerReentries, before.ownerReentries);
    if (state === "spent") assert.deepEqual(w.ledger.snapshot(), before);
  });
}

test("numeric spend alone cannot authorize reconnect and genuine proof cannot cross ledgers", () => {
  const w = reconnectFixture();
  const proof = registered(w);
  const other = new CallBudget({ taskId: "fixture-task", tier: 2, carried: { callsSpent: 1 } });
  assert.throws(() => other.authorizeReconnect(proof), /proof-unavailable/);
  other.restoreReservation(w.ledger.reservation(w.reservation.id)!);
  other.bindOriginalTurn(w.binding);
  assert.throws(() => other.authorizeReconnect(proof), /proof-unavailable/);
  assert.equal(other.callsSpent, 1);
});

test("copied, forged and premature authorizations refuse without changing the ledger", () => {
  const w = reconnectFixture("held");
  const before = w.ledger.snapshot();
  const intent = w.verifier.verify(w.registration, w.spec);
  assert.throws(() => w.ledger.authorizeReconnect(intent), /claimed physical launch/);
  assert.throws(() => w.ledger.authorizeReconnect({ ...intent }), /proof-unavailable/);
  assert.throws(() => w.ledger.authorizeReconnect({} as VerifiedReconnectAuthorization), /proof-unavailable/);
  w.ledger.claimReconnectLaunch(intent);
  assert.throws(() => w.ledger.claimReconnectLaunch(intent), /already claimed/);
  assert.deepEqual(w.ledger.snapshot(), before);
});

test("released, completed and inconsistent original liabilities refuse", () => {
  for (const disposition of ["released", "completed", "inconsistent"] as const) {
    const w = reconnectFixture("held");
    const proof = registered(w);
    if (disposition === "released") w.ledger.releaseOnRegistrationFailure(w.reservation.id);
    if (disposition === "completed") w.ledger.markTurnCompleted(w.binding.logicalTurnId);
    if (disposition === "inconsistent") w.ledger.spendOnGo(w.reservation.id);
    const before = w.ledger.snapshot();
    assert.throws(() => w.ledger.authorizeReconnect(proof));
    assert.deepEqual(w.ledger.snapshot(), before);
  }
});

test("restoration carries each spent debit once and never collides with a new reservation", () => {
  const w = reconnectFixture();
  const record = w.ledger.reservation(w.reservation.id)!;
  const restored = new CallBudget({ taskId: "fixture-task", tier: 2, carried: { callsSpent: 1 }, reservationNamespace: "fixture-operation" });
  restored.restoreReservation(record);
  restored.restoreReservation(record);
  assert.equal(restored.callsSpent, 1);
  assert.equal(restored.reserve({ cost: 1 }).id, "fixture-operation:r2");
  assert.throws(() => restored.restoreReservation({ ...record, id: "other-operation:r1" }), /exceeds journal-carried spend/);
  assert.throws(() => restored.restoreReservation({ ...record, state: "released", spent: 0 }), /disagrees/);
  assert.throws(() => restored.restoreReservation({ ...record, id: "r1" }), /operation-qualified/);
  assert.equal(restored.callsSpent, 1);
});

test("registered recovery charges the original held liability, ambiguous recovery retains it", () => {
  for (const knowledge of ["never-launched", "launch-intent", "registered", "spent"] as const) {
    const w = reconnectFixture("held");
    const before = w.ledger.snapshot();
    assert.throws(() => w.ledger.settleRecoveredLiability(w.reservation.id, knowledge, false), /ambiguous/);
    assert.deepEqual(w.ledger.snapshot(), before);
    if (knowledge === "launch-intent") {
      assert.throws(() => w.ledger.settleRecoveredLiability(w.reservation.id, knowledge, true), /ambiguous/);
      assert.deepEqual(w.ledger.snapshot(), before);
    } else {
      w.ledger.settleRecoveredLiability(w.reservation.id, knowledge, true);
      assert.equal(w.ledger.callsSpent, knowledge === "never-launched" ? 0 : 1);
      assert.equal(w.ledger.callsReserved, 0);
    }
  }
});

for (const field of ["adapterId", "adapterSourceDigest", "executableVersion", "protocolVersion", "provider", "model", "effort", "role", "toolExecutor", "sandboxMechanism", "amendmentMode"] as const) {
  test(`live proof must match capability dimension ${field}`, () => {
    const w = reconnectFixture();
    w.state = { ...w.state, capability: { ...w.state.capability, [field]: "different" } };
    assert.throws(() => w.verifier.verify(w.registration, w.spec), /proof-unavailable/);
    assert.equal(w.ledger.callsSpent, 1);
  });
}

for (const field of ["ownerCancelled", "turnCompleted", "localControllerExclusive", "localTreeQuiescent", "checkpointVerified", "toolFrontierVerified"] as const) {
  test(`reconnect refuses changed current fact ${field}`, () => {
    const w = reconnectFixture();
    w.state = { ...w.state, [field]: !w.state[field] };
    assert.throws(() => w.verifier.verify(w.registration, w.spec), /recovery-ambiguous/);
  });
}

test("settled activation, changed physical run, unknown acceptance and unproved steering refuse", () => {
  const w = reconnectFixture("held");
  assert.throws(() => w.verifier.verify({ ...w.registration, runId: "another-physical-process" }, w.spec));
  w.state = { ...w.state, reconnectStage: "settled" };
  assert.throws(() => w.verifier.verify(w.registration, w.spec));
  w.state = { ...w.state, reconnectStage: "launch-intent", providerNeverAccepted: false };
  assert.throws(() => w.verifier.verify(w.registration, w.spec));
  w.state = { ...w.state, providerNeverAccepted: true, ownerAmendmentDigest: w.state.admissionDigest };
  assert.throws(() => w.verifier.verify(w.registration, w.spec), /amendment acknowledgement/);
});

test("mid-review retains REVIEWING, its original inverse route, candidate, context and round", () => {
  const w = reconnectFixture("spent", true);
  const before = w.ledger.snapshot();
  const proof = registered(w);
  w.ledger.authorizeReconnect(proof);
  assert.deepEqual(w.ledger.snapshot(), before);
  assert.equal(proof.binding.lifecycle, "REVIEWING");
  for (const patch of [
    { lifecycle: "RUNNING" as const }, { candidateSha: "c".repeat(40) },
    { reviewContextDigest: "d".repeat(64) }, { provider: "replacement-provider" }, { correctionRound: 1 },
  ]) {
    w.state = { ...w.state, currentBinding: { ...w.binding, ...patch } };
    assert.throws(() => w.verifier.verify(w.registration, w.spec, "before-go"), /current lifecycle/);
  }
});

test("current original inputs, config, grants, phase and route are revalidated independently", () => {
  const w = reconnectFixture();
  for (const field of ["originalRequestDigest", "originalPromptBundleDigest", "compiledRecipeDigest", "configDigest", "routeAndExecutableDigest",
    "toolsAndSandboxDigest", "permissionBaselineDigest", "originalTurnInputDigest", "effectiveInputDigest"] as const) {
    w.state = { ...w.state, currentBinding: { ...w.binding, [field]: "e".repeat(64) } };
    assert.throws(() => w.verifier.verify(w.registration, w.spec), /current lifecycle/, field);
  }
  for (const patch of [{ protectedGrantGeneration: "different-generation" }, { phaseOrdinal: 5 }, { role: "scout" },
    { effort: "high" }, { preWriteHeadSha: "f".repeat(40) }, { originAuthorizationId: "different-authorization" }]) {
    w.state = { ...w.state, currentBinding: { ...w.binding, ...patch } };
    assert.throws(() => w.verifier.verify(w.registration, w.spec), /current lifecycle/);
  }
});
