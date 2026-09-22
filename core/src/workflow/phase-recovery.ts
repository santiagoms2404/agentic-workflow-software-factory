import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnvelope } from "../contracts/parse-envelope.ts";
import { assertPhaseRecovery, recoveryDigest, recoveryBudgetDigest, type PhaseRecovery } from "../contracts/phase-recovery.ts";
import type { StoredEnvelope } from "../contracts/stored-envelope.ts";
import { savedResultTreeDigest } from "./saved-phase-result.ts";
import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import type { AttemptEvent, AttemptStatus } from "../cli/commands/attempt.ts";
import { deriveAttemptStatus, readAttempt } from "../cli/commands/attempt.ts";
import { scanJournalText } from "../persistence/replay.ts";
import { journalFilePath, statusFilePath, lockFilePath } from "../persistence/platform-paths.ts";
import { AttemptLock } from "../persistence/attempt-lock.ts";
import { writeStatus } from "../persistence/status-store.ts";
import { assertClean, runGit, type GitRunner } from "../git/changes.ts";
import { reconcileHostCommit, type HostCommitReconciliation } from "../git/commit-reconcile.ts";
import { planHostValidationRecovery, type HostValidationRecovery } from "./host-validation.ts";
import { runSystemCommand } from "../execution/transport-broker.ts";
const readOnlyGit = (repository: string): GitRunner => argv => runSystemCommand("git", ["-C", repository, ...argv], {
  env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 30_000,
});
import type { PhaseEvidenceRecord } from "../observability/attempt-evidence.ts";
import { acceptedResumeInstructions } from "./resume-instruction.ts";

/**
 * Everything a stage advance may NOT change: the accepted prefix, the identity
 * pins, the retained debit and the saved reply itself. A `validating`
 * checkpoint is tied to the `result-ready` checkpoint that proved the reply by
 * this digest, because `id`, `createdAt`, `kind` and `validation` are exactly
 * the four fields an advance is allowed to move.
 */
function savedReplyBinding(checkpoint: PhaseRecovery): string {
  const { id: _id, createdAt: _createdAt, kind: _kind, validation: _validation, ...bound } = checkpoint;
  return recoveryDigest(bound);
}

