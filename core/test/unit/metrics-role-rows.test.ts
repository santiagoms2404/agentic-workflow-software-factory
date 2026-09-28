import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/observability/sqlite.ts";
import type { AttributionRun, RunPhase } from "../../src/metrics/attribution.ts";
import {
  blockedHere,
  claims,
  failedHere,
  guardrailHits,
  honestStops,
  isCleanCompletion,
  isCorrected,
  isFirstPass,
  isGuardrailHit,
  isRecovered,
  isSettled,
  phaseRan,
  readRoleRows,
  refutedClaims,
  stateGroup,
  type EnvelopeFact,
  type GateFact,
  type OutcomePhase,
  type RoleRow,
} from "../../src/metrics/role-rows.ts";
import type { GateId } from "../../src/gates/interface.ts";
import { AT, OPUS_HIGH, SyntheticAttempt, phase, route, session, usage } from "./_metrics-journal.ts";

function outcome(phaseId: string, status: string, correctionCount = 0, errorCode: string | null = null, maxCorrections = 1): OutcomePhase {
  return { phaseId, status, correctionCount, maxCorrections, errorCode };
}

function gate(phaseId: string, round: number, gateId: string, passed: boolean): GateFact {
  return { phaseId, round, gateId, passed };
}

function envelope(phaseId: string, round: number, producerStatus: EnvelopeFact["producerStatus"]): EnvelopeFact {
  return { phaseId, round, producerStatus };
}

function runPhase(key: string, ordinal: number, kind: string, owner: string, status: string, errorCode: string | null = null): RunPhase {
  return { key, ordinal, kind, owner, status, errorCode };
}

// ---------------------------------------------------------------------------
// One test per definition, each on its own fixture.
// ---------------------------------------------------------------------------

test("state group: PUBLISHED is landed, owner-held and terminal states keep their names, the rest are in flight", () => {
  assert.equal(stateGroup("LANDED"), "LANDED");
  assert.equal(stateGroup("PUBLISHED"), "LANDED");
  assert.equal(stateGroup("AWAITING_OWNER"), "AWAITING_OWNER");
  assert.equal(stateGroup("CANCELLED"), "CANCELLED");
  assert.equal(stateGroup("BLOCKED"), "BLOCKED");
  for (const open of ["DRAFT", "PREPARED", "RUNNING", "GATING", "REVIEWING", "LANDING"]) assert.equal(stateGroup(open), "OPEN", open);
});

test("a row holds the phases the run reached: never queued, skipped, or cancelled before starting", () => {
  assert.equal(phaseRan({ status: "QUEUED", startedAt: null }), false);
  assert.equal(phaseRan({ status: "SKIPPED", startedAt: null }), false);
  assert.equal(phaseRan({ status: "CANCELLED", startedAt: null }), false);
  assert.equal(phaseRan({ status: "CANCELLED", startedAt: AT }), true);
  // A launch that failed before the phase recorded RUNNING still ran, and still answers for its block.
  assert.equal(phaseRan({ status: "FAILED", startedAt: null }), true);
  assert.equal(phaseRan({ status: "RUNNING", startedAt: AT }), true);
});

test("settled: every phase of the role is terminal and the run is not in flight", () => {
  const done = [outcome("a", "SUCCEEDED"), outcome("b", "FAILED", 0, "PhaseGateFailure")];
  assert.equal(isSettled(done, "BLOCKED"), true);
  assert.equal(isSettled(done, "AWAITING_OWNER"), true);
  assert.equal(isSettled(done, "OPEN"), false, "a run in flight settles nothing, even with every phase over");
  assert.equal(isSettled([outcome("a", "SUCCEEDED"), outcome("b", "VALIDATING")], "BLOCKED"), false);
  assert.equal(isSettled([], "LANDED"), false);
});

