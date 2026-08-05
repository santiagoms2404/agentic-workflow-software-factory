import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope, WorktreeRelativePath } from "./envelope-base.ts";

export const SCOUT_OUTPUT_SCHEMA_ID = "awsf.scout-output/v1";

export const ScoutOutputSchema = phaseEnvelope(
  SCOUT_OUTPUT_SCHEMA_ID,
  {
    findings: Type.Array(
      Type.Object(
        { file: WorktreeRelativePath, note: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ),
  },
  "Output of a scout (read-only reconnaissance) phase.",
);

export type ScoutOutput = Static<typeof ScoutOutputSchema>;
