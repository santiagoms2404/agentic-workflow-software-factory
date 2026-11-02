// B2-13 regression test: Jev decide() must not be called when judgment
// does not refine the proposal (e.g. quota-pause, quota-stop, funded
// ceiling-pause, review-hold accept, and blocked stops).
// Per W19 DD5: "Jev only refines judgment".

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttemptEvent, AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { JevOutcome } from "../../../src/decision/jev-transport.ts";
import { Journal } from "../../../src/persistence/journal.ts";
import { readTaskDecisions } from "../../../src/persistence/task-decisions.ts";
import { readTaskDelegateProposals } from "../../../src/persistence/task-delegate.ts";
import { recordShadowProposal, type ShadowInput } from "../../../src/delegate/shadow.ts";
import { assertDelegateProposal } from "../../../src/delegate/proposal.ts";
import type { PhaseRecovery } from "../../../src/contracts/phase-recovery.ts";
import { REVIEW_OUTPUT_SCHEMA_ID } from "../../../src/contracts/review-output.ts";

const HASH = "a".repeat(64);
const SHA = "b".repeat(40);
const PHASES = async () => ({
  config: {
    phases: [
      { id: "plan", ticket: null, route: "claude-code" },
      { id: "T01-build", ticket: "T01", route: "pi-codex" },
      { id: "T01-gates", ticket: "T01", route: null },
      { id: "T02-build", ticket: "T02", route: "pi-codex" },
      { id: "review", ticket: null, route: "claude-code" },
    ],
  },
  roles: { plan: "planner", "T01-build": "builder", "T02-build": "builder", review: "reviewer" },
});

function recoveryCheckpoint(kind: "ceiling-pause" | "quota-pause"): PhaseRecovery {
  return {
    schema: "awsf.phase-recovery/v1",
    id: `${kind}-1`,
    sessionId: "s-1",
    kind,
    ticket: "T02",
    workflowId: "shift",
    bindingDigest: HASH,
    prefix: ["plan", "T01-build", "T01-gates"].map((phaseKey, index) => ({
      phaseKey,
      ordinal: index + 1,
      envelopeId: `e-${phaseKey}`,
      envelopeDigest: HASH,
      round: 0,
      candidateSha: SHA,
    })),
    repository: "/repo",
    worktree: "/wt",
    commonGitDir: "/repo/.git",
    integrationBaseSha: SHA,
    worktreeHeadSha: SHA,
    budgetDigest: HASH,
    quota: null,
    createdAt: "2026-09-29T10:00:00Z",
  };
}

function status(extra: Record<string, unknown>): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1",
    sessionId: "s-1",
    project: "awsf",
    taskId: "task-1",
    continuesTask: null,
    groupId: null,
    planRef: null,
    attempt: 1,
    repository: "/nonexistent-repo",
    worktree: "/wt",
    workflow: "shift",
    tier: 2,
    request: "r",
    configSnapshotJson: "{}",
    lifecycleState: "RUNNING",
    baseSha: SHA,
    candidateSha: SHA,
    phase: null,
    budget: {
      attempt: 1,
      callsSpent: 1,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
      ownerReentries: 0,
      allowance: { auto: 2, owner: 1, ownerReentries: 1 },
      ceiling: 10,
    },
    ceilingGrants: [],
    routeOverrides: {},
    reviewDegradation: null,
    model: null,
    lastActivityAt: "t",
    lastActivity: "a",
    nextAction: "n",
    gatesPass: false,
    requiredReviewPresent: false,
    journeyApproved: false,
    protectedApprovalsValid: false,
    process: null,
    landingApproval: null,
    blocker: null,
    recovery: null,
    revision: 7,
    lastSourceSeq: 7,
    ...extra,
  } as unknown as AttemptStatus;
}

