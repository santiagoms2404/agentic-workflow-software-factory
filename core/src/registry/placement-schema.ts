import { Type, type Static } from "@sinclair/typebox";
import { toJsonSchema } from "../contracts/typebox.ts";
import { ProjectSlugSchema } from "../config/schema.ts";
import { ExplicitIdSchema } from "./catalog-schema.ts";

export const PLACEMENT_VERSION = "awsf.placement/v1" as const;

const Path = Type.String({ minLength: 1 });

const PlacementRepositorySchema = Type.Object(
  {
    path: Path,
    worktree_root: Type.Optional(Path),
  },
  { additionalProperties: false },
);

// This document is machine-local placement only. Its deliberately closed
// shape prevents durable project identity from being recorded beside paths.
export const PlacementSchema = Type.Object(
  {
    version: Type.Literal(PLACEMENT_VERSION),
    project: ProjectSlugSchema,
    repositories: Type.Record(ExplicitIdSchema, PlacementRepositorySchema, {
      minProperties: 1,
      additionalProperties: false,
    }),
    worktree_root: Type.Optional(Path),
  },
  { additionalProperties: false, $id: PLACEMENT_VERSION, title: "Placement" },
);

export type Placement = Static<typeof PlacementSchema>;

/** The JSON Schema emission of PlacementSchema; never a hand-maintained copy. */
export function emitPlacementJsonSchema(): Record<string, unknown> {
  return toJsonSchema(PlacementSchema, {
    $id: "https://awsf.local/schemas/awsf.placement/v1",
    title: "Placement",
    description: "Machine-local repository placement for an AWSF project.",
  });
}
