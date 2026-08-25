// This is the repository's FIRST transitive fence. Existing fences are direct
// text scans, but INV-1 says workflow code may not reach the quota module at
// all. A direct-import scan is satisfied by putting one intermediate file
// between workflow and quota, so this fence follows the full relative-import
// graph and reports every hop it found.
//
// The routing leg is necessarily weaker, and the weakness is explicit here.
// The routing resolver and the legitimate quota consumer share one file:
// `core/src/cli/commands/production-run.ts` holds both route resolution and the
// phase loop. No path glob can bar the first while permitting the second.
// Pretending otherwise would be the weaker choice. Instead, the named resolver
// signatures and closures are checked semantically, including the bounded
// inline resolver in production-run.ts. The readout's closed runtime field list
// is the backstop that prevents a routing comparator from being added at all.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { QUOTA_ROUTE_READOUT_FIELDS } from "../../../src/quota/readout.ts";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

const SOURCE_ROOT = join(repoRoot(), "core", "src");
const WORKFLOW_PREFIX = "core/src/workflow/";
const QUOTA_PREFIX = "core/src/quota/";
const RESOLUTION_FILES = {
  production: "core/src/cli/commands/production-run.ts",
  reviewPhase: "core/src/cli/commands/review-phase.ts",
  rework: "core/src/cli/commands/rework.ts",
  start: "core/src/cli/commands/start.ts",
  reviewRouting: "core/src/workflow/review-routing.ts",
} as const;

const ROUTE_FUNCTIONS = [
  [RESOLUTION_FILES.reviewPhase, "resolveReviewRoute"],
  [RESOLUTION_FILES.rework, "resolveRoute"],
  [RESOLUTION_FILES.start, "defaultPreflight"],
  [RESOLUTION_FILES.reviewRouting, "providerPairFrom"],
  [RESOLUTION_FILES.reviewRouting, "oppositeProvider"],
  [RESOLUTION_FILES.reviewRouting, "runMandatoryReview"],
] as const;

const EXPECTED_ROUTE_READOUT_FIELDS = [
  "adapterId",
  "provider",
  "scope",
  "effectivePercentRemaining",
  "minutesToReset",
  "configuredThresholdMinutes",
  "verdict",
  "reasonCode",
  "remedy",
] as const;

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

let cachedSourceProgram: { readonly program: ts.Program; readonly checker: ts.TypeChecker } | undefined;

function sourceProgram(): { readonly program: ts.Program; readonly checker: ts.TypeChecker } {
  if (cachedSourceProgram !== undefined) return cachedSourceProgram;
  const configPath = join(repoRoot(), "tsconfig.json");
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, repoRoot());
  const program = ts.createProgram({
    rootNames: walkFiles(SOURCE_ROOT),
    options: parsed.options,
  });
  cachedSourceProgram = { program, checker: program.getTypeChecker() };
  return cachedSourceProgram;
}

function repoSourceFile(program: ts.Program, relativePath: string): ts.SourceFile {
  const expected = resolve(repoRoot(), relativePath);
  const source = program.getSourceFiles().find((candidate) => resolve(candidate.fileName) === expected);
  assert.notEqual(source, undefined, `missing source file ${relativePath}`);
  return source!;
}

function quotaDeclarations(symbol: ts.Symbol, checker: ts.TypeChecker): readonly string[] {
  const resolved = (symbol.flags & ts.SymbolFlags.Alias) === 0
    ? symbol
    : checker.getAliasedSymbol(symbol);
  return (resolved.declarations ?? [])
    .map((declaration) => relRepo(declaration.getSourceFile().fileName))
    .filter((path) => path.startsWith(QUOTA_PREFIX));
}

function quotaTypes(
  type: ts.Type,
  checker: ts.TypeChecker,
  seen: Set<ts.Type> = new Set(),
): readonly string[] {
  if (seen.has(type)) return [];
  seen.add(type);
  const origins = new Set<string>();
  const collectSymbol = (symbol: ts.Symbol | undefined): void => {
    if (symbol === undefined) return;
    for (const path of quotaDeclarations(symbol, checker)) origins.add(path);
  };
  collectSymbol(type.aliasSymbol);
  collectSymbol(type.getSymbol());

  if (type.isUnionOrIntersection()) {
    for (const member of type.types) {
      for (const path of quotaTypes(member, checker, seen)) origins.add(path);
    }
  }
  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    const objectType = type as ts.ObjectType;
    if ((objectType.objectFlags & ts.ObjectFlags.Reference) !== 0) {
      for (const argument of checker.getTypeArguments(objectType as ts.TypeReference)) {
        for (const path of quotaTypes(argument, checker, seen)) origins.add(path);
      }
    }
  }
  return [...origins];
}

