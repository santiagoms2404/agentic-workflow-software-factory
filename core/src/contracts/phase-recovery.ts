import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { SavedPhaseResultSchema } from "./saved-phase-result.ts";
import { HostValidationProgressSchema, assertHostValidationProgress } from "./host-validation.ts";
import { sha256, canonicalJson } from "./owner-amendment.ts";
const id = Type.String({ minLength: 1 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const sha = Type.String({ pattern: "^[a-f0-9]{40}$" });
export const AcceptedPhaseSchema = Type.Object({
  phaseKey: id, ordinal: Type.Integer({ minimum: 1 }), envelopeId: id,
  envelopeDigest: hash, ownerAmendmentDigest: Type.Optional(hash), round: Type.Integer({ minimum: 0 }), candidateSha: Type.Union([sha, Type.Null()]),
}, { additionalProperties: false });
export type AcceptedPhase = Static<typeof AcceptedPhaseSchema>;
export const BoundaryQuotaSchema = Type.Object({
  adapterId: id, provider: id, scope: id, minutes: Type.Number({ minimum: 0 }),
  threshold: Type.Number({ minimum: 0 }), observedAt: id, readoutDigest: hash,
}, { additionalProperties: false });
export type BoundaryQuota = Static<typeof BoundaryQuotaSchema>;
export const PhaseRecoverySchema = Type.Object({
  schema: Type.Literal("awsf.phase-recovery/v1"), id, sessionId: id,
  kind: Type.Union([Type.Literal("completed-phase"), Type.Literal("quota-pause"), Type.Literal("result-ready"), Type.Literal("validating")]),
  pending: Type.Optional(SavedPhaseResultSchema),
  // Present only while a saved reply is inside host validation. It names the exact
  // stage the host had reached and, once the commit transport was about to run,
  // the one commit it intended — never a licence to create a different one.
  validation: Type.Optional(HostValidationProgressSchema),
  workflowId: id, bindingDigest: hash, prefix: Type.Array(AcceptedPhaseSchema),
  repository: id, worktree: id, commonGitDir: id, integrationBaseSha: sha, worktreeHeadSha: sha,
  budgetDigest: hash, quota: Type.Union([BoundaryQuotaSchema, Type.Null()]), createdAt: id,
}, { additionalProperties: false });
export type PhaseRecovery = Static<typeof PhaseRecoverySchema>;
export const recoveryDigest = (value: unknown): string => sha256(canonicalJson(value));
// An explicitly journaled owner ceiling raise may fund remaining phases. Debit and liability fields stay exact.
export const recoveryBudgetDigest = (value: object): string => recoveryDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "ceiling")));
export function assertPhaseRecovery(value: unknown): asserts value is PhaseRecovery {
  if (!Value.Check(PhaseRecoverySchema, value)) throw new Error("recovery checkpoint is invalid");
  const saved = value.kind === "result-ready" || value.kind === "validating";
  if (saved !== (value.pending !== undefined) || (value.kind === "validating") !== (value.validation !== undefined) ||
      (value.prefix.length === 0 && value.pending === undefined) ||
      (value.pending !== undefined && value.pending.ordinal !== value.prefix.length + 1)) throw new Error("saved result frontier is inconsistent");
  const progress = value.validation;
  if (progress !== undefined) {
    assertHostValidationProgress(progress);
    const pending = value.pending!;
    if (progress.phaseKey !== pending.phaseKey || progress.ordinal !== pending.ordinal || progress.round !== pending.round ||
        progress.runId !== pending.runId || progress.envelopeId !== pending.envelopeId ||
        progress.envelopeDigest !== pending.envelopeDigest) throw new Error("host validation progress belongs to another saved reply");
    // The pre-commit revision is the checkpoint's own recorded HEAD. An intent
    // naming a different parent is not this attempt's commit.
    if (progress.commitIntent !== null && progress.commitIntent.parentSha !== value.worktreeHeadSha) {
      throw new Error("host commit intent names a different pre-commit revision than the checkpoint");
    }
  }
  if ((value.kind === "quota-pause") !== (value.quota !== null)) throw new Error("recovery quota binding is inconsistent");
  if (value.prefix.some((entry, index) => entry.ordinal !== index + 1) || new Set(value.prefix.map(entry => entry.phaseKey)).size !== value.prefix.length) {
    throw new Error("accepted phase prefix is not contiguous");
  }
}
