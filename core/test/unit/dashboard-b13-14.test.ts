import test from "node:test";
import assert from "node:assert/strict";
import { attributionPanel } from "../../../dashboard/src/metrics-run.ts";
import type { LinkedMetricsRun } from "../../../dashboard/src/metrics-run.ts";

function fakeRun(overrides: Partial<LinkedMetricsRun> = {}): LinkedMetricsRun {
  return {
    run: "test-run-1",
    sessionId: "ses_1",
    taskId: "task-1",
    project: "proj-1",
    attempt: 1,
    tier: 1,
    workflow: "test-flow",
    stateGroup: "CANCELLED",
    statusText: "CANCELLED",
    startedAt: "2026-10-15T10:00:00.000Z",
    endedAt: "2026-10-15T10:05:00.000Z",
    durationMs: 300000,
    costUsd: 0.1,
    costAuthority: "exact",
    inputTokens: 100,
    outputTokens: 50,
    calls: 2,
    phasesTotal: 1,
    phasesSettled: 1,
    phaseStatus: "COMPLETE",
    lastPhase: "build",
    failureSummary: null,
    failureClass: null,
    attribution: null,
    heuristicAttribution: null,
    ownerAttribution: null,
    attributionSource: null,
    reviewVerdict: null,
    ownerReentries: 0,
    phases: [],
    inLens: true,
    ...overrides,
  } as unknown as LinkedMetricsRun;
}

test("B13-14: attributionPanel returns a panel for CANCELLED runs as well as BLOCKED", () => {
  const cancelledRun = fakeRun({ stateGroup: "CANCELLED" });
  const panel = attributionPanel(cancelledRun);
  assert.notEqual(panel, null, "attributionPanel should return a panel for CANCELLED runs");
  assert.equal(panel!.override, null);

  const overriddenCancelled = fakeRun({
    stateGroup: "CANCELLED",
    ownerAttribution: { cause: "factory", reason: "cancelled due to spec bug", at: "2026-10-15T12:00:00.000Z" },
    attribution: "factory",
    attributionSource: "owner",
  });
  const overriddenPanel = attributionPanel(overriddenCancelled);
  assert.notEqual(overriddenPanel, null);
  assert.deepEqual(overriddenPanel!.override, {
    cause: "factory",
    reason: "cancelled due to spec bug",
    at: "2026-10-15T12:00:00.000Z",
    date: "2026-10-15",
  });
  assert.equal(overriddenPanel!.inForce, "factory");
  assert.equal(overriddenPanel!.source, "owner");

  const blockedRun = fakeRun({ stateGroup: "BLOCKED" });
  assert.notEqual(attributionPanel(blockedRun), null, "BLOCKED runs still receive a panel");

  const landedRun = fakeRun({ stateGroup: "LANDED" });
  assert.equal(attributionPanel(landedRun), null, "LANDED runs receive null");

  const openRun = fakeRun({ stateGroup: "OPEN" });
  assert.equal(attributionPanel(openRun), null, "OPEN runs receive null");
});
