import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { WorktreeRelativePath } from "./envelope-base.ts";

/** Author-supplied frontmatter table. State and prompt bytes belong to the host. */
export const PlanAdmissionTicketSchema = Type.Object({
  id: Type.String({ pattern: "^T[0-9]{2}$" }),
  title: Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" }),
  milestone: Type.String({ pattern: "^M[1-9][0-9]*$" }),
  depends_on: Type.Array(Type.String({ pattern: "^T[0-9]{2}$" }), { uniqueItems: true }),
  serves: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
  tier: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 })),
  workflow: Type.Optional(Type.String({ minLength: 1 })),
  task_class: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });
export type PlanAdmissionTicket = Static<typeof PlanAdmissionTicketSchema>;

export const PLAN_ADMISSION_SCHEMA_ID = "awsf.plan-admission/v1";
export const PlanAdmissionRecordSchema = Type.Object({
  schema: Type.Literal(PLAN_ADMISSION_SCHEMA_ID),
  stem: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
  baseSha: Type.String({ pattern: "^[a-f0-9]{40}$" }),
  at: Type.String({ minLength: 1 }),
  files: Type.Array(Type.Object({
    path: WorktreeRelativePath,
    sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  }, { additionalProperties: false }), { minItems: 4 }),
}, { additionalProperties: false });
export type PlanAdmissionRecord = Static<typeof PlanAdmissionRecordSchema>;
export function assertPlanAdmissionRecord(value: unknown): asserts value is PlanAdmissionRecord {
  if (!Value.Check(PlanAdmissionRecordSchema, value)) throw new Error("invalid plan admission record");
}