test("first pass: settled, every phase SUCCEEDED, each with correction_count 0", () => {
  assert.equal(isFirstPass([outcome("a", "SUCCEEDED"), outcome("b", "SUCCEEDED")], "LANDED"), true);
  assert.equal(isFirstPass([outcome("a", "SUCCEEDED"), outcome("b", "SUCCEEDED", 1)], "LANDED"), false);
  assert.equal(isFirstPass([outcome("a", "SUCCEEDED"), outcome("b", "FAILED")], "BLOCKED"), false);
  assert.equal(isFirstPass([outcome("a", "SUCCEEDED")], "OPEN"), false);
});

test("guardrail hit: a failed path gate on the role's phases, or a PermissionBreach, counted once per phase", () => {
  const writes = outcome("writes", "SUCCEEDED", 1);
  const protectedPaths = outcome("protected", "SUCCEEDED", 1);
  const breach = outcome("breach", "FAILED", 0, "PermissionBreach");
  const claimOnly = outcome("claims", "SUCCEEDED", 1);
  const gates = [
    gate("writes", 0, "writes_within_globs", false),
    gate("protected", 0, "no_protected_paths", false),
    // The breach's own path gate failed too; it is still one hit.
    gate("breach", 0, "writes_within_globs", false),
    gate("claims", 0, "diff_matches_claims", false),
    gate("claims", 1, "writes_within_globs", true),
    gate("elsewhere", 0, "no_protected_paths", false),
  ];
  assert.equal(isGuardrailHit(writes, gates), true);
  assert.equal(isGuardrailHit(protectedPaths, gates), true);
  assert.equal(isGuardrailHit(breach, []), true, "the error code alone is a hit");
  assert.equal(isGuardrailHit(claimOnly, gates), false, "a claim gate is not a guardrail");
  assert.equal(guardrailHits([writes, protectedPaths, breach, claimOnly], gates), 3);
});

test("clean completion: first pass with zero guardrail hits", () => {
  const phases = [outcome("a", "SUCCEEDED"), outcome("b", "SUCCEEDED")];
  assert.equal(isCleanCompletion(phases, [gate("a", 0, "writes_within_globs", true)], "LANDED"), true);
  // A guardrail gate that failed and was still let through is a hit, so this first pass is not clean.
  assert.equal(isCleanCompletion(phases, [gate("b", 0, "no_protected_paths", false)], "LANDED"), false);
  assert.equal(isCleanCompletion([outcome("a", "SUCCEEDED", 1)], [], "LANDED"), false);
});

test("claim: an envelope round with a producer status", () => {
  assert.equal(claims([
    envelope("a", 0, "success"),
    envelope("a", 1, "failure"),
    envelope("b", 0, null),
  ]), 2);
  assert.equal(claims([]), 0);
});

test("refuted claim: success on a round whose diff_matches_claims failed, beside an honest stop that is not one", () => {
  const envelopes = [
    envelope("build", 0, "success"),
    envelope("build", 1, "success"),
    envelope("stop", 0, "failure"),
  ];
  const gates = [
    gate("build", 0, "diff_matches_claims", false),
    gate("build", 1, "diff_matches_claims", true),
    gate("stop", 0, "diff_matches_claims", false),
  ];
  assert.equal(refutedClaims(envelopes, gates), 1);
  assert.equal(honestStops(envelopes), 1);
  assert.equal(claims(envelopes), 3);
});

test("refuted claim: contract and guardrail gates never refute, and a failure on another round or phase does not either", () => {
  const envelopes = [envelope("a", 0, "success"), envelope("b", 0, "success")];
  const notClaims: GateId[] = ["envelope_valid", "json_parses", "writes_within_globs", "no_protected_paths"];
  assert.equal(refutedClaims(envelopes, notClaims.map((id) => gate("a", 0, id, false))), 0);
  assert.equal(refutedClaims(envelopes, [gate("a", 1, "commands_pass", false), gate("c", 0, "head_advanced", false)]), 0);
  assert.equal(refutedClaims(envelopes, [gate("b", 0, "verdict_consistent", false)]), 1);
});

