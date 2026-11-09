import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { SeedOwnerAmendmentSchema, assertOwnerAmendmentBinding } from "./owner-amendment.ts";
import { OBJECT_ID_PATTERN, SHA256_HEX_PATTERN } from "./typebox.ts";

const id = Type.String({ minLength: 1 });
const sha = Type.String({ pattern: OBJECT_ID_PATTERN });
const digest = Type.String({ pattern: SHA256_HEX_PATTERN });

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
    assertOwnerAmendmentBinding(value.ownerAmendment, {
      entry: "seed",
      project: value.target.project,
      taskId: value.target.taskId,
      attempt: 1,
      sessionId: value.target.sessionId,
      authorizationId: value.authorizationId,
      operationId: value.authorizationId,
      phaseKey: value.builderPhaseKey,
      phaseOrdinal: value.builderPhaseOrdinal,
      originalRequestDigest: value.requestDigest,
      originalPromptBundleDigest: value.builderPromptBundleDigest,
      anchorId: null,
      logicalTurnId: null,
      correctionRound: 0,
      priorAmendmentDigest: null,
      deliveryFrontier: "first-builder-input",
    }, "amendment does not bind the seeded target");
  }
}
