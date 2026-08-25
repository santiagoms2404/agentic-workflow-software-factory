// This is the repository's FIRST transitive fence. Existing fences are direct
// text scans, but INV-1 says workflow code may not reach the quota module at
// all. A direct-import scan is satisfied by putting one intermediate file
// between workflow and quota, so this fence follows the full relative-import
// graph and reports every hop it found.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { test } from "node:test";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

const SOURCE_ROOT = join(repoRoot(), "core", "src");
const WORKFLOW_PREFIX = "core/src/workflow/";
const QUOTA_PREFIX = "core/src/quota/";

const RELATIVE_IMPORT_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?[\w$*{},\s]+\s+from\s*(["'])(\.\.?\/[^"'`\r\n]+)\1/g,
  /\bimport\s*(["'])(\.\.?\/[^"'`\r\n]+)\1/g,
  /\bimport\s*\(\s*(["'])(\.\.?\/[^"'`\r\n]+)\1\s*\)/g,
] as const;

function relativeImportSpecifiers(source: string): readonly string[] {
  const specifiers = new Set<string>();
  for (const pattern of RELATIVE_IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier !== undefined) specifiers.add(specifier);
    }
  }
  return [...specifiers].sort();
}

function resolveSourceImport(
  importer: string,
  specifier: string,
  sourceFiles: ReadonlySet<string>,
): string | null {
  const target = resolve(dirname(importer), specifier);
  const candidates = extname(target) === ""
    ? [target, `${target}.ts`, `${target}.tsx`, `${target}.vue`, join(target, "index.ts"), join(target, "index.tsx")]
    : [target];
  return candidates.find((candidate) => sourceFiles.has(candidate)) ?? null;
}

function buildRelativeImportGraph(): ReadonlyMap<string, readonly string[]> {
  const files = walkFiles(SOURCE_ROOT);
  const sourceFiles = new Set(files);
  const graph = new Map<string, readonly string[]>();

  for (const file of files) {
    const neighbors = relativeImportSpecifiers(readFileSync(file, "utf8"))
      .map((specifier) => resolveSourceImport(file, specifier, sourceFiles))
      .filter((target): target is string => target !== null)
      .map(relRepo);
    graph.set(relRepo(file), Object.freeze([...new Set(neighbors)].sort()));
  }
  return graph;
}

/** The map keys are the complete reachable closure; each value is its shortest path from start. */
function reachablePaths(
  start: string,
  graph: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  const paths = new Map<string, readonly string[]>([[start, Object.freeze([start])]]);
  const queue = [start];
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (current === undefined) continue;
    const currentPath = paths.get(current)!;
    for (const neighbor of graph.get(current) ?? []) {
      if (paths.has(neighbor)) continue;
      paths.set(neighbor, Object.freeze([...currentPath, neighbor]));
      queue.push(neighbor);
    }
  }
  return paths;
}

test("workflow cannot transitively reach quota modules", () => {
  const graph = buildRelativeImportGraph();
  const starts = [...graph.keys()].filter((file) => file.startsWith(WORKFLOW_PREFIX)).sort();
  const violations: string[] = [];

  for (const start of starts) {
    for (const [target, path] of reachablePaths(start, graph)) {
      if (target.startsWith(QUOTA_PREFIX)) violations.push(path.join(" -> "));
    }
  }

  assert.equal(
    violations.length,
    0,
    ["workflow reached the quota module through these relative-import paths:", ...violations.map((path) => `  ${path}`)].join("\n"),
  );
});
