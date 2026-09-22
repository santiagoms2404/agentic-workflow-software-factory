import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { argvDigest, gateConfigDigest, gatesConfigDigest, COMMAND_LEDGER_PROTOCOL_VERSION,
  type CommandDispatchIntent, type CommandDispatchResult,
  type CommandOccurrenceClosed } from "../../../src/contracts/command-ledger.ts";
import { planAdoptedMeasurement, planCommandRecovery,
  type CommandExpectation, type CommandLedgerSnapshot } from "../../../src/workflow/command-ledger.ts";

const SHA = "a".repeat(40);
const OTHER_SHA = "d".repeat(40);
const OUTPUT = "all 12 checks passed\n";
const DIGEST = createHash("sha256").update(OUTPUT).digest("hex");
const GATES = { lint: { argv: ["npm", "run", "lint"], timeout_seconds: 60 } } as const;
const ARGV = GATES.lint.argv;

function intentFor(overrides: Partial<CommandDispatchIntent> = {}): CommandDispatchIntent {
  return {
    schema: "awsf.command-dispatch-intent/v1",
    intentId: "intent-1", dispatcherId: "production-run/measure-candidate",
    occurrenceKey: `builder:${SHA}:0`, gateId: "lint", origin: "verify-candidate",
    phaseKey: "builder", phaseOrdinal: 2, round: 0, attempt: 1, sessionId: "session-1",
    argv: [...ARGV], argvDigest: argvDigest(ARGV),
    cwd: "/w", worktreeRealPath: "/w",
    timeoutMs: 60_000, maxOutputBytes: 1_048_576,
    gateConfigDigest: gateConfigDigest(GATES.lint), gatesConfigDigest: gatesConfigDigest(GATES),
    candidateSha: SHA, headBefore: SHA, cleanBefore: true,
    dispatchedAt: "2026-09-22T00:00:01.000Z",
    ...overrides,
  };
}

function resultFor(overrides: Partial<CommandDispatchResult> = {}): CommandDispatchResult {
  return {
    schema: "awsf.command-dispatch-result/v1",
    intentId: "intent-1", outcome: "exited", exitCode: 0, durationMs: 1_200,
    outputRef: "raw/command-builder-lint-0.txt", outputBytes: OUTPUT.length, outputDigest: DIGEST,
    headAfter: SHA, cleanAfter: true, descendantQuiescence: "unproved",
    settledAt: "2026-09-22T00:00:02.000Z",
    ...overrides,
  };
}

function snapshotFor(overrides: Partial<CommandLedgerSnapshot> = {}): CommandLedgerSnapshot {
  const intents = overrides.intents ?? [intentFor()];
  const results = overrides.results ?? [resultFor()];
  return {
    intents,
    results,
    openings: [{
      schema: "awsf.command-occurrence-opened/v1", dispatcherId: "production-run/measure-candidate",
      occurrenceKey: `builder:${SHA}:0`, protocolVersion: COMMAND_LEDGER_PROTOCOL_VERSION,
      openedAt: "2026-09-22T00:00:00.500Z",
    }],
    closures: [],
    dispatchPoints: [{ dispatcherId: "production-run/measure-candidate", occurrenceKey: `builder:${SHA}:0` }],
    retained: results.map(result => ({ intentId: result.intentId, bytes: result.outputBytes, digest: result.outputDigest })),
    ...overrides,
  };
}

const expectation: CommandExpectation = {
  dispatcherId: "production-run/measure-candidate", occurrenceKey: `builder:${SHA}:0`,
  gateId: "lint", gateIds: ["lint"],
  argvDigest: argvDigest(ARGV), gateConfigDigest: gateConfigDigest(GATES.lint),
  gatesConfigDigest: gatesConfigDigest(GATES),
  cwd: "/w", worktreeRealPath: "/w", timeoutMs: 60_000, maxOutputBytes: 1_048_576,
  candidateSha: SHA, attempt: 1, sessionId: "session-1",
};

// --- the three primary cuts -------------------------------------------------

test("a complete, verified occurrence restores rather than running the command again", () => {
  const planned = planCommandRecovery(snapshotFor(), expectation);
  assert.equal(planned.action, "restore");
});

