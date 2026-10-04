import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HEURISTIC_ATTRIBUTION_RULES,
  blockedAgentPhase,
  blockingPhase,
  effectiveAttribution,
  heuristicAttribution,
  type Attribution,
  type AttributionRun,
  type RunPhase,
} from "../../src/metrics/attribution.ts";

function phase(key: string, ordinal: number, kind: string, owner: string, status = "SUCCEEDED", errorCode: string | null = null): RunPhase {
  return { key, ordinal, kind, owner, status, errorCode };
}

function blocked(phases: readonly RunPhase[], reasonCode: string | null = "phase-abort"): AttributionRun {
  return {
    lifecycleState: "BLOCKED",
    phases,
    transitions: [{ seq: 1, toState: "RUNNING", reasonCode: null }, { seq: 2, toState: "BLOCKED", reasonCode }],
  };
}

/** A shift ticket: the host carries the brief, the builder builds, the host gates it. */
function shift(tests: RunPhase): RunPhase[] {
  return [phase("t01-brief", 1, "engineer", "host"), phase("t01-build", 2, "agent", "builder"), tests];
}

const FAILED = "FAILED";

interface Case {
  readonly name: string;
  readonly code: string;
  readonly run: AttributionRun;
  readonly expected: Attribution;
}

const CASES: readonly Case[] = [
  {
    name: "CommandPhaseFailure in the host tests phase after a build is the model's",
    code: "CommandPhaseFailure",
    run: blocked(shift(phase("t01-tests", 3, "code", "host", FAILED, "CommandPhaseFailure"))),
    expected: "model",
  },
  {
    name: "PhaseGateFailure is the model's",
    code: "PhaseGateFailure",
    run: blocked([phase("t01-build", 1, "agent", "builder", FAILED, "PhaseGateFailure")]),
    expected: "model",
  },
  {
    name: "EnvelopeValidationFailure is the model's",
    code: "EnvelopeValidationFailure",
    run: blocked([phase("planner", 1, "agent", "planner", FAILED, "EnvelopeValidationFailure")]),
    expected: "model",
  },
  {
    name: "ReplacementReviewInconsistent is the model's",
    code: "ReplacementReviewInconsistent",
    run: blocked([phase("builder", 1, "agent", "builder"), phase("reviewer", 2, "agent", "reviewer", FAILED, "ReplacementReviewInconsistent")], "review-inconsistent"),
    expected: "model",
  },
  {
    name: "ReplacementReviewMalformed is the model's",
    code: "ReplacementReviewMalformed",
    run: blocked([phase("builder", 1, "agent", "builder"), phase("reviewer", 2, "agent", "reviewer", FAILED, "ReplacementReviewMalformed")], "review-malformed"),
    expected: "model",
  },
  {
    name: "PermissionBreach is the model's",
    code: "PermissionBreach",
    run: blocked([phase("t01-build", 1, "agent", "builder", FAILED, "PermissionBreach")], "permission-breach"),
    expected: "model",
  },
  {
    name: "AdapterError is the factory's",
    code: "AdapterError",
    run: blocked([phase("t01-build", 1, "agent", "builder", FAILED, "AdapterError")]),
    expected: "factory",
  },
  {
    name: "OwnerReworkCredentialRejected is the factory's",
    code: "OwnerReworkCredentialRejected",
    run: blocked([phase("builder", 1, "agent", "builder"), phase("owner-rework-1", 2, "agent", "builder", FAILED, "OwnerReworkCredentialRejected")]),
    expected: "factory",
  },
  {
    name: "a bare Error from a host phase is the factory's",
    code: "Error",
    run: blocked([phase("t01-build", 1, "agent", "builder"), phase("shift-review-context", 2, "code", "host", FAILED, "Error")]),
    expected: "factory",
  },
  {
    name: "ExecutableNotFound is the environment's",
    code: "ExecutableNotFound",
    run: blocked([phase("t01-build", 1, "agent", "builder", FAILED, "ExecutableNotFound")]),
    expected: "environment",
  },
  {
    name: "phase-abort on the BLOCKED transition, with no phase error, is unknown",
    code: "phase-abort",
    run: blocked([phase("t01-build", 1, "agent", "builder", FAILED)], "phase-abort"),
    expected: "unknown",
  },
];

for (const { name, run, expected } of CASES) {
  test(`heuristic table: ${name}`, () => {
    assert.equal(heuristicAttribution(run), expected);
  });
}