test("honest stop: producer_status failure, and only that", () => {
  assert.equal(honestStops([envelope("a", 0, "failure"), envelope("a", 1, "success"), envelope("b", 0, null)]), 1);
});

test("recovered: round-0 gates failed and the final round passed within max_corrections", () => {
  const gates = [
    gate("fixed", 0, "diff_matches_claims", false),
    gate("fixed", 1, "diff_matches_claims", true),
    gate("fixed", 1, "envelope_valid", true),
    gate("clean", 0, "diff_matches_claims", true),
    gate("stuck", 0, "diff_matches_claims", false),
    gate("stuck", 1, "diff_matches_claims", false),
    gate("over", 0, "envelope_valid", false),
    gate("over", 2, "envelope_valid", true),
  ];
  assert.equal(isRecovered(outcome("fixed", "SUCCEEDED", 1), gates), true);
  assert.equal(isRecovered(outcome("clean", "SUCCEEDED"), gates), false, "nothing failed, so nothing was recovered");
  assert.equal(isRecovered(outcome("stuck", "FAILED", 1, "PhaseGateFailure"), gates), false);
  assert.equal(isRecovered(outcome("over", "SUCCEEDED", 2, null, 1), gates), false, "beyond max_corrections");
});

test("corrected: correction_count above 0", () => {
  assert.equal(isCorrected(outcome("a", "SUCCEEDED", 1)), true);
  assert.equal(isCorrected(outcome("a", "FAILED", 2)), true);
  assert.equal(isCorrected(outcome("a", "SUCCEEDED")), false);
});

test("failed here: the run is BLOCKED in one of this role's phases, and a host gate's block lands on the agent it judged", () => {
  const inReview: AttributionRun = {
    lifecycleState: "BLOCKED",
    phases: [runPhase("builder", 1, "agent", "builder", "SUCCEEDED"), runPhase("reviewer", 2, "agent", "reviewer", "FAILED", "PermissionBreach")],
    transitions: [],
  };
  assert.equal(failedHere(inReview, "reviewer"), true);
  assert.equal(failedHere(inReview, "builder"), false);

  const inTests: AttributionRun = {
    lifecycleState: "BLOCKED",
    phases: [runPhase("t01-build", 1, "agent", "builder", "SUCCEEDED"), runPhase("t01-tests", 2, "code", "host", "FAILED", "CommandPhaseFailure")],
    transitions: [],
  };
  assert.equal(failedHere(inTests, "builder"), true);
  assert.equal(failedHere(inTests, "host"), false);

  assert.equal(failedHere({ ...inReview, lifecycleState: "AWAITING_OWNER" }, "reviewer"), false);
});

test("blocked here: failed here, and only when the effective attribution is model", () => {
  assert.equal(blockedHere(true, "model"), true);
  for (const attribution of ["factory", "environment", "owner", "unknown", null] as const) {
    assert.equal(blockedHere(true, attribution), false, String(attribution));
  }
  assert.equal(blockedHere(false, "model"), false);
});

// ---------------------------------------------------------------------------
// Rows read from a projected synthetic journal.
// ---------------------------------------------------------------------------

function rowsOf(...runs: SyntheticAttempt[]): RoleRow[] {
  const db = openDatabase(":memory:");
  try {
    for (const run of runs) run.project(db);
    return readRoleRows(db);
  } finally {
    db.close();
  }
}

const CODEX = ["codex", "openai-codex", "codex:gpt-6-sol"] as const;

