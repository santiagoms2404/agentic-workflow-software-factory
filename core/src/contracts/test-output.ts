import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope } from "./envelope-base.ts";

export const TEST_OUTPUT_SCHEMA_ID = "awsf.test-output/v1";

/** `TestOutput.outputTail` is bounded at 4000 characters, verbatim and unparsed. */
export const TEST_OUTPUT_TAIL_MAX_CHARS = 4000;

/** 40-hex git object id. The test envelope names the exact SHA it ran against. */
export const SHA_PATTERN = "^[0-9a-f]{40}$";

export const TestOutputSchema = phaseEnvelope(
  TEST_OUTPUT_SCHEMA_ID,
  {
    passed: Type.Boolean(),
    candidateSha: Type.String({ pattern: SHA_PATTERN }),
    commands: Type.Array(
      Type.Object(
        {
          gateId: Type.String({ minLength: 1 }),
          argv: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
          exitCode: Type.Integer(),
          durationMs: Type.Integer({ minimum: 0 }),
          outputRef: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    failures: Type.Array(Type.String({ minLength: 1 })),
    // Verbatim and unparsed (`data_types.py:158-163`): the builder cannot open
    // a log file it was never handed, and every test runner formats failures
    // differently, so a generic parser would be confidently wrong.
    outputTail: Type.String({ maxLength: TEST_OUTPUT_TAIL_MAX_CHARS }),
  },
  "Output of a code (test/typecheck) phase. HOST-generated — never model-generated.",
);

export type TestOutput = Static<typeof TestOutputSchema>;
