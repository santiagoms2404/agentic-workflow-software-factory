import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { attemptDir as attemptDirectory } from "../../persistence/platform-paths.ts";
import { ceilingFor, type Tier } from "../../state/tiers.ts";
import {
  latestAttemptNumber,
  nextActionFor,
  persistAttempt,
  taskRoot,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";

export interface NewCommandOptions {
  readonly stateRoot: string;
  readonly project: string;
  readonly taskId: string;
  readonly repository: string;
  readonly request: string;
  readonly workflow: string;
  readonly tier: Tier;
  readonly configSnapshotJson?: string;
  readonly allowance?: { auto: number; owner: number };
  readonly projectRecord?: AttemptProjector;
  readonly now?: () => string;
  readonly sessionId?: () => string;
}

/** Mint the task's first attempt at DRAFT. Later attempts belong only to retry. */
export async function newCommand(options: NewCommandOptions): Promise<{ attemptDir: string; status: AttemptStatus }> {
  const root = taskRoot(options.stateRoot, options.project, options.taskId);
  const existing = await latestAttemptNumber(root);
  if (existing !== null) {
    throw new Error(`${options.project}/${options.taskId} already has attempt ${existing}; use \`awsf retry\` after it is terminal`);
  }
  const attempt = 1;
  const dir = attemptDirectory(options.stateRoot, options.project, options.taskId, String(attempt));
  const now = (options.now ?? ((): string => new Date().toISOString()))();
  const status: AttemptStatus = {
    schema: "awsf/attempt-status/v1",
    sessionId: (options.sessionId ?? randomUUID)(),
    project: options.project,
    taskId: options.taskId,
    attempt,
    repository: resolve(options.repository),
    worktree: null,
    workflow: options.workflow,
    tier: options.tier,
    request: options.request,
    configSnapshotJson: options.configSnapshotJson ?? "{}",
    lifecycleState: "DRAFT",
    baseSha: null,
    candidateSha: null,
    phase: null,
    budget: {
      attempt,
      callsSpent: 0,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
      allowance: { ...(options.allowance ?? { auto: 1, owner: 1 }) },
    },
    model: null,
    lastActivityAt: now,
    lastActivity: "attempt recorded; no worktree or provider exists yet",
    nextAction: nextActionFor("DRAFT", options.taskId),
    gatesPass: false,
    requiredReviewPresent: false,
    journeyApproved: false,
    protectedApprovalsValid: false,
    process: null,
    landingApproval: null,
    blocker: null,
    revision: 1,
    lastSourceSeq: 1,
  };
  // Calling this also pins the configured ceiling at creation time through the
  // budget vocabulary; it throws if tier is not one of 0/1/2.
  ceilingFor(options.tier);
  return {
    attemptDir: dir,
    status: await persistAttempt(dir, null, { kind: "attempt.created", next: status }, options.projectRecord),
  };
}
