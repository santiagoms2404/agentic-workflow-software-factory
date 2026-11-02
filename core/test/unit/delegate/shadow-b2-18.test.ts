// Regression test for B2-18:
// recordShadowProposal checks for an existing proposal before the awaited Jev call
// and appends after it, with no lock and no uniqueness check at append, so two
// recorders of one stop can both append, and pairAttempt then credits one observed
// act to both proposals.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordShadowProposal } from "../../../src/delegate/shadow.ts";
import { appendTaskDelegateProposal, readTaskDelegateProposals } from "../../../src/persistence/task-delegate.ts";
import type { AttemptStatus } from "../../../src/state/tiers.ts";
import { DELEGATE_PROPOSAL_SCHEMA_ID, DELEGATE_PROPOSAL_TYPE } from "../../../src/delegate/proposal.ts";
import { Journal } from "../../../src/persistence/journal.ts";
import type { AttemptEvent } from "../../../src/observability/attempt-evidence.ts";
import type { PhaseRecovery } from "../../../src/contracts/phase-recovery.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const HASH = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

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

test("B2-18: re-checks alreadyRecorded before appending in recordShadowProposal", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-shadow-b2-18-"));
  const taskRoot = join(root, "projects", "awsf", "tasks", "task-1");
  const attemptDir = join(taskRoot, "1");
  mkdirSync(attemptDir, { recursive: true });

  const current = status({ recovery: ceilingPause() });
  writeFileSync(join(attemptDir, "status.json"), JSON.stringify(current));
  const journal = new Journal<AttemptEvent>(join(attemptDir, "journal.jsonl"));
  await journal.append({ kind: "attempt.updated", next: current, evidence: { type: "ceiling-pause", checkpoint: ceilingPause() } });

  try {
    let injected = false;
    const outcome = await recordShadowProposal({
      attemptDir,
      phases: async () => {
        if (!injected) {
          injected = true;
          // Concurrent caller records proposal for revision 7 before this call reaches append
          await appendTaskDelegateProposal(taskRoot, {
            schema: DELEGATE_PROPOSAL_SCHEMA_ID,
            type: DELEGATE_PROPOSAL_TYPE,
            id: "concurrent-p1",
            project: current.project,
            taskId: current.taskId,
            attempt: current.attempt,
            sessionId: current.sessionId,
            statusRevision: current.revision,
            at: new Date().toISOString(),
            stopKind: "ceiling-pause",
            edge: null,
            checkpointId: null,
            leased: false,
            decision: { recordId: null, outcome: "not-consulted" },
            proposal: { act: { act: "raise", calls: 5, raiseActs: 1, finalCeiling: 10 }, rationale: "ceiling-short", executable: true },
            allowedActs: ["raise"],
            facts: {
              stopKind: "ceiling-pause",
              sessionId: current.sessionId,
              attemptRevision: current.revision,
              phaseId: null,
              edge: null,
              checkpointId: null,
              unstartedPhases: 0,
              review: null,
              quota: null,
              ceiling: null,
              isCorrection: false,
            },
          });
        }
        return {
          config: { phases: [
            { id: "plan", ticket: null, route: "claude-code" },
            { id: "T01-build", ticket: "T01", route: "pi-codex" },
            { id: "T01-gates", ticket: "T01", route: null },
            { id: "T02-build", ticket: "T02", route: "pi-codex" },
            { id: "review", ticket: null, route: "claude-code" },
          ] } as any,
          roles: { plan: "planner", "T01-build": "builder", "T02-build": "builder", review: "reviewer" } as any,
        };
      },
    });

    assert.equal(outcome.recorded, false);
    assert.equal(outcome.reason, "already-recorded");
    const proposals = await readTaskDelegateProposals(taskRoot);
    assert.equal(proposals.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
