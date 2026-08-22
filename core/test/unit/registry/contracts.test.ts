import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify as toYaml } from "yaml";
import {
  ContractProjectionPathError,
  ContractProjectionSchema,
  ContractProjectionSchemaError,
  loadContractProjection,
} from "../../../src/registry/contracts.ts";
import {
  ContractDigestSchema,
  ProjectCatalogSchema,
} from "../../../src/registry/catalog-schema.ts";

function validProjection(): Record<string, unknown> {
  return {
    version: "awsf.contracts/v1",
    contracts: [
      {
        id: "openapi",
        role: "consumes",
        path: "lib/api/openapi.json",
        digest: `sha256:${"0".repeat(64)}`,
      },
    ],
  };
}

function cloneProjection(): Record<string, any> {
  return structuredClone(validProjection()) as Record<string, any>;
}

function assertCode(action: () => unknown, ErrorType: new (...args: any[]) => Error, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof ErrorType && (error as { code?: string }).code === code);
}

test("loads a repository-local contract projection with only participant fields", () => {
  const projection = loadContractProjection(toYaml(validProjection()));

  assert.deepEqual(projection, validProjection());
});

test("the catalog and projection reference one digest schema fragment", () => {
  const catalogDigest = ProjectCatalogSchema.properties.contracts.items.properties.digest;
  const projectionDigest = ContractProjectionSchema.properties.contracts.items.properties.digest;

  assert.equal(catalogDigest, ContractDigestSchema);
  assert.equal(projectionDigest, ContractDigestSchema);
});

for (const [name, mutate] of [
  ["an extra root field", (doc: Record<string, any>) => { doc.project = "smart-health"; }],
  ["an extra participant field", (doc: Record<string, any>) => { doc.contracts[0].repository = "application"; }],
  ["a parent producer field", (doc: Record<string, any>) => {
    doc.contracts[0].producer = { repository: "service", path: "openapi.json" };
  }],
] as const) {
  test(`rejects ${name}`, () => {
    const doc = cloneProjection();
    mutate(doc);

    assertCode(
      () => loadContractProjection(toYaml(doc)),
      ContractProjectionSchemaError,
      "E_CONTRACT_PROJECTION_SCHEMA",
    );
  });
}

for (const digest of [
  `sha256:${"A".repeat(64)}`,
  `sha256:${"0".repeat(63)}`,
  "sha512:" + "0".repeat(64),
] as const) {
  test(`rejects projection digest ${digest.slice(0, 12)}...`, () => {
    const doc = cloneProjection();
    doc.contracts[0].digest = digest;

    assertCode(
      () => loadContractProjection(toYaml(doc)),
      ContractProjectionSchemaError,
      "E_CONTRACT_PROJECTION_SCHEMA",
    );
  });
}

test("rejects a projection path with an upward segment", () => {
  const doc = cloneProjection();
  doc.contracts[0].path = "lib/../openapi.json";

  assertCode(
    () => loadContractProjection(toYaml(doc)),
    ContractProjectionPathError,
    "E_CONTRACT_PROJECTION_PATH",
  );
});
