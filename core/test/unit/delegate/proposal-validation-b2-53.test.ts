import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDelegateProposal } from "../../../src/delegate/proposal.ts";
import { assertDelegateReplay } from "../../../src/delegate/replay.ts";

function liveRecord(proposal: unknown): unknown {
  return {
    schema: "awsf.delegate-proposal/v1",
    type: "delegate.proposal",
    id: "proposal-1",
    project: "project-1",
    taskId: "task-1",
    attempt: 1,
    sessionId: "session-1",
    statusRevision: 1,
    at: "2026-09-01T00:00:00.000Z",
    stopKind: "ceiling-pause",
    edge: null,
    checkpointId: "checkpoint-1",
    leased: false,
    decision: { recordId: null, outcome: "numbers-only" },
    proposal,
    allowedActs: [],
    facts: {},
  };
}

function replayRecord(proposal: unknown): unknown {
  return {
    schema: "awsf.delegate-replay/v1",
    type: "delegate.replay",
    id: "replay-1",
    replayId: "run-1",
    mode: "numbers-only",
    project: "project-1",
    taskId: "task-1",
    attempt: 1,
    sessionId: "session-1",
    statusRevision: 1,
    at: "2026-09-01T00:00:00.000Z",
    replayedAt: "2026-09-01T00:01:00.000Z",
    stopKind: "ceiling-pause",
    edge: null,
    checkpointId: "checkpoint-1",
    decision: { recordId: null, outcome: "numbers-only" },
    proposal,
    allowedActs: [],
    facts: {},
  };
}

test("live and replay records share the never-executable proposal rule", () => {
  const invalid = { act: { act: "wait-for-owner" }, rationale: "blocked-needs-owner", executable: true };
  assert.throws(() => assertDelegateProposal(liveRecord(invalid)), /proposal\.executable/u);
  assert.throws(() => assertDelegateReplay(replayRecord(invalid)), /proposal\.executable/u);
});

test("live and replay validators reject a malformed nested act with the named field", () => {
  const invalid = { act: null, rationale: "blocked-needs-owner", executable: false };
  assert.throws(() => assertDelegateProposal(liveRecord(invalid)), /proposal\.act/u);
  assert.throws(() => assertDelegateReplay(replayRecord(invalid)), /proposal\.act/u);
});
