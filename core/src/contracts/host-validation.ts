import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
const id = Type.String({ minLength: 1 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const sha = Type.String({ pattern: "^[a-f0-9]{40}$" });

/**
 * Host validation of one already-complete reply, in the exact order
 * `runAgentPhase` performs it.
 *
 * The first four stages only READ: they reduce durable bytes (the stored
 * envelope, the retained worktree) to a verdict and leave nothing behind, so a
 * crash inside any of them is recovered by running them again. `commit` and
 * `verify-candidate` ACT — one writes a Git object, the other dispatches
 * owner-configured commands — so a crash at or after either is recovered by
 * reconciling what actually happened, never by repeating it.
 */
export const HOST_VALIDATION_STAGES = [
  "envelope-check", "gates", "permission-enforce", "capture-diff", "commit", "verify-candidate", "accept",
] as const;
export type HostValidationStage = (typeof HOST_VALIDATION_STAGES)[number];
/** The two stages whose work cannot be undone by observing that it failed to finish. */
export const EFFECTFUL_HOST_VALIDATION_STAGES: readonly HostValidationStage[] = Object.freeze(["commit", "verify-candidate"]);
export const HostValidationStageSchema = Type.Union(HOST_VALIDATION_STAGES.map(stage => Type.Literal(stage)));

/**
 * Everything needed to recognise the one commit this host was about to create,
 * recorded BEFORE the transport that creates it.
 *
 * `committedPaths` and `contentDigest` describe the whole working tree against
 * `parentSha`, not only the paths this turn touched, because `commitAsHost`
 * stages `--all`. `changedPaths` is retained separately as the host-captured
 * diff object the permission check actually ran on.
 */
export const HostCommitIntentSchema = Type.Object({
  intentId: id, phaseKey: id, ordinal: Type.Integer({ minimum: 1 }), round: Type.Integer({ minimum: 0 }), runId: id,
  parentSha: sha, message: Type.String({ minLength: 1 }), author: id, committer: id,
  changedPaths: Type.Array(Type.String({ minLength: 1 })), committedPaths: Type.Array(Type.String({ minLength: 1 })),
  contentDigest: hash, treeDigest: hash,
}, { additionalProperties: false });
export type HostCommitIntent = Static<typeof HostCommitIntentSchema>;

/** The durable outcome of that one transport. `commitSha` is null for a phase that changed nothing. */
export const HostCommitResultSchema = Type.Object({
  intentId: id, commitSha: Type.Union([sha, Type.Null()]), treeDigest: hash,
}, { additionalProperties: false });
export type HostCommitResult = Static<typeof HostCommitResultSchema>;

export const HostValidationProgressSchema = Type.Object({
  schema: Type.Literal("awsf.host-validation/v1"),
  phaseKey: id, ordinal: Type.Integer({ minimum: 1 }), round: Type.Integer({ minimum: 0 }), runId: id,
  envelopeId: id, envelopeDigest: hash,
  /** The `result-ready` checkpoint this segment descends from, so its original debit proof stays reachable. */
  resultCheckpointId: id,
  /** The stage about to run. Every earlier stage is durably finished. */
  stage: HostValidationStageSchema,
  commitIntent: Type.Union([HostCommitIntentSchema, Type.Null()]),
  commitResult: Type.Union([HostCommitResultSchema, Type.Null()]),
  /**
   * Set instead of `commitIntent` when this phase commits under a protected
   * grant. That transport records its own durable intent and binding, so the
   * stage names the consumption and the reconciliation reads A2's evidence
   * rather than keeping a second, weaker copy of it here.
   */
  protectedConsumptionId: Type.Union([id, Type.Null()]),
}, { additionalProperties: false });
export type HostValidationProgress = Static<typeof HostValidationProgressSchema>;

export const stageOrdinal = (stage: HostValidationStage): number => HOST_VALIDATION_STAGES.indexOf(stage);
export const isRepeatableStage = (stage: HostValidationStage): boolean => !EFFECTFUL_HOST_VALIDATION_STAGES.includes(stage);
/** The first stage of the read-only prefix. Replay always restarts there, never part-way through it. */
export const FIRST_HOST_VALIDATION_STAGE: HostValidationStage = "envelope-check";

export function assertHostValidationProgress(value: unknown): asserts value is HostValidationProgress {
  if (!Value.Check(HostValidationProgressSchema, value)) throw new Error("host validation progress is invalid");
  const committing = stageOrdinal(value.stage) >= stageOrdinal("commit");
  const committed = stageOrdinal(value.stage) > stageOrdinal("commit");
  const protectedEffect = value.protectedConsumptionId !== null;
  if (committing !== (value.commitIntent !== null || protectedEffect) || (value.commitIntent !== null && protectedEffect) ||
      (value.commitResult !== null) !== (committed && !protectedEffect)) {
    throw new Error("host validation stage disagrees with its recorded commit evidence");
  }
  const intent = value.commitIntent;
  if (intent !== null && (intent.phaseKey !== value.phaseKey || intent.ordinal !== value.ordinal ||
      intent.round !== value.round || intent.runId !== value.runId)) throw new Error("host commit intent belongs to another turn");
  if (value.commitResult !== null && value.commitResult.intentId !== intent!.intentId) throw new Error("host commit result cites another intent");
  if (intent !== null && (new Set(intent.committedPaths).size !== intent.committedPaths.length ||
      intent.committedPaths.some((path, index) => index > 0 && path <= intent.committedPaths[index - 1]!))) {
    throw new Error("host commit intent paths are duplicated or unsorted");
  }
  if (intent !== null && intent.committedPaths.length === 0 && value.commitResult !== null && value.commitResult.commitSha !== null) {
    throw new Error("host commit result claims a commit for an empty change-set");
  }
}
