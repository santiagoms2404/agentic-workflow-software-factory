import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { assertCandidateSeed, type CandidateSeed } from "../../contracts/candidate-seed.ts";
import { ShiftManifestSchema, shiftManifestDigest, type ShiftManifest } from "../../contracts/shift-selection-record.ts";
import { isCompiledWorkflowId } from "../../workflow/compiled-ids.ts";
import { sha256 } from "../../contracts/owner-amendment.ts";
import { attemptDir as attemptDirectory } from "../../persistence/platform-paths.ts";
import { correctionAllowance } from "../../state/task-machine.ts";
import { assertCeiling, ceilingFor, type CallCeilings, type Tier } from "../../state/tiers.ts";
import type { PhaseRouteOverrides } from "../../workflow/route-flags.ts";
import {
  assertGroupId,
  assertPlanRef,
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
  /** Host-authorized seed, persisted atomically with the first target event. */
  readonly seed?: CandidateSeed;
  /** The sealed selection a `shift` compiles from. Required for a shift and refused for anything else. */
  readonly shift?: ShiftManifest;
  /**
   * The driving session that minted this task. Absent means NULL: no group
   * existed for it, which is the honest record and never a guess.
   */
  readonly groupId?: string;
  /**
   * The registered plan this task belongs to, already resolved against the
   * catalog by the caller. Absent means NULL: no plan was named, and none is
   * inferred from the task id's shape or from the request's words.
   */
  readonly planRef?: string;
  readonly repository: string;
  readonly request: string;
  readonly workflow: string;
  readonly tier: Tier;
  readonly configSnapshotJson?: string;
  /**
   * The attempt's own `--route` selections. Attempt state, never folded into
   * `configSnapshotJson`: the snapshot must keep equalling the file on disk or
   * `awsf rework` and `awsf review` refuse this attempt for a difference the
   * owner deliberately introduced.
   */
  readonly routeOverrides?: PhaseRouteOverrides;
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
  if (options.groupId !== undefined) assertGroupId(options.groupId);
  if (options.planRef !== undefined) assertPlanRef(options.planRef);
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
  // A shift's phase list exists only once a selection is bound, so the binding
  // is made here, where the attempt is, and never inferred later.
  if (isCompiledWorkflowId(options.workflow) !== (options.shift !== undefined)) {
    throw new Error(`workflow ${JSON.stringify(options.workflow)} ${options.shift === undefined ? "requires" : "cannot carry"} a sealed shift selection`);
  }
  if (options.shift !== undefined && (!Value.Check(ShiftManifestSchema, options.shift) || shiftManifestDigest(options.shift) !== options.shift.manifestDigest)) {
    throw new Error("shift selection is not a sealed awsf.shift-manifest/v1");
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
    groupId: options.groupId ?? null,
    planRef: options.planRef ?? null,
    attempt,
    repository: resolve(options.repository),
    worktree: null,
    workflow: options.workflow,
    tier: options.tier,
    request: options.request,
    configSnapshotJson: options.configSnapshotJson ?? "{}",
    lifecycleState: "DRAFT",
    baseSha: options.seed?.integrationBaseSha ?? null,
    candidateSha: null,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    ...(options.shift === undefined ? {} : { shift: options.shift }),
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
    routeOverrides: options.routeOverrides ?? {},
    reviewDegradation: null,
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
  if (options.seed !== undefined) {
    const seed = options.seed;
    assertCandidateSeed(seed);
    if (seed.target.taskId !== status.taskId || seed.target.project !== status.project || seed.target.sessionId !== status.sessionId ||
        seed.target.attempt !== 1 || seed.workflow !== status.workflow || status.tier !== 2 || status.continuesTask !== seed.source.taskId ||
        seed.configDigest !== sha256(status.configSnapshotJson) || seed.requestDigest !== sha256(status.request)) throw new Error("seed does not bind this new target");
  }
  return {
    attemptDir: dir,
    status: await persistAttempt(dir, null, { kind: "attempt.created", next: status,
      ...(options.seed === undefined ? {} : { evidence: { type: "candidate-seed" as const, seed: options.seed } }),
    }, options.projectRecord),
  };
}
