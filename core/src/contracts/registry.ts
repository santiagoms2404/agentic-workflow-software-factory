import type { TObject } from "@sinclair/typebox";
import {
  ArchitectureReviewOutputSchema,
  ARCHITECTURE_REVIEW_OUTPUT_SCHEMA_ID,
  type ArchitectureReviewOutput,
} from "./architecture-review-output.ts";
import { BuildOutputSchema, BUILD_OUTPUT_SCHEMA_ID, type BuildOutput } from "./build-output.ts";
import { DesignContextSchema, DESIGN_CONTEXT_SCHEMA_ID, type DesignContext } from "./design-context.ts";
import {
  DesignOutputSchema,
  DESIGN_OUTPUT_SCHEMA_ID,
  type DesignOutput,
} from "./design-output.ts";
import {
  DesignPlanOutputSchema,
  DESIGN_PLAN_OUTPUT_SCHEMA_ID,
  type DesignPlanOutput,
} from "./design-plan-output.ts";
import { DocumentOutputSchema, DOCUMENT_OUTPUT_SCHEMA_ID, type DocumentOutput } from "./document-output.ts";
import { InitOutputSchema, INIT_OUTPUT_SCHEMA_ID, type InitOutput } from "./init-output.ts";
import {
  ProjectRegisterOutputSchema,
  PROJECT_REGISTER_OUTPUT_SCHEMA_ID,
  type ProjectRegisterOutput,
} from "./project-register-output.ts";
import { PublishOutputSchema, PUBLISH_OUTPUT_SCHEMA_ID, type PublishOutput } from "./publish-output.ts";
import { IntakeOutputSchema, INTAKE_OUTPUT_SCHEMA_ID, type IntakeOutput } from "./intake-output.ts";
import { PlanContextSchema, PLAN_CONTEXT_SCHEMA_ID, type PlanContext } from "./plan-context.ts";
import { PlanOutputSchema, PLAN_OUTPUT_SCHEMA_ID, type PlanOutput } from "./plan-output.ts";
import { ReviewContextSchema, REVIEW_CONTEXT_SCHEMA_ID, type ReviewContext } from "./review-context.ts";
import { ReviewOutputSchema, REVIEW_OUTPUT_SCHEMA_ID, type ReviewOutput } from "./review-output.ts";
import { ScoutOutputSchema, SCOUT_OUTPUT_SCHEMA_ID, type ScoutOutput } from "./scout-output.ts";
import { TestOutputSchema, TEST_OUTPUT_SCHEMA_ID, type TestOutput } from "./test-output.ts";

/**
 * Every wire envelope schema, keyed by its schema id.
 *
 * This is the only lookup table: the parser, the prompt compiler, and the
 * gates all resolve a schema id through here, so adding a phase envelope
 * without registering it makes it unusable rather than silently unvalidated.
 */
export const ENVELOPE_SCHEMAS = {
  [PLAN_OUTPUT_SCHEMA_ID]: PlanOutputSchema,
  [BUILD_OUTPUT_SCHEMA_ID]: BuildOutputSchema,
  [TEST_OUTPUT_SCHEMA_ID]: TestOutputSchema,
  [REVIEW_OUTPUT_SCHEMA_ID]: ReviewOutputSchema,
  [REVIEW_CONTEXT_SCHEMA_ID]: ReviewContextSchema,
  [DESIGN_CONTEXT_SCHEMA_ID]: DesignContextSchema,
  [DESIGN_OUTPUT_SCHEMA_ID]: DesignOutputSchema,
  [ARCHITECTURE_REVIEW_OUTPUT_SCHEMA_ID]: ArchitectureReviewOutputSchema,
  [PLAN_CONTEXT_SCHEMA_ID]: PlanContextSchema,
  [DESIGN_PLAN_OUTPUT_SCHEMA_ID]: DesignPlanOutputSchema,
  [DOCUMENT_OUTPUT_SCHEMA_ID]: DocumentOutputSchema,
  [SCOUT_OUTPUT_SCHEMA_ID]: ScoutOutputSchema,
  [INTAKE_OUTPUT_SCHEMA_ID]: IntakeOutputSchema,
  [INIT_OUTPUT_SCHEMA_ID]: InitOutputSchema,
  [PROJECT_REGISTER_OUTPUT_SCHEMA_ID]: ProjectRegisterOutputSchema,
  [PUBLISH_OUTPUT_SCHEMA_ID]: PublishOutputSchema,
} as const;

export type EnvelopeSchemaId = keyof typeof ENVELOPE_SCHEMAS;

/** Static payload type for a given schema id. */
export interface EnvelopeTypeById {
  [PLAN_OUTPUT_SCHEMA_ID]: PlanOutput;
  [BUILD_OUTPUT_SCHEMA_ID]: BuildOutput;
  [TEST_OUTPUT_SCHEMA_ID]: TestOutput;
  [REVIEW_OUTPUT_SCHEMA_ID]: ReviewOutput;
  [REVIEW_CONTEXT_SCHEMA_ID]: ReviewContext;
  [DESIGN_CONTEXT_SCHEMA_ID]: DesignContext;
  [DESIGN_OUTPUT_SCHEMA_ID]: DesignOutput;
  [ARCHITECTURE_REVIEW_OUTPUT_SCHEMA_ID]: ArchitectureReviewOutput;
  [PLAN_CONTEXT_SCHEMA_ID]: PlanContext;
  [DESIGN_PLAN_OUTPUT_SCHEMA_ID]: DesignPlanOutput;
  [DOCUMENT_OUTPUT_SCHEMA_ID]: DocumentOutput;
  [SCOUT_OUTPUT_SCHEMA_ID]: ScoutOutput;
  [INTAKE_OUTPUT_SCHEMA_ID]: IntakeOutput;
  [INIT_OUTPUT_SCHEMA_ID]: InitOutput;
  [PROJECT_REGISTER_OUTPUT_SCHEMA_ID]: ProjectRegisterOutput;
  [PUBLISH_OUTPUT_SCHEMA_ID]: PublishOutput;
}

export const ENVELOPE_SCHEMA_IDS = Object.keys(ENVELOPE_SCHEMAS) as EnvelopeSchemaId[];

export class UnknownEnvelopeSchemaError extends Error {
  readonly code = "E_UNKNOWN_ENVELOPE_SCHEMA";
  constructor(schemaId: string) {
    super(`unknown envelope schema id: "${schemaId}"`);
    this.name = "UnknownEnvelopeSchemaError";
  }
}

export function isEnvelopeSchemaId(candidate: string): candidate is EnvelopeSchemaId {
  return Object.hasOwn(ENVELOPE_SCHEMAS, candidate);
}

/** Resolves a schema id to its TypeBox definition, failing closed on an unknown id. */
export function schemaForId(schemaId: string): TObject {
  if (!isEnvelopeSchemaId(schemaId)) {
    throw new UnknownEnvelopeSchemaError(schemaId);
  }
  return ENVELOPE_SCHEMAS[schemaId] as unknown as TObject;
}
