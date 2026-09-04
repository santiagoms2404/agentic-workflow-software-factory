import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { attemptDir as attemptDirectory } from "../../persistence/platform-paths.ts";
import { correctionAllowance } from "../../state/task-machine.ts";
import { assertCeiling, ceilingFor, type CallCeilings, type Tier } from "../../state/tiers.ts";
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
  readonly continuesTask?: string;
  readonly repository: string;
  readonly request: string;
  readonly workflow: string;
  readonly tier: Tier;
  readonly configSnapshotJson?: string;
  /**
   * The effective configuration's `risk.call_ceiling`. Omitted, the tier's
   * documented default applies — the same number the hardcoded constant gave
   * before the field was connected.
   */
  readonly callCeilings?: CallCeilings;
  readonly allowance?: { auto: number; owner: number; ownerReentries?: number };
  readonly projectRecord?: AttemptProjector;
  readonly now?: () => string;
  readonly sessionId?: () => string;
}

/** Mint the task's first attempt at DRAFT. Later attempts belong only to retry. */
export async function newCommand(options: NewCommandOptions): Promise<{ attemptDir: string; status: AttemptStatus }> {
  const root = taskRoot(options.stateRoot, options.project, options.taskId);
  if (options.continuesTask === options.taskId) {
    throw new Error(`${options.project}/${options.taskId} cannot continue itself`);
  }
  if (options.continuesTask !== undefined) {
    const continuedRoot = taskRoot(options.stateRoot, options.project, options.continuesTask);
    if (await latestAttemptNumber(continuedRoot) === null) {
      throw new Error(
        `${options.project}/${options.taskId} cannot continue missing task ${options.project}/${options.continuesTask}`,
      );
    }
  }
  const existing = await latestAttemptNumber(root);
  if (existing !== null) {
    throw new Error(`${options.project}/${options.taskId} already has attempt ${existing}; use \`awsf retry\` after it is terminal`);
  }
  const attempt = 1;
  const dir = attemptDirectory(options.stateRoot, options.project, options.taskId, String(attempt));
  const now = (options.now ?? ((): string => new Date().toISOString()))();
  // Pinned at creation from the effective configuration, and recorded on the
  // attempt: a later edit to `awsf.config.yaml` moves nobody's live ceiling,
  // and only `awsf raise` moves this one.
  const ceiling = assertCeiling(
    ceilingFor(options.tier, options.callCeilings),
    `${options.project}/${options.taskId} at T${options.tier}`,
  );
  const status: AttemptStatus = {
    schema: "awsf/attempt-status/v1",
    sessionId: (options.sessionId ?? randomUUID)(),
    project: options.project,
    taskId: options.taskId,
    continuesTask: options.continuesTask ?? null,
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
      ownerReentries: 0,
      allowance: correctionAllowance(options.allowance ?? { auto: 1, owner: 1 }),
      ceiling,
    },
    ceilingGrants: [],
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
  return {
    attemptDir: dir,
    status: await persistAttempt(dir, null, { kind: "attempt.created", next: status }, options.projectRecord),
  };
}