async function attempt(
  current: AttemptStatus,
  events: AttemptEvent[] = [],
): Promise<{ root: string; attemptDir: string; taskRoot: string }> {
  const root = mkdtempSync(join(tmpdir(), "awsf-shadow-b2-13-"));
  const taskRoot = join(root, "projects", "awsf", "tasks", "task-1");
  const attemptDir = join(taskRoot, "1");
  mkdirSync(attemptDir, { recursive: true });
  writeFileSync(join(attemptDir, "status.json"), JSON.stringify(current));
  const journal = new Journal<AttemptEvent>(join(attemptDir, "journal.jsonl"));
  for (const event of events) {
    await journal.append(event);
  }
  await journal.close();
  return { root, attemptDir, taskRoot };
}

function transport(outcome: JevOutcome, asked: unknown[] = []): NonNullable<ShadowInput["transport"]> {
  return {
    ask: async (state, questions) => {
      asked.push({ state, questions });
      return outcome;
    },
  };
}

const ANSWERED_RAISE: JevOutcome = {
  outcome: "answered",
  requestedModel: "~typesafe/jev-latest",
  resolvedModel: "typesafe/jev-1.13-20260917",
  answers: {
    progressing: { type: "noul", noul: 0.9 },
    next_act: {
      type: "choice",
      choice: "raise",
      probabilities: { raise: 0.9, cancel: 0.05, wait_for_owner: 0.03, other: 0.02 },
      confidence: 0.9,
    },
    risk: {
      type: "score",
      score: 0.2,
      legend: { "0": "low", "1": "medium", "2": "high" },
      probabilities: { "0": 0.8, "1": 0.15, "2": 0.05 },
      confidence: 0.8,
    },
  },
  usage: { input_tokens: 600, output_tokens: 80 },
  cost: { amount: 0.00003, source: "reported" },
  elapsedMs: 700,
  attempts: 1,
  redacted: false,
  requestText: "{}",
  responseText: "{}",
} as unknown as JevOutcome;

const ANSWERED_REWORK: JevOutcome = {
  outcome: "answered",
  requestedModel: "~typesafe/jev-latest",
  resolvedModel: "typesafe/jev-1.13-20260917",
  answers: {
    progressing: { type: "noul", noul: 0.9 },
    next_act: {
      type: "choice",
      choice: "rework",
      probabilities: { rework: 0.9, cancel: 0.05, wait_for_owner: 0.03, other: 0.02 },
      confidence: 0.9,
    },
    risk: {
      type: "score",
      score: 0.2,
      legend: { "0": "low", "1": "medium", "2": "high" },
      probabilities: { "0": 0.8, "1": 0.15, "2": 0.05 },
      confidence: 0.8,
    },
  },
  usage: { input_tokens: 600, output_tokens: 80 },
  cost: { amount: 0.00003, source: "reported" },
  elapsedMs: 700,
  attempts: 1,
  redacted: false,
  requestText: "{}",
  responseText: "{}",
} as unknown as JevOutcome;

let counter = 0;
const ids = () => `id-${String(++counter)}`;

