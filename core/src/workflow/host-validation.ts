import { FIRST_HOST_VALIDATION_STAGE, isRepeatableStage, stageOrdinal,
  type HostCommitIntent, type HostCommitResult, type HostValidationProgress, type HostValidationStage } from "../contracts/host-validation.ts";

/**
 * What the command ledger says about the interrupted `verify-candidate` stage,
 * reduced by the impure caller from durable evidence.
 *
 * Absent means no ledger verdict is available — a legacy attempt, or a host that
 * could not read one — and the stage keeps its original refusal.
 */
export type VerifyCandidateLedgerVerdict =
  | { readonly action: "restore-all" }
  | { readonly action: "resume"; readonly gateIds: readonly string[] }
  | { readonly action: "refuse"; readonly reason: string };

/**
 * What a recovering host may do about an interrupted host-validation segment,
 * decided from durable evidence alone.
 *
 * `replay` is only ever offered for a prefix that is entirely read-only.
 * `reconcile-commit` hands the caller the recorded intent so Git objects can
 * decide whether that exact commit exists; it is never permission to commit
 * something else. `reconcile-commands` names the configured commands that
 * provably never ran, and only those. `refuse` names the missing proof and
 * authorizes nothing.
 */
export type HostValidationRecovery =
  | { readonly action: "replay"; readonly from: HostValidationStage }
  | { readonly action: "reconcile-commit"; readonly intent: HostCommitIntent; readonly result: HostCommitResult | null; readonly resumeAt: HostValidationStage }
  | { readonly action: "reconcile-protected"; readonly consumptionId: string; readonly resumeAt: HostValidationStage }
  | { readonly action: "reconcile-commands"; readonly dispatch: readonly string[]; readonly resumeAt: HostValidationStage }
  | { readonly action: "refuse"; readonly reason: string };

/**
 * A3's cut table for one saved reply's host validation.
 *
 * Read-only prefix — replay it whole. Restarting at the first stage rather than
 * at the recorded one costs a second pure reduction and removes the question of
 * whether a half-finished gate left a verdict behind.
 *
 * `commit` — the transport may or may not have run. Only Git objects can say,
 * so the decision is deferred to `reconcileHostCommit` with the recorded intent.
 *
 * `verify-candidate` — the commit is durable, but owner-configured commands
 * were dispatched with no per-command intent/result ledger to consult. Absence
 * of a result is not proof of non-execution, so this refuses. Building that
 * ledger is the named integration requirement that would turn this cut into a
 * reconciliation.
 *
 * `accept` — every effectful step finished durably. Reconcile the commit to
 * prove the candidate is the recorded one, then accept the phase without
 * re-running anything.
 */
export function planHostValidationRecovery(
  progress: HostValidationProgress,
  ledger?: VerifyCandidateLedgerVerdict,
): HostValidationRecovery {
  if (isRepeatableStage(progress.stage) && stageOrdinal(progress.stage) < stageOrdinal("commit")) {
    return Object.freeze({ action: "replay" as const, from: FIRST_HOST_VALIDATION_STAGE });
  }
  if (progress.protectedConsumptionId !== null) {
    // The protected transport keeps its own durable intent and binding, so the
    // publication it left behind is identified against that evidence rather
    // than against a second copy recorded here.
    return Object.freeze({ action: "reconcile-protected" as const, consumptionId: progress.protectedConsumptionId,
      resumeAt: progress.stage === "commit" ? "verify-candidate" as const : progress.stage });
  }
  if (progress.stage === "commit") {
    return Object.freeze({ action: "reconcile-commit" as const, intent: progress.commitIntent!, result: null, resumeAt: "verify-candidate" as const });
  }
  if (progress.stage === "verify-candidate") {
    // A3 named this cut's remedy: a per-command intent/result ledger turns a
    // blanket refusal into a decision. Without one the original refusal stands,
    // because a missing result is still not proof that a command did not run.
    if (ledger === undefined) {
      return Object.freeze({ action: "refuse" as const,
        reason: "configured candidate commands were dispatched for this round with no durable per-command result; " +
          "a missing result is not proof that a command did not run, so recovery neither re-dispatches it nor accepts the phase" });
    }
    if (ledger.action === "refuse") return Object.freeze({ action: "refuse" as const, reason: ledger.reason });
    return Object.freeze({ action: "reconcile-commands" as const,
      dispatch: ledger.action === "restore-all" ? Object.freeze([]) : Object.freeze([...ledger.gateIds]),
      resumeAt: "accept" as const });
  }
  return Object.freeze({ action: "reconcile-commit" as const, intent: progress.commitIntent!, result: progress.commitResult, resumeAt: "accept" as const });
}
