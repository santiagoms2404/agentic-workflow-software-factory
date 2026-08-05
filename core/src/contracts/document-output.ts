import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope, WorktreeRelativePath } from "./envelope-base.ts";

export const DOCUMENT_OUTPUT_SCHEMA_ID = "awsf.document-output/v1";

export const DocumentOutputSchema = phaseEnvelope(
  DOCUMENT_OUTPUT_SCHEMA_ID,
  {
    changedFiles: Type.Array(WorktreeRelativePath),
    documentedAreas: Type.Array(
      Type.Object(
        { subject: Type.String({ minLength: 1 }), documentPath: WorktreeRelativePath },
        { additionalProperties: false },
      ),
    ),
    proposedCommitMessage: Type.String({ minLength: 1 }),
  },
  "Output of a documentation phase. `diff_matches_claims` applies; final tests re-run afterward.",
);

export type DocumentOutput = Static<typeof DocumentOutputSchema>;