test("the table is frozen, holds each code once, and every row has its own case above", () => {
  assert.ok(Object.isFrozen(HEURISTIC_ATTRIBUTION_RULES));
  for (const rule of HEURISTIC_ATTRIBUTION_RULES) assert.ok(Object.isFrozen(rule), rule.code);
  const codes = HEURISTIC_ATTRIBUTION_RULES.map((rule) => rule.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(CASES.map((entry) => entry.code), codes);
  assert.deepEqual(
    Object.fromEntries(HEURISTIC_ATTRIBUTION_RULES.map((rule) => [rule.code, rule.attribution])),
    Object.fromEntries(CASES.map((entry) => [entry.code, entry.expected])),
  );
  const attributions: readonly Attribution[] = HEURISTIC_ATTRIBUTION_RULES.map((rule) => rule.attribution);
  assert.ok(!attributions.includes("owner"), "only the owner's override says owner");
  assert.ok(!attributions.includes("driver"), "only an owner record says driver; the heuristic table stays unchanged");
});

test("an unknown code is unknown, from the phase or from the transition", () => {
  assert.equal(heuristicAttribution(blocked([phase("t01-build", 1, "agent", "builder", FAILED, "SessionIdentityBroken")])), "unknown");
  assert.equal(heuristicAttribution(blocked([phase("t01-build", 1, "agent", "builder", FAILED)], "quota-exhausted")), "unknown");
});

test("no code at all is unknown", () => {
  assert.equal(heuristicAttribution(blocked([phase("t01-build", 1, "agent", "builder", FAILED)], null)), "unknown");
  assert.equal(heuristicAttribution(blocked([], null)), "unknown");
  assert.equal(heuristicAttribution({ lifecycleState: "BLOCKED", phases: [], transitions: [] }), "unknown");
});

test("a row's condition is part of the row: a CommandPhaseFailure after no build, or a bare Error from an agent, is unknown", () => {
  // simple-sdlc's final-tests judges the documenter, not a build.
  const afterDocs = blocked([
    phase("builder", 1, "agent", "builder"),
    phase("tests", 2, "code", "host"),
    phase("documenter", 3, "agent", "documenter"),
    phase("final-tests", 4, "code", "host", FAILED, "CommandPhaseFailure"),
  ]);
  assert.equal(heuristicAttribution(afterDocs), "unknown");
  assert.equal(heuristicAttribution(blocked([phase("request", 1, "engineer", "engineer", FAILED, "CommandPhaseFailure")])), "unknown");
  assert.equal(heuristicAttribution(blocked([phase("t01-build", 1, "agent", "builder", FAILED, "Error")])), "unknown");
});

test("the blocking phase's error code is read before the transition's reason code", () => {
  const run = blocked([phase("t01-build", 1, "agent", "builder", FAILED, "ExecutableNotFound")], "permission-breach");
  assert.equal(heuristicAttribution(run), "environment");
});

test("a run that is not BLOCKED has no attribution, whatever its phases say", () => {
  const phases = [phase("t01-build", 1, "agent", "builder", FAILED, "PermissionBreach")];
  for (const lifecycleState of ["RUNNING", "AWAITING_OWNER", "LANDED", "CANCELLED"]) {
    const run: AttributionRun = { lifecycleState, phases, transitions: [] };
    assert.equal(heuristicAttribution(run), null, lifecycleState);
    assert.equal(blockingPhase(run), null, lifecycleState);
  }
});

test("the blocking phase is the last FAILED phase, and a host phase's block lands on the agent phase it judged", () => {
  const run = blocked([
    phase("t01-brief", 1, "engineer", "host"),
    phase("t01-build", 2, "agent", "builder"),
    phase("t01-tests", 3, "code", "host"),
    phase("t02-brief", 4, "engineer", "host"),
    phase("t02-build", 5, "agent", "builder", FAILED, "PhaseGateFailure"),
    phase("t02-tests", 6, "code", "host", FAILED, "CommandPhaseFailure"),
    phase("shift-review", 7, "agent", "reviewer", "QUEUED"),
  ]);
  assert.equal(blockingPhase(run)?.key, "t02-tests");
  assert.equal(blockedAgentPhase(run)?.key, "t02-build");

  const agent = blocked([phase("builder", 1, "agent", "builder"), phase("reviewer", 2, "agent", "reviewer", FAILED, "PermissionBreach")]);
  assert.equal(blockedAgentPhase(agent)?.key, "reviewer");

  const beforeAnyAgent = blocked([phase("t01-brief", 1, "engineer", "host", FAILED, "Error"), phase("t01-build", 2, "agent", "builder", "QUEUED")]);
  assert.equal(blockedAgentPhase(beforeAnyAgent), null);
  assert.equal(heuristicAttribution(beforeAnyAgent), "factory");
});

test("the owner's override wins over the heuristic, which stays beside it", () => {
  const run = blocked([phase("t01-build", 1, "agent", "builder", FAILED, "PermissionBreach")]);
  assert.deepEqual(effectiveAttribution(run, null), { attribution: "model", source: "heuristic", heuristic: "model" });
  assert.deepEqual(
    effectiveAttribution(run, { cause: "owner", reason: "the ticket asked for the protected path", at: "2026-09-28T10:00:00.000Z" }),
    { attribution: "owner", source: "owner", heuristic: "model" },
  );
});

test("a run that is not BLOCKED has no attribution, even with an override on record", () => {
  const landed: AttributionRun = { lifecycleState: "LANDED", phases: [phase("t01-build", 1, "agent", "builder")], transitions: [] };
  assert.deepEqual(
    effectiveAttribution(landed, { cause: "model", reason: "stray", at: "2026-09-28T10:00:00.000Z" }),
    { attribution: null, source: null, heuristic: null },
  );
});
