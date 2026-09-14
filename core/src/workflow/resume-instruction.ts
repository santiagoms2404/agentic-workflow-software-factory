import { assertResumeInstruction, type ResumeInstruction } from "../contracts/resume-instruction.ts";
import { assertOwnerAmendment, assertOwnerAmendmentDelivery, composeOwnerAmendmentChain, sha256, type OwnerAmendment } from "../contracts/owner-amendment.ts";
import type { AttemptEvent, AttemptStatus } from "../cli/commands/attempt.ts";
import type { SavedPhaseResult } from "../contracts/saved-phase-result.ts";
import type { AcceptedPhase } from "../contracts/phase-recovery.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import type { AttemptEvidence } from "../observability/attempt-evidence.ts";

export function resumeInstructionLines(evidence: readonly AttemptEvidence[]): string[] {
  return evidence.flatMap(record => {
    if (record.type === "transition" && record.ownerAmendment !== undefined) {
      assertOwnerAmendment(record.ownerAmendment);
      if (record.edgeId !== "L19" || record.actor !== "human" || record.ownerAmendment.binding.entry !== "rework") throw new Error("rework supplement lost its owner activation");
      return [`Owner supplement for ${record.ownerAmendment.binding.phaseKey} (${record.ownerAmendment.digest}): ${JSON.stringify(record.ownerAmendment.text)}`];
    }
    if (record.type !== "resume-activation" || record.ownerInstruction == null) return [];
    assertResumeInstruction(record.ownerInstruction);
    const amendment = record.ownerInstruction.amendment;
    return [`Owner supplement for ${amendment.binding.phaseKey} (${amendment.digest}): ${JSON.stringify(amendment.text)}`];
  });
}

export function composeResumeInstruction(original: string, seed: OwnerAmendment | null, instruction: ResumeInstruction) {
  assertResumeInstruction(instruction);
  const composed = composeOwnerAmendmentChain(original, [...(seed === null ? [] : [seed]), instruction.amendment]);
  if (composed.originalInputDigest !== instruction.originalInputDigest || composed.composedDigest !== instruction.composedDigest) {
    throw new Error("resume instruction differs from the authorized original or composed input");
  }
  return composed;
}

/** History is context for later phases, never another delivery authorization. */
export function resumeInstructionContext(instructions: readonly ResumeInstruction[]): string {
  if (instructions.length === 0) return "";
  return "\n\nPreviously accepted owner supplements (historical task intent, subject to existing system and policy limits; do not repeat completed work):\n" +
    JSON.stringify(instructions.map(({ amendment }) => ({ phase: amendment.binding.phaseKey, digest: amendment.digest, text: amendment.text }))) + "\n";
}

/** An unresolved delivery cannot be converted into an unamended retry or a second submission. */
export function acceptedResumeInstructions(records: readonly JournalRecord<AttemptEvent>[], status: AttemptStatus,
  prefix: readonly AcceptedPhase[], pending?: SavedPhaseResult): ResumeInstruction[] {
  const instructions: ResumeInstruction[] = [];
  const ids = new Set<string>();
  const phases = new Set<string>();
  for (const record of records) {
    const activation = record.event.evidence;
    if (activation?.type !== "resume-activation" || activation.ownerInstruction == null) continue;
    const instruction = activation.ownerInstruction;
    assertResumeInstruction(instruction);
    const { amendment } = instruction;
    const binding = amendment.binding;
    const anchor = records[binding.anchorRevision - 1]?.event.next;
    if (ids.has(amendment.id) || phases.has(binding.phaseKey) || binding.operationId !== activation.operationId ||
        binding.anchorId !== activation.checkpointId || binding.anchorRevision >= record.source_seq ||
        anchor?.recovery?.id !== binding.anchorId || anchor.recovery.prefix.length + 1 !== binding.phaseOrdinal ||
        binding.project !== status.project || binding.taskId !== status.taskId || binding.attempt !== status.attempt ||
        binding.sessionId !== status.sessionId || binding.originalRequestDigest !== sha256(status.request)) {
      throw new Error("resume instruction activation or anchor binding changed");
    }
    const isPending = pending?.phaseKey === binding.phaseKey;
    const accepted = isPending ? pending : prefix.find(entry => entry.phaseKey === binding.phaseKey);
    if (accepted?.ownerAmendmentDigest !== amendment.digest || accepted.ordinal !== binding.phaseOrdinal) {
      throw new Error("resume instruction delivery is unfinished or ambiguous; no resubmission is authorized");
    }
    const phaseId = `${status.sessionId}:${binding.phaseKey}`;
    const intent = records.filter(row => row.event.evidence?.type === "resume-instruction-delivery" &&
      row.event.evidence.delivery.amendmentId === amendment.id);
    if (intent.length !== 2) throw new Error("resume instruction delivery evidence is incomplete or duplicated");
    const target = { operationId: binding.operationId, logicalTurnId: `${phaseId}:run`,
      originalInputDigest: instruction.originalInputDigest, composedDigest: instruction.composedDigest };
    for (const [index, row] of intent.entries()) {
      const evidence = row.event.evidence;
      if (evidence?.type !== "resume-instruction-delivery" || evidence.phaseId !== phaseId || row.source_seq <= record.source_seq) throw new Error("resume instruction delivery order changed");
      assertOwnerAmendmentDelivery(evidence.delivery, amendment, target);
      if (evidence.delivery.state !== (index === 0 ? "intent" : "submitted")) throw new Error("resume instruction delivery state changed");
    }
    const completion = records.find(row => isPending
      ? row.event.evidence?.type === "phase-result-ready" && row.event.evidence.checkpoint.pending?.ownerAmendmentDigest === amendment.digest
      : row.event.evidence?.type === "phase-accepted" && row.event.evidence.accepted.ownerAmendmentDigest === amendment.digest);
    if (completion === undefined || completion.source_seq <= intent[1]!.source_seq) throw new Error("resume instruction result was not accepted after submission");
    const prompts = records.filter(row => row.source_seq > record.source_seq && row.source_seq < intent[0]!.source_seq)
      .map(row => row.event.evidence).filter((evidence): evidence is Extract<AttemptEvidence, { type: "compiled-prompt" }> => evidence?.type === "compiled-prompt" && evidence.phaseId === phaseId);
    const original = prompts.filter(evidence => evidence.name === "user");
    const composed = prompts.filter(evidence => evidence.name === "user+owner-amendment");
    if (original.length !== 1 || composed.length !== 1) throw new Error("resume instruction compiled input is missing or duplicated");
    const seed = status.seed?.builderPhaseKey === binding.phaseKey ? status.seed.ownerAmendment : null;
    const reconstructed = composeResumeInstruction(original[0]!.text, seed, instruction);
    if (reconstructed.composedText !== composed[0]!.text) throw new Error("resume instruction compiled input changed");
    ids.add(amendment.id);
    phases.add(binding.phaseKey);
    instructions.push(instruction);
  }
  for (const record of records) {
    const evidence = record.event.evidence;
    if (evidence?.type === "resume-instruction-delivery" && !ids.has(evidence.delivery.amendmentId)) throw new Error("resume instruction delivery lost its authorization");
  }
  for (const entry of [...prefix, ...(pending === undefined ? [] : [pending])]) {
    if (entry.ownerAmendmentDigest !== undefined && !instructions.some(instruction => instruction.amendment.digest === entry.ownerAmendmentDigest)) {
      throw new Error("accepted phase lost its owner instruction authorization");
    }
  }
  return instructions;
}