test("B2-13: funded ceiling-pause does not call Jev decide()", async () => {
  // With ceiling = 10, callsSpent = 1, callsReserved = 0, agent phases = 2, target = 4 <= 10.
  // plan.acts === 0 -> ceiling-funded proposal, no Jev refinement needed.
  const checkpoint = recoveryCheckpoint("ceiling-pause");
  const current = status({ recovery: checkpoint });
  const { root, attemptDir, taskRoot } = await attempt(current, [
    { kind: "attempt.updated", next: current, evidence: { type: "ceiling-pause", checkpoint } as never },
  ]);
  try {
    const asked: unknown[] = [];
    const outcome = await recordShadowProposal({
      attemptDir,
      phases: PHASES,
      transport: transport(ANSWERED_RAISE, asked),
      newId: ids,
    });
    assert.equal(outcome.recorded, true);
    assert.equal(asked.length, 0, "decide() must not be called for funded ceiling-pause");
    const [proposal] = await readTaskDelegateProposals(taskRoot);
    assert.ok(proposal);
    assertDelegateProposal(proposal);
    assert.equal(proposal.stopKind, "ceiling-pause");
    assert.equal(proposal.proposal.rationale, "ceiling-funded");
    assert.equal(proposal.proposal.act.act, "resume");
    assert.equal(proposal.decision.recordId, null);
    const decisions = await readTaskDecisions(taskRoot);
    assert.equal(decisions.length, 0, "no decision record should be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-13: quota-pause does not call Jev decide()", async () => {
  const checkpoint = recoveryCheckpoint("quota-pause");
  const current = status({ recovery: checkpoint });
  const { root, attemptDir, taskRoot } = await attempt(current, [
    { kind: "attempt.updated", next: current, evidence: { type: "quota-pause", checkpoint } as never },
  ]);
  try {
    const asked: unknown[] = [];
    const outcome = await recordShadowProposal({
      attemptDir,
      phases: PHASES,
      transport: transport(ANSWERED_RAISE, asked),
      quotaPlan: { kind: "resume-now" },
      newId: ids,
    });
    assert.equal(outcome.recorded, true);
    assert.equal(asked.length, 0, "decide() must not be called for quota-pause");
    const [proposal] = await readTaskDelegateProposals(taskRoot);
    assert.ok(proposal);
    assertDelegateProposal(proposal);
    assert.equal(proposal.stopKind, "quota-pause");
    assert.equal(proposal.proposal.rationale, "quota-recovered");
    assert.equal(proposal.proposal.act.act, "resume");
    assert.equal(proposal.decision.recordId, null);
    const decisions = await readTaskDecisions(taskRoot);
    assert.equal(decisions.length, 0, "no decision record should be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-13: quota-stop (L26) does not call Jev decide()", async () => {
  const current = status({ lifecycleState: "AWAITING_OWNER", recovery: null });
  const { root, attemptDir, taskRoot } = await attempt(current, [
    {
      kind: "attempt.transitioned",
      next: current,
      evidence: {
        type: "transition",
        id: "t-L26",
        seq: 1,
        from: "RUNNING",
        to: "AWAITING_OWNER",
        edgeId: "L26",
        actor: "host",
        reasonSource: "gate",
        reasonCode: "quota-exhausted",
        reasonDetail: null,
        spawnSite: false,
        at: "2026-09-29T09:30:00Z",
      } as never,
    },
    {
      kind: "attempt.updated",
      next: current,
      evidence: {
        type: "quota-snapshot",
        completedPhaseKey: "T01-build",
        nextPhaseKey: "T02-build",
        effectivePercentRemaining: 0,
        minutesToReset: 60,
        reasonCode: "quota-exhausted",
      } as never,
    },
  ]);
  try {
    const asked: unknown[] = [];
    const outcome = await recordShadowProposal({
      attemptDir,
      phases: PHASES,
      transport: transport(ANSWERED_RAISE, asked),
      newId: ids,
    });
    assert.equal(outcome.recorded, true);
    assert.equal(asked.length, 0, "decide() must not be called for quota-stop");
    const [proposal] = await readTaskDelegateProposals(taskRoot);
    assert.ok(proposal);
    assertDelegateProposal(proposal);
    assert.equal(proposal.stopKind, "quota-stop");
    assert.equal(proposal.proposal.rationale, "quota-plan-absent");
    assert.equal(proposal.proposal.act.act, "wait-for-owner");
    assert.equal(proposal.decision.recordId, null);
    const decisions = await readTaskDecisions(taskRoot);
    assert.equal(decisions.length, 0, "no decision record should be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-13: blocked stop does not call Jev decide()", async () => {
  const current = status({ lifecycleState: "BLOCKED", recovery: null });
  const { root, attemptDir, taskRoot } = await attempt(current, [
    {
      kind: "attempt.transitioned",
      next: current,
      evidence: {
        type: "transition",
        id: "t-L8",
        seq: 1,
        from: "RUNNING",
        to: "BLOCKED",
        edgeId: "L8",
        actor: "host",
        reasonSource: "gate",
        reasonCode: "test-failure",
        reasonDetail: null,
        spawnSite: false,
        at: "2026-09-29T09:30:00Z",
      } as never,
    },
  ]);
  try {
    const asked: unknown[] = [];
    const outcome = await recordShadowProposal({
      attemptDir,
      phases: PHASES,
      transport: transport(ANSWERED_RAISE, asked),
      newId: ids,
    });
    assert.equal(outcome.recorded, true);
    assert.equal(asked.length, 0, "decide() must not be called for blocked stop");
    const [proposal] = await readTaskDelegateProposals(taskRoot);
    assert.ok(proposal);
    assertDelegateProposal(proposal);
    assert.equal(proposal.stopKind, "blocked");
    assert.equal(proposal.proposal.rationale, "blocked-needs-owner");
    assert.equal(proposal.proposal.act.act, "wait-for-owner");
    assert.equal(proposal.decision.recordId, null);
    assert.deepEqual(proposal.allowedActs, []);
    const decisions = await readTaskDecisions(taskRoot);
    assert.equal(decisions.length, 0, "no decision record should be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-13: review-hold with accepted verdict does not call Jev decide()", async () => {
  const current = status({ lifecycleState: "AWAITING_OWNER", recovery: null });
  const { root, attemptDir, taskRoot } = await attempt(current, [
    {
      kind: "attempt.transitioned",
      next: current,
      evidence: {
        type: "transition",
        id: "t-L15",
        seq: 1,
        from: "RUNNING",
        to: "AWAITING_OWNER",
        edgeId: "L15",
        actor: "host",
        reasonSource: "gate",
        reasonCode: "review-complete",
        reasonDetail: null,
        spawnSite: false,
        at: "2026-09-29T09:30:00Z",
      } as never,
    },
    {
      kind: "attempt.updated",
      next: current,
      evidence: {
        type: "envelope",
        phaseId: "review",
        envelope: {
          envelopeId: "env-review",
          sessionId: "s-1",
          phaseId: "review",
          correctionRound: 0,
          agent: "reviewer",
          schemaId: REVIEW_OUTPUT_SCHEMA_ID,
          valid: true,
          createdAt: "2026-09-29T09:20:00Z",
          payload: {
            schema: REVIEW_OUTPUT_SCHEMA_ID,
            verdict: "accept",
            reviewedSha: SHA,
            findings: [],
            limitations: [],
          },
          violations: [],
          rawOutputPath: "/raw",
        },
      } as never,
    },
    {
      kind: "attempt.updated",
      next: current,
      evidence: {
        type: "review",
        phaseId: "review",
        adapterId: "claude-code",
        provider: "anthropic",
        verdict: "accept",
        reviewedSha: SHA,
        findingCount: 0,
        at: "2026-09-29T09:21:00Z",
      } as never,
    },
  ]);
  try {
    const asked: unknown[] = [];
    const outcome = await recordShadowProposal({
      attemptDir,
      phases: PHASES,
      transport: transport(ANSWERED_RAISE, asked),
      newId: ids,
    });
    assert.equal(outcome.recorded, true);
    assert.equal(asked.length, 0, "decide() must not be called for review-hold accept");
    const [proposal] = await readTaskDelegateProposals(taskRoot);
    assert.ok(proposal);
    assertDelegateProposal(proposal);
    assert.equal(proposal.stopKind, "review-hold");
    assert.equal(proposal.proposal.rationale, "review-accepted");
    assert.equal(proposal.proposal.act.act, "land-shadow");
    assert.equal(proposal.decision.recordId, null);
    const decisions = await readTaskDecisions(taskRoot);
    assert.equal(decisions.length, 0, "no decision record should be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-13: review-hold with concern still calls Jev decide()", async () => {
  const current = status({ lifecycleState: "AWAITING_OWNER", recovery: null });
  const { root, attemptDir, taskRoot } = await attempt(current, [
    {
      kind: "attempt.transitioned",
      next: current,
      evidence: {
        type: "transition",
        id: "t-L15",
        seq: 1,
        from: "RUNNING",
        to: "AWAITING_OWNER",
        edgeId: "L15",
        actor: "host",
        reasonSource: "gate",
        reasonCode: "review-complete",
        reasonDetail: null,
        spawnSite: false,
        at: "2026-09-29T09:30:00Z",
      } as never,
    },
    {
      kind: "attempt.updated",
      next: current,
      evidence: {
        type: "envelope",
        phaseId: "review",
        envelope: {
          envelopeId: "env-review",
          sessionId: "s-1",
          phaseId: "review",
          correctionRound: 0,
          agent: "reviewer",
          schemaId: REVIEW_OUTPUT_SCHEMA_ID,
          valid: true,
          createdAt: "2026-09-29T09:20:00Z",
          payload: {
            schema: REVIEW_OUTPUT_SCHEMA_ID,
            verdict: "concern",
            reviewedSha: SHA,
            findings: [{ id: "F1", severity: "high", file: "a.ts", line: 10, title: "t", detail: "d" }],
            limitations: [],
          },
          violations: [],
          rawOutputPath: "/raw",
        },
      } as never,
    },
    {
      kind: "attempt.updated",
      next: current,
      evidence: {
        type: "review",
        phaseId: "review",
        adapterId: "claude-code",
        provider: "anthropic",
        verdict: "concern",
        reviewedSha: SHA,
        findingCount: 1,
        at: "2026-09-29T09:21:00Z",
      } as never,
    },
  ]);
  try {
    const asked: unknown[] = [];
    const outcome = await recordShadowProposal({
      attemptDir,
      phases: PHASES,
      transport: transport(ANSWERED_REWORK, asked),
      newId: ids,
    });
    assert.equal(outcome.recorded, true);
    assert.equal(asked.length, 1, "decide() must be called for review-hold concern");
    const [proposal] = await readTaskDelegateProposals(taskRoot);
    assert.ok(proposal);
    assertDelegateProposal(proposal);
    assert.equal(proposal.stopKind, "review-hold");
    assert.equal(proposal.proposal.rationale, "jev-picked");
    assert.equal(proposal.proposal.act.act, "rework");
    assert.notEqual(proposal.decision.recordId, null);
    const decisions = await readTaskDecisions(taskRoot);
    assert.equal(decisions.length, 1, "decision record must be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-13: underfunded ceiling-pause still calls Jev decide()", async () => {
  // With ceiling = 2, callsSpent = 3, target = 6 > 2 -> plan.acts = 1 > 0.
  // Requires Jev stop-judgment refinement.
  const checkpoint = recoveryCheckpoint("ceiling-pause");
  const current = status({
    recovery: checkpoint,
    budget: {
      attempt: 1,
      callsSpent: 3,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
      ownerReentries: 0,
      allowance: { auto: 2, owner: 1, ownerReentries: 1 },
      ceiling: 2,
    },
  });
  const { root, attemptDir, taskRoot } = await attempt(current, [
    { kind: "attempt.updated", next: current, evidence: { type: "ceiling-pause", checkpoint } as never },
  ]);
  try {
    const asked: unknown[] = [];
    const outcome = await recordShadowProposal({
      attemptDir,
      phases: PHASES,
      transport: transport(ANSWERED_RAISE, asked),
      newId: ids,
    });
    assert.equal(outcome.recorded, true);
    assert.equal(asked.length, 1, "decide() must be called for underfunded ceiling-pause");
    const [proposal] = await readTaskDelegateProposals(taskRoot);
    assert.ok(proposal);
    assertDelegateProposal(proposal);
    assert.equal(proposal.stopKind, "ceiling-pause");
    assert.equal(proposal.proposal.rationale, "ceiling-short");
    assert.equal(proposal.proposal.act.act, "raise");
    assert.notEqual(proposal.decision.recordId, null);
    const decisions = await readTaskDecisions(taskRoot);
    assert.equal(decisions.length, 1, "decision record must be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
