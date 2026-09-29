// The shadow owner's runner step (W19 task 5): at a stop it asks
// stop-judgment through decide(), records one delegate.proposal whether or
// not a lease exists, records wait-for-owner when the decision is unavailable,
// records once per stop, and never touches the attempt.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttemptEvent, AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { JevOutcome } from "../../../src/decision/jev-transport.ts";
import { Journal } from "../../../src/persistence/journal.ts";
import { readTaskDecisions } from "../../../src/persistence/task-decisions.ts";
import { delegateFilePath, readTaskDelegateProposals } from "../../../src/persistence/task-delegate.ts";
import { recordShadowProposal, type ShadowInput } from "../../../src/delegate/shadow.ts";
import { assertDelegateProposal } from "../../../src/delegate/proposal.ts";
import type { PhaseRecovery } from "../../../src/contracts/phase-recovery.ts";

const HASH = "a".repeat(64);
const SHA = "b".repeat(40);
const PHASES = async () => ({
  config: { phases: [
    { id: "plan", ticket: null, route: "claude-code" },
    { id: "T01-build", ticket: "T01", route: "pi-codex" },
    { id: "T01-gates", ticket: "T01", route: null },
    { id: "T02-build", ticket: "T02", route: "pi-codex" },
    { id: "review", ticket: null, route: "claude-code" },
  ] },
  roles: { plan: "planner", "T01-build": "builder", "T02-build": "builder", review: "reviewer" },
});

function ceilingPause(): PhaseRecovery {
  return {
    schema: "awsf.phase-recovery/v1", id: "cp-1", sessionId: "s-1", kind: "ceiling-pause", ticket: "T02", workflowId: "shift",
    bindingDigest: HASH, prefix: ["plan", "T01-build", "T01-gates"].map((phaseKey, index) => ({
      phaseKey, ordinal: index + 1, envelopeId: `e-${phaseKey}`, envelopeDigest: HASH, round: 0, candidateSha: SHA })),
    repository: "/repo", worktree: "/wt", commonGitDir: "/repo/.git", integrationBaseSha: SHA, worktreeHeadSha: SHA,
    budgetDigest: HASH, quota: null, createdAt: "2026-09-29T10:00:00Z",
  };
}

function status(extra: Record<string, unknown>): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1", sessionId: "s-1", project: "awsf", taskId: "task-1", continuesTask: null, groupId: null,
    planRef: null, attempt: 1, repository: "/nonexistent-repo", worktree: "/wt", workflow: "shift", tier: 2, request: "r",
    configSnapshotJson: "{}", lifecycleState: "RUNNING", baseSha: SHA, candidateSha: SHA, phase: null,
    budget: { attempt: 1, callsSpent: 3, callsReserved: 0, correctionsAuto: 0, correctionsOwner: 0, ownerReentries: 0,
      allowance: { auto: 2, owner: 1, ownerReentries: 1 } },
    ceilingGrants: [], routeOverrides: {}, reviewDegradation: null, model: null, lastActivityAt: "t", lastActivity: "a",
    nextAction: "n", gatesPass: false, requiredReviewPresent: false, journeyApproved: false, protectedApprovalsValid: false,
    process: null, landingApproval: null, blocker: null, recovery: null, revision: 7, lastSourceSeq: 7,
    ...extra,
  } as unknown as AttemptStatus;
}

async function attempt(current: AttemptStatus): Promise<{ root: string; attemptDir: string; taskRoot: string }> {
  const root = mkdtempSync(join(tmpdir(), "awsf-shadow-"));
  const taskRoot = join(root, "projects", "awsf", "tasks", "task-1");
  const attemptDir = join(taskRoot, "1");
  mkdirSync(attemptDir, { recursive: true });
  writeFileSync(join(attemptDir, "status.json"), JSON.stringify(current));
  const journal = new Journal<AttemptEvent>(join(attemptDir, "journal.jsonl"));
  await journal.append({ kind: "attempt.updated", next: current, evidence: { type: "ceiling-pause", checkpoint: ceilingPause() } });
  await journal.close();
  return { root, attemptDir, taskRoot };
}

function transport(outcome: JevOutcome, asked: unknown[] = []): NonNullable<ShadowInput["transport"]> {
  return { ask: async (state, questions) => { asked.push({ state, questions }); return outcome; } };
}

const ANSWERED_RAISE: JevOutcome = {
  outcome: "answered", requestedModel: "~typesafe/jev-latest", resolvedModel: "typesafe/jev-1.13-20260917",
  answers: {
    progressing: { type: "noul", noul: 0.9 },
    next_act: { type: "choice", choice: "raise", probabilities: { raise: 0.9, cancel: 0.05, wait_for_owner: 0.03, other: 0.02 }, confidence: 0.9 },
    risk: { type: "score", score: 0.2, legend: { "0": "low", "1": "medium", "2": "high" }, probabilities: { "0": 0.8, "1": 0.15, "2": 0.05 }, confidence: 0.8 },
  },
  usage: { input_tokens: 600, output_tokens: 80 }, cost: { amount: 0.00003, source: "reported" }, elapsedMs: 700, attempts: 1,
  redacted: false, requestText: "{}", responseText: "{}",
} as unknown as JevOutcome;

