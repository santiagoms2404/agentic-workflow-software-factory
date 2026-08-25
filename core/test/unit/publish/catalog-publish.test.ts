import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CatalogAbsolutePathError,
  CatalogCredentialShapedError,
  CatalogSchemaError,
  loadCatalog,
} from "../../../src/registry/catalog.ts";

function catalog(publish = ""): string {
  return `
version: awsf.project/v1
project:
  slug: publish-test
repositories:
  plans:
    role: plan
    default_branch: main
  service:
    role: service
    default_branch: main${publish}
plans:
  root: specs
  format: awsf-plan-html/v1
`;
}

function publishBlock(fields: string): string {
  return `
    publish:
${fields}`;
}

function assertCode(action: () => unknown, ErrorType: new (...args: never[]) => Error, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof ErrorType && (error as { code?: string }).code === code);
}

test("rejects a credential-shaped publish host with the inherited catalog check", () => {
  // INHERITED, not added: containsCredential already scans every catalog string leaf.
  const credentialShapedHost = "https://" + ["user", "token"].join(":") + "@host";
  const yaml = catalog(publishBlock(`      remotes: [origin]
      branches: [main]
      host: ${credentialShapedHost}`));

  assertCode(() => loadCatalog(yaml), CatalogCredentialShapedError, "E_CATALOG_CREDENTIAL");
});

for (const [name, value] of [
  ["an absolute path", "/tmp/publish"],
  ["a drive-letter path", "C:\\publish"],
] as const) {
  test(`rejects ${name} anywhere in publish with the inherited catalog check`, () => {
    // INHERITED, not added: assertNoAbsolutePaths already scans every catalog string leaf.
    const yaml = catalog(publishBlock(`      remotes: [${value}]
      branches: [main]`));

    assertCode(() => loadCatalog(yaml), CatalogAbsolutePathError, "E_CATALOG_ABSOLUTE_PATH");
  });
}

for (const key of ["environment", "endpoint", "release"]) {
  test(`rejects publish.${key} so deployment scope cannot enter the schema`, () => {
    const yaml = catalog(publishBlock(`      remotes: [origin]
      branches: [main]
      ${key}: production`));

    assertCode(() => loadCatalog(yaml), CatalogSchemaError, "E_CATALOG_SCHEMA");
  });
}

for (const field of ["remotes", "branches"]) {
  test(`rejects an empty publish ${field} allowlist`, () => {
    const other = field === "remotes" ? "branches" : "remotes";
    const yaml = catalog(publishBlock(`      ${field}: []
      ${other}: [main]`));

    assertCode(() => loadCatalog(yaml), CatalogSchemaError, "E_CATALOG_SCHEMA");
  });
}

test("loads a repository without publish as not publishable", () => {
  const loaded = loadCatalog(catalog());

  assert.equal(loaded.repositories.service?.publish, undefined);
});

for (const [name, remote] of [
  ["a slash", "upstream/origin"],
  ["whitespace", "upstream origin"],
  ["a leading plus", "+origin"],
  ["a colon", "origin:write"],
] as const) {
  test(`rejects a publish remote name containing ${name}`, () => {
    const yaml = catalog(publishBlock(`      remotes: [${JSON.stringify(remote)}]
      branches: [main]`));

    assertCode(() => loadCatalog(yaml), CatalogSchemaError, "E_CATALOG_SCHEMA");
  });
}
