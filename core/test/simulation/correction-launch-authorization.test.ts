// The third authorization class: a real provider process, registered before GO,
// that charges no call.
//
// The whole risk this file exists to close is that "free" quietly becomes
// "unlimited". A task-edge or agent-phase launch is bounded by the reservation
// ledger — the ceiling refuses a sixth call. A correction reserves nothing, so
// what bounds it is `risk.correction_allowance`, charged by the phase machine
// and re-checked by the broker's verifier. Every negative case below is a way
// that bound could have been sidestepped.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StubAdapter } from "../../src/adapters/stub.ts";
import type { PhaseCorrectionProcessRegistration } from "../../src/adapters/interface.ts";
import { CallBudget, type Reservation } from "../../src/execution/call-budget.ts";
import { ProcessTransportBroker } from "../../src/execution/transport-broker.ts";
import type { BarrierRecord } from "../../src/execution/launcher-barrier.ts";
import { compileWorkflow, type CompiledWorkflow } from "../../src/workflow/compiler.ts";
import {
  createCorrectionLaunchVerifier,
  type CorrectionAllowanceState,
  type OpenConversation,
} from "../../src/workflow/phase-launch-authorization.ts";
import { planBuildTestWorkflow } from "../../src/workflow/recipes/plan-build-test.ts";

const PROVIDER = join(import.meta.dirname, "..", "fixtures", "providers", "stub", "stub-provider.mjs");
const HANDLE = "continuity:builder";

interface World {
  readonly compiled: CompiledWorkflow;
  readonly budget: CallBudget;
  readonly origin: Reservation;
  readonly records: BarrierRecord[];
  readonly corrections: BarrierRecord[];
  readonly broker: ProcessTransportBroker;
  readonly root: string;
  readonly sideEffect: string;
  close(): void;
}

