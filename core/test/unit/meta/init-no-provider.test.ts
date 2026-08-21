import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { relRepo, repoRoot } from "./_walk.ts";

const ENTRYPOINTS = [
  "core/src/cli/commands/init.ts",
  "core/src/config/init-template.ts",
] as const;

// Exact rather than prefix-based: adding any new dependency requires explaining
// why deterministic initialization needs it. TypeBox and the tier files are the
// schema-validation and schema-bound constants used by the config builder.
const ALLOWED_LOCAL_MODULES = [
  "core/src/cli/commands/init.ts",
  "core/src/config/init-template.ts",
  "core/src/config/schema.ts",
  "core/src/execution/transport-broker.ts",
  "core/src/git/changes.ts",
  "core/src/git/commit.ts",
  "core/src/state/errors.ts",
  "core/src/state/tiers.ts",
] as const;

// The broker is the approved host-process boundary. It is deliberately a leaf
// in this walk: init reaches only runSystemCommand through git/changes.ts, while
// the broker's provider-launch implementation has separate adapter interfaces.
const TERMINAL_LOCAL_MODULES = new Set([
  "core/src/execution/transport-broker.ts",
]);

// Only packages and Node builtins used by config construction and host file I/O.
const ALLOWED_EXTERNAL_MODULES = [
  "@sinclair/typebox",
  "@sinclair/typebox/value",
  "node:fs/promises",
  "node:path",
  "yaml",
] as const;

const BASELINE_BOUNDARY = [
  /^core\/src\/adapters\//,
  /^core\/src\/workflow\//,
  /^core\/src\/gates\//,
  /(?:^|\/)(?:recipes?|compiled-envelope)(?:\/|\.ts$)/,
] as const;

// Standard static imports and export-from declarations only. Dynamic import()
// and require() are outside this fence; neither mechanism exists in this path.
const STATIC_IMPORT = /\bimport\s+(?!type\b)(?:["']([^"']+)["']|[\s\S]*?\bfrom\s+["']([^"']+)["'])|\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g;

test("awsf init reaches only its host-side baseline allowlist", () => {
  const reachable = walkStaticImports(ENTRYPOINTS);
  const allowed = [...ALLOWED_LOCAL_MODULES, ...ALLOWED_EXTERNAL_MODULES].sort();

  assert.deepEqual([...reachable].sort(), allowed);

  const boundaryViolations = [...reachable]
    .filter((module) => module.startsWith("core/src/"))
    .filter((module) => BASELINE_BOUNDARY.some((pattern) => pattern.test(module)));
  assert.deepEqual(boundaryViolations, [], "init must not reach providers, workflows, gates, or recipes");

  const allowlistViolations = ALLOWED_LOCAL_MODULES.filter((module) =>
    BASELINE_BOUNDARY.some((pattern) => pattern.test(module))
  );
  assert.deepEqual(allowlistViolations, [], "the allowlist itself must preserve the baseline boundary");
});

function walkStaticImports(entrypoints: readonly string[]): Set<string> {
  const reachable = new Set<string>();
  const pending = [...entrypoints];

  while (pending.length > 0) {
    const module = pending.pop();
    assert.ok(module !== undefined);
    if (reachable.has(module)) continue;
    reachable.add(module);

    if (!module.startsWith("core/src/") || TERMINAL_LOCAL_MODULES.has(module)) continue;

    const sourcePath = join(repoRoot(), module);
    assert.ok(existsSync(sourcePath), `static import graph module does not exist: ${module}`);
    const source = readFileSync(sourcePath, "utf8");
    STATIC_IMPORT.lastIndex = 0;

    for (const match of source.matchAll(STATIC_IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      assert.ok(specifier !== undefined);
      pending.push(specifier.startsWith(".") ? resolveLocalImport(sourcePath, specifier) : specifier);
    }
  }

  return reachable;
}

function resolveLocalImport(importer: string, specifier: string): string {
  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base) === "" ? [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")] : [base];
  const resolved = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  assert.ok(resolved !== undefined, `cannot resolve ${JSON.stringify(specifier)} from ${relRepo(importer)}`);
  return relRepo(resolved);
}
