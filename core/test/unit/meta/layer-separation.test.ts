import assert from "node:assert/strict";
import { test } from "node:test";
import { emitProjectCatalogJsonSchema } from "../../../src/registry/catalog-schema.ts";
import { emitPlacementJsonSchema } from "../../../src/registry/placement-schema.ts";

type JsonSchema = Record<string, unknown>;

function topLevelPropertyNames(schema: JsonSchema): Set<string> {
  return new Set(Object.keys(schema["properties"] as Record<string, unknown>));
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

test("catalog and placement share only their project join field outside document framing", () => {
  const catalogProperties = topLevelPropertyNames(emitProjectCatalogJsonSchema());
  const placementProperties = topLevelPropertyNames(emitPlacementJsonSchema());
  // Both documents need a version discriminator and repository map to parse
  // and index their records. Those envelopes do not carry durable identity or
  // machine-local placement. The remaining common property is the join key.
  for (const name of ["version", "repositories"]) {
    catalogProperties.delete(name);
    placementProperties.delete(name);
  }

  assert.deepEqual(intersection(catalogProperties, placementProperties), ["project"]);
});

test("neither emitted schema names a state root or clone path", () => {
  const forbidden = /(?:^|[_-])(?:state[_-]?root|clone(?:[_-]?(?:path|root|location))?)(?:$|[_-])/i;

  for (const [name, schema] of [
    ["catalog", emitProjectCatalogJsonSchema()],
    ["placement", emitPlacementJsonSchema()],
  ] as const) {
    const matches = [...allPropertyNames(schema)].filter((property) => forbidden.test(property));
    assert.deepEqual(matches, [], `${name} schema has a state-root or clone-path field`);
  }
});
