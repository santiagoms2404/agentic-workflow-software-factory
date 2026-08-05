import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope, WorktreeRelativePath } from "./envelope-base.ts";

export const BUILD_OUTPUT_SCHEMA_ID = "awsf.build-output/v1";

export const BuildOutputSchema = phaseEnvelope(
  BUILD_OUTPUT_SCHEMA_ID,
  {
    // The candidate SHA is deliberately ABSENT. The host owns the commit and
    // computes the SHA; a model that reported one could report a stale or
    // invented value, and `diff_matches_claims` would then be comparing the
    // host's diff against the model's fiction.
    changedFiles: Type.Array(WorktreeRelativePath),
    implementationNotes: Type.Array(Type.String({ minLength: 1 })),
    commandsRun: Type.Array(
      Type.Object(
        {
          argv: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
          // null = the command did not exit normally (signalled, or never
          // observed to finish). 0 is a real, authoritative exit code.
          exitCode: Type.Union([Type.Integer(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    proposedCommitMessage: Type.String({ minLength: 1 }),
  },
  "Output of a build (or fix) phase. The host, not the model, owns the commit and its SHA.",
);

export type BuildOutput = Static<typeof BuildOutputSchema>;