/** Reads journal truth without repairing anything during owner preflight. */
export async function inspectPhaseRecovery(attemptDir: string) {
  const scan = scanJournalText<AttemptEvent>(await readFile(journalFilePath(attemptDir), "utf8"), journalFilePath(attemptDir));
  if (!scan.ok || scan.tornTail !== null) throw new Error("recovery refused: corrupt or torn journal; retain it for diagnosis");
  const status = deriveAttemptStatus(scan.records);
  if (status === null) throw new Error("recovery refused: empty journal");
  const disk = await readAttempt(attemptDir);
  const historical = deriveAttemptStatus(scan.records.slice(0, disk.revision));
  if (historical === null || recoveryDigest(historical) !== recoveryDigest(disk)) throw new Error("recovery refused: status disagrees with journal");
  const creation = scan.records[0]?.event.evidence;
  if (recoveryDigest(creation?.type === "candidate-seed" ? creation.seed : null) !== recoveryDigest(status.seed ?? null)) {
    throw new Error("recovery refused: seed differs from its atomic creation evidence");
  }
  const checkpoint = status.recovery;
  if (checkpoint == null) throw new Error("recovery refused: no durable accepted-phase checkpoint; legacy or interrupted results cannot be replayed");
  assertPhaseRecovery(checkpoint);
  if (checkpoint.sessionId !== status.sessionId || checkpoint.workflowId !== status.workflow ||
      checkpoint.repository !== status.repository || checkpoint.worktree !== status.worktree || checkpoint.integrationBaseSha !== status.baseSha) {
    throw new Error("recovery checkpoint belongs to another attempt or repository");
  }
  if (status.process !== null || status.budget.callsReserved !== 0 || recoveryBudgetDigest(status.budget) !== checkpoint.budgetDigest) {
    throw new Error("recovery refused: active or unsettled execution; no refund or relaunch is authorized");
  }
  const pending = checkpoint.pending;
  const progress = checkpoint.validation;
  let pendingEnvelope: StoredEnvelope<EnvelopeBase> | null = null;
  if (pending !== undefined) {
    const proof = scan.records.findLast(record => record.event.evidence?.type === "phase-result-ready" &&
      (progress === undefined || record.event.evidence.checkpoint.id === progress.resultCheckpointId));
    const origin = proof?.event.evidence?.type === "phase-result-ready" ? proof.event.evidence.checkpoint : null;
    // Before validation starts the checkpoint IS the completion proof. Once it
    // starts, the checkpoint advances stage by stage while the original
    // completion proof stays where it was written, so the two are tied by the
    // cited id and by every binding a stage advance may not touch — the
    // accepted prefix, the worktree pins, the saved reply and its debit.
    const ties = origin !== null && (progress === undefined
      ? recoveryDigest(origin) === recoveryDigest(checkpoint)
      : origin.kind === "result-ready" && savedReplyBinding(origin) === savedReplyBinding(checkpoint));
    if (!ties || proof!.event.evidence!.type !== "phase-result-ready" || proof!.event.evidence.phase.key !== pending.phaseKey ||
        proof!.event.evidence.phase.ordinal !== pending.ordinal || proof!.event.evidence.phase.status !== "VALIDATING" ||
        proof!.event.evidence.phase.correctionCount !== pending.round || pending.reservation.attempt !== status.attempt ||
        scan.records.some(record => record.event.evidence?.type === "phase-validation-started" && record.event.evidence.checkpointId === checkpoint.id)) {
      throw new Error("saved reply validation has started or its completion proof changed");
    }
    if (progress !== undefined) {
      // A durable stage is only ever installed by the event that announces the
      // stage advance. A checkpoint that appeared in any other event is not a
      // record of what the host actually reached.
      const installed = scan.records.find(record => record.event.next.recovery != null &&
        recoveryDigest(record.event.next.recovery) === recoveryDigest(checkpoint));
      if (installed?.event.evidence?.type !== "phase-validation-started" ||
          installed.event.evidence.phaseId !== `${status.sessionId}:${pending.phaseKey}` ||
          !scan.records.some(record => record.event.evidence?.type === "phase-validation-started" &&
            record.event.evidence.checkpointId === progress.resultCheckpointId)) {
        throw new Error("host validation stage has no durable advance evidence");
      }
    }
    const exit = scan.records.map(record => record.event.evidence).findLast(evidence => evidence?.type === "process" && evidence.record.runId === pending.runId);
    if (exit?.type !== "process" || exit.status !== "EXITED" || exit.exitCode !== 0 || exit.endedAt === null || exit.phaseId !== `${status.sessionId}:${pending.phaseKey}`) throw new Error("saved reply has no completed original process");
    const originRun = pending.runId.replace(/:c\d+$/, "");
    const debit = scan.records.some(record => record.event.evidence?.type === "process" &&
      record.event.evidence.phaseId === `${status.sessionId}:${pending.phaseKey}` && record.event.evidence.record.runId === originRun &&
      record.event.evidence.record.reservationId === pending.reservation.id && record.event.evidence.record.edge === pending.reservation.edge &&
      record.event.evidence.status === "RUNNING" && record.event.evidence.releasedAt !== null);
    if (!debit) throw new Error("saved reply original debit is unproved");
    const route = scan.records.map(record => record.event.evidence).findLast(evidence => evidence?.type === "agent-start" && evidence.phaseId === `${status.sessionId}:${pending.phaseKey}`);
    if (route?.type !== "agent-start" || (route.route?.effective.adapterKind ?? route.adapterId) !== pending.model.adapter || route.provider !== pending.model.provider ||
        route.requestedModel !== pending.model.requestedModel) throw new Error("saved reply original route is unproved");
  }
  const phases = new Map<string, PhaseEvidenceRecord>();
  const envelopes = new Map<string, EnvelopeBase>();
  const accepted = new Map<string, string>();
  for (const record of scan.records) {
    if (record.event.next.sessionId !== status.sessionId || record.event.next.revision !== record.source_seq) throw new Error("recovery journal identity or sequence mismatch");
    const evidence = record.event.evidence;
    if ((evidence?.type === "phase" || evidence?.type === "resume-activation" || evidence?.type === "protected-activation") && evidence.phase !== null) phases.set(evidence.phase.key, evidence.phase);
    if (evidence?.type === "phase-result-ready") phases.set(evidence.phase.key, evidence.phase);
    if (evidence?.type === "phase-accepted") {
      phases.set(evidence.phase.key, evidence.phase);
      accepted.set(evidence.phase.key, recoveryDigest(evidence.accepted));
    }
    if (evidence?.type === "envelope") {
      if (pending?.envelopeId === evidence.envelope.envelopeId) {
        if (pendingEnvelope !== null || recoveryDigest(evidence.envelope) !== pending.envelopeDigest ||
            evidence.envelope.phaseId !== pending.phaseKey || evidence.envelope.sessionId !== status.sessionId ||
            evidence.envelope.correctionRound !== pending.round || !evidence.envelope.valid || evidence.envelope.payload === null ||
            !parseEnvelope(JSON.stringify(evidence.envelope.payload), evidence.envelope.schemaId).valid) throw new Error("saved reply envelope changed or is invalid");
        pendingEnvelope = evidence.envelope;
      }
      const match = checkpoint.prefix.find(entry => entry.envelopeId === evidence.envelope.envelopeId);
      if (match === undefined) continue;
      if (envelopes.has(match.phaseKey) || !evidence.envelope.valid || evidence.envelope.payload === null ||
          evidence.envelope.correctionRound !== match.round || recoveryDigest(evidence.envelope) !== match.envelopeDigest ||
          !parseEnvelope(JSON.stringify(evidence.envelope.payload), evidence.envelope.schemaId).valid) {
        throw new Error("accepted envelope is missing, duplicated, changed or invalid");
      }
      envelopes.set(match.phaseKey, evidence.envelope.payload);
    }
  }
  for (const entry of checkpoint.prefix) {
    if (!envelopes.has(entry.phaseKey) || accepted.get(entry.phaseKey) !== recoveryDigest(entry) || phases.get(entry.phaseKey)?.status !== "SUCCEEDED") {
      throw new Error("recovery refused: accepted phase completion is unproved");
    }
  }
  for (const phase of phases.values()) {
    if (phase.key === pending?.phaseKey && phase.ordinal === pending.ordinal && phase.status === "VALIDATING") continue;
    if (phase.ordinal > checkpoint.prefix.length && phase.status !== "QUEUED") throw new Error("recovery refused: a later phase has already started");
  }
  if (pending !== undefined && pendingEnvelope === null) throw new Error("saved reply envelope is missing");
  const allInstructions = acceptedResumeInstructions(scan.records, status, checkpoint.prefix, pending);
  const pendingInstruction = allInstructions.find(instruction => instruction.amendment.binding.phaseKey === pending?.phaseKey) ?? null;
  const instructions = allInstructions.filter(instruction => instruction !== pendingInstruction);
  return { status, checkpoint, phases, envelopes, instructions, pendingInstruction, pendingEnvelope, records: scan.records, disk };
}

