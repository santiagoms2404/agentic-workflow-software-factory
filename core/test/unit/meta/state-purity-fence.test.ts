import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { repoRoot, sourceImportCandidates, walkFiles, relRepo } from "./_walk.ts";

const CORE_SRC = join(repoRoot(), "core", "src");
const STATE_ROOT = join(CORE_SRC, "state");
const IMPURE_MODULES = "(?:node:)?(?:fs|child_process|http|https|http2|net|dgram|dns|sqlite|tls|perf_hooks|timers|readline|os|crypto|worker_threads)";
const IMPURE_IMPORT = new RegExp(
  `(?:from\\s+|import\\s*\\(?\\s*|require\\s*\\(\\s*)(['"\\x60])${IMPURE_MODULES}(?:\\/[^'"\\x60]*)?\\1`,
);

// Invariant 5 names the clock as well as I/O. A read of the clock, a timer,
// randomness or the process needs no import at all (globals), so it is matched
// at the call site. The import fence above cannot see it.
const IMPURE_CALL = /\b(?:Date\s*(?:\.\s*now|\[\s*["'`]now["'`]\s*\])|new\s+Date\b|performance\s*(?:\.\s*now|\[\s*["'`]now["'`]\s*\])|setTimeout|setInterval|setImmediate|Math\s*(?:\.\s*random|\[\s*["'`]random["'`]\s*\])|randomUUID|process\s*(?:\.\s*[A-Za-z_$]|\s*\[))/;

interface Source { readonly path: string; readonly text: string }

function runtimeRelativeImports(path: string, text: string): { readonly specifiers: readonly string[]; readonly unresolved: readonly string[] } {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const unresolved: string[] = [];
  const add = (specifier: ts.Expression | undefined, node: ts.Node): void => {
    if (specifier !== undefined && (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier))) {
      if (specifier.text.startsWith(".")) specifiers.push(specifier.text);
    } else {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      unresolved.push(`${relRepo(path)}:${String(line)} has an unresolved module load`);
    }
  };
  const hasRuntimeImport = (clause: ts.ImportClause | undefined): boolean => {
    if (clause === undefined) return true;
    if (clause.isTypeOnly) return false;
    const bindings = clause.namedBindings;
    return bindings === undefined || !ts.isNamedImports(bindings)
      || bindings.elements.some((element) => !element.isTypeOnly);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && hasRuntimeImport(node.importClause)) {
      add(node.moduleSpecifier, node);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined) {
      const clause = node.exportClause;
      const typeOnlyReexport = clause !== undefined && ts.isNamedExports(clause)
        && clause.elements.every((element) => element.isTypeOnly);
      if (!typeOnlyReexport) add(node.moduleSpecifier, node);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        add(node.arguments[0], node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, unresolved };
}

/** State files remain the roots; only their runtime-relative dependencies are followed. */
function purityOffenders(stateFiles: readonly string[], sources: readonly Source[]): string[] {
  const byPath = new Map(sources.map((source) => [source.path, source.text]));
  const sourcePaths = new Set(byPath.keys());
  const pending = [...stateFiles];
  const reached = new Set<string>();
  const offenders: string[] = [];

  while (pending.length > 0) {
    const path = pending.pop();
    assert.ok(path !== undefined);
    if (reached.has(path)) continue;
    reached.add(path);
    const text = byPath.get(path);
    assert.ok(text !== undefined, `state import graph cannot read ${relRepo(path)}`);
    if (IMPURE_IMPORT.test(text) || IMPURE_CALL.test(text)) offenders.push(relRepo(path));

    const imports = runtimeRelativeImports(path, text);
    offenders.push(...imports.unresolved);
    for (const specifier of imports.specifiers) {
      const base = resolve(dirname(path), specifier);
      const target = sourceImportCandidates(base).find((candidate) => sourcePaths.has(candidate));
      if (target === undefined) offenders.push(`${relRepo(path)} cannot resolve ${specifier}`);
      else pending.push(target);
    }
  }
  return [...new Set(offenders)].sort();
}

test("core/src/state runtime imports and their relative closure remain pure", () => {
  const files = walkFiles(CORE_SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const stateFiles = walkFiles(STATE_ROOT, [".ts"]);
  assert.ok(stateFiles.length > 0, "the state purity root must not be vacuous");
  assert.deepEqual(purityOffenders(stateFiles, files), []);
});

test("state purity fence rejects clock, timer, randomness and process reads with no import (B3-28)", () => {
  for (const call of [
    "const at = Date.now();",
    "const at = new Date();",
    "const at = performance.now();",
    'const at = Date["now"]();',
    "setTimeout(resume, 1);",
    "const roll = Math.random();",
    'const roll = Math["random"]();',
    "const id = randomUUID();",
    "const pid = process.pid;",
    'const env = process["env"];',
  ]) {
    assert.equal(IMPURE_CALL.test(call), true, `${call} must be refused`);
  }
  assert.equal(IMPURE_CALL.test("const at = transition(evidence);"), false);
});

test("state purity fence rejects clocks, readline, bare and dynamic imports", () => {
  assert.equal(IMPURE_IMPORT.test('import { readFileSync } from "node:fs";'), true);
  assert.equal(IMPURE_IMPORT.test('import { performance } from "node:perf_hooks";'), true);
  assert.equal(IMPURE_IMPORT.test('import { setTimeout as sleep } from "node:timers/promises";'), true);
  assert.equal(IMPURE_IMPORT.test('import { createInterface } from "node:readline";'), true);
  assert.equal(IMPURE_IMPORT.test('import "node:fs";'), true);
  assert.equal(IMPURE_IMPORT.test('const fs = await import("node:fs");'), true);
  assert.equal(IMPURE_IMPORT.test("const fs = await import(`node:fs`);"), true);
  assert.equal(IMPURE_IMPORT.test("const fs = require(`node:fs`);"), true);
  assert.equal(IMPURE_IMPORT.test('const cp = require("node:child_process");'), true);
  assert.equal(IMPURE_IMPORT.test('import http2 from "node:http2";'), true);
  assert.equal(IMPURE_IMPORT.test('import { homedir } from "node:os";'), true);
  assert.equal(IMPURE_IMPORT.test('import { randomBytes } from "node:crypto";'), true);
  assert.equal(IMPURE_IMPORT.test('import { transition } from "./transitions.ts";'), false);
});

test("state purity follows runtime imports but not erased type-only edges", () => {
  const root = join(repoRoot(), "state-purity-fixture");
  const state = join(root, "core/src/state/entry.ts");
  const pure = join(root, "core/src/contracts/pure.ts");
  const types = join(root, "core/src/contracts/types.ts");
  const impure = join(root, "core/src/contracts/io.ts");
  const sources = [
    { path: state, text: 'import type { Shape } from "../contracts/types.ts";\nimport { value } from "../contracts/pure.ts";\nvoid value;\n' },
    { path: pure, text: 'import "./io.ts";\nexport const value = 1;\n' },
    { path: types, text: 'import "node:fs";\nexport interface Shape { value: string }\n' },
    { path: impure, text: 'import { readFile } from "node:fs";\nvoid readFile;\n' },
  ];
  assert.deepEqual(purityOffenders([state], sources), [relRepo(impure)]);
});
