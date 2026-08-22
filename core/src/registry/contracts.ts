import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { parse as parseYaml } from "yaml";
import { stringUnion, toJsonSchema } from "../contracts/typebox.ts";
import { normalizeRepositoryPath } from "../policy/path-policy.ts";
import {
  ContractDigestSchema,
  ExplicitIdSchema,
} from "./catalog-schema.ts";

export const CONTRACT_PROJECTION_VERSION = "awsf.contracts/v1" as const;
export const CONTRACT_PARTICIPANT_ROLES = ["produces", "consumes"] as const;

const ContractProjectionEntrySchema = Type.Object(
  {
    id: ExplicitIdSchema,
    role: stringUnion(CONTRACT_PARTICIPANT_ROLES),
    path: Type.String({ minLength: 1 }),
    digest: ContractDigestSchema,
  },
  { additionalProperties: false },
);

/** A repository-local projection containing only contracts this repository participates in. */
export const ContractProjectionSchema = Type.Object(
  {
    version: Type.Literal(CONTRACT_PROJECTION_VERSION),
    contracts: Type.Array(ContractProjectionEntrySchema),
  },
  { additionalProperties: false, $id: CONTRACT_PROJECTION_VERSION, title: "ContractProjection" },
);

export type ContractProjection = Static<typeof ContractProjectionSchema>;

export class ContractProjectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ContractProjectionError";
  }
}

export class ContractProjectionSchemaError extends ContractProjectionError {
  readonly violations: string[];

  constructor(violations: string[]) {
    super(
      "E_CONTRACT_PROJECTION_SCHEMA",
      `contract projection does not match ${CONTRACT_PROJECTION_VERSION}: ${violations.join("; ")}`,
    );
    this.name = "ContractProjectionSchemaError";
    this.violations = violations;
  }
}

export class ContractProjectionPathError extends ContractProjectionError {
  constructor(contractId: string, path: string, detail: string) {
    super(
      "E_CONTRACT_PROJECTION_PATH",
      `contract ${JSON.stringify(contractId)} path is not repository-relative: ${JSON.stringify(path)} (${detail})`,
    );
    this.name = "ContractProjectionPathError";
  }
}

function assertStructure(doc: unknown): asserts doc is ContractProjection {
  if (Value.Check(ContractProjectionSchema, doc)) return;
  const violations = [...Value.Errors(ContractProjectionSchema, doc)]
    .map((error) => `${error.path || "(root)"}: ${error.message}`);
  throw new ContractProjectionSchemaError(violations);
}

/** Parses and validates repository-root `awsf.contracts.yaml` text. */
export function loadContractProjection(yamlText: string): ContractProjection {
  const doc: unknown = parseYaml(yamlText);
  assertStructure(doc);
  for (const contract of doc.contracts) {
    try {
      normalizeRepositoryPath(contract.path);
    } catch (error) {
      throw new ContractProjectionPathError(
        contract.id,
        contract.path,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return doc;
}

/** The JSON Schema emission of ContractProjectionSchema; never a hand-maintained copy. */
export function emitContractProjectionJsonSchema(): Record<string, unknown> {
  return toJsonSchema(ContractProjectionSchema, {
    $id: "https://awsf.local/schemas/awsf.contracts/v1",
    title: "ContractProjection",
    description: "Repository-local contract participation and expected byte digests.",
  });
}