/**
 * What a recovering host may do about an interrupted host-validation segment,
 * and the candidate that segment is bound to.
 *
 * `commit` is null when the cut fell inside the read-only prefix, where no
 * commit could have been attempted. `candidateSha` is the revision the phase
 * would accept: the reconciled commit, or the prefix's existing candidate when
 * nothing was committed.
 */
export interface ValidationReconciliation {
  readonly plan: HostValidationRecovery;
  readonly commit: HostCommitReconciliation | null;
  readonly candidateSha: string | null;
}

/**
 * Reconcile the effectful half of host validation against Git objects.
 *
 * Nothing here writes. Every branch either identifies one exact outcome or
 * throws, and a throw leaves the worktree, the index, the candidate and the
 * retained debit exactly as the crash left them. In particular, an ambiguous
 * commit history is a refusal — never a reset, a clean, a stash, or a second
 * commit that would "make it look right".
 */
export async function reconcileHostValidation(
  status: AttemptStatus, checkpoint: PhaseRecovery, git: GitRunner,
): Promise<ValidationReconciliation> {
  const progress = checkpoint.validation!;
  const pending = checkpoint.pending!;
  const inherited = checkpoint.prefix.at(-1)?.candidateSha ?? null;
  const plan = planHostValidationRecovery(progress);
  if (plan.action === "refuse") throw new Error(`recovery refused: ${plan.reason}`);
  // A protected host effect is identified against its own durable intent and
  // binding, under the execution lease, by `git/protected-reconcile.ts`.
  // Preflight states the plan and touches nothing.
  if (plan.action === "reconcile-protected") return Object.freeze({ plan, commit: null, candidateSha: inherited });
  if (plan.action === "replay") {
    if (await savedResultTreeDigest(status.worktree!, git) !== pending.worktreeDigest) throw new Error("saved reply worktree or index bytes changed");
    if (runGit(git, ["rev-parse", "HEAD"]).trim() !== checkpoint.worktreeHeadSha) throw new Error("recovery refused: HEAD moved during read-only host validation");
    return Object.freeze({ plan, commit: null, candidateSha: inherited });
  }
  const commit = await reconcileHostCommit(plan.intent, { worktree: status.worktree!, git });
  if (commit.outcome === "refused") throw new Error(`recovery refused: ${commit.reason}`);
  if (commit.outcome === "not-committed") {
    // The transport never ran, so the exact bytes it was going to commit must
    // still be the exact bytes the saved reply left behind.
    if (await savedResultTreeDigest(status.worktree!, git) !== pending.worktreeDigest) throw new Error("saved reply worktree or index bytes changed");
  }
  const recorded = plan.result;
  if (recorded !== null) {
    if ((recorded.commitSha === null) !== (commit.outcome === "not-committed") ||
        (commit.outcome === "committed" && commit.commitSha !== recorded.commitSha)) {
      throw new Error("recovery refused: the durable commit result and the repository name different revisions");
    }
    if (await savedResultTreeDigest(status.worktree!, git) !== recorded.treeDigest) throw new Error("recovery refused: worktree or index bytes changed after the recorded commit");
  }
  return Object.freeze({ plan, commit,
    candidateSha: commit.outcome === "committed" ? commit.commitSha : inherited });
}