test("an intent with no result refuses by name and never re-dispatches", () => {
  const planned = planCommandRecovery(snapshotFor({ results: [], retained: [] }), expectation);
  assert.equal(planned.action, "refuse");
  assert.match(planned.action === "refuse" ? planned.reason : "", /not proof that it did not run/u);
});

test("an intent with no result refuses even where the occurrence is not a dispatch point", () => {
  // The whole-journal governance predicate catches this case first when the
  // hygiene record is present. This exercises the per-key branch directly, so
  // the narrower rule is covered rather than shadowed.
  const planned = planCommandRecovery(
    snapshotFor({ results: [], retained: [], dispatchPoints: [] }), expectation);
  assert.equal(planned.action, "refuse");
  assert.match(planned.action === "refuse" ? planned.reason : "", /not proof that it did not run/u);
});

test("a governed occurrence with no intent dispatches exactly once", () => {
  const planned = planCommandRecovery(
    snapshotFor({ intents: [], results: [], retained: [], dispatchPoints: [] }), expectation);
  assert.equal(planned.action, "dispatch");
});

// --- governance: the predicate the first two designs got wrong ---------------

test("a legacy occurrence that dispatched before the ledger existed refuses", () => {
  // Its hygiene record is in the snapshot because an EARLIER run wrote it, and
  // that run left no opening. The current run has not yet written its own
  // hygiene record, which is why the two are distinguishable at all.
  const planned = planCommandRecovery(
    snapshotFor({ intents: [], results: [], retained: [], openings: [] }), expectation);
  assert.equal(planned.action, "refuse");
  assert.match(planned.action === "refuse" ? planned.reason : "", /does not record dispatches/u);
});

test("a legacy occurrence elsewhere in the attempt does not poison this one", () => {
  // Governance is scoped to the occurrence being decided. One ungoverned phase
  // must not make every later phase in the attempt unrecoverable.
  const planned = planCommandRecovery(snapshotFor({
    dispatchPoints: [
      { dispatcherId: "production-run/measure-candidate", occurrenceKey: `builder:${SHA}:0` },
      { dispatcherId: "production-run/measure-candidate", occurrenceKey: `legacy:${OTHER_SHA}:0` },
    ],
  }), expectation);
  assert.equal(planned.action, "restore");
});

test("a fresh occurrence with no prior dispatch point dispatches", () => {
  const planned = planCommandRecovery(
    snapshotFor({ intents: [], results: [], retained: [], openings: [], dispatchPoints: [] }),
    expectation);
  assert.equal(planned.action, "dispatch");
});

test("an ungoverned run that dispatched and crashed mid-loop is caught by its hygiene record", () => {
  // The decisive case. A pre-ledger binary persists candidate_hygiene, dispatches,
  // and dies inside spawnSync — so it writes no commands_pass aggregate and no
  // ledger evidence, and leaves an untorn journal. Keying the predicate on the
  // post-loop aggregate would find nothing to quantify over and conclude the
  // commands never ran.
  const planned = planCommandRecovery(
    snapshotFor({ intents: [], results: [], retained: [], openings: [] }), expectation);
  assert.equal(planned.action, "refuse");
  assert.match(planned.action === "refuse" ? planned.reason : "", /may have run outside the ledger/u);
});

test("a governed run that died before writing its first intent still dispatches", () => {
  // Same zero intents as the ungoverned case above. Only the opening marker
  // tells them apart, which is exactly why the marker exists.
  const planned = planCommandRecovery(snapshotFor({ intents: [], results: [], retained: [] }), expectation);
  assert.equal(planned.action, "dispatch");
});

test("a failing hygiene dispatches nothing, so its occurrence is not a dispatch point and does not refuse", () => {
  // Only PASSING hygiene records become dispatch points. A failed one returns
  // before any command runs, so holding no ledger evidence is correct.
  const planned = planCommandRecovery(
    snapshotFor({ intents: [], results: [], retained: [], dispatchPoints: [] }), expectation);
  assert.equal(planned.action, "dispatch");
});

