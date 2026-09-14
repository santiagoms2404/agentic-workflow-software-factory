import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnvelope } from "../contracts/parse-envelope.ts";
import { assertPhaseRecovery, recoveryDigest, recoveryBudgetDigest, type PhaseRecovery } from "../contracts/phase-recovery.ts";
import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import type { AttemptEvent, AttemptStatus } from "../cli/commands/attempt.ts";
import { deriveAttemptStatus, readAttempt } from "../cli/commands/attempt.ts";
import { scanJournalText } from "../persistence/replay.ts";
import { journalFilePath, statusFilePath, lockFilePath } from "../persistence/platform-paths.ts";
import { AttemptLock } from "../persistence/attempt-lock.ts";
import { writeStatus } from "../persistence/status-store.ts";
import { assertClean, runGit, type GitRunner } from "../git/changes.ts";
import { runSystemCommand } from "../execution/transport-broker.ts";
const readOnlyGit = (repository: string): GitRunner => argv => runSystemCommand("git", ["-C", repository, ...argv], {
  env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 30_000,
});
import type { PhaseEvidenceRecord } from "../observability/attempt-evidence.ts";
import { acceptedResumeInstructions } from "./resume-instruction.ts";

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
  const phases = new Map<string, PhaseEvidenceRecord>();
  const envelopes = new Map<string, EnvelopeBase>();
  const accepted = new Map<string, string>();
  for (const record of scan.records) {
    if (record.event.next.sessionId !== status.sessionId || record.event.next.revision !== record.source_seq) throw new Error("recovery journal identity or sequence mismatch");
    const evidence = record.event.evidence;
    if ((evidence?.type === "phase" || evidence?.type === "resume-activation") && evidence.phase !== null) phases.set(evidence.phase.key, evidence.phase);
    if (evidence?.type === "phase-accepted") {
      phases.set(evidence.phase.key, evidence.phase);
      accepted.set(evidence.phase.key, recoveryDigest(evidence.accepted));
    }
    if (evidence?.type === "envelope") {
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
    if (phase.ordinal > checkpoint.prefix.length && phase.status !== "QUEUED") throw new Error("recovery refused: a later phase has already started");
  }
  const instructions = acceptedResumeInstructions(scan.records, status, checkpoint.prefix);
  return { status, checkpoint, phases, envelopes, instructions, records: scan.records, disk };
}

export async function verifyRecoveryWorktree(status: AttemptStatus, checkpoint: PhaseRecovery): Promise<void> {
  if (status.worktree === null || status.baseSha === null) throw new Error("recovery has no worktree");
  const git = readOnlyGit(status.worktree);
  const canonical = readOnlyGit(status.repository);
  assertClean(status.worktree, "before", git);
  if (runGit(git, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() !== "HEAD" ||
      runGit(git, ["rev-parse", "HEAD"]).trim() !== checkpoint.worktreeHeadSha ||
      runGit(canonical, ["rev-parse", "HEAD"]).trim() !== checkpoint.integrationBaseSha ||
      await realpath(runGit(git, ["rev-parse", "--show-toplevel"]).trim()) !== await realpath(status.worktree) ||
      await realpath(runGit(git, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()) !== checkpoint.commonGitDir ||
      await realpath(runGit(canonical, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()) !== checkpoint.commonGitDir ||
      await realpath(status.repository) !== checkpoint.repository || await realpath(status.worktree) !== checkpoint.worktree) {
    throw new Error("recovery refused: repository, detached HEAD, canonical base or worktree binding changed");
  }
  const registered = runGit(canonical, ["worktree", "list", "--porcelain", "-z"]);
  if (!registered.split("\0").includes(`worktree ${resolve(status.worktree)}`)) throw new Error("recovery worktree is no longer registered");
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