test("roles never mix: a planner's corrections, gates and claims stay in the planner's row", () => {
  const run = new SyntheticAttempt({ ...session("s1"), workflowId: "simple-sdlc", planRef: "awsf-v2-w18-route-metrics" });
  run.phase(phase("planner", "planner", { ordinal: 1, maxCorrections: 1 }));
  run.start("phase-planner", "planner", ...CODEX);
  run.event("phase-planner", "run-1", { kind: "usage", usage: usage(300, 30, 0, 0, null) });
  run.envelope("phase-planner", "planner", 0, null);
  run.gate("phase-planner", 0, "envelope_valid", false);
  run.envelope("phase-planner", "planner", 1, "success");
  run.gate("phase-planner", 1, "envelope_valid", true);
  run.phase(phase("planner", "planner", { ordinal: 1, status: "SUCCEEDED", correctionCount: 1, endedAt: "2026-09-26T10:03:00.000Z" }));
  run.phase(phase("builder", "builder", { ordinal: 2 }));
  run.start("phase-builder", "builder", ...CODEX);
  run.event("phase-builder", "run-2", { kind: "run.started", adapter: "pi-codex", requestedModel: "gpt-6-sol" });
  run.event("phase-builder", "run-2", {
    kind: "model.resolved", adapter: "pi-codex", provider: "openai-codex", requestedModel: "gpt-6-sol",
    resolvedModel: "gpt-6-sol-2026-09-01", provenance: "stream-authoritative",
  });
  run.event("phase-builder", "run-2", { kind: "usage", usage: usage(1000, 100, 4000, 0, 20) });
  run.call("phase-builder", "builder", ...CODEX, "gpt-6-sol", usage(1000, 100, 4000, 0, 20));
  run.envelope("phase-builder", "builder", 0, "success");
  run.gate("phase-builder", 0, "diff_matches_claims", true);
  run.gate("phase-builder", 0, "writes_within_globs", true);
  run.phase(phase("builder", "builder", { ordinal: 2, status: "SUCCEEDED", endedAt: "2026-09-26T10:10:00.000Z" }));
  run.phase(phase("reviewer", "reviewer", { ordinal: 3 }));
  run.start("phase-reviewer", "reviewer", "claude", "anthropic", "claude:opus", { ...OPUS_HIGH, phaseId: "reviewer" });
  run.envelope("phase-reviewer", "reviewer", 0, "success");
  run.review("phase-reviewer", "accept");
  run.phase(phase("reviewer", "reviewer", { ordinal: 3, status: "SUCCEEDED", endedAt: "2026-09-26T10:12:00.000Z" }));
  run.transition("AWAITING_OWNER");
  run.transition("LANDING");
  run.transition("LANDED");

  const rows = rowsOf(run);
  assert.deepEqual(rows.map((row) => row.role), ["planner", "builder", "reviewer"]);
  const [planner, builder, reviewer] = rows;

  assert.equal(planner!.corrections, 1);
  assert.equal(planner!.corrected, 1);
  assert.equal(planner!.recovered, 1);
  assert.equal(planner!.firstPass, false);
  assert.deepEqual(planner!.gates, { pass: 1, total: 2, firstRoundFail: ["envelope_valid"] });
  assert.equal(planner!.claims, 1);
  assert.equal(planner!.tokens.inputTokens, 300);

  assert.equal(builder!.corrections, 0);
  assert.equal(builder!.corrected, 0);
  assert.equal(builder!.recovered, 0);
  assert.equal(builder!.firstPass, true);
  assert.equal(builder!.cleanCompletion, true);
  assert.deepEqual(builder!.gates, { pass: 2, total: 2, firstRoundFail: [] });
  assert.equal(builder!.claims, 1);
  assert.equal(builder!.tokens.inputTokens, 1000);
  assert.equal(builder!.tokens.cacheReadTokens, 4000);
  assert.equal(builder!.calls, 1);
  assert.equal(builder!.minutes, 10);
  assert.deepEqual(builder!.route, { adapter: "codex", provider: "openai-codex", model: "codex:gpt-6-sol", effort: "xhigh" });
  assert.equal(builder!.effortSource, "config-agent");
  assert.equal(builder!.identityProvenance, "stream-authoritative");

  assert.deepEqual(reviewer!.route, { adapter: "claude", provider: "anthropic", model: "opus", effort: "high" });
  assert.equal(reviewer!.effortSource, "journal");
  assert.equal(reviewer!.identityProvenance, null, "no call was observed, so no identity is claimed");

  for (const row of rows) {
    assert.equal(row.stateGroup, "LANDED");
    assert.equal(row.settled, true);
    assert.equal(row.failedHere, false);
    assert.equal(row.blockedHere, false);
    assert.equal(row.workflow, "simple-sdlc");
    assert.equal(row.tier, 2);
    assert.equal(row.project, "awsf");
    assert.equal(row.planRef, "awsf-v2-w18-route-metrics");
    assert.equal(row.reviewVerdict, "accept");
    assert.equal(row.startedAt, AT);
  }
});

