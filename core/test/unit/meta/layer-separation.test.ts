import assert from "node:assert/strict";
import { test } from "node:test";
import { emitProjectCatalogJsonSchema } from "../../../src/registry/catalog-schema.ts";
import { emitPlacementJsonSchema } from "../../../src/registry/placement-schema.ts";

type JsonSchema = Record<string, unknown>;

function topLevelPropertyNames(schema: JsonSchema): Set<string> {
  const properties = Object.keys(schema["properties"] as Record<string, unknown>);
  assert.ok(properties.length > 0, "empty schema properties");
  return new Set(properties);
}

function allPropertyNames(node: unknown, names = new Set<string>()): Set<string> {
  if (node === null || typeof node !== "object") return names;
  const object = node as Record<string, unknown>;
  const properties = object["properties"];
  if (properties !== null && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [name, child] of Object.entries(properties as Record<string, unknown>)) {
      names.add(name);
      allPropertyNames(child, names);
    }
  }
  for (const [name, child] of Object.entries(object)) {
    if (name !== "properties") allPropertyNames(child, names);
  }
  return names;
}

function intersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((name) => right.has(name)).sort();
}

function checkSharedProperties(catalog: JsonSchema, placement: JsonSchema): void {
  const catalogProperties = topLevelPropertyNames(catalog);
  const placementProperties = topLevelPropertyNames(placement);
  // Both documents need a version discriminator and repository map to parse
  // and index their records. Those envelopes do not carry durable identity or
  // machine-local placement. The remaining common property is the join key.
  for (const name of ["version", "repositories"]) {
    catalogProperties.delete(name);
    placementProperties.delete(name);
  }

  assert.deepEqual(intersection(catalogProperties, placementProperties), ["project"]);
}

function checkPaths(name: string, schema: JsonSchema): void {
  topLevelPropertyNames(schema);
  const forbidden = /(?:^|[_-])(?:state[_-]?root|stateroot|clone(?:[_-]?(?:path|root|location))?)(?:$|[_-])/i;

  const matches = [...allPropertyNames(schema)].filter((property) => forbidden.test(property));
  assert.deepEqual(matches, [], `${name} schema has a state-root or clone-path field: ${matches.join(", ")}`);
}

test("catalog and placement share only their project join field outside document framing", () => {
  checkSharedProperties(emitProjectCatalogJsonSchema(), emitPlacementJsonSchema());
});

test("neither emitted schema names a state root or clone path", () => {
  checkPaths("catalog", emitProjectCatalogJsonSchema());
  checkPaths("placement", emitPlacementJsonSchema());
});

test("layer checks reject a planted shared field and nested machine-local paths", () => {
  const shared = { properties: { project: {}, planted: {} } };
  assert.throws(() => checkSharedProperties(shared, shared), /planted/u);
  for (const field of ["stateRoot", "clone_path"]) {
    const nested = { properties: { repo: { properties: { [field]: {} } } } };
    assert.throws(() => checkPaths("planted", nested), new RegExp(field, "u"));
  }
  assert.throws(() => checkPaths("planted", { properties: {} }), /empty schema properties/u);
});
