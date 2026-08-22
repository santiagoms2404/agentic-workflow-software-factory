import { Type, type Static } from "@sinclair/typebox";
import { GateEntrySchema, ProjectSlugSchema } from "../config/schema.ts";
import { stringUnion, toJsonSchema } from "../contracts/typebox.ts";

export const PROJECT_CATALOG_VERSION = "awsf.project/v1" as const;
export const PROJECT_REPOSITORY_ROLES = ["plan", "service", "application", "library", "source"] as const;
export const PROJECT_DELIVERY_POSTURES = ["service", "mobile", "docs", "none"] as const;
export const PROJECT_PLAN_FORMATS = ["awsf-plan-html/v1"] as const;

const NonEmptyString = Type.String({ minLength: 1 });
const ExplicitId = Type.String({ minLength: 1, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$" });

const RepositoryReferenceSchema = Type.Object(
  {
    repository: ExplicitId,
    path: NonEmptyString,
  },
  { additionalProperties: false },
);

const RepositorySchema = Type.Object(
  {
    role: stringUnion(PROJECT_REPOSITORY_ROLES),
    default_branch: NonEmptyString,
    identity: Type.Optional(
      Type.Object(
        { root_commit: NonEmptyString },
        { additionalProperties: false },
      ),
    ),
    // A catalog records only the gate ids AWSF can join to evidence. It is not
    // a complete account of every check a repository may run.
    gates: Type.Optional(
      Type.Partial(
        Type.Record(ExplicitId, GateEntrySchema, {
          additionalProperties: false,
        }),
      ),
    ),
    delivery: Type.Optional(stringUnion(PROJECT_DELIVERY_POSTURES)),
  },
  { additionalProperties: false },
);

// This one TypeBox definition supplies the runtime validator shape, the
// static TypeScript type, and the JSON Schema emitted below.
export const ProjectCatalogSchema = Type.Object(
  {
    version: Type.Literal(PROJECT_CATALOG_VERSION),
    project: Type.Object(
      { slug: ProjectSlugSchema },
      { additionalProperties: false },
    ),
    repositories: Type.Record(ExplicitId, RepositorySchema, {
      minProperties: 1,
      additionalProperties: false,
    }),
    plans: Type.Object(
      {
        root: Type.String({ minLength: 1, default: "specs" }),
        format: stringUnion(PROJECT_PLAN_FORMATS),
        default: Type.Optional(NonEmptyString),
      },
      { additionalProperties: false },
    ),
    contracts: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: ExplicitId,
            digest: Type.String({ pattern: "^sha256:[0-9a-fA-F]{64}$" }),
            producer: RepositoryReferenceSchema,
            consumers: Type.Array(RepositoryReferenceSchema, { minItems: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { additionalProperties: false, $id: PROJECT_CATALOG_VERSION, title: "ProjectCatalog" },
);

export type ProjectCatalog = Static<typeof ProjectCatalogSchema>;

/** The JSON Schema emission of ProjectCatalogSchema; never a hand-maintained copy. */
export function emitProjectCatalogJsonSchema(): Record<string, unknown> {
  return toJsonSchema(ProjectCatalogSchema, {
    $id: "https://awsf.local/schemas/awsf.project/v1",
    title: "ProjectCatalog",
    description: "Durable identity and coordination for an AWSF multi-repository project.",
  });
}