/** A shift whose second ticket's candidate fails the host tests phase. */
function blockedShift(): SyntheticAttempt {
  const run = new SyntheticAttempt(session("s2"));
  let ordinal = 0;
  for (const ticket of ["t01", "t02"]) {
    run.phase(phase(`${ticket}-brief`, "host", { ordinal: ++ordinal, kind: "engineer", status: "SUCCEEDED", endedAt: AT }));
    const build = `phase-${ticket}-build`;
    const buildOrdinal = ++ordinal;
    run.phase(phase(`${ticket}-build`, "builder", { ordinal: buildOrdinal }));
    run.start(build, "builder", ...CODEX);
    run.event(build, `run-${ticket}`, { kind: "usage", usage: usage(500, 50, 2000, 0, 10) });
    run.call(build, "builder", ...CODEX, "gpt-6-sol", usage(500, 50, 2000, 0, 10));
    run.envelope(build, "builder", 0, "success");
    run.gate(build, 0, "diff_matches_claims", ticket === "t01");
    run.phase(phase(`${ticket}-build`, "builder", { ordinal: buildOrdinal, status: "SUCCEEDED", endedAt: "2026-09-26T10:05:00.000Z" }));
    const passed = ticket === "t01";
    run.phase(phase(`${ticket}-tests`, "host", {
      ordinal: ++ordinal, kind: "code", status: passed ? "SUCCEEDED" : "FAILED", endedAt: AT,
      errorCode: passed ? null : "CommandPhaseFailure",
    }));
  }
  run.phase(phase("shift-review", "reviewer", { ordinal: ++ordinal, status: "QUEUED", startedAt: null }));
  run.transition("BLOCKED", "phase-abort");
  return run;
}

test("a blocked shift: the builder's row sums both tickets, carries the model block, and the queued reviewer has no row", () => {
  const rows = rowsOf(blockedShift());
  assert.deepEqual(rows.map((row) => row.role), ["builder"]);
  const [builder] = rows;
  assert.equal(builder!.phases, 2);
  assert.equal(builder!.calls, 2);
  assert.equal(builder!.tokens.inputTokens, 1000);
  assert.equal(builder!.minutes, 10);
  assert.equal(builder!.stateGroup, "BLOCKED");
  assert.equal(builder!.settled, true);
  assert.equal(builder!.failedHere, true);
  assert.equal(builder!.blockedHere, true, "CommandPhaseFailure after a build is the model's");
  assert.equal(builder!.claims, 2);
  assert.equal(builder!.refuted, 1, "t02 said success while its diff_matches_claims failed");
  assert.deepEqual(builder!.gates, { pass: 1, total: 2, firstRoundFail: ["diff_matches_claims"] });
  assert.equal(builder!.reworkPhases, 0);
  assert.equal(builder!.usageAuthority, "provider");
});

