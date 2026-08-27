import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope } from "./envelope-base.ts";
import { SHA_PATTERN } from "./test-output.ts";

export const INIT_OUTPUT_SCHEMA_ID = "awsf.init-output/v1";

export const InitOutputSchema = phaseEnvelope(
  INIT_OUTPUT_SCHEMA_ID,
  {
    kind: Type.String({ minLength: 1 }),
    line: Type.String({ minLength: 1 }),
    commitSha: Type.String({ pattern: SHA_PATTERN }),
    path: Type.String({ minLength: 1 }),
  },
  "Validated result returned and printed by the session-less awsf init host command. HOST-generated and not stored.",
);

export type InitOutput = Static<typeof InitOutputSchema>;
