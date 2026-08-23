import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope, WorktreeRelativePath } from "./envelope-base.ts";

export const DESIGN_PLAN_OUTPUT_SCHEMA_ID = "awsf.design-plan-output/v1";

export const DESIGN_PLAN_STEP_ID_PATTERN = "^T[0-9]{2}$";
export const DESIGN_PLAN_MILESTONE_ID_PATTERN = "^M[0-9]+$";

const StepIdSchema = Type.String({ pattern: DESIGN_PLAN_STEP_ID_PATTERN });
const MilestoneIdSchema = Type.String({ pattern: DESIGN_PLAN_MILESTONE_ID_PATTERN });

const DesignPlanMilestoneSchema = Type.Object(
  {
    id: MilestoneIdSchema,
    title: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const DesignPlanStepSchema = Type.Object(
  {
    // These patterns are the same ticket and milestone vocabularies consumed
    // by the offline sync fence, so rendering cannot introduce foreign ids.
    id: StepIdSchema,
    title: Type.String({ minLength: 1 }),
    milestone: MilestoneIdSchema,
    files: Type.Array(WorktreeRelativePath),
    serves: Type.Array(Type.String({ minLength: 1 })),
    dependsOn: Type.Array(StepIdSchema),
    buildPrompt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const DesignPlanOutputSchema = phaseEnvelope(
  DESIGN_PLAN_OUTPUT_SCHEMA_ID,
  {
    milestones: Type.Array(DesignPlanMilestoneSchema),
    steps: Type.Array(DesignPlanStepSchema),
    testStrategy: Type.Array(Type.String({ minLength: 1 })),
    risks: Type.Array(
      Type.Object(
        {
          risk: Type.String({ minLength: 1 }),
          mitigation: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    openQuestions: Type.Array(Type.String({ minLength: 1 })),
  },
  "Output of the design-to-plan planning phase, carrying the identifier coverage join and renderable build prompts.",
);

export type DesignPlanOutput = Static<typeof DesignPlanOutputSchema>;
