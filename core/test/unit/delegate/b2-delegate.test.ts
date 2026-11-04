// Regression tests for Batch 2 findings in Delegate:
// 1. B2-28: raiseActsNeeded moved to core/src/state/tiers.ts, re-exported from shift.ts,
//    imported by policy.ts from ../state/tiers.ts.
// 2. B2-29: journalPhases maps routes by both full phaseId and extracted phaseKey (suffix after colon),
//    and looks up by both so dbPhaseId format in agent-start does not leave phases unrecorded.

import assert from "node:assert/strict";
import { test } from "node:test";
import { raiseActsNeeded as raiseActsNeededFromTiers, MAX_CALL_CEILING } from "../../../src/state/tiers.ts";
import { raiseActsNeeded as raiseActsNeededFromShift } from "../../../src/cli/commands/shift.ts";
import { proposeAct, type JudgmentInput, type PolicyInput } from "../../../src/delegate/policy.ts";
import { journalPhases, UNRECORDED_ROUTE } from "../../../src/delegate/replay.ts";
import type { JournalRecord } from "../../../src/persistence/journal.ts";
import type { AttemptEvent } from "../../../src/cli/commands/attempt.ts";
import type { PhaseEvidenceRecord, AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import type { StopFacts } from "../../../src/delegate/stop-facts.ts";

test("B2-28: raiseActsNeeded is exported from tiers.ts and re-exported from shift.ts", () => {
  assert.equal(raiseActsNeededFromTiers, raiseActsNeededFromShift);

  assert.deepEqual(raiseActsNeededFromTiers(5, 5), { acts: 0, finalCeiling: 5 });
  assert.deepEqual(raiseActsNeededFromTiers(5, 6), { acts: 1, finalCeiling: 10 });
  assert.deepEqual(raiseActsNeededFromTiers(5, 15), { acts: 2, finalCeiling: 15 });
  assert.deepEqual(raiseActsNeededFromTiers(5, 20), { acts: 3, finalCeiling: 20 });
  assert.equal(raiseActsNeededFromTiers(5, MAX_CALL_CEILING + 1), null);
});

test("B2-28: policy proposeAct uses raiseActsNeeded from tiers.ts for ceiling-pause", () => {
  const facts: StopFacts = {
    schema: "awsf.stop-facts/v1",
    project: "awsf",
    task: "task-1",
    attempt: 1,
    sessionId: "s-1",
    workflow: "shift",
    tier: 2,
    lifecycle: "RUNNING",
    stopKind: "ceiling-pause",
    edge: null,
    reasonCode: null,
    checkpointId: "cp-1",
    ticket: null,
    callsSpent: 3,
    callsReserved: 1,
    ceiling: 5,
    maxCallCeiling: MAX_CALL_CEILING,
    nextPhase: "build-2",
    nextRoute: "codex",
    ticketsDone: [],
    ticketsRemaining: [],
    corrections: { auto: 0, autoAllowance: 2, owner: 0, ownerAllowance: 1, ownerReentries: 0, ownerReentriesAllowance: 1 },
    review: null,
    gates: null,
    quota: null,
  };

  const config = {
    phases: [
      { id: "build-1", ticket: "T-1", route: "codex" },
      { id: "build-2", ticket: "T-2", route: "codex" },
      { id: "review", ticket: "T-2", route: "claude" },
    ],
  };

  const judgment: JudgmentInput = {
    outcome: "answered",
    result: { kind: "act", act: "raise", confidence: 0.95 },
  };

  const input: PolicyInput = {
    facts,
    judgment,
    config,
  };

  const proposal = proposeAct(input);
  // target = callsSpent (3) + callsReserved (1) + agentCallsFrom (2) + 1 = 7.
  // ceiling = 5. raiseActsNeeded(5, 7) -> acts: 1, finalCeiling: 10.
  // calls = 10 - 5 = 5.
  assert.equal(proposal.act.act, "raise");
  if (proposal.act.act === "raise") {
    assert.equal(proposal.act.calls, 5);
    assert.equal(proposal.act.raiseActs, 1);
    assert.equal(proposal.act.finalCeiling, 10);
  }
  assert.equal(proposal.rationale, "ceiling-short");
  assert.equal(proposal.executable, true);
});

test("B2-29: journalPhases maps routes by both dbPhaseId (session:phaseKey) and bare phase key", () => {
  const sessionId = "sess-12345";
  const records: JournalRecord<AttemptEvent>[] = [
    {
      source_seq: 1,
      recorded_at: "2026-09-29T10:00:00Z",
      event: {
        kind: "attempt.updated",
        next: {} as any,
        evidence: {
          type: "phase",
          phase: {
            phaseId: `${sessionId}:plan`,
            ordinal: 1,
            key: "plan",
            name: "plan",
            kind: "agent",
            owner: "planner",
            description: "plan phase",
            status: "QUEUED",
            correctionCount: 0,
            maxCorrections: 1,
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            endedAt: null,
            createdAt: "2026-09-29T10:00:00Z",
          } satisfies PhaseEvidenceRecord,
        },
      },
    },
    {
      source_seq: 2,
      recorded_at: "2026-09-29T10:00:01Z",
      event: {
        kind: "attempt.updated",
        next: {} as any,
        evidence: {
          type: "phase",
          phase: {
            phaseId: `${sessionId}:build`,
            ordinal: 2,
            key: "build",
            name: "build",
            kind: "agent",
            owner: "builder",
            description: "build phase",
            status: "QUEUED",
            correctionCount: 0,
            maxCorrections: 1,
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            endedAt: null,
            createdAt: "2026-09-29T10:00:00Z",
          } satisfies PhaseEvidenceRecord,
        },
      },
    },
    {
      source_seq: 3,
      recorded_at: "2026-09-29T10:00:02Z",
      event: {
        kind: "attempt.updated",
        next: {} as any,
        evidence: {
          type: "phase",
          phase: {
            phaseId: `${sessionId}:unstarted`,
            ordinal: 3,
            key: "unstarted",
            name: "unstarted",
            kind: "agent",
            owner: "reviewer",
            description: "unstarted phase",
            status: "QUEUED",
            correctionCount: 0,
            maxCorrections: 1,
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            endedAt: null,
            createdAt: "2026-09-29T10:00:00Z",
          } satisfies PhaseEvidenceRecord,
        },
      },
    },
    // Case 1: agent-start recorded with bare phaseKey "plan"
    {
      source_seq: 4,
      recorded_at: "2026-09-29T10:00:03Z",
      event: {
        kind: "attempt.updated",
        next: {} as any,
        evidence: {
          type: "agent-start",
          phaseId: "plan",
          agent: "planner",
          adapterId: "claude-code",
          provider: "anthropic",
          color: null,
          requestedModel: "claude-3-7-sonnet",
          sandboxBadge: "none",
          sandboxMechanism: "none",
          at: "2026-09-29T10:00:03Z",
        } as unknown as AttemptEvidence,
      },
    },
    // Case 2: agent-start recorded with dbPhaseId "sess-12345:build"
    {
      source_seq: 5,
      recorded_at: "2026-09-29T10:00:04Z",
      event: {
        kind: "attempt.updated",
        next: {} as any,
        evidence: {
          type: "agent-start",
          phaseId: `${sessionId}:build`,
          agent: "builder",
          adapterId: "pi-codex",
          provider: "openai",
          color: null,
          requestedModel: "gpt-4o",
          sandboxBadge: "none",
          sandboxMechanism: "none",
          at: "2026-09-29T10:00:04Z",
        } as unknown as AttemptEvidence,
      },
    },
  ];

  const { config, roles } = journalPhases(records);

  // Both plan (bare phaseKey) and build (dbPhaseId with colon) must resolve their route.
  // unstarted must remain UNRECORDED_ROUTE.
  assert.deepEqual(
    config.phases.map((p) => [p.id, p.route]),
    [
      ["plan", "claude-code"],
      ["build", "pi-codex"],
      ["unstarted", UNRECORDED_ROUTE],
    ],
  );
  assert.equal(roles.plan, "planner");
  assert.equal(roles.build, "builder");
  assert.equal(roles.unstarted, "reviewer");
});
