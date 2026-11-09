import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { parse as parseYaml } from "yaml";
import { stringUnion, toJsonSchema } from "../contracts/typebox.ts";
import { normalizeRepositoryPath } from "../policy/path-policy.ts";
import {
  ContractDigestSchema,
  ExplicitIdSchema,
  type ProjectCatalog,
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

/** The host-registered expectation a production candidate must satisfy. */
export interface ContractGateRequirement {
  readonly id: string;
  readonly role: "produces" | "consumes";
  readonly path: string;
  readonly digest: string;
}

/** Derives local requirements from the canonical project catalog, never a candidate projection. */
export function contractRequirementsForRepository(
  catalog: Pick<ProjectCatalog, "contracts">,
  repositoryId: string,
): readonly ContractGateRequirement[] {
  const requirements: ContractGateRequirement[] = [];
  for (const contract of catalog.contracts ?? []) {
    if (contract.producer.repository === repositoryId) {
      requirements.push(Object.freeze({ id: contract.id, role: "produces", path: contract.producer.path, digest: contract.digest }));
    }
    for (const consumer of contract.consumers) {
      if (consumer.repository === repositoryId) {
        requirements.push(Object.freeze({ id: contract.id, role: "consumes", path: consumer.path, digest: contract.digest }));
      }
    }
  }
  return Object.freeze(requirements);
}

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