function functionDeclaration(source: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const matches = source.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.equal(matches.length, 1, `${relRepo(source.fileName)} must declare exactly one ${name}`);
  return matches[0]!;
}

function referencedQuotaExports(
  root: ts.Node,
  checker: ts.TypeChecker,
  includeCapturedTypes: boolean,
): readonly string[] {
  const violations = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol !== undefined) {
        for (const path of quotaDeclarations(symbol, checker)) {
          violations.add(`${node.text} from ${path}`);
        }
        if (includeCapturedTypes) {
          const declarations = symbol.declarations ?? [];
          const declaredInside = declarations.some((declaration) =>
            declaration.pos >= root.pos && declaration.end <= root.end);
          if (!declaredInside) {
            for (const path of quotaTypes(checker.getTypeAtLocation(node), checker)) {
              violations.add(`${node.text} has a type from ${path}`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return [...violations].sort();
}

function assertRouteFunctionQuotaFree(
  source: ts.SourceFile,
  name: string,
  checker: ts.TypeChecker,
): readonly string[] {
  const declaration = functionDeclaration(source, name);
  const violations = new Set<string>();
  const signature = checker.getSignatureFromDeclaration(declaration);
  assert.notEqual(signature, undefined, `missing checked signature for ${name}`);
  for (const parameter of declaration.parameters) {
    for (const path of quotaTypes(checker.getTypeAtLocation(parameter), checker)) {
      violations.add(`${name} accepts a type from ${path}`);
    }
  }
  for (const path of quotaTypes(checker.getReturnTypeOfSignature(signature!), checker)) {
    violations.add(`${name} returns a type from ${path}`);
  }
  if (declaration.body !== undefined) {
    for (const detail of referencedQuotaExports(declaration.body, checker, true)) {
      violations.add(`${name} closes over ${detail}`);
    }
  }
  return [...violations].sort();
}

function productionInlineResolver(source: ts.SourceFile): ts.Block {
  const command = functionDeclaration(source, "runProductionCommand");
  const matches: ts.Block[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTryStatement(node)) {
      const text = node.tryBlock.getText(source);
      if (text.includes("routes.set(") && text.includes("oppositeProvider(")) {
        matches.push(node.tryBlock);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(command);
  assert.equal(matches.length, 1, "production-run.ts must have one bounded inline route resolver");
  return matches[0]!;
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

test("route-resolution signatures and closures contain no quota export", () => {
  const { program, checker } = sourceProgram();
  const violations: string[] = [];

  for (const [path, name] of ROUTE_FUNCTIONS) {
    const source = repoSourceFile(program, path);
    violations.push(...assertRouteFunctionQuotaFree(source, name, checker));
  }

  const production = repoSourceFile(program, RESOLUTION_FILES.production);
  const inline = productionInlineResolver(production);
  for (const detail of referencedQuotaExports(inline, checker, true)) {
    violations.push(`production inline resolver references ${detail}`);
  }

  assert.equal(
    violations.length,
    0,
    ["route resolution reached quota exports:", ...violations.map((detail) => `  ${detail}`)].join("\n"),
  );
});

test("quota route readout has exactly the closed descriptive field list", () => {
  assert.deepEqual(
    [...QUOTA_ROUTE_READOUT_FIELDS],
    [...EXPECTED_ROUTE_READOUT_FIELDS],
    "the route readout shape changed; routing comparators, rank, ordering, and preferred fields are forbidden",
  );
});

test("core source declares no quota delta, cost, spent, or per-task identifier", () => {
  const { program } = sourceProgram();
  const violations: string[] = [];
  const forbidden = /(?:quota.*(?:delta|cost|spent|pertask)|(?:delta|cost|spent|pertask).*quota)/iu;

  for (const source of program.getSourceFiles()) {
    const relativePath = relRepo(source.fileName);
    if (!relativePath.startsWith("core/src/")) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const normalized = node.text.replaceAll("_", "").replaceAll("-", "");
        if (forbidden.test(normalized)) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          violations.push(`${relativePath}:${String(position.line + 1)}:${String(position.character + 1)} ${node.text}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  assert.equal(
    violations.length,
    0,
    ["quota-derived task attribution identifiers are forbidden:", ...violations.map((detail) => `  ${detail}`)].join("\n"),
  );
});
