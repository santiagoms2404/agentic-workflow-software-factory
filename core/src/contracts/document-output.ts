import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope, WorktreeRelativePath } from "./envelope-base.ts";

export const DOCUMENT_OUTPUT_SCHEMA_ID = "awsf.document-output/v1";
export const RUN_REPORT_PATH_PATTERN = "^reports/[a-z0-9](?:[a-z0-9-]{0,63})\\.md$";

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
    // One logical Markdown destination. The host writes it under the private
    // task report-projection directory beside the attempt, never into Git or a
    // sealed attempt. Wire fields stay closed and required, so every producer
    // states its report handoff explicitly.
    runReport: Type.Object({
      path: Type.String({ pattern: RUN_REPORT_PATH_PATTERN }),
      markdown: Type.String({ minLength: 1 }),
    }, { additionalProperties: false }),
  },
  "Output of a documentation phase. `diff_matches_claims` applies; final tests re-run afterward.",
);

export type DocumentOutput = Static<typeof DocumentOutputSchema>;
