import { Type, type Static } from "@sinclair/typebox";
import { ExplicitIdSchema } from "../registry/catalog-schema.ts";
import { phaseEnvelope } from "./envelope-base.ts";
import { SHA_PATTERN } from "./test-output.ts";

export const DESIGN_CONTEXT_SCHEMA_ID = "awsf.design-context/v1";

// Host-composed from the project catalog, machine-local placement, and Git.
// The absolute paths make this journal evidence only: it must never be
// committed or carried by the render phase into a rendered file.
//
// `headSha` pins which revision of each repository was available, not which
// files the designer opened. That is weaker than review_evidence_present's
// byte-level digest and is the right reproducibility unit here: a designer
// explores a codebase, while a reviewer judges a fixed diff.
const AbsoluteMachinePathSchema = Type.String({
  minLength: 1,
  pattern: "^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)",
  description: "Resolved machine-local absolute path. POSIX, drive-letter, and UNC paths are accepted.",
});

const DesignTargetSchema = Type.Object(
  {
    repositoryId: ExplicitIdSchema,
    path: AbsoluteMachinePathSchema,
    defaultBranch: Type.String({ minLength: 1 }),
    headSha: Type.String({ pattern: SHA_PATTERN }),
  },
  { additionalProperties: false },
);

export const DesignContextSchema = phaseEnvelope(
  DESIGN_CONTEXT_SCHEMA_ID,
  {
    // One target per catalog repository, including the plan repository. A
    // single-repository project is the one-item degenerate case.
    targets: Type.Array(DesignTargetSchema, { minItems: 1 }),
  },
  "Host-composed repository identities and revisions available to the design phase. HOST-generated — never model-generated.",
);

export type DesignContext = Static<typeof DesignContextSchema>;
