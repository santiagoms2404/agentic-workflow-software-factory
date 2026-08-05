import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope } from "./envelope-base.ts";

export const PLAN_OUTPUT_SCHEMA_ID = "awsf.plan-output/v1";

export const PlanOutputSchema = phaseEnvelope(
  PLAN_OUTPUT_SCHEMA_ID,
  {
    goals: Type.Array(Type.String({ minLength: 1 })),
    nonGoals: Type.Array(Type.String({ minLength: 1 })),
    implementationSteps: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1 }),
          title: Type.String({ minLength: 1 }),
          files: Type.Array(Type.String({ minLength: 1 })),
          acceptanceCriteria: Type.Array(Type.String({ minLength: 1 })),
        },
        { additionalProperties: false },
      ),
    ),
    testStrategy: Type.Array(Type.String({ minLength: 1 })),
    risks: Type.Array(
      Type.Object(
        { risk: Type.String({ minLength: 1 }), mitigation: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ),
    // A successful plan may legitimately leave none that are blocking; the
    // plan gate checks for *blocking* questions, not for an empty array.
    openQuestions: Type.Array(Type.String({ minLength: 1 })),
  },
  "Output of a planning phase.",
);

export type PlanOutput = Static<typeof PlanOutputSchema>;
