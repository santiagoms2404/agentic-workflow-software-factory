import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope } from "./envelope-base.ts";

export const PLAN_AUTHOR_OUTPUT_SCHEMA_ID = "awsf.plan-author-output/v1";
export const PLAN_AUTHOR_ENVELOPE_MAX_BYTES = 65536;
export const PLAN_AUTHOR_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export const PLAN_AUTHOR_TABLE_MAX_BYTES = 256 * 1024;

/** References are relative to this phase's host-owned session-runtime, never Git. */
export const PlanAuthorOutputSchema = phaseEnvelope(PLAN_AUTHOR_OUTPUT_SCHEMA_ID, {
  stem: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 128 }),
  runtimeFiles: Type.Object({
    plan: Type.Literal("plan.html"),
    buildPrompts: Type.Literal("build-prompts.md"),
    tickets: Type.Literal("tickets.json"),
  }, { additionalProperties: false }),
}, "Names three session-runtime files for host create-only admission. No repository write or marker is earned.");
export type PlanAuthorOutput = Static<typeof PlanAuthorOutputSchema>;