test("a row carries the model observed answering only when every phase that observed one agrees", () => {
  const observedBy = (models: readonly string[]) => {
    const run = new SyntheticAttempt(session(`s-${models.join("-")}`));
    models.forEach((model, index) => {
      const key = `t0${index + 1}-build`;
      run.phase(phase(key, "builder", { ordinal: index + 1 }));
      run.start(`phase-${key}`, "builder", "claude", "anthropic", "claude:opus", route(
        key, { adapterId: "claude", adapterKind: "claude-code", provider: "anthropic", model: "opus", effort: "high" },
        "attempt-override", "claude:opus",
      ));
      run.call(`phase-${key}`, "builder", "claude", "anthropic", "claude:opus", model, usage(1, 1, 0, 0, null));
      run.phase(phase(key, "builder", { ordinal: index + 1, status: "SUCCEEDED", endedAt: AT }));
    });
    run.transition("AWAITING_OWNER");
    return rowsOf(run)[0]!.resolvedModel;
  };
  assert.equal(observedBy(["claude-opus-5-5", "claude-opus-5-5"]), "claude-opus-5-5");
  assert.equal(observedBy(["claude-opus-5-5", "claude-opus-5"]), null);
});

test("a block the heuristic gives to the environment fails here but is not blocked here", () => {
  const run = new SyntheticAttempt(session("s3"));
  run.phase(phase("t01-build", "builder", { ordinal: 1, status: "FAILED", errorCode: "ExecutableNotFound", endedAt: AT }));
  run.transition("BLOCKED", "phase-abort");
  const [builder] = rowsOf(run);
  assert.equal(builder!.failedHere, true);
  assert.equal(builder!.blockedHere, false);
  assert.equal(builder!.calls, 0);
  assert.equal(builder!.costAuthority, "unavailable");
  assert.equal(builder!.resolvedModel, null, "no call observed a model");
  assert.equal(builder!.usageAuthority, "none");
});

test("a role whose phases ran on two routes is marked mixed, with no route to rank under", () => {
  const run = new SyntheticAttempt(session("s4"));
  run.phase(phase("t01-build", "builder", { ordinal: 1, status: "SUCCEEDED", endedAt: AT }));
  run.phase(phase("t02-build", "builder", { ordinal: 2 }));
  run.start("phase-t02-build", "builder", "claude", "anthropic", "claude:opus", route(
    "t02-build",
    { adapterId: "claude", adapterKind: "claude-code", provider: "anthropic", model: "opus", effort: "xhigh" },
    "attempt-override",
    "claude:opus",
  ));
  run.phase(phase("t02-build", "builder", { ordinal: 2, status: "SUCCEEDED", endedAt: AT }));
  run.transition("AWAITING_OWNER");
  const [builder] = rowsOf(run);
  assert.equal(builder!.routeMixed, true);
  assert.deepEqual(builder!.route, { adapter: null, provider: null, model: null, effort: null });
  assert.equal(builder!.effortSource, null);
  assert.equal(builder!.settled, true);
  assert.equal(builder!.firstPass, true);
});

test("owner rework phases are counted on the run and belong to the builder's row", () => {
  const run = new SyntheticAttempt(session("s5"));
  run.phase(phase("builder", "builder", { ordinal: 1, status: "SUCCEEDED", endedAt: AT }));
  run.ownerReentries = 1;
  run.phase(phase("owner-rework-1", "builder", { ordinal: 2, maxCorrections: 0, status: "SUCCEEDED", endedAt: AT }));
  run.phase(phase("owner-rework-1-tests", "host", { ordinal: 3, kind: "code", status: "SUCCEEDED", endedAt: AT }));
  run.transition("AWAITING_OWNER");
  const [builder] = rowsOf(run);
  assert.equal(builder!.phases, 2);
  assert.equal(builder!.reworkPhases, 1);
  assert.equal(builder!.ownerReentries, 1);
});

test("an open run's rows are not settled, so they are neither first pass nor clean", () => {
  const run = new SyntheticAttempt(session("s6"));
  run.phase(phase("t01-build", "builder", { ordinal: 1, status: "SUCCEEDED", endedAt: AT }));
  run.phase(phase("t02-build", "builder", { ordinal: 2 }));
  const [builder] = rowsOf(run);
  assert.equal(builder!.stateGroup, "OPEN");
  assert.equal(builder!.settled, false);
  assert.equal(builder!.firstPass, false);
  assert.equal(builder!.cleanCompletion, false);
  assert.equal(builder!.minutes, 0, "the finished phase's minutes; the open one has none");
});
