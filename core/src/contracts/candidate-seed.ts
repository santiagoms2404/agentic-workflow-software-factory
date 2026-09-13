import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { SeedOwnerAmendmentSchema, assertOwnerAmendment } from "./owner-amendment.ts";

const id = Type.String({ minLength: 1 });
const sha = Type.String({ pattern: "^[a-f0-9]{40}$" });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });

export const CandidateSeedSchema = Type.Object({
  schema: Type.Literal("awsf.candidate-seed/v1"), authorizationId: id, confirmedAt: id,
  source: Type.Object({
    project: id, taskId: id, attempt: Type.Integer({ minimum: 1 }), sessionId: id,
    revision: Type.Integer({ minimum: 1 }), journalDigest: digest,
    lifecycle: Type.Union([Type.Literal("BLOCKED"), Type.Literal("CANCELLED")]),
  }, { additionalProperties: false }),
  target: Type.Object({ project: id, taskId: id, attempt: Type.Literal(1), sessionId: id }, { additionalProperties: false }),
  integrationBaseSha: sha, seedCandidateSha: sha,
  configDigest: digest, requestDigest: digest, workflow: id,
  builderPhaseKey: id, builderPhaseOrdinal: Type.Integer({ minimum: 1 }), builderPromptBundleDigest: digest,
  ownerAmendment: Type.Union([SeedOwnerAmendmentSchema, Type.Null()]),
}, { additionalProperties: false });
export type CandidateSeed = Static<typeof CandidateSeedSchema>;

export function assertCandidateSeed(value: unknown): asserts value is CandidateSeed {
  if (!Value.Check(CandidateSeedSchema, value)) throw new Error("invalid candidate seed or unsupported assurance-transfer field");
  if (value.integrationBaseSha === value.seedCandidateSha || value.source.taskId === value.target.taskId || value.source.project !== value.target.project) {
    throw new Error("seed must bind a distinct target and a nonempty candidate");
  }
  if (value.ownerAmendment !== null) {
    assertOwnerAmendment(value.ownerAmendment);
    const binding = value.ownerAmendment.binding;
    if (binding.entry !== "seed" || binding.project !== value.target.project || binding.taskId !== value.target.taskId || binding.attempt !== 1 ||
        binding.sessionId !== value.target.sessionId || binding.authorizationId !== value.authorizationId ||
        binding.operationId !== value.authorizationId || binding.phaseKey !== value.builderPhaseKey ||
        binding.phaseOrdinal !== value.builderPhaseOrdinal || binding.originalRequestDigest !== value.requestDigest ||
        binding.originalPromptBundleDigest !== value.builderPromptBundleDigest) throw new Error("amendment does not bind the seeded target");
  }
}
