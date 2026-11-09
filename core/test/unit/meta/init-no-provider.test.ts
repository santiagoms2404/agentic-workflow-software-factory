import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { repoRoot } from "./_walk.ts";

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
  "node:crypto",
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

// Static imports and export-from declarations plus literal dynamic import() calls. Nonliteral loaders are rejected below.
const STATIC_IMPORT = /\bimport\s+(?!type\b|\()(?:["']([^"']+)["']|[\s\S]*?\bfrom\s+["']([^"']+)["'])|\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(["'`])([^"'`\r\n]+)\1\s*\)/g;
const NONLITERAL_IMPORT = /\bimport\s*\(\s*(?:`[^`]*\$\{[^`]*`|(?!["'`]))/;

function importSpecifiers(source: string): string[] {
  STATIC_IMPORT.lastIndex = 0;
  DYNAMIC_IMPORT.lastIndex = 0;
  return [
    ...[...source.matchAll(STATIC_IMPORT)].map((match) => match[1] ?? match[2] ?? match[3]),
    ...[...source.matchAll(DYNAMIC_IMPORT)].map((match) => match[2]),
  ].filter((specifier): specifier is string => typeof specifier === "string");
}

test("awsf init reaches only its host-side baseline allowlist", () => {
  const reachable = walkRuntimeImports(ENTRYPOINTS);
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

test("a literal dynamic import extends the provider-reach graph", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-init-import-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = join(root, "core/src/cli/entry.ts");
  const adapter = join(root, "core/src/adapters/provider.ts");
  mkdirSync(join(root, "core/src/cli"), { recursive: true });
  mkdirSync(join(root, "core/src/adapters"), { recursive: true });
  writeFileSync(entry, "export const load = () => import(`../adapters/provider.ts`);\n");
  writeFileSync(adapter, "export const provider = true;\n");
  assert.equal(NONLITERAL_IMPORT.test("const name = getProvider(); import(name)"), true);
  assert.equal(NONLITERAL_IMPORT.test("import(`../${name}.ts`)"), true);
  assert.equal(NONLITERAL_IMPORT.test("import(`../adapters/provider.ts`)"), false);
  assert.deepEqual(importSpecifiers('const load = () => import(`../adapters/provider.ts`);'), ["../adapters/provider.ts"]);
  assert.deepEqual([...walkRuntimeImports(["core/src/cli/entry.ts"], root)].sort(), [
    "core/src/adapters/provider.ts",
    "core/src/cli/entry.ts",
  ]);
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
  const brokerImports = importSpecifiers(brokerSource);

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
  const reconnectImports = importSpecifiers(reconnectSource);
  const reconnectBad = reconnectImports.filter((mod) =>
    mod.includes("adapters") || mod.includes("gates") || mod.includes("recipes"),
  );
  assert.deepEqual(reconnectBad, [], "turn-reconnect-authorization must have no runtime provider or gate imports");
});

function walkRuntimeImports(entrypoints: readonly string[], root = repoRoot()): Set<string> {
  const reachable = new Set<string>();
  const pending = [...entrypoints];

  while (pending.length > 0) {
    const module = pending.pop();
    assert.ok(module !== undefined);
    if (reachable.has(module)) continue;
    reachable.add(module);

    if (!module.startsWith("core/src/") || TERMINAL_LOCAL_MODULES.has(module)) continue;

    const sourcePath = join(root, module);
    assert.ok(existsSync(sourcePath), `import graph module does not exist: ${module}`);
    const source = readFileSync(sourcePath, "utf8");
    assert.equal(NONLITERAL_IMPORT.test(source), false, `${module} uses a nonliteral dynamic import`);

    for (const specifier of importSpecifiers(source)) {
      pending.push(specifier.startsWith(".") ? resolveLocalImport(sourcePath, specifier, root) : specifier);
    }
  }

  return reachable;
}

function resolveLocalImport(importer: string, specifier: string, root = repoRoot()): string {
  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base) === ""
    ? [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`, `${base}.js`, `${base}.mjs`, join(base, "index.ts")]
    : [base];
  const resolved = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  assert.ok(resolved !== undefined, `cannot resolve ${JSON.stringify(specifier)} from ${relative(root, importer).split(sep).join("/")}`);
  return relative(root, resolved).split(sep).join("/");
}