export async function verifyRecoveryWorktree(status: AttemptStatus, checkpoint: PhaseRecovery): Promise<ValidationReconciliation | null> {
  if (status.worktree === null || status.baseSha === null) throw new Error("recovery has no worktree");
  const git = readOnlyGit(status.worktree);
  const canonical = readOnlyGit(status.repository);
  // A `validating` checkpoint answers the tree and HEAD questions against its
  // recorded commit intent, because HEAD legitimately advances at exactly one
  // point inside the segment. Every other checkpoint keeps the original rule.
  const reconciliation = checkpoint.validation === undefined ? null : await reconcileHostValidation(status, checkpoint, git);
  if (reconciliation === null && checkpoint.pending === undefined) assertClean(status.worktree, "before", git);
  else if (reconciliation === null && await savedResultTreeDigest(status.worktree, git) !== checkpoint.pending!.worktreeDigest) throw new Error("saved reply worktree or index bytes changed");
  if (runGit(git, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() !== "HEAD" ||
      (reconciliation === null && runGit(git, ["rev-parse", "HEAD"]).trim() !== checkpoint.worktreeHeadSha) ||
      runGit(canonical, ["rev-parse", "HEAD"]).trim() !== checkpoint.integrationBaseSha ||
      await realpath(runGit(git, ["rev-parse", "--show-toplevel"]).trim()) !== await realpath(status.worktree) ||
      await realpath(runGit(git, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()) !== checkpoint.commonGitDir ||
      await realpath(runGit(canonical, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()) !== checkpoint.commonGitDir ||
      await realpath(status.repository) !== checkpoint.repository || await realpath(status.worktree) !== checkpoint.worktree) {
    throw new Error("recovery refused: repository, detached HEAD, canonical base or worktree binding changed");
  }
  const registered = runGit(canonical, ["worktree", "list", "--porcelain", "-z"]);
  if (!registered.split("\0").includes(`worktree ${resolve(status.worktree)}`)) throw new Error("recovery worktree is no longer registered");
  return reconciliation;
}

/** Only called after owner confirmation and validation, under the execution lease. */
export async function reconcileRecoveryStatus(attemptDir: string, inspected: Awaited<ReturnType<typeof inspectPhaseRecovery>>): Promise<void> {
  if (inspected.disk.revision === inspected.status.revision) return;
  await new AttemptLock(lockFilePath(attemptDir)).withLock(async () => {
    const current = await inspectPhaseRecovery(attemptDir);
    if (recoveryDigest(current.status) !== recoveryDigest(inspected.status)) throw new Error("recovery journal changed during reconciliation");
    await writeStatus(statusFilePath(attemptDir), inspected.status);
  });
}

/** Initial execution and re-entry use exactly this schema-based context reduction. */
export function reducePhaseContext(previous: ReadonlyMap<string, EnvelopeBase>, initial: EnvelopeBase) {
  const schemas = new Map<string, EnvelopeBase>();
  let last = initial;
  for (const envelope of previous.values()) { schemas.set(envelope.schema, envelope); last = envelope; }
  return { previous: last, schemas };
}
