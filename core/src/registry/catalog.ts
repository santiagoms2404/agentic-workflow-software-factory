import { Value } from "@sinclair/typebox/value";
import { parse as parseYaml } from "yaml";
import { KNOWN_GATE_IDS } from "../config/schema.ts";
import { assertNoAbsolutePaths, scanStrings } from "../config/machine-path.ts";
import { normalizeRepositoryPath } from "../policy/path-policy.ts";
import { containsCredential } from "../policy/redaction.ts";
import {
  PROJECT_CATALOG_VERSION,
  ProjectCatalogSchema,
  type ProjectCatalog,
} from "./catalog-schema.ts";

// Every rejection this loader can throw. Kept as one closed class hierarchy
// so callers assert on `code` or `instanceof`, never message text.
export class CatalogError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CatalogError";
  }
}

export class CatalogSchemaError extends CatalogError {
  readonly violations: string[];

  constructor(violations: string[]) {
    super("E_CATALOG_SCHEMA", `catalog does not match ${PROJECT_CATALOG_VERSION}: ${violations.join("; ")}`);
    this.name = "CatalogSchemaError";
    this.violations = violations;
  }
}

export class CatalogUnknownVersionError extends CatalogError {
  constructor(version: string) {
    super("E_CATALOG_UNKNOWN_VERSION", `unknown catalog version: ${JSON.stringify(version)}`);
    this.name = "CatalogUnknownVersionError";
  }
}

export class CatalogAbsolutePathError extends CatalogError {
  constructor(path: string, value: string) {
    super("E_CATALOG_ABSOLUTE_PATH", `${path} looks like an absolute machine path: ${JSON.stringify(value)}`);
    this.name = "CatalogAbsolutePathError";
  }
}

export class CatalogEscapingPathError extends CatalogError {
  constructor(path: string, value: string, detail: string) {
    super("E_CATALOG_ESCAPING_PATH", `${path} is not repository-relative: ${JSON.stringify(value)} (${detail})`);
    this.name = "CatalogEscapingPathError";
  }
}

export class CatalogCredentialShapedError extends CatalogError {
  constructor(path: string) {
    super("E_CATALOG_CREDENTIAL", `${path} holds a credential-shaped value`);
    this.name = "CatalogCredentialShapedError";
  }
}

export class CatalogUnknownGateError extends CatalogError {
  constructor(repositoryId: string, gateId: string) {
    super("E_CATALOG_UNKNOWN_GATE", `repositories.${repositoryId}.gates names unknown gate id ${JSON.stringify(gateId)}`);
    this.name = "CatalogUnknownGateError";
  }
}

export class CatalogPlanRoleCardinalityError extends CatalogError {
  constructor(repositoryIds: readonly string[]) {
    super(
      "E_CATALOG_PLAN_ROLE_CARDINALITY",
      `exactly one repository must carry role "plan", found ${repositoryIds.length}: ${repositoryIds.join(", ")}`,
    );
    this.name = "CatalogPlanRoleCardinalityError";
  }
}

export class CatalogContractReferenceError extends CatalogError {
  constructor(contractId: string, role: "producer" | "consumer", repositoryId: string) {
    super(
      "E_CATALOG_CONTRACT_REFERENCE",
      `contract ${JSON.stringify(contractId)} ${role} names undeclared repository ${JSON.stringify(repositoryId)}`,
    );
    this.name = "CatalogContractReferenceError";
  }
}

function versionOf(doc: unknown): unknown {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return undefined;
  return (doc as Record<string, unknown>).version;
}

function assertStructure(doc: unknown): void {
  if (Value.Check(ProjectCatalogSchema, doc)) return;

  const errors = [...Value.Errors(ProjectCatalogSchema, doc)];
  const nonVersionErrors = errors.filter((error) => error.path !== "/version");
  const version = versionOf(doc);
  if (nonVersionErrors.length === 0 && typeof version === "string") {
    throw new CatalogUnknownVersionError(version);
  }

  const violations = errors.map((error) => `${error.path || "(root)"}: ${error.message}`);
  throw new CatalogSchemaError(violations);
}

function assertNoCredentialShapedValues(doc: unknown): void {
  scanStrings(doc, "", (path, value) => {
    if (containsCredential(value)) throw new CatalogCredentialShapedError(path);
  });
}

function assertRepositoryPath(path: string, value: string): void {
  try {
    normalizeRepositoryPath(value);
  } catch (error) {
    throw new CatalogEscapingPathError(path, value, error instanceof Error ? error.message : String(error));
  }
}

function assertRepositoryPaths(catalog: ProjectCatalog): void {
  assertRepositoryPath("plans.root", catalog.plans.root);
  for (const contract of catalog.contracts ?? []) {
    assertRepositoryPath(`contracts.${contract.id}.producer.path`, contract.producer.path);
    contract.consumers.forEach((consumer, index) => {
      assertRepositoryPath(`contracts.${contract.id}.consumers[${index}].path`, consumer.path);
    });
  }
}

function assertKnownGateIds(catalog: ProjectCatalog): void {
  for (const [repositoryId, repository] of Object.entries(catalog.repositories)) {
    for (const gateId of Object.keys(repository.gates ?? {})) {
      if (!(KNOWN_GATE_IDS as readonly string[]).includes(gateId)) {
        throw new CatalogUnknownGateError(repositoryId, gateId);
      }
    }
  }
}

function assertPlanRoleCardinality(catalog: ProjectCatalog): void {
  const planRepositoryIds = Object.entries(catalog.repositories)
    .filter(([, repository]) => repository.role === "plan")
    .map(([repositoryId]) => repositoryId);
  if (planRepositoryIds.length !== 1) throw new CatalogPlanRoleCardinalityError(planRepositoryIds);
}

function assertContractReferences(catalog: ProjectCatalog): void {
  const repositoryIds = new Set(Object.keys(catalog.repositories));
  for (const contract of catalog.contracts ?? []) {
    if (!repositoryIds.has(contract.producer.repository)) {
      throw new CatalogContractReferenceError(contract.id, "producer", contract.producer.repository);
    }
    for (const consumer of contract.consumers) {
      if (!repositoryIds.has(consumer.repository)) {
        throw new CatalogContractReferenceError(contract.id, "consumer", consumer.repository);
      }
    }
  }
}

/** Parses and validates durable `awsf.project.yaml` catalog text. */
export function loadCatalog(yamlText: string): ProjectCatalog {
  const doc: unknown = parseYaml(yamlText);

  // These document-wide sweeps intentionally precede structural validation so
  // newly added fields inherit the durable-value restrictions automatically.
  assertNoAbsolutePaths(doc, CatalogAbsolutePathError);
  assertNoCredentialShapedValues(doc);
  assertStructure(doc);
  const catalog = doc as ProjectCatalog;

  assertRepositoryPaths(catalog);
  assertKnownGateIds(catalog);
  assertPlanRoleCardinality(catalog);
  assertContractReferences(catalog);

  return catalog;
}
