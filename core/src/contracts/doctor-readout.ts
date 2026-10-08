import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const DOCTOR_READOUT_SCHEMA_ID = "awsf.doctor/v1";
const closed = { additionalProperties: false } as const;
export const DoctorRowSchema = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("warn"), Type.Literal("finding")]),
  detail: Type.Array(Type.String(), { minItems: 1 }),
}, closed);
export type DoctorRow = Static<typeof DoctorRowSchema>;
export const DoctorReadoutSchema = Type.Object({
  schema: Type.Literal(DOCTOR_READOUT_SCHEMA_ID),
  healthy: Type.Boolean(),
  rows: Type.Object({
    existing: DoctorRowSchema, jev: DoctorRowSchema, storage: DoctorRowSchema,
    executables: DoctorRowSchema, providers: DoctorRowSchema, quota: DoctorRowSchema,
    coverage: DoctorRowSchema, branches: DoctorRowSchema, worktrees: DoctorRowSchema,
    baseline: DoctorRowSchema, markers: DoctorRowSchema,
  }, closed),
  lines: Type.Array(Type.String()),
}, { ...closed, $id: DOCTOR_READOUT_SCHEMA_ID, title: "DoctorReadout" });
export type DoctorReadout = Static<typeof DoctorReadoutSchema>;
export function assertDoctorReadout(value: unknown): asserts value is DoctorReadout {
  if (!Value.Check(DoctorReadoutSchema, value)) throw new Error(`invalid ${DOCTOR_READOUT_SCHEMA_ID} readout`);
}