const UNAVAILABLE: JevOutcome = { outcome: "unavailable", reason: "missing-key", detail: "OPENROUTER_API_KEY is not set" } as unknown as JevOutcome;

let counter = 0;
const ids = () => `id-${String(++counter)}`;

test("shadow: a ceiling-pause records one decision and one raise proposal, without a lease", async () => {
  const current = status({ recovery: ceilingPause() });
  const { root, attemptDir, taskRoot } = await attempt(current);
  try {
    const statusBefore = readFileSync(join(attemptDir, "status.json"), "utf8");
    const journalBefore = readFileSync(join(attemptDir, "journal.jsonl"), "utf8");
    const asked: unknown[] = [];
    const outcome = await recordShadowProposal({ attemptDir, phases: PHASES, transport: transport(ANSWERED_RAISE, asked), newId: ids, now: () => "2026-09-29T11:00:00Z" });
    assert.equal(outcome.recorded, true);
    const [proposal] = await readTaskDelegateProposals(taskRoot);
    assert.ok(proposal);
    assertDelegateProposal(proposal);
    assert.equal(proposal.type, "delegate.proposal");
    assert.equal(proposal.leased, false);
    assert.equal(proposal.stopKind, "ceiling-pause");
    assert.deepEqual(proposal.proposal, { act: { act: "raise", calls: 5, raiseActs: 1, finalCeiling: 10 }, rationale: "ceiling-short", executable: true });
    assert.deepEqual(proposal.allowedActs, ["raise", "cancel"]);
    const decisions = await readTaskDecisions(taskRoot);
    assert.equal(decisions.length, 1);
    assert.equal(proposal.decision.recordId, decisions[0]!.id);
    assert.deepEqual(decisions[0]!.caller, { kind: "stop", name: "ceiling-pause" });
    assert.equal(asked.length, 1);
    // Nothing about the attempt moved.
    assert.equal(readFileSync(join(attemptDir, "status.json"), "utf8"), statusBefore);
    assert.equal(readFileSync(join(attemptDir, "journal.jsonl"), "utf8"), journalBefore);
    // Once per stop.
    assert.deepEqual(await recordShadowProposal({ attemptDir, phases: PHASES, transport: transport(ANSWERED_RAISE) }), { recorded: false, reason: "already-recorded" });
    assert.equal((await readTaskDelegateProposals(taskRoot)).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow: an unavailable decision still records a proposal: wait-for-owner, jev-unavailable", async () => {
  const { root, attemptDir, taskRoot } = await attempt(status({ recovery: ceilingPause() }));
  try {
    await recordShadowProposal({ attemptDir, phases: PHASES, transport: transport(UNAVAILABLE), newId: ids });
    const [proposal] = await readTaskDelegateProposals(taskRoot);
    assert.deepEqual(proposal!.proposal, { act: { act: "wait-for-owner" }, rationale: "jev-unavailable", executable: false });
    assert.equal(proposal!.decision.outcome, "unavailable");
    assert.equal((await readTaskDecisions(taskRoot)).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow: a transport that throws still records wait-for-owner, and the default transport withholds nothing it lacks", async () => {
  const { root, attemptDir, taskRoot } = await attempt(status({ recovery: ceilingPause() }));
  try {
    await recordShadowProposal({ attemptDir, phases: PHASES, transport: { ask: async () => { throw new Error("socket closed"); } }, newId: ids });
    const [proposal] = await readTaskDelegateProposals(taskRoot);
    assert.deepEqual([proposal!.proposal.act.act, proposal!.proposal.rationale, proposal!.decision.recordId], ["wait-for-owner", "jev-unavailable", null]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // No key in env: the real transport answers missing-key before any request.
  const second = await attempt(status({ recovery: ceilingPause() }));
  try {
    await recordShadowProposal({ attemptDir: second.attemptDir, phases: PHASES, env: {}, newId: ids });
    const [proposal] = await readTaskDelegateProposals(second.taskRoot);
    assert.equal(proposal!.proposal.rationale, "jev-unavailable");
    const [decision] = await readTaskDecisions(second.taskRoot);
    assert.equal(decision!.outcome, "unavailable");
  } finally {
    rmSync(second.root, { recursive: true, force: true });
  }
});

test("shadow: an attempt that is not at a stop records nothing", async () => {
  const { root, attemptDir, taskRoot } = await attempt(status({}));
  try {
    assert.deepEqual(await recordShadowProposal({ attemptDir, phases: PHASES, transport: transport(ANSWERED_RAISE) }), { recorded: false, reason: "not-at-stop" });
    assert.throws(() => readFileSync(delegateFilePath(taskRoot)), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
