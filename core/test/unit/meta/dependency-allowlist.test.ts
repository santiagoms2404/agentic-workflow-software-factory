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

// Optional and peer dependencies can be installed too; bundling has two npm
// spellings. Check their names without banning legitimate D2 declarations.
// Boolean bundling selects all/none of the dependencies checked by this fence.
function checkSupplementalDependencies(pkg: Record<string, unknown>, allowed: string[]): void {
  for (const field of ["optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"]) {
    const value = pkg[field];
    if (value === undefined) continue;
    const bundled = field === "bundleDependencies" || field === "bundledDependencies";
    if (bundled && typeof value === "boolean") continue;
    let names: unknown[];
    if (bundled) {
      assert.ok(Array.isArray(value), `${field} must be an array or boolean`);
      names = value;
    } else {
      assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${field} must be an object`);
      names = Object.keys(value);
    }
    for (const name of names) {
      assert.ok(typeof name === "string" && allowed.includes(name), `${field}: ${String(name)} is outside the D2 allowlist`);
    }
  }
}

function checkCore(pkg: Record<string, unknown>): void {
  const deps = Object.keys((pkg.dependencies as Record<string, string>) ?? {});
  assert.deepEqual(deps.sort(), [...CORE_DEPS].sort());
  assert.equal(pkg.devDependencies, undefined);
  checkSupplementalDependencies(pkg, CORE_DEPS);
}

function checkDashboard(pkg: Record<string, unknown>): void {
  const deps = Object.keys((pkg.dependencies as Record<string, string>) ?? {});
  const devDeps = Object.keys((pkg.devDependencies as Record<string, string>) ?? {});
  assert.deepEqual(deps.sort(), [...DASHBOARD_DEPS].sort());
  assert.deepEqual(devDeps.sort(), [...DASHBOARD_DEV_DEPS].sort());
  checkSupplementalDependencies(pkg, [...DASHBOARD_DEPS, ...DASHBOARD_DEV_DEPS]);
}

function checkRoot(pkg: Record<string, unknown>): void {
  const devDeps = Object.keys((pkg.devDependencies as Record<string, string>) ?? {});
  assert.deepEqual(devDeps.sort(), [...ROOT_DEV_DEPS].sort());
  assert.equal(pkg.dependencies, undefined);
  // Root's allowance is dev-only, not permission to install runtime dependencies.
  checkSupplementalDependencies(pkg, []);
}

test("core/package.json dependencies match the D2 allowlist exactly", () => {
  checkCore(readJson(join(repoRoot(), "core", "package.json")));
});

test("dashboard/package.json dependencies match the D2 allowlist exactly", () => {
  checkDashboard(readJson(join(repoRoot(), "dashboard", "package.json")));
});

test("root package.json devDependencies match the D2 allowlist exactly", () => {
  checkRoot(readJson(join(repoRoot(), "package.json")));
});

test("the D2 checks reject planted dependencies in each package", () => {
  const deps = (names: readonly string[]) => Object.fromEntries(names.map(name => [name, "*"]));
  const cases = [
    [checkCore, { dependencies: deps(CORE_DEPS) }, "dependencies"],
    [checkDashboard, { dependencies: deps(DASHBOARD_DEPS), devDependencies: deps(DASHBOARD_DEV_DEPS) }, "devDependencies"],
    [checkRoot, { devDependencies: deps(ROOT_DEV_DEPS) }, "devDependencies"],
  ] as const;
  for (const [check, pkg, field] of cases) {
    const clean: Record<string, unknown> = pkg;
    assert.throws(() => check({ ...clean, [field]: { ...clean[field] as object, planted: "1.0.0" } }), /planted/u);
    assert.throws(() => check({ ...pkg, optionalDependencies: { planted: "1.0.0" } }), /optionalDependencies: planted/u);
    assert.throws(() => check({}), { code: "ERR_ASSERTION" });
  }
});
