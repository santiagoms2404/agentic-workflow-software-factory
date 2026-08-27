import { Type, type Static } from "@sinclair/typebox";
import {
  PROJECT_DELIVERY_POSTURES,
  PROJECT_PLAN_FORMATS,
  PROJECT_REPOSITORY_ROLES,
} from "../registry/catalog-schema.ts";
import { phaseEnvelope } from "./envelope-base.ts";
import { stringUnion } from "./typebox.ts";

export const PROJECT_REGISTER_OUTPUT_SCHEMA_ID = "awsf.project-register-output/v1";

const ResolvedCommandSchema = Type.Object(
  {
    gateId: Type.String({ minLength: 1 }),
    argv: Type.Array(Type.String()),
    timeout_seconds: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const ResolvedRepositorySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
    worktreeRoot: Type.String({ minLength: 1 }),
    role: stringUnion(PROJECT_REPOSITORY_ROLES),
    defaultBranch: Type.String({ minLength: 1 }),
    identity: Type.Optional(Type.Object({ root_commit: Type.String({ minLength: 1 }) }, { additionalProperties: false })),
    delivery: Type.Optional(stringUnion(PROJECT_DELIVERY_POSTURES)),
    gates: Type.Array(ResolvedCommandSchema),
  },
  { additionalProperties: false },
);

const ResolvedProjectSchema = Type.Object(
  {
    slug: Type.String({ minLength: 1 }),
    repositories: Type.Record(Type.String({ minLength: 1 }), ResolvedRepositorySchema, { minProperties: 1 }),
    plans: Type.Object(
      {
        root: Type.String({ minLength: 1 }),
        format: stringUnion(PROJECT_PLAN_FORMATS),
        default: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: false },
    ),
    contracts: Type.Array(Type.Object(
      {
        id: Type.String({ minLength: 1 }),
        digest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
        producer: Type.Object(
          { repository: Type.String({ minLength: 1 }), path: Type.String({ minLength: 1 }) },
          { additionalProperties: false },
        ),
        consumers: Type.Array(Type.Object(
          { repository: Type.String({ minLength: 1 }), path: Type.String({ minLength: 1 }) },
          { additionalProperties: false },
        ), { minItems: 1 }),
      },
      { additionalProperties: false },
    )),
  },
  { additionalProperties: false },
);

export const ProjectRegisterOutputSchema = phaseEnvelope(
  PROJECT_REGISTER_OUTPUT_SCHEMA_ID,
  {
    kind: Type.String({ minLength: 1 }),
    line: Type.String({ minLength: 1 }),
    resolvedProject: ResolvedProjectSchema,
    placementFileBytes: Type.String(),
  },
  "Validated result returned and printed by the session-less awsf project register host command. HOST-generated and not stored.",
);

export type ProjectRegisterOutput = Static<typeof ProjectRegisterOutputSchema>;
