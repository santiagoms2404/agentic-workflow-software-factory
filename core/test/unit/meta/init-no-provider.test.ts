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
// why deterministic initialization needs it. TypeBox, the envelope contract,
// and the tier files validate the init result and config builder at their sources.
const ALLOWED_LOCAL_MODULES = [
  "core/src/cli/commands/init.ts",
  "core/src/config/init-template.ts",
  "core/src/config/schema.ts",
  "core/src/config/workflow-ids.ts",
  "core/src/contracts/envelope-base.ts",
  "core/src/contracts/init-output.ts",
  "core/src/contracts/test-output.ts",
  "core/src/contracts/typebox.ts",
  "core/src/execution/transport-broker.ts",
  "core/src/git/changes.ts",
  "core/src/git/commit.ts",
  "core/src/state/errors.ts",
  "core/src/state/tiers.ts",
] as const;

// The broker is the approved host-process boundary. It is deliberately isolated
// as a leaf in this entrypoint walk because init reaches only runSystemCommand
// through git/changes.ts. Its runtime imports are explicitly evaluated and
// isolated in separate tests below to prove that no provider, gate, recipe, or
// workflow runner is reachable through this boundary.
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

test("git/changes imports only host system command execution from the broker", () => {
  const changesPath = join(repoRoot(), "core/src/git/changes.ts");
  const source = readFileSync(changesPath, "utf8");
  const brokerImport = source.match(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*transport-broker(?:\.ts)?["']/);
  assert.ok(brokerImport && brokerImport[1], "git/changes must import from transport-broker");
  const importedNames = brokerImport[1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(importedNames, ["runSystemCommand"]);
});

test("transport-broker runtime imports are evaluated and isolated from providers and gates", () => {
  const brokerPath = join(repoRoot(), "core/src/execution/transport-broker.ts");
  const brokerSource = readFileSync(brokerPath, "utf8");
  STATIC_IMPORT.lastIndex = 0;
  const brokerImports = [...brokerSource.matchAll(STATIC_IMPORT)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter((mod): mod is string => typeof mod === "string");

  // 1. No runtime value imports from adapters (only type-only imports allowed)
  const adapterImports = brokerImports.filter((mod) => mod.includes("adapters"));
  assert.deepEqual(adapterImports, [], "transport-broker must have no runtime value imports from adapters");

  // 2. No runtime value imports from gates
  const gateImports = brokerImports.filter((mod) => mod.includes("gates"));
  assert.deepEqual(gateImports, [], "transport-broker must have no runtime value imports from gates");

  // 3. No runtime value imports from recipes
  const recipeImports = brokerImports.filter((mod) => mod.includes("recipe"));
  assert.deepEqual(recipeImports, [], "transport-broker must have no runtime value imports from recipes");

  // 4. Under workflow/, only the turn reconnect admission verifier is imported
  const workflowImports = brokerImports
    .filter((mod) => mod.includes("workflow"))
    .map((mod) => resolveLocalImport(brokerPath, mod));
  assert.deepEqual(
    workflowImports,
    ["core/src/workflow/turn-reconnect-authorization.ts"],
    "only turn-reconnect-authorization admission verifier is imported from workflow by transport-broker",
  );

  // 5. And turn-reconnect-authorization itself has no runtime provider/gate imports
  const reconnectPath = join(repoRoot(), "core/src/workflow/turn-reconnect-authorization.ts");
  const reconnectSource = readFileSync(reconnectPath, "utf8");
  STATIC_IMPORT.lastIndex = 0;
  const reconnectImports = [...reconnectSource.matchAll(STATIC_IMPORT)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter((mod): mod is string => typeof mod === "string");
  const reconnectBad = reconnectImports.filter((mod) =>
    mod.includes("adapters") || mod.includes("gates") || mod.includes("recipes"),
  );
  assert.deepEqual(reconnectBad, [], "turn-reconnect-authorization must have no runtime provider or gate imports");
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
  const candidates = extname(base) === ""
    ? [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`, `${base}.js`, `${base}.mjs`, join(base, "index.ts")]
    : [base];
  const resolved = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  assert.ok(resolved !== undefined, `cannot resolve ${JSON.stringify(specifier)} from ${relRepo(importer)}`);
  return relRepo(resolved);
}