test("an occurrence closed before dispatch does not poison every later decision in the attempt", () => {
  // The adopt structural-gate path reaches the dispatch point and dispatches
  // nothing, deterministically. Without the closure marker its silence reads as
  // an ungoverned dispatch and the whole attempt becomes unrecoverable.
  const closure: CommandOccurrenceClosed = {
    schema: "awsf.command-occurrence-closed/v1",
    dispatcherId: "adopt/adoption-tests", occurrenceKey: `session-1:adoption-tests:${SHA}`,
    reason: "structural gates failed before any configured command was dispatched",
    closedAt: "2026-09-22T00:00:03.000Z",
  };
  const planned = planCommandRecovery(snapshotFor({
    closures: [closure],
    dispatchPoints: [
      { dispatcherId: "production-run/measure-candidate", occurrenceKey: `builder:${SHA}:0` },
      { dispatcherId: "adopt/adoption-tests", occurrenceKey: `session-1:adoption-tests:${SHA}` },
    ],
  }), expectation);
  assert.equal(planned.action, "restore");
});

test("a closure never excuses an intent whose command settled unrecorded", () => {
  const planned = planCommandRecovery(snapshotFor({
    results: [], retained: [],
    closures: [{
      schema: "awsf.command-occurrence-closed/v1",
      dispatcherId: "production-run/measure-candidate", occurrenceKey: `builder:${SHA}:0`,
      reason: "a command dirtied the worktree", closedAt: "2026-09-22T00:00:03.000Z",
    }],
  }), expectation);
  assert.equal(planned.action, "refuse");
  assert.match(planned.action === "refuse" ? planned.reason : "", /not proof that it did not run/u);
});

test("a gate added since the crash refuses the measurement rather than restoring a stale one", () => {
  // The added gate itself has no intent and would dispatch, but every gate the
  // old occurrence DID measure now disagrees on gatesConfigDigest, so the
  // measurement as a whole cannot be rebuilt from it.
  const widened = { ...GATES, typecheck: { argv: ["npx", "tsc"], timeout_seconds: 60 } };
  const planned = planCommandRecovery(snapshotFor(), { ...expectation,
    gateIds: ["lint", "typecheck"], gatesConfigDigest: gatesConfigDigest(widened) });
  assert.equal(planned.action, "refuse");
  assert.match(planned.action === "refuse" ? planned.reason : "", /configured gate set changed/u);
});

// --- results that must never be restored ------------------------------------

test("a command that left the worktree dirty is never restored as a passing measurement", () => {
  const planned = planCommandRecovery(snapshotFor({ results: [resultFor({ cleanAfter: false })] }), expectation);
  assert.equal(planned.action, "refuse");
  assert.match(planned.action === "refuse" ? planned.reason : "", /left the worktree dirty/u);
});

test("a command that moved the candidate is never restored", () => {
  const planned = planCommandRecovery(snapshotFor({ results: [resultFor({ headAfter: OTHER_SHA })] }), expectation);
  assert.equal(planned.action, "refuse");
});

test("a command that never reported an exit status is never restored", () => {
  const planned = planCommandRecovery(snapshotFor({ results: [resultFor({ outcome: "no-exit", exitCode: -1 })] }), expectation);
  assert.equal(planned.action, "refuse");
  assert.match(planned.action === "refuse" ? planned.reason : "", /never reported an exit status/u);
});

test("a withheld result refuses for the credential reason, not for a missing one", () => {
  const planned = planCommandRecovery(snapshotFor({
    results: [resultFor({ outcome: "withheld", exitCode: 0, outputRef: null, outputBytes: null, outputDigest: null })],
    retained: [{ intentId: "intent-1", bytes: null, digest: null }],
  }), expectation);
  assert.equal(planned.action, "refuse");
  assert.match(planned.action === "refuse" ? planned.reason : "", /withheld by the credential check/u);
});

// --- torn and drifted evidence ----------------------------------------------

test("retained output that is missing, short or altered refuses", () => {
  for (const observation of [
    { intentId: "intent-1", bytes: null, digest: null },
    { intentId: "intent-1", bytes: OUTPUT.length - 1, digest: DIGEST },
    { intentId: "intent-1", bytes: OUTPUT.length, digest: "f".repeat(64) },
  ]) {
    const planned = planCommandRecovery(snapshotFor({ retained: [observation] }), expectation);
    assert.equal(planned.action, "refuse", JSON.stringify(observation));
  }
});

