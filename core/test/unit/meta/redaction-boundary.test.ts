import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./_walk.ts";

const BOUNDARIES = [
  "core/src/persistence/journal.ts",
  "core/src/persistence/status-store.ts",
  "core/src/observability/projector.ts",
  "core/src/config/effective-config.ts",
  "core/src/adapters/env.ts",
];

test("every current persistence/display/provider boundary uses the shared credential scrubber", () => {
  const offenders = BOUNDARIES.filter((path) => {
    const source = readFileSync(join(repoRoot(), path), "utf8");
    return !source.includes("policy/redaction.ts");
  });
  assert.deepEqual(offenders, []);
});

test("credential-shape definitions have one production owner", () => {
  const owners = [
    "core/src/policy/redaction.ts",
    "core/src/config/load.ts",
    "core/src/config/effective-config.ts",
    "core/src/adapters/env.ts",
  ].filter((path) => {
    const source = readFileSync(join(repoRoot(), path), "utf8");
    return /AKIA\[|BEGIN \[A-Z|gh\[opusr\]|xox\[baprs\]/.test(source);
  });
  assert.deepEqual(owners, ["core/src/policy/redaction.ts"]);
});
