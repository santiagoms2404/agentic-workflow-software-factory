// A synthetic state root for the W19 task 7 replay: three tasks, five
// historical stops, and the acts that followed them. Every value is invented;
// nothing is copied from a real journal.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttemptEvent, AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { PhaseRecovery } from "../../../src/contracts/phase-recovery.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../../src/observability/attempt-evidence.ts";
import { Journal } from "../../../src/persistence/journal.ts";
import type { TaskState } from "../../../src/state/task-machine.ts";

const HASH = "a".repeat(64);
const SHA = "b".repeat(40);

type Step = { readonly evidence: AttemptEvidence; readonly status?: Record<string, unknown> };

function baseStatus(taskId: string, sessionId: string): Record<string, unknown> {
  return {
    schema: "awsf/attempt-status/v1", sessionId, project: "demo", taskId, continuesTask: null, groupId: null, planRef: null,
    attempt: 1, repository: "/nonexistent", worktree: "/nonexistent-wt", workflow: "shift", tier: 2, request: "synthetic request",
    configSnapshotJson: "{}", lifecycleState: "RUNNING", baseSha: SHA, candidateSha: SHA, phase: null,
    budget: { attempt: 1, callsSpent: 3, callsReserved: 0, correctionsAuto: 0, correctionsOwner: 0, ownerReentries: 0,
      allowance: { auto: 2, owner: 1, ownerReentries: 1 } },
    ceilingGrants: [], routeOverrides: {}, reviewDegradation: null, model: null, lastActivityAt: "t", lastActivity: "a", nextAction: "n",
    gatesPass: false, requiredReviewPresent: false, journeyApproved: false, protectedApprovalsValid: false, process: null,
    landingApproval: null, blocker: null, recovery: null, revision: 0, lastSourceSeq: 0,
  };
}

const PHASES: readonly [string, "agent" | "code", string][] = [
  ["plan", "agent", "planner"], ["T01-build", "agent", "builder"], ["T01-gates", "code", "host"],
  ["T02-build", "agent", "builder"], ["review", "agent", "reviewer"],
];

function phaseSteps(): Step[] {
  const steps: Step[] = PHASES.map(([key, kind, owner], index) => ({
    evidence: { type: "phase", phase: {
      phaseId: `db-${key}`, ordinal: index + 1, key, name: key, kind, owner, description: "d", status: "QUEUED",
      correctionCount: 0, maxCorrections: 1, errorCode: null, errorMessage: null, startedAt: null, endedAt: null, createdAt: "t",
    } satisfies PhaseEvidenceRecord },
  }));
  for (const [key, adapterId] of [["plan", "claude-code"], ["T01-build", "pi-codex"]] as const) {
    steps.push({ evidence: { type: "agent-start", phaseId: key, agent: "a", adapterId, provider: "p", color: null, requestedModel: "m",
      sandboxBadge: "none", sandboxMechanism: "none", at: "t" } as unknown as AttemptEvidence });
  }
  return steps;
}

function checkpoint(kind: PhaseRecovery["kind"], sessionId: string, prefix: readonly string[], ticket: string): PhaseRecovery {
  return {
    schema: "awsf.phase-recovery/v1", id: `cp-${kind}-${String(prefix.length)}`, sessionId, kind, ticket, workflowId: "shift", bindingDigest: HASH,
    prefix: prefix.map((phaseKey, index) => ({ phaseKey, ordinal: index + 1, envelopeId: `e-${phaseKey}`, envelopeDigest: HASH, round: 0, candidateSha: SHA })),
    repository: "/nonexistent", worktree: "/nonexistent-wt", commonGitDir: "/nonexistent/.git", integrationBaseSha: SHA, worktreeHeadSha: SHA,
    budgetDigest: HASH, quota: null, createdAt: "t",
  };
}

function transition(from: TaskState, to: TaskState, edgeId: string, reasonCode: string | null = null): AttemptEvidence {
  return { type: "transition", id: `t-${edgeId}`, seq: 1, from, to, actor: "human", edgeId, reasonSource: "gate", reasonCode, reasonDetail: null, spawnSite: false, at: "t" };
}
const RESUME = { type: "resume-activation", operationId: "o", checkpointId: "c", reason: "r", reservationId: null, phase: null } as AttemptEvidence;
const GRANT: AttemptEvidence = { type: "ceiling-grant", calls: 5, from: 5, to: 10, reason: "synthetic", attempt: 1, at: "t" };

