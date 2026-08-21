import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify as toYaml } from "yaml";
import { buildMinimalConfig, InvalidProjectSlugError } from "../../../src/config/init-template.ts";
import { ConfigSchemaError, loadConfig } from "../../../src/config/load.ts";
import { MAX_CALL_CEILING, MIN_CALL_CEILING } from "../../../src/state/tiers.ts";

for (const slug of ["new-project", "another-valid-project-2"]) {
  test(`buildMinimalConfig round-trips ${slug}`, () => {
    const config = buildMinimalConfig(slug);
    assert.deepEqual(loadConfig(toYaml(config)), config);
  });
}

test("buildMinimalConfig rejects invalid slugs before the loader", () => {
  assert.throws(
    () => buildMinimalConfig("Invalid-Slug"),
    (error: unknown) => error instanceof InvalidProjectSlugError && !(error instanceof ConfigSchemaError),
  );
});

test("buildMinimalConfig uses the imported call-ceiling bounds", () => {
  const ceilings = buildMinimalConfig("ceiling-project").risk.call_ceiling;

  assert.deepEqual(ceilings, {
    T0: MIN_CALL_CEILING,
    T1: MIN_CALL_CEILING,
    T2: MIN_CALL_CEILING,
  });
  for (const ceiling of Object.values(ceilings)) {
    assert.ok(ceiling >= MIN_CALL_CEILING);
    assert.ok(ceiling <= MAX_CALL_CEILING);
  }
});