function world(overrides: {
  conversation?: Partial<OpenConversation> | null;
  allowance?: CorrectionAllowanceState;
  spendOrigin?: boolean;
  installVerifier?: boolean;
} = {}): World {
  const root = mkdtempSync(join(tmpdir(), "awsf-correction-"));
  const sideEffect = join(root, "correction-ran.json");
  const compiled = compileWorkflow(planBuildTestWorkflow, 1);
  const budget = new CallBudget({ taskId: "correction", tier: 1, allowance: { auto: 1, owner: 1 } });
  // The planner was L4. The builder's own first turn is the call a correction
  // hangs off, and it is genuinely spent before anything below runs.
  budget.spendOnGo(budget.reserve({ cost: 1, edge: "L4", subject: "planner through L4" }).id);
  const origin = budget.reserve({ cost: 1, subject: "builder first turn" });
  if (overrides.spendOrigin !== false) budget.spendOnGo(origin.id);

  const conversation: OpenConversation | null = overrides.conversation === null ? null : {
    handle: HANDLE,
    adapterId: "stub-config",
    role: "builder",
    turns: 1,
    verifiedContinuity: "same-session-correction",
    ...overrides.conversation,
  };
  const verifier = createCorrectionLaunchVerifier({
    statusFor: (taskSessionId) => ({ taskSessionId, lifecycleState: "RUNNING", workflowId: compiled.id }),
    compiledWorkflowFor: () => compiled,
    configuredRouteFor: () => ({ adapterId: "stub-config", role: "builder", launchAuthorization: "agent-phase" }),
    conversationFor: () => conversation,
    correctionStateFor: () => overrides.allowance ?? { used: { auto: 1, owner: 0 }, allowance: { auto: 1, owner: 1 } },
  });
  const records: BarrierRecord[] = [];
  const corrections: BarrierRecord[] = [];
  const broker = new ProcessTransportBroker({
    register: async (record) => { records.push(record); },
    onSpent: async () => { assert.fail("a correction must never settle a reservation"); },
    onCorrection: async (record) => { corrections.push(record); },
    ledger: budget,
    ...(overrides.installVerifier === false ? {} : { correctionLaunchVerifier: verifier }),
  });
  return {
    compiled, budget, origin, records, corrections, broker, root, sideEffect,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

function registration(
  origin: Reservation,
  overrides: Partial<PhaseCorrectionProcessRegistration> = {},
): PhaseCorrectionProcessRegistration {
  return {
    kind: "phase-correction",
    runId: "run-builder-correction-1",
    taskSessionId: "task-session-correction",
    workflowId: "plan-build-test",
    phaseId: "builder",
    phaseOrdinal: 3,
    correctionRound: 1,
    tranche: "auto",
    originReservationId: origin.id,
    adapterId: "stub-config",
    role: "builder",
    continuityHandle: HANDLE,
    ...overrides,
  };
}

async function launch(w: World, registrationOverrides: Partial<PhaseCorrectionProcessRegistration> = {}): Promise<void> {
  const adapter = new StubAdapter({ providerPath: PROVIDER, sideEffectPath: w.sideEffect });
  const transport = await w.broker.startProcess(
    registration(w.origin, registrationOverrides),
    adapter.buildSpec({
      model: "stub/success",
      prompt: "correct the candidate in this same session",
      cwd: w.root,
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
    }),
    new AbortController().signal,
  );
  for await (const _event of adapter.parse(transport)) { /* drained */ }
  await transport.exit;
}

// ---------------------------------------------------------------------------
// The positive control: a real process, registered, and no call charged.
// ---------------------------------------------------------------------------

test("a correction really launches, is registered before GO, and charges no call", async () => {
  const w = world();
  try {
    const before = w.budget.callsSpent;
    await launch(w);

    assert.equal(existsSync(w.sideEffect), true, "the positive control must prove a provider really ran");
    assert.equal(w.records.length, 1, "a correction is registered exactly like any other launch");
    assert.equal(w.budget.callsSpent, before, "an intra-phase correction costs tokens, not a call");
    assert.equal(w.budget.callsReserved, 0, "and it leaves no reservation behind either");
    // `onSpent` would have failed the test; `onCorrection` is the hook that
    // fires, so the journal can tell the two classes of launch apart rather than
    // inferring one from the absence of a row.
    assert.equal(w.corrections.length, 1);

    const record = w.records[0]!;
    assert.equal(record.edge, null, "a correction is not disguised as a task edge");
    assert.equal(record.reservationId, w.origin.id, "the row names the call this turn hangs off");
    assert.deepEqual(record.phase, {
      taskSessionId: "task-session-correction",
      workflowId: "plan-build-test",
      phaseId: "builder",
      phaseOrdinal: 3,
      adapterId: "stub-config",
      role: "builder",
    });
    // The origin reservation is untouched: still spent, never re-spent, never
    // handed back.
    assert.equal(w.budget.reservation(w.origin.id)?.state, "spent");
  } finally { w.close(); }
});

test("the correction's identity is registered with a PID the host can later kill", async () => {
  const w = world();
  try {
    await launch(w);
    const identity = w.records[0]!.identity;
    assert.ok(identity.pid > 0 && identity.pgid > 0);
    // PID reuse protection is the same mechanism as every other launch: a
    // correction that could not be cancelled would be the one process class the
    // host could not stop.
    assert.notEqual(identity.startIdentity, null);
    assert.ok(identity.startIdentitySource.length > 0);
  } finally { w.close(); }
});

// ---------------------------------------------------------------------------
// Every way "free" could have become "unlimited".
// ---------------------------------------------------------------------------

test("a correction whose origin call was never spent is refused", async () => {
  // Otherwise the cheap class would be a free FIRST turn, and the ceiling would
  // never be reached at all.
  const w = world({ spendOrigin: false });
  try {
    await assert.rejects(() => launch(w), /origin reservation is unknown or was never spent/);
    assert.equal(existsSync(w.sideEffect), false, "no child may exist after a refusal");
    assert.equal(w.records.length, 0);
  } finally { w.close(); }
});

test("round 0 may not arrive wearing the cheap class", async () => {
  const w = world();
  try {
    await assert.rejects(() => launch(w, { correctionRound: 0 }), /round 0 is the phase's first turn/);
    assert.equal(existsSync(w.sideEffect), false);
  } finally { w.close(); }
});

test("with no verifier installed there are no corrections at all", async () => {
  // The same rule the agent-phase class already holds: a capability nobody
  // installed is a capability nobody has, and a free provider launch is the last
  // one that should be available by default.
  const w = world({ installVerifier: false });
  try {
    await assert.rejects(() => launch(w), /trusted correction verifier is not installed/);
    assert.equal(existsSync(w.sideEffect), false);
  } finally { w.close(); }
});

test("a spent allowance refuses the next round, and there is no unbounded loop", async () => {
  const w = world({ allowance: { used: { auto: 2 }, allowance: { auto: 1, owner: 1 } } as CorrectionAllowanceState });
  try {
    await assert.rejects(() => launch(w), /auto correction allowance is spent/);
    assert.equal(existsSync(w.sideEffect), false);
  } finally { w.close(); }
});

test("a tranche configured to zero can never be drawn", async () => {
  const w = world({ allowance: { used: { auto: 0, owner: 0 }, allowance: { auto: 0, owner: 0 } } });
  try {
    await assert.rejects(() => launch(w), /auto correction allowance is spent \(0\/0\)/);
  } finally { w.close(); }
});

test("a round beyond the total configured allowance is refused even inside a tranche", async () => {
  const w = world({ allowance: { used: { auto: 1, owner: 0 }, allowance: { auto: 1, owner: 1 } } });
  try {
    await assert.rejects(() => launch(w, { correctionRound: 3 }), /exceeds the configured allowance of 2/);
  } finally { w.close(); }
});

// ---------------------------------------------------------------------------
// Every way continuity could have been faked.
// ---------------------------------------------------------------------------

test("a correction with no open conversation is refused", async () => {
  const w = world({ conversation: null });
  try {
    await assert.rejects(() => launch(w), /no conversation is open for this phase/);
    assert.equal(existsSync(w.sideEffect), false);
  } finally { w.close(); }
});

test("a conversation the phase did not open cannot be named", async () => {
  const w = world();
  try {
    await assert.rejects(() => launch(w, { continuityHandle: "continuity:reviewer" }), /a conversation this phase did not open/);
  } finally { w.close(); }
});

test("a route whose adapter does not report same-session correction is refused", async () => {
  // The config may say `same-session` all it likes. This is the adapter's own
  // answer, and it is the one that decides.
  const w = world({ conversation: { verifiedContinuity: "none" } });
  try {
    await assert.rejects(() => launch(w), /does not report same-session correction/);
  } finally { w.close(); }
});

test("a conversation with no completed turn has nothing to correct", async () => {
  const w = world({ conversation: { turns: 0 } });
  try {
    await assert.rejects(() => launch(w), /no completed turn to correct/);
  } finally { w.close(); }
});

test("a conversation opened on another adapter or role cannot be re-entered here", async () => {
  for (const conversation of [{ adapterId: "claude-config" }, { role: "reviewer" }]) {
    const w = world({ conversation });
    try {
      await assert.rejects(() => launch(w), /opened on a different adapter or role/);
    } finally { w.close(); }
  }
});

// ---------------------------------------------------------------------------
// Everything an ordinary phase launch already proves, still proved.
// ---------------------------------------------------------------------------

test("a correction outside durable RUNNING, or off the compiled workflow, is refused", async () => {
  const compiled = compileWorkflow(planBuildTestWorkflow, 1);
  const budget = new CallBudget({ taskId: "correction-negative", tier: 1 });
  const origin = budget.reserve({ cost: 1, subject: "builder first turn" });
  budget.spendOnGo(origin.id);
  const conversation: OpenConversation = {
    handle: HANDLE, adapterId: "stub-config", role: "builder", turns: 1,
    verifiedContinuity: "same-session-correction",
  };
  const build = (state: "RUNNING" | "GATING"): ReturnType<typeof createCorrectionLaunchVerifier> =>
    createCorrectionLaunchVerifier({
      statusFor: (taskSessionId) => ({ taskSessionId, lifecycleState: state, workflowId: compiled.id }),
      compiledWorkflowFor: () => compiled,
      configuredRouteFor: () => ({ adapterId: "stub-config", role: "builder", launchAuthorization: "agent-phase" }),
      conversationFor: () => conversation,
      correctionStateFor: () => ({ used: { auto: 1, owner: 0 }, allowance: { auto: 1, owner: 1 } }),
    });

  // A correction is a launch inside the durable RUNNING sojourn, so it inherits
  // the compiled-phase proof wholesale rather than a weakened copy of it.
  assert.throws(() => build("GATING").verify(registration(origin)), /is GATING, not RUNNING/);
  assert.throws(() => build("RUNNING").verify(registration(origin, { phaseOrdinal: 2 })), /do not identify a compiled phase/);
  assert.throws(() => build("RUNNING").verify(registration(origin, { phaseId: "planner" })), /do not identify a compiled phase/);
  assert.throws(() => build("RUNNING").verify(registration(origin, { workflowId: "build" })), /does not match/);

  const evidence = build("RUNNING").verify(registration(origin));
  assert.equal(evidence.launchAuthorization, "phase-correction");
  assert.equal(evidence.verifiedContinuity, "same-session-correction");
  assert.equal(evidence.correctionRound, 1);
  assert.equal(evidence.tranche, "auto");
  assert.equal(evidence.continuityHandle, HANDLE);
  // The evidence carries the handle and never the provider locator: the
  // verifier decides whether a correction may launch and has no business
  // knowing how to reach the provider.
  assert.equal(JSON.stringify(evidence).includes("session-id"), false);
});
