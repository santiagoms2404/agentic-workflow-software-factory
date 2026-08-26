// This fence proves that no advancing path exists in core/src: stage modules
// cannot transitively reach a process-launch boundary, schedule deferred work,
// or expose an acting flag through `awsf stage`. It says nothing about what a
// person types after reading the stage command's output.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

const SOURCE_ROOT = join(repoRoot(), "core", "src");
const STAGES_ROOT = join(SOURCE_ROOT, "stages");
const STAGES_PREFIX = "core/src/stages/";
const PROCESS_BOUNDARIES = new Set([
  "core/src/execution/process-controller.ts",
  "core/src/execution/transport-broker.ts",
]);
const READ_ONLY_STAGE_FLAGS = new Set(["catalog", "state-root"]);

const RELATIVE_IMPORT_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?[\w$*{},\s]+\s+from\s*(["'])(\.\.?\/[^"'`\r\n]+)\1/g,
  /\bimport\s*(["'])(\.\.?\/[^"'`\r\n]+)\1/g,
  /\bimport\s*\(\s*(["'])(\.\.?\/[^"'`\r\n]+)\1\s*\)/g,
] as const;

interface ImportEdge {
  readonly target: string;
  readonly line: number;
}

function relativeImports(
  file: string,
  sourceFiles: ReadonlySet<string>,
): readonly ImportEdge[] {
  const source = readFileSync(file, "utf8");
  const edges = new Map<string, number>();
  for (const pattern of RELATIVE_IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier === undefined) continue;
      const unresolved = resolve(dirname(file), specifier);
      const candidates = extname(unresolved) === ""
        ? [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, join(unresolved, "index.ts"), join(unresolved, "index.tsx")]
        : [unresolved];
      const target = candidates.find((candidate) => sourceFiles.has(candidate));
      if (target === undefined) continue;
      const line = source.slice(0, match.index).split("\n").length;
      const relativeTarget = relRepo(target);
      if (!edges.has(relativeTarget)) edges.set(relativeTarget, line);
    }
  }
  return [...edges].map(([target, line]) => ({ target, line }));
}

function buildRelativeImportGraph(): ReadonlyMap<string, readonly ImportEdge[]> {
  const files = walkFiles(SOURCE_ROOT);
  const sourceFiles = new Set(files);
  return new Map(files.map((file) => [relRepo(file), relativeImports(file, sourceFiles)]));
}

/** Each map value is the shortest relative-import path from a stage source. */
function reachablePaths(
  starts: readonly string[],
  graph: ReadonlyMap<string, readonly ImportEdge[]>,
): ReadonlyMap<string, readonly string[]> {
  const paths = new Map<string, readonly string[]>(starts.map((start) => [start, [start]]));
  const queue = [...starts];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (current === undefined) continue;
    const path = paths.get(current)!;
    for (const edge of graph.get(current) ?? []) {
      if (paths.has(edge.target)) continue;
      paths.set(edge.target, [...path, edge.target]);
      queue.push(edge.target);
    }
  }
  return paths;
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function location(source: ts.SourceFile, node: ts.Node): string {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${relRepo(source.fileName)}:${String(position.line + 1)}:${String(position.character + 1)}`;
}

function timerOffenders(): readonly string[] {
  const offenders: string[] = [];
  const timerIdentifiers = new Set(["setTimeout", "setInterval", "setImmediate", "queueMicrotask"]);
  const scheduledMembers = new Set(["nextTick", "postTask", "scheduleCallback"]);

  for (const path of walkFiles(STAGES_ROOT, [".ts", ".tsx"])) {
    const source = sourceFile(path);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && (node.moduleSpecifier.text === "node:timers" || node.moduleSpecifier.text === "node:timers/promises")) {
        offenders.push(`${location(source, node)} imports ${node.moduleSpecifier.text}`);
      } else if (ts.isIdentifier(node) && timerIdentifiers.has(node.text)) {
        offenders.push(`${location(source, node)} uses ${node.text}`);
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && scheduledMembers.has(node.expression.name.text)) {
        offenders.push(`${location(source, node.expression.name)} schedules ${node.expression.name.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...new Set(offenders)].sort();
}

function parsedStageFlags(): readonly string[] {
  const path = join(SOURCE_ROOT, "cli", "main.ts");
  const source = sourceFile(path);
  const stageBranches: ts.Statement[] = [];
  const findStageBranch = (node: ts.Node): void => {
    if (ts.isIfStatement(node) && ts.isBinaryExpression(node.expression)) {
      const { left, right } = node.expression;
      if ((left.getText(source) === "command" && ts.isStringLiteral(right) && right.text === "stage")
        || (right.getText(source) === "command" && ts.isStringLiteral(left) && left.text === "stage")) {
        stageBranches.push(node.thenStatement);
      }
    }
    ts.forEachChild(node, findStageBranch);
  };
  findStageBranch(source);
  assert.equal(stageBranches.length, 1, "awsf stage must have one command branch");

  const matches: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "filter") {
      const keysCall = node.expression.expression;
      const callback = node.arguments[0];
      if (ts.isCallExpression(keysCall) && ts.isPropertyAccessExpression(keysCall.expression)
        && keysCall.expression.expression.getText(source) === "Object"
        && keysCall.expression.name.text === "keys"
        && keysCall.arguments[0]?.getText(source) === "parsed.flags"
        && callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const parameter = callback.parameters[0]?.name;
        if (parameter !== undefined && ts.isIdentifier(parameter)) {
          const flags: string[] = [];
          const collect = (candidate: ts.Node): void => {
            if (ts.isBinaryExpression(candidate)) {
              const left = candidate.left;
              const right = candidate.right;
              if (ts.isIdentifier(left) && left.text === parameter.text && ts.isStringLiteral(right)) flags.push(right.text);
              if (ts.isIdentifier(right) && right.text === parameter.text && ts.isStringLiteral(left)) flags.push(left.text);
            }
            ts.forEachChild(candidate, collect);
          };
          collect(callback.body);
          matches.push(flags);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(stageBranches[0]!);
  assert.equal(matches.length, 1, "awsf stage must expose one statically inspectable parsed.flags filter");
  return [...new Set(matches[0])].sort();
}

test("stage modules cannot transitively reach a process launch site", () => {
  const graph = buildRelativeImportGraph();
  const starts = [...graph.keys()].filter((file) => file.startsWith(STAGES_PREFIX)).sort();
  const reachable = reachablePaths(starts, graph);
  const offenders: string[] = [];

  for (const [file, path] of reachable) {
    for (const edge of graph.get(file) ?? []) {
      if (!PROCESS_BOUNDARIES.has(edge.target)) continue;
      offenders.push(`${file}:${String(edge.line)} ${[...path, edge.target].join(" -> ")}`);
    }
  }

  assert.deepEqual(offenders.sort(), []);
});

test("stage modules contain no timer or scheduled callback", () => {
  assert.deepEqual(timerOffenders(), []);
});

test("awsf stage's parsed flag list contains only read-only path flags", () => {
  const offenders = parsedStageFlags().filter((flag) => !READ_ONLY_STAGE_FLAGS.has(flag));
  assert.deepEqual(offenders, []);
});
