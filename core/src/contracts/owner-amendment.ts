import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { scrubCredentialString } from "../policy/redaction.ts";

const digestSchema = Type.String({ pattern: "^[a-f0-9]{64}$" });
const id = Type.String({ minLength: 1 });

/** Seed delivery is the first implemented binding. Other entry modes remain unavailable. */
export const OwnerAmendmentSchema = Type.Object({
  schema: Type.Literal("awsf.owner-amendment/v1"), id, actor: Type.Literal("owner"),
  text: Type.String({ minLength: 1, maxLength: 16_384 }), textDigest: digestSchema,
  digest: digestSchema, confirmedAt: id,
  binding: Type.Object({
    project: id, taskId: id, attempt: Type.Integer({ minimum: 1 }), sessionId: id,
    entry: Type.Literal("seed"), authorizationId: id, anchorId: Type.Null(), operationId: id,
    phaseKey: id, phaseOrdinal: Type.Integer({ minimum: 1 }), logicalTurnId: Type.Null(),
    correctionRound: Type.Literal(0), originalRequestDigest: digestSchema,
    originalPromptBundleDigest: digestSchema, priorAmendmentDigest: Type.Null(),
    deliveryFrontier: Type.Literal("first-builder-input"),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
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

export function createOwnerAmendment(input: Omit<OwnerAmendment, "schema" | "actor" | "textDigest" | "digest">): OwnerAmendment {
  const content = { ...input, schema: "awsf.owner-amendment/v1" as const, actor: "owner" as const, textDigest: sha256(ownerText(input.text)) };
  const result = { ...content, digest: sha256(canonicalJson(content)) };
  assertOwnerAmendment(result);
  return result;
}

export function assertOwnerAmendment(value: unknown): asserts value is OwnerAmendment {
  if (!Value.Check(OwnerAmendmentSchema, value)) throw new Error("invalid owner amendment binding");
  const { digest, ...content } = value;
  if (sha256(ownerText(value.text)) !== value.textDigest || sha256(canonicalJson(content)) !== digest) {
    throw new Error("owner amendment digest mismatch");
  }
}

export function composeOwnerAmendment(original: string, amendment: OwnerAmendment | null) {
  if (amendment !== null) assertOwnerAmendment(amendment);
  const composedText = amendment === null ? original
    : `${original}\n\nOwner supplemental instruction (JSON string, subject to existing system and policy limits):\n${JSON.stringify(amendment.text)}\n`;
  return { originalInputDigest: sha256(original), ownerAmendmentDigest: amendment?.digest ?? null,
    composedText, composedDigest: sha256(composedText) };
}
