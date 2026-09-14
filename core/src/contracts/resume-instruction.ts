import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ResumeOwnerAmendmentSchema, assertOwnerAmendment } from "./owner-amendment.ts";
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
/** The immutable input commitment carried by the owner-authorized activation. */
export const ResumeInstructionSchema = Type.Object({
  amendment: ResumeOwnerAmendmentSchema, originalInputDigest: digest, composedDigest: digest,
}, { additionalProperties: false });
export type ResumeInstruction = Static<typeof ResumeInstructionSchema>;
export function assertResumeInstruction(value: unknown): asserts value is ResumeInstruction {
  if (!Value.Check(ResumeInstructionSchema, value)) throw new Error("invalid resume instruction commitment");
  assertOwnerAmendment(value.amendment);
}
