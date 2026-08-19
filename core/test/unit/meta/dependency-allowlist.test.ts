import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./_walk.ts";

const CORE_DEPS = ["@sinclair/typebox", "yaml"];
const DASHBOARD_DEPS = ["vue", "lucide-vue-next"];
const DASHBOARD_DEV_DEPS = ["vite", "@vitejs/plugin-vue"];
// `@types/node` was admitted to D2 by owner amendment (2026-08-18, T37). It is
// a devDependency carrying type declarations only: it ships nothing, executes
// nothing, and is absent from every runtime import graph. D2 exists to bound the
// RUNTIME dependency surface, and this does not enter it. Admitting it is what
// lets `typecheck` see real type errors instead of 813 missing-ambient ones.
const ROOT_DEV_DEPS = ["@types/node", "typescript", "vue-tsc", "oxlint"];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("core/package.json dependencies match the D2 allowlist exactly", () => {
  const pkg = readJson(join(repoRoot(), "core", "package.json"));
  const deps = Object.keys((pkg.dependencies as Record<string, string>) ?? {});
  assert.deepEqual(deps.sort(), [...CORE_DEPS].sort());
  assert.equal(pkg.devDependencies, undefined);
});

test("dashboard/package.json dependencies match the D2 allowlist exactly", () => {
  const pkg = readJson(join(repoRoot(), "dashboard", "package.json"));
  const deps = Object.keys((pkg.dependencies as Record<string, string>) ?? {});
  const devDeps = Object.keys((pkg.devDependencies as Record<string, string>) ?? {});
  assert.deepEqual(deps.sort(), [...DASHBOARD_DEPS].sort());
  assert.deepEqual(devDeps.sort(), [...DASHBOARD_DEV_DEPS].sort());
});

test("root package.json devDependencies match the D2 allowlist exactly", () => {
  const pkg = readJson(join(repoRoot(), "package.json"));
  const devDeps = Object.keys((pkg.devDependencies as Record<string, string>) ?? {});
  assert.deepEqual(devDeps.sort(), [...ROOT_DEV_DEPS].sort());
  assert.equal(pkg.dependencies, undefined);
});
