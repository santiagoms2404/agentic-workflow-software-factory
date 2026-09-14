import { Type, type Static } from "@sinclair/typebox";
const id = Type.String({ minLength: 1 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const SavedPhaseResultSchema = Type.Object({
  phaseKey: id, runId: id, ordinal: Type.Integer({ minimum: 1 }), envelopeId: id, envelopeDigest: hash,
  round: Type.Integer({ minimum: 0 }), ownerAmendmentDigest: Type.Optional(hash), worktreeDigest: hash,
  before: Type.Record(Type.String(), Type.String()),
  sandboxBadge: Type.Union([Type.Literal("os-enforced"), Type.Literal("tool-policy"), Type.Literal("unavailable")]),
  reservation: Type.Object({ id, cost: Type.Literal(1), kind: Type.Literal("single"), edge: Type.Union([Type.Literal("L4"), Type.Literal("L11"), Type.Null()]),
    attempt: Type.Integer({ minimum: 1 }), state: Type.Literal("spent"), spent: Type.Literal(1) }, { additionalProperties: false }),
  model: Type.Object({ adapter: id, provider: id, requestedModel: id, contextWindow: Type.Union([Type.Number(), Type.Null()]),
    supportsThinking: Type.Boolean(), supportsTools: Type.Boolean(), supportsImages: Type.Boolean(),
    continuity: Type.Union([Type.Literal("same-session-correction"), Type.Literal("none")]),
    usageAuthority: Type.Union([Type.Literal("provider"), Type.Literal("partial"), Type.Literal("none")]),
    costAuthority: Type.Union([Type.Literal("provider"), Type.Literal("catalog-estimate"), Type.Literal("unavailable")]),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type SavedPhaseResult = Static<typeof SavedPhaseResultSchema>;
