import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stringify as toYaml } from "yaml";
import {
  CatalogAbsolutePathError,
  CatalogContractReferenceError,
  CatalogEscapingPathError,
  CatalogPlanRoleCardinalityError,
  CatalogUnknownGateError,
  CatalogUnknownVersionError,
  loadCatalog,
} from "../../../src/registry/catalog.ts";
import { loadConfig } from "../../../src/config/load.ts";

function validCatalog(): Record<string, unknown> {
  return {
    version: "awsf.project/v1",
    project: { slug: "smart-health" },
    repositories: {
      plans: { role: "plan", default_branch: "main", identity: { root_commit: "a".repeat(40) } },
      service: {
        role: "service",
        default_branch: "main",
        identity: { root_commit: "b".repeat(40) },
        gates: { test: { argv: ["npm", "test"], timeout_seconds: 60 } },
      },
      application: { role: "application", default_branch: "master" },
      "model-source-one": { role: "source", default_branch: "main", identity: { root_commit: "c".repeat(40) } },
      "model-source-two": { role: "source", default_branch: "master", identity: { root_commit: "d".repeat(40) } },
    },
    plans: { root: "specs", format: "awsf-plan-html/v1" },
    contracts: [
      {
        id: "openapi",
        digest: `sha256:${"0".repeat(64)}`,
        producer: { repository: "service", path: "openapi.json" },
        consumers: [{ repository: "application", path: "lib/api/openapi.json" }],
      },
    ],
  };
}

function cloneCatalog(): Record<string, any> {
  return structuredClone(validCatalog()) as Record<string, any>;
}

function assertCode(action: () => unknown, ErrorType: new (...args: any[]) => Error, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof ErrorType && (error as { code?: string }).code === code);
}

test("loads this repository's catalog with the configured project slug", () => {
  const catalogPath = fileURLToPath(new URL("../../../../awsf.project.yaml", import.meta.url));
  const configPath = fileURLToPath(new URL("../../../../awsf.config.yaml", import.meta.url));

  const catalog = loadCatalog(readFileSync(catalogPath, "utf8"));
  const config = loadConfig(readFileSync(configPath, "utf8"));

  assert.equal(catalog.project.slug, config.project.slug);
});

test("loads a measured five-repository catalog with mixed branches and an optional identity signal", () => {
  const catalog = loadCatalog(toYaml(validCatalog()));

  assert.equal(Object.keys(catalog.repositories).length, 5);
  assert.equal(catalog.repositories.application?.identity, undefined);
  assert.equal(catalog.repositories.application?.default_branch, "master");
  assert.equal(catalog.repositories.service?.default_branch, "main");
});

for (const [name, mutate] of [
  ["a POSIX absolute path", (doc: Record<string, any>) => { doc.plans.root = "/srv/projects/plans"; }],
  ["a Windows drive-letter path", (doc: Record<string, any>) => { doc.contracts[0].producer.path = "C:\\projects\\service\\openapi.json"; }],
  ["a UNC path", (doc: Record<string, any>) => { doc.contracts[0].consumers[0].path = "\\\\host\\share\\openapi.json"; }],
  ["a home-relative path in an object key", (doc: Record<string, any>) => {
    doc.repositories.service.gates["~/.awsf/gate"] = { argv: ["npm", "test"], timeout_seconds: 60 };
  }],
] as const) {
  test(`rejects ${name} with the catalog path code`, () => {
    const doc = cloneCatalog();
    mutate(doc);
    assertCode(() => loadCatalog(toYaml(doc)), CatalogAbsolutePathError, "E_CATALOG_ABSOLUTE_PATH");
  });
}

test("rejects a repository-relative path with an upward escape", () => {
  const doc = cloneCatalog();
  doc.contracts[0].producer.path = "../service/openapi.json";

  assertCode(() => loadCatalog(toYaml(doc)), CatalogEscapingPathError, "E_CATALOG_ESCAPING_PATH");
});

for (const count of [0, 2]) {
  test(`rejects ${count} plan-role repositories`, () => {
    const doc = cloneCatalog();
    if (count === 0) doc.repositories.plans.role = "source";
    if (count === 2) doc.repositories.service.role = "plan";

    assertCode(() => loadCatalog(toYaml(doc)), CatalogPlanRoleCardinalityError, "E_CATALOG_PLAN_ROLE_CARDINALITY");
  });
}

test("rejects an unknown catalog version", () => {
  const doc = cloneCatalog();
  doc.version = "awsf.project/v2";

  assertCode(() => loadCatalog(toYaml(doc)), CatalogUnknownVersionError, "E_CATALOG_UNKNOWN_VERSION");
});

test("rejects an unknown gate id", () => {
  const doc = cloneCatalog();
  doc.repositories.service.gates.unmeasured_gate = { argv: ["npm", "run", "check"], timeout_seconds: 60 };

  assertCode(() => loadCatalog(toYaml(doc)), CatalogUnknownGateError, "E_CATALOG_UNKNOWN_GATE");
});

test("rejects a contract naming an undeclared repository", () => {
  const doc = cloneCatalog();
  doc.contracts[0].consumers[0].repository = "dispatch-daemon";

  assertCode(() => loadCatalog(toYaml(doc)), CatalogContractReferenceError, "E_CATALOG_CONTRACT_REFERENCE");
});
