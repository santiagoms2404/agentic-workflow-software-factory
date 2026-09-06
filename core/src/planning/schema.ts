import { Type, type TProperties } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Event, Narrative, Proposal, Reference } from "./model.ts";

const object = <T extends TProperties>(properties: T) => Type.Object(properties, { additionalProperties: false });
const text = Type.String({ minLength: 1, maxLength: 65_536, pattern: "\\S" });
const optionalText = Type.String({ maxLength: 65_536 });
const id = Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$" });
const integer = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const base = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const strings = Type.Array(text, { maxItems: 1024 });
const ids = Type.Array(id, { maxItems: 1024, uniqueItems: true });
export const ReferenceSchema = object({ path: text, sha256: digest, repository: text, revision: text, locator: text,
  kind: Type.Union([Type.Literal("text"), Type.Literal("attachment")]) });
const references = Type.Array(ReferenceSchema, { maxItems: 1024 });
export const NarrativeSchema = object({ title: text, explanation: text, changes: text, reason: text,
  friction: optionalText, tasks: ids, references });
const unit = object({ id, revision: integer, title: text, purpose: text, taskId: id,
  scope: Type.Array(text, { minItems: 1, maxItems: 1024 }), nonGoals: strings, serves: ids,
  acceptance: Type.Array(text, { minItems: 1, maxItems: 1024 }),
  prerequisites: Type.Array(object({ unit: id, revision: integer,
    kind: Type.Union([Type.Literal("interface"), Type.Literal("implementation")]), contract: text }), { maxItems: 1024 }),
  decisions: strings, references,
  completion: Type.Union([Type.Literal("landed"), Type.Literal("owner-accepted")]),
  plan: Type.Optional(object({ catalog: text, stem: id, task: Type.String({ pattern: "^[TW][0-9]{2}$" }), sourceSha256: digest })),
  disposition: Type.Union([Type.Literal("active"), Type.Literal("deferred"), Type.Literal("split")]),
  reason: optionalText, revisit: optionalText, parents: ids });
export const ProposalSchema = object({ id, base, narrative: NarrativeSchema,
  alternatives: strings,
  changes: Type.Array(Type.Union([
    object({ kind: Type.Literal("define"), unit }),
    object({ kind: Type.Literal("split"), unit: id, children: Type.Array(unit, { minItems: 2, maxItems: 1024 }), reason: text }),
    object({ kind: Type.Literal("defer"), unit: id, reason: text, revisit: text }),
    object({ kind: Type.Literal("order"), units: ids }),
    object({ kind: Type.Literal("constraints"), values: strings }),
    object({ kind: Type.Literal("requirements"), values: Type.Array(object({ id, text }), { maxItems: 1024 }) }),
    object({ kind: Type.Literal("bind"), binding: object({ unit: id, revision: integer, taskId: id, attempt: integer, sessionId: id }) }),
    object({ kind: Type.Literal("accept-delivery"), unit: id, revision: integer, evidence: Type.Array(ReferenceSchema, { minItems: 1, maxItems: 1024 }) }),
    object({ kind: Type.Literal("accept-interface"), unit: id, revision: integer, contract: text, evidence: Type.Array(ReferenceSchema, { minItems: 1, maxItems: 1024 }) }),
    object({ kind: Type.Literal("close"), reason: text }),
  ]), { minItems: 1, maxItems: 1024 }) });
const InputSchema = object({ id, text: Type.String({ maxLength: 1_048_576 }), sha256: digest, provenance: text, attachments: references });
export const EventSchema = object({ schema: Type.Literal("awsf/group-event/v1"), group: id, project: id, id, base,
  at: Type.String({ pattern: "^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$" }),
  previous: Type.Union([digest, Type.Literal("")]), digest,
  operation: Type.Union([
    object({ kind: Type.Literal("capture"), input: InputSchema, narrative: NarrativeSchema }),
    object({ kind: Type.Literal("propose"), proposal: ProposalSchema }),
    object({ kind: Type.Literal("apply"), proposal: id, proposalHash: digest, ownerReason: text }),
  ]) });
export function eventValue(value: unknown): Event {
  if (!Value.Check(EventSchema, value)) throw new Error("invalid group event schema");
  return value;
}
export function proposalValue(value: unknown): Proposal {
  if (!Value.Check(ProposalSchema, value)) throw new Error("invalid proposal schema");
  return value;
}
export function narrativeValue(value: unknown): Narrative {
  if (!Value.Check(NarrativeSchema, value)) throw new Error("invalid narrative schema");
  return value;
}
export function referenceValue(value: unknown): Reference {
  if (!Value.Check(ReferenceSchema, value)) throw new Error("invalid reference schema");
  return value;
}
