import assert from "node:assert/strict";
import { test } from "node:test";
import { createOwnerAmendment, composeOwnerAmendmentChain, sha256, canonicalJson } from "../../../src/contracts/owner-amendment.ts";
import { acceptedResumeInstructions, composeResumeInstruction, resumeInstructionContext, resumeInstructionLines } from "../../../src/workflow/resume-instruction.ts";
import type { ResumeInstruction } from "../../../src/contracts/resume-instruction.ts";
import type { AcceptedPhase } from "../../../src/contracts/phase-recovery.ts";
import type { AttemptStatus, AttemptEvent } from "../../../src/cli/commands/attempt.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../../src/observability/attempt-evidence.ts";
import type { JournalRecord } from "../../../src/persistence/journal.ts";

function fixture() {
  // Reader-only specimens. They do not constitute execution or provider capability proofs.
  const status = { project: "project", taskId: "task", attempt: 1, sessionId: "session", request: "original request", seed: null } as AttemptStatus;
  const original = "original compiled input";
  const amendment = createOwnerAmendment({ id: "supplement", text: '  exact café text\n"quoted"  ', confirmedAt: "2026-09-14T00:00:00Z",
    binding: { entry: "resume", project: status.project, taskId: status.taskId, attempt: 1, sessionId: status.sessionId,
      authorizationId: "authorization", operationId: "operation", phaseKey: "builder", phaseOrdinal: 2,
      anchorId: "anchor", anchorRevision: 1, logicalTurnId: null, correctionRound: 0,
      originalRequestDigest: sha256(status.request), originalPromptBundleDigest: sha256("bundle"), priorAmendmentDigest: null,
      deliveryFrontier: "next-phase-input" } });
  const composed = composeOwnerAmendmentChain(original, [amendment]);
  const instruction: ResumeInstruction = { amendment, originalInputDigest: composed.originalInputDigest, composedDigest: composed.composedDigest };
  const accepted: AcceptedPhase = { phaseKey: "builder", ordinal: 2, envelopeId: "envelope", envelopeDigest: sha256("envelope"), round: 0,
    candidateSha: null, ownerAmendmentDigest: amendment.digest };
  const phase = { key: "builder", phaseId: "session:builder", ordinal: 2, status: "SUCCEEDED" } as PhaseEvidenceRecord;
  const delivery = { schema: "awsf.owner-amendment-delivery/v1" as const, amendmentId: amendment.id, amendmentDigest: amendment.digest,
    bindingDigest: sha256(canonicalJson(amendment.binding)), operationId: "operation", logicalTurnId: "session:builder:run",
    originalInputDigest: composed.originalInputDigest, composedDigest: composed.composedDigest, providerAcknowledgementDigest: null };
  const evidence: AttemptEvidence[] = [
    { type: "resume-activation", operationId: "operation", checkpointId: "anchor", reason: "continue", reservationId: "reservation", phase, ownerInstruction: instruction },
    { type: "compiled-prompt", phaseId: "session:builder", name: "user", text: original, lineCount: 1, at: "now" },
    { type: "compiled-prompt", phaseId: "session:builder", name: "user+owner-amendment", text: composed.composedText, lineCount: 4, at: "now" },
    { type: "resume-instruction-delivery", phaseId: "session:builder", delivery: { ...delivery, state: "intent" }, at: "now" },
    { type: "resume-instruction-delivery", phaseId: "session:builder", delivery: { ...delivery, state: "submitted" }, at: "now" },
    { type: "phase-accepted", phase, accepted },
  ];
  const records: JournalRecord<AttemptEvent>[] = [{ source_seq: 1, recorded_at: "now", event: { kind: "attempt.updated",
    next: { ...status, revision: 1, recovery: { id: "anchor", prefix: [{}] } as NonNullable<AttemptStatus["recovery"]> } } },
    ...evidence.map((value, index) => ({ source_seq: index + 2, recorded_at: "now", event: {
      kind: "attempt.updated" as const, next: { ...status, revision: index + 2 }, evidence: value } }))];
  return { status, original, instruction, accepted, records, evidence };
}

test("resume input preserves exact owner text and original bytes; later intent is explicitly historical", () => {
  const f = fixture();
  const composed = composeResumeInstruction(f.original, null, f.instruction);
  assert.ok(composed.composedText.startsWith(f.original));
  assert.ok(composed.composedText.includes(JSON.stringify(f.instruction.amendment.text)));
  const history = acceptedResumeInstructions(f.records, f.status, [f.accepted]);
  assert.equal(history.length, 1);
  assert.match(resumeInstructionContext(history), /historical task intent/);
  assert.equal(resumeInstructionContext([]), "");
  assert.ok(resumeInstructionLines(f.evidence)[0]!.includes(JSON.stringify(f.instruction.amendment.text)));
});

for (const mutation of ["text", "activation", "request", "input", "missing-submission", "duplicate-submission", "missing-acceptance", "orphan-delivery"] as const) {
  test(`resume instruction refuses ${mutation} instead of replaying input`, () => {
    const f = fixture();
    const activation = f.records[1]!.event.evidence;
    assert.equal(activation?.type, "resume-activation");
    if (activation?.type !== "resume-activation") throw new Error("fixture activation missing");
    switch (mutation) {
      case "text": Object.assign(activation, { ownerInstruction: { ...f.instruction, amendment: { ...f.instruction.amendment, text: "changed" } } }); break;
      case "activation": Object.assign(activation, { operationId: "another-operation" }); break;
      case "request": Object.assign(f.status, { request: "another request" }); break;
      case "input": Object.assign(f.records[2]!.event.evidence!, { text: "substituted input" }); break;
      case "missing-submission": f.records.splice(5, 1); break;
      case "duplicate-submission": f.records.push(f.records[5]!); break;
      case "missing-acceptance": f.records.pop(); break;
      case "orphan-delivery": f.records.splice(1, 1); break;
    }
    assert.throws(() => acceptedResumeInstructions(f.records, f.status, [f.accepted]));
  });
}

test("resume composes after the seed supplement without replacing either instruction", () => {
  const f = fixture();
  const { anchorRevision: _anchorRevision, ...common } = f.instruction.amendment.binding;
  const seed = createOwnerAmendment({ id: "seed-instruction", text: "original seed intent", confirmedAt: "now", binding: {
    ...common, entry: "seed", anchorId: null, priorAmendmentDigest: null, deliveryFrontier: "first-builder-input" } });
  const amendment = createOwnerAmendment({ id: "resume-instruction", text: f.instruction.amendment.text, confirmedAt: "now",
    binding: { ...f.instruction.amendment.binding, priorAmendmentDigest: seed.digest } });
  const expected = composeOwnerAmendmentChain(f.original, [seed, amendment]);
  const instruction: ResumeInstruction = { amendment, originalInputDigest: expected.originalInputDigest, composedDigest: expected.composedDigest };
  assert.equal(composeResumeInstruction(f.original, seed, instruction).composedText, expected.composedText);
  assert.throws(() => composeResumeInstruction(f.original, null, instruction), /chain/);
});

test("an authorized but unfinished supplement cannot be silently discarded by plain resume", () => {
  const f = fixture();
  assert.throws(() => acceptedResumeInstructions(f.records.slice(0, 2), f.status, []), /unfinished or ambiguous/);
});
