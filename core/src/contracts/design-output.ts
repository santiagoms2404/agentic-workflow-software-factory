import { Type, type Static } from "@sinclair/typebox";
import { phaseEnvelope } from "./envelope-base.ts";
import {
  ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN,
  INVARIANT_IDENTIFIER_PATTERN,
} from "../registry/plan-spine.ts";

export const DESIGN_OUTPUT_SCHEMA_ID = "awsf.design-output/v1";

const DECISION_IDENTIFIER_PATTERN = /^D-[1-9][0-9]*$/u;

const DesignComponentSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    responsibility: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const DesignDecisionSchema = Type.Object(
  {
    id: Type.String({ pattern: DECISION_IDENTIFIER_PATTERN.source }),
    statement: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const DesignInvariantSchema = Type.Object(
  {
    // Structural so the identifier rule travels with the emitted schema into
    // the designer's prompt instead of existing only in a later gate.
    id: Type.String({ pattern: INVARIANT_IDENTIFIER_PATTERN.source }),
    statement: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const DesignAcceptanceCriterionSchema = Type.Object(
  {
    id: Type.String({ pattern: ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN.source }),
    statement: Type.String({ minLength: 1 }),
    // A criterion without a stated observation is prose, not an acceptance
    // boundary another phase can verify.
    verifiedBy: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const DesignOutputSchema = phaseEnvelope(
  DESIGN_OUTPUT_SCHEMA_ID,
  {
    answeredRequest: Type.String({ minLength: 1 }),
    components: Type.Array(DesignComponentSchema),
    decisions: Type.Array(DesignDecisionSchema),
    invariants: Type.Array(DesignInvariantSchema),
    acceptanceCriteria: Type.Array(DesignAcceptanceCriterionSchema),
    openQuestions: Type.Array(Type.String({ minLength: 1 })),
  },
  "Output of a design phase. Identifiers are declared here and carried, not retyped, downstream.",
);

export type DesignOutput = Static<typeof DesignOutputSchema>;
