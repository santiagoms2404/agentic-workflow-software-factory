import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./_walk.ts";

const CORE_DEPS = ["@sinclair/typebox", "yaml"];
const DASHBOARD_DEPS = ["vue", "lucide-vue-next"];
const DASHBOARD_DEV_DEPS = ["vite", "@vitejs/plugin-vue"];
const ROOT_DEV_DEPS = ["typescript", "vue-tsc", "oxlint"];

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
