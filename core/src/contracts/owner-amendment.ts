import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { scrubCredentialString } from "../policy/redaction.ts";

const digestSchema = Type.String({ pattern: "^[a-f0-9]{64}$" });
const id = Type.String({ minLength: 1 });

const commonBinding = {
  project: id, taskId: id, attempt: Type.Integer({ minimum: 1 }), sessionId: id,
  authorizationId: id, operationId: id, phaseKey: id, phaseOrdinal: Type.Integer({ minimum: 1 }),
  originalRequestDigest: digestSchema, originalPromptBundleDigest: digestSchema,
};
const commonAmendment = {
  schema: Type.Literal("awsf.owner-amendment/v1"), id, actor: Type.Literal("owner"),
  text: Type.String({ minLength: 1, maxLength: 16_384 }), textDigest: digestSchema,
  digest: digestSchema, confirmedAt: id,
};

/** Keep seed's original strict shape. Recovery authority cannot be copied into a new target. */
export const SeedOwnerAmendmentSchema = Type.Object({ ...commonAmendment,
  binding: Type.Object({ ...commonBinding, entry: Type.Literal("seed"), anchorId: Type.Null(),
    logicalTurnId: Type.Null(), correctionRound: Type.Literal(0), priorAmendmentDigest: Type.Null(),
    deliveryFrontier: Type.Literal("first-builder-input"),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const ResumeOwnerAmendmentSchema = Type.Object({ ...commonAmendment,
  binding: Type.Object({ ...commonBinding, entry: Type.Literal("resume"), anchorId: id,
    anchorRevision: Type.Integer({ minimum: 1 }), logicalTurnId: Type.Null(), correctionRound: Type.Literal(0),
    priorAmendmentDigest: Type.Union([digestSchema, Type.Null()]), deliveryFrontier: Type.Literal("next-phase-input"),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const RescueOwnerAmendmentSchema = Type.Object({ ...commonAmendment,
  binding: Type.Object({ ...commonBinding, entry: Type.Literal("rescue"), anchorId: id,
    anchorRevision: Type.Integer({ minimum: 1 }), logicalTurnId: id, correctionRound: Type.Integer({ minimum: 0 }),
    reconnectGeneration: Type.Integer({ minimum: 1 }), inputFrontierDigest: digestSchema,
    priorAmendmentDigest: Type.Union([digestSchema, Type.Null()]), deliveryFrontier: Type.Literal("original-turn-input"),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const ReworkOwnerAmendmentSchema = Type.Object({ ...commonAmendment,
  binding: Type.Object({ ...commonBinding, entry: Type.Literal("rework"), anchorId: id,
    anchorRevision: Type.Integer({ minimum: 1 }), candidateSha: Type.String({ pattern: "^[a-f0-9]{40}$" }),
    defectDigest: digestSchema, ownerReentry: Type.Integer({ minimum: 1 }), logicalTurnId: id,
    correctionRound: Type.Literal(0), priorAmendmentDigest: Type.Null(), deliveryFrontier: Type.Literal("rework-input"),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type ReworkOwnerAmendment = Static<typeof ReworkOwnerAmendmentSchema>;

/** These contracts bind owner intent. They do not enable an entry path or native steering. */
export const OwnerAmendmentSchema = Type.Union([SeedOwnerAmendmentSchema, ResumeOwnerAmendmentSchema, RescueOwnerAmendmentSchema, ReworkOwnerAmendmentSchema]);
export type OwnerAmendment = Static<typeof OwnerAmendmentSchema>;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("undefined is not canonical JSON");
  return encoded;
}

export function ownerText(text: string): string {
  if (text.trim().length === 0 || text.length > 16_384 || Buffer.byteLength(text) > 65_536) {
    throw new Error("owner instruction must be nonblank and at most 16384 characters / 65536 UTF-8 bytes");
  }
  if (scrubCredentialString(text) !== text) throw new Error("owner instruction contains credential-shaped data");
  return text;
}

export function createOwnerAmendment<B extends OwnerAmendment["binding"]>(
  input: Omit<OwnerAmendment, "schema" | "actor" | "textDigest" | "digest" | "binding"> & { binding: B },
): OwnerAmendment & { binding: B } {
  const content = { ...input, binding: Object.freeze({ ...input.binding }),
    schema: "awsf.owner-amendment/v1" as const, actor: "owner" as const, textDigest: sha256(ownerText(input.text)) };
  const result = { ...content, digest: sha256(canonicalJson(content)) };
  assertOwnerAmendment(result);
  return Object.freeze(result) as OwnerAmendment & { binding: B };
}

export function assertOwnerAmendment(value: unknown): asserts value is OwnerAmendment {
  if (!Value.Check(OwnerAmendmentSchema, value)) throw new Error("invalid owner amendment binding");
  const { digest, ...content } = value;
  if (sha256(ownerText(value.text)) !== value.textDigest || sha256(canonicalJson(content)) !== digest) {
    throw new Error("owner amendment digest mismatch");
  }
}

/** Validate against the host's current activation, never against provider-supplied bindings. */
export function assertOwnerAmendmentBinding(amendment: OwnerAmendment, expected: OwnerAmendment["binding"]): void {
  assertOwnerAmendment(amendment);
  if (canonicalJson(amendment.binding) !== canonicalJson(expected)) throw new Error("owner amendment activation binding changed");
}

export function composeOwnerAmendment(original: string, amendment: OwnerAmendment | null) {
  if (amendment !== null) assertOwnerAmendment(amendment);
  const composedText = amendment === null ? original
    : `${original}\n\nOwner supplemental instruction (JSON string, subject to existing system and policy limits):\n${JSON.stringify(amendment.text)}\n`;
  return { originalInputDigest: sha256(original), ownerAmendmentDigest: amendment?.digest ?? null,
    composedText, composedDigest: sha256(composedText) };
}

/** Rebuild the input from original bytes. A partial chain cannot silently drop earlier intent. */
export function composeOwnerAmendmentChain(original: string, amendments: readonly OwnerAmendment[]) {
  let text = original;
  let prior: OwnerAmendment | null = null;
  const seen = new Set<string>();
  for (const amendment of amendments) {
    assertOwnerAmendment(amendment);
    if (seen.has(amendment.id) || amendment.binding.priorAmendmentDigest !== (prior?.digest ?? null)) {
      throw new Error("owner amendment chain is incomplete, reordered, or duplicated");
    }
    if (prior !== null) {
      for (const key of ["project", "taskId", "attempt", "sessionId", "phaseKey", "phaseOrdinal", "originalRequestDigest", "originalPromptBundleDigest"] as const) {
        if (amendment.binding[key] !== prior.binding[key]) throw new Error("owner amendment chain crosses an original input boundary");
      }
      if (prior.binding.logicalTurnId !== null && amendment.binding.logicalTurnId !== prior.binding.logicalTurnId) {
        throw new Error("owner amendment chain crosses logical turns");
      }
    }
    seen.add(amendment.id);
    text = composeOwnerAmendment(text, amendment).composedText;
    prior = amendment;
  }
  return { originalInputDigest: sha256(original), ownerAmendmentDigest: prior?.digest ?? null,
    composedText: text, composedDigest: sha256(text) };
}

export const OwnerAmendmentDeliverySchema = Type.Object({
  schema: Type.Literal("awsf.owner-amendment-delivery/v1"), amendmentId: id, amendmentDigest: digestSchema,
  bindingDigest: digestSchema, operationId: id, logicalTurnId: id,
  originalInputDigest: digestSchema, composedDigest: digestSchema,
  state: Type.Union([Type.Literal("intent"), Type.Literal("submitted"), Type.Literal("acknowledged"), Type.Literal("unknown")]),
  providerAcknowledgementDigest: Type.Union([digestSchema, Type.Null()]),
}, { additionalProperties: false });
export type OwnerAmendmentDelivery = Static<typeof OwnerAmendmentDeliverySchema>;
const deliveryTargetSchema = Type.Pick(OwnerAmendmentDeliverySchema, ["operationId", "logicalTurnId", "originalInputDigest", "composedDigest"]);
export type OwnerAmendmentDeliveryTarget = Static<typeof deliveryTargetSchema>;

function assertDeliveryTarget(amendment: OwnerAmendment, expected: OwnerAmendmentDeliveryTarget): void {
  if (!Value.Check(deliveryTargetSchema, expected) || expected.operationId !== amendment.binding.operationId ||
      (amendment.binding.logicalTurnId !== null && expected.logicalTurnId !== amendment.binding.logicalTurnId)) {
    throw new Error("owner amendment delivery target does not match the current activation");
  }
}

/** The target comes from host-reconstructed input and the current logical turn, never the delivery record itself. */
export function assertOwnerAmendmentDelivery(value: unknown, amendment: OwnerAmendment,
  expected: OwnerAmendmentDeliveryTarget): asserts value is OwnerAmendmentDelivery {
  assertOwnerAmendment(amendment);
  assertDeliveryTarget(amendment, expected);
  if (!Value.Check(OwnerAmendmentDeliverySchema, value)) throw new Error("invalid owner amendment delivery evidence");
  if (value.amendmentId !== amendment.id || value.amendmentDigest !== amendment.digest ||
      value.bindingDigest !== sha256(canonicalJson(amendment.binding)) || value.operationId !== amendment.binding.operationId ||
      (amendment.binding.logicalTurnId !== null && value.logicalTurnId !== amendment.binding.logicalTurnId)) {
    throw new Error("owner amendment delivery names another activation or logical turn");
  }
  for (const key of ["operationId", "logicalTurnId", "originalInputDigest", "composedDigest"] as const) {
    if (value[key] !== expected[key]) throw new Error("owner amendment delivery differs from the host input or logical turn");
  }
  if ((value.state === "acknowledged") !== (value.providerAcknowledgementDigest !== null)) {
    throw new Error("owner amendment acknowledgement is unproved or inconsistent");
  }
}

/** Unknown delivery must be queried by the same key, never silently replayed. */
export function ownerAmendmentDeliveryAction(amendment: OwnerAmendment, delivery: OwnerAmendmentDelivery | null,
  capability: "new-phase-input" | "idempotent-in-turn" | "unavailable", expected: OwnerAmendmentDeliveryTarget): "deliver-initial-input" | "deliver-in-turn-idempotently" | "query-acknowledgement" | "already-acknowledged" | "refuse" {
  assertOwnerAmendment(amendment);
  const rescue = amendment.binding.entry === "rescue";
  if (rescue ? capability !== "idempotent-in-turn" : capability !== "new-phase-input") return "refuse";
  assertDeliveryTarget(amendment, expected);
  if (delivery !== null) {
    assertOwnerAmendmentDelivery(delivery, amendment, expected);
    if (delivery.state === "acknowledged") return "already-acknowledged";
    if (!rescue) return "refuse";
    if (delivery.state !== "intent") return "query-acknowledgement";
  }
  return rescue ? "deliver-in-turn-idempotently" : "deliver-initial-input";
}
