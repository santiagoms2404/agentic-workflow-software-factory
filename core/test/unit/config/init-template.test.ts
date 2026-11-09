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
    T0: 1,
    T1: 3,
    T2: 5,
  });
  for (const ceiling of Object.values(ceilings)) {
    assert.ok(ceiling >= MIN_CALL_CEILING);
    assert.ok(ceiling <= MAX_CALL_CEILING);
  }
});

test("B10-29: the minimal config protects the catalog, plan HTML, build prompts and ticket sets next to it", () => {
  const protectedPaths = buildMinimalConfig("protected-project").policy.protected_paths;
  for (const glob of ["AGENTS.md", "awsf.config.yaml", "awsf.project.yaml", "specs/*.html", "specs/*-build-prompts.md", "specs/tickets/*/**"]) {
    assert.ok(protectedPaths.includes(glob), `${glob} must be protected in a new project`);
  }
});