test("every bound identity field refuses on drift", () => {
  const drifts: Partial<CommandExpectation>[] = [
    { argvDigest: argvDigest(["npm", "run", "lint", "--fix"]) },
    { gateConfigDigest: gateConfigDigest({ argv: ARGV, timeout_seconds: 120 }) },
    { gatesConfigDigest: gatesConfigDigest({ ...GATES, typecheck: { argv: ["tsc"], timeout_seconds: 60 } }) },
    { cwd: "/elsewhere" }, { worktreeRealPath: "/elsewhere" },
    { timeoutMs: 120_000 }, { maxOutputBytes: 2_048 },
    { candidateSha: OTHER_SHA }, { attempt: 2 }, { sessionId: "session-2" },
  ];
  for (const drift of drifts) {
    const planned = planCommandRecovery(snapshotFor(), { ...expectation, ...drift });
    assert.equal(planned.action, "refuse", JSON.stringify(drift));
  }
});

test("two intents sharing one key, or two results citing one intent, refuse as corruption", () => {
  const doubled = planCommandRecovery(
    snapshotFor({ intents: [intentFor(), intentFor({ intentId: "intent-2" })] }), expectation);
  assert.equal(doubled.action, "refuse");
  const twoResults = planCommandRecovery(
    snapshotFor({ results: [resultFor(), resultFor()] }), expectation);
  assert.equal(twoResults.action, "refuse");
});

// --- adopted measurement ----------------------------------------------------

const adoptExpectation: Omit<CommandExpectation, "gateId" | "occurrenceKey"> = expectation;

test("a host command phase adopts the builder's completed measurement of the same candidate", () => {
  const planned = planAdoptedMeasurement(snapshotFor(), { ...adoptExpectation, gateIds: ["lint"] });
  assert.equal(planned.action, "adopt");
  assert.equal(planned.action === "adopt" ? planned.entries.length : 0, 1);
});

test("a second host command phase never adopts the first phase's own dispatch", () => {
  // The regression this scoping exists to prevent: two awsf.test-output phases
  // against one unchanged candidate. Without origin scoping the later phase
  // restores the earlier phase's measurement and runs nothing at all.
  const testsPhase = intentFor({
    intentId: "intent-tests", occurrenceKey: `tests:${SHA}:0`, origin: "phase-dispatch", phaseKey: "tests",
  });
  const planned = planAdoptedMeasurement(snapshotFor({
    intents: [testsPhase],
    results: [resultFor({ intentId: "intent-tests" })],
    openings: [{
      schema: "awsf.command-occurrence-opened/v1", dispatcherId: "production-run/measure-candidate",
      occurrenceKey: `tests:${SHA}:0`, protocolVersion: COMMAND_LEDGER_PROTOCOL_VERSION,
      openedAt: "2026-09-22T00:00:00.500Z",
    }],
    dispatchPoints: [{ dispatcherId: "production-run/measure-candidate", occurrenceKey: `tests:${SHA}:0` }],
  }), { ...adoptExpectation, gateIds: ["lint"] });
  assert.equal(planned.action, "dispatch");
});

test("an incomplete builder measurement refuses instead of being topped up", () => {
  const planned = planAdoptedMeasurement(snapshotFor({
    intents: [intentFor(), intentFor({ intentId: "intent-2", gateId: "typecheck" })],
    results: [resultFor()],
    retained: [{ intentId: "intent-1", bytes: OUTPUT.length, digest: DIGEST }],
    dispatchPoints: [],
  }), { ...adoptExpectation, gateIds: ["lint", "typecheck"] });
  assert.equal(planned.action, "refuse");
});

test("no builder measurement for this candidate dispatches rather than adopting an older one", () => {
  const planned = planAdoptedMeasurement(snapshotFor({
    intents: [intentFor({ candidateSha: OTHER_SHA, occurrenceKey: `builder:${OTHER_SHA}:0` })],
    results: [resultFor()],
    dispatchPoints: [],
  }), { ...adoptExpectation, gateIds: ["lint"] });
  assert.equal(planned.action, "dispatch");
});