async function writeAttempt(stateRoot: string, taskId: string, sessionId: string, steps: readonly Step[]): Promise<string> {
  const dir = join(stateRoot, "projects", "demo", "tasks", taskId, "1");
  mkdirSync(dir, { recursive: true });
  const journal = new Journal<AttemptEvent>(join(dir, "journal.jsonl"));
  let status = baseStatus(taskId, sessionId);
  for (const [index, step] of steps.entries()) {
    status = { ...status, recovery: null, blocker: null, ...step.status, revision: index + 1, lastSourceSeq: index + 1 };
    await journal.append({ kind: "attempt.updated", next: status as unknown as AttemptStatus, evidence: step.evidence });
  }
  await journal.close();
  writeFileSync(join(dir, "status.json"), JSON.stringify(status));
  return dir;
}

export interface ReplayFixture {
  readonly stateRoot: string;
  readonly attemptDirs: readonly string[];
}

/**
 * Five stops. task-a: ceiling-pause then a grant (raise, match); ticket-block
 * then a resume (numbers-only wait, none); ceiling-pause then a cancel (raise,
 * mismatch). task-b: L15 after an accepting review then L20 (land-shadow,
 * match). task-c: L8 into BLOCKED (wait, none).
 */
export async function replayFixture(): Promise<ReplayFixture> {
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-replay-"));
  const prefix = ["plan", "T01-build", "T01-gates"];
  const a = await writeAttempt(stateRoot, "task-a", "s-a", [
    ...phaseSteps(),
    { evidence: { type: "ceiling-pause", checkpoint: checkpoint("ceiling-pause", "s-a", prefix, "T02") }, status: { recovery: checkpoint("ceiling-pause", "s-a", prefix, "T02") } },
    { evidence: GRANT },
    { evidence: RESUME },
    { evidence: { type: "ticket-block", checkpoint: checkpoint("ticket-block", "s-a", ["plan", "T01-build"], "T01"), phaseKey: "T01-gates", source: "gate", detail: "red" },
      status: { recovery: checkpoint("ticket-block", "s-a", ["plan", "T01-build"], "T01"), blocker: { code: "phase-abort", detail: "red", ahead: null, behind: null, source: "gate" } } },
    { evidence: RESUME },
    { evidence: { type: "ceiling-pause", checkpoint: checkpoint("ceiling-pause", "s-a", prefix, "T02") }, status: { recovery: checkpoint("ceiling-pause", "s-a", prefix, "T02") } },
    { evidence: transition("RUNNING", "CANCELLED", "L9"), status: { lifecycleState: "CANCELLED" } },
  ]);
  const b = await writeAttempt(stateRoot, "task-b", "s-b", [
    ...phaseSteps(),
    { evidence: { type: "review", phaseId: "review", adapterId: "claude-code", provider: "anthropic", verdict: "accept", reviewedSha: SHA, findingCount: 0, at: "t" } },
    { evidence: transition("REVIEWING", "AWAITING_OWNER", "L15"), status: { lifecycleState: "AWAITING_OWNER" } },
    { evidence: transition("AWAITING_OWNER", "LANDING", "L20"), status: { lifecycleState: "LANDING" } },
  ]);
  const c = await writeAttempt(stateRoot, "task-c", "s-c", [
    ...phaseSteps(),
    { evidence: transition("RUNNING", "BLOCKED", "L8", "silence"), status: { lifecycleState: "BLOCKED" } },
  ]);
  return { stateRoot, attemptDirs: [a, b, c] };
}

/** An injected owner terminal that records what it was shown. */
export function recordingTerminal(interactive: boolean, answer: boolean): { lines: string[]; prompts: string[]; terminal: import("../../../src/cli/tty.ts").OwnerTerminal } {
  const lines: string[] = [];
  const prompts: string[] = [];
  return {
    lines,
    prompts,
    terminal: { interactive, write: (line) => { lines.push(line); }, confirm: async (prompt) => { prompts.push(prompt); return answer; } },
  };
}
