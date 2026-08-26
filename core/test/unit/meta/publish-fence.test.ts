// This fence has three legs, and its ceiling is explicit. A unique-symbol brand
// is defeatable by a sufficiently indirect cast. The derivation leg detects
// direct construction and casts to the branded type outside authorize.ts, but a
// helper can launder a value through unknown across files. If that scan is
// evaded, the locality leg still confines the push token to the sole argv site.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import {
  authorizePublish,
  type PublishRefspec,
  type PublishRemoteFacts,
  type PublishRepositoryFacts,
  type PublishStatusFacts,
} from "../../../src/publish/authorize.ts";
import { TASK_STATES } from "../../../src/state/task-machine.ts";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

const SOURCE_ROOT = join(repoRoot(), "core", "src");
const AUTHORIZE_FILE = "core/src/publish/authorize.ts";
const ARGV_FILE = "core/src/publish/argv.ts";
const PUSH_TOKEN = /(["'])push\1/;

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

function functionDeclaration(source: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const matches = source.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.equal(matches.length, 1, `${relRepo(source.fileName)} must declare exactly one ${name}`);
  return matches[0]!;
}

function interfaceDeclaration(source: ts.SourceFile, name: string): ts.InterfaceDeclaration {
  const matches = source.statements.filter((statement): statement is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === name);
  assert.equal(matches.length, 1, `${relRepo(source.fileName)} must declare exactly one ${name}`);
  return matches[0]!;
}

function resolvedSymbol(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (symbol === undefined || (symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
  return checker.getAliasedSymbol(symbol);
}

function typeContainsSymbol(
  type: ts.Type,
  target: ts.Symbol,
  checker: ts.TypeChecker,
  seen: Set<ts.Type> = new Set(),
): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (resolvedSymbol(type.getSymbol(), checker) === target) return true;
  if (resolvedSymbol(type.aliasSymbol, checker) === target) return true;
  if (type.isUnionOrIntersection()) {
    return type.types.some((member) => typeContainsSymbol(member, target, checker, seen));
  }
  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    const objectType = type as ts.ObjectType;
    if ((objectType.objectFlags & ts.ObjectFlags.Reference) !== 0) {
      return checker.getTypeArguments(objectType as ts.TypeReference)
        .some((argument) => typeContainsSymbol(argument, target, checker, seen));
    }
  }
  return false;
}

function sourceLocation(source: ts.SourceFile, node: ts.Node): string {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${relRepo(source.fileName)}:${String(position.line + 1)}:${String(position.character + 1)}`;
}

function derivationViolations(
  source: ts.SourceFile,
  target: ts.Symbol,
  checker: ts.TypeChecker,
): readonly string[] {
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const contextual = checker.getContextualType(node);
      if (contextual !== undefined && typeContainsSymbol(contextual, target, checker)) {
        violations.push(`${sourceLocation(source, node)} constructs AuthorizedPublishPlan`);
      }
    }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const asserted = checker.getTypeFromTypeNode(node.type);
      if (typeContainsSymbol(asserted, target, checker)) {
        violations.push(`${sourceLocation(source, node)} casts to AuthorizedPublishPlan`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function publishStatus(lifecycleState: PublishStatusFacts["lifecycleState"]): PublishStatusFacts {
  const candidateSha = "a".repeat(40);
  return {
    lifecycleState,
    candidateSha,
    landingApproval: { candidateSha },
  };
}

const CANDIDATE_SHA = "a".repeat(40);
const REPOSITORY: PublishRepositoryFacts = {
  headSha: CANDIDATE_SHA,
  checkoutClean: true,
  allow: { remotes: ["origin"], branches: ["main"] },
};
const REMOTE: PublishRemoteFacts = {
  name: "origin",
  branch: "main",
  resolvedHost: null,
  fastForward: true,
};
const REFSPEC: PublishRefspec = {
  source: CANDIDATE_SHA,
  destination: "refs/heads/main",
  forced: false,
  deleting: false,
};

test("the push token exists only in publish/argv.ts", () => {
  const sites = walkFiles(SOURCE_ROOT)
    .filter((file) => PUSH_TOKEN.test(readFileSync(file, "utf8")))
    .map(relRepo)
    .sort();

  assert.deepEqual(sites, [ARGV_FILE]);
});

test("publish argv derives only from the branded authorization type", () => {
  const { program, checker } = sourceProgram();
  const authorizeSource = repoSourceFile(program, AUTHORIZE_FILE);
  const argvSource = repoSourceFile(program, ARGV_FILE);
  const planDeclaration = interfaceDeclaration(authorizeSource, "AuthorizedPublishPlan");
  const planSymbol = checker.getSymbolAtLocation(planDeclaration.name);
  assert.notEqual(planSymbol, undefined, "AuthorizedPublishPlan must have a checked symbol");

  const brandMembers = planDeclaration.members.filter((member): member is ts.PropertySignature =>
    ts.isPropertySignature(member)
    && member.name !== undefined
    && ts.isComputedPropertyName(member.name)
    && (checker.getTypeAtLocation(member.name.expression).flags & ts.TypeFlags.UniqueESSymbol) !== 0);
  assert.equal(brandMembers.length, 1, "AuthorizedPublishPlan must carry exactly one unique-symbol brand");

  const publishArgv = functionDeclaration(argvSource, "publishArgv");
  assert.equal(publishArgv.parameters.length, 1, "publishArgv must declare exactly one parameter");
  const parameterType = checker.getTypeAtLocation(publishArgv.parameters[0]!);
  const parameterSymbol = resolvedSymbol(parameterType.getSymbol() ?? parameterType.aliasSymbol, checker);
  assert.notEqual(parameterSymbol, undefined, "publishArgv parameter type must resolve to a declaration");
  const declarationFiles = [...new Set((parameterSymbol!.declarations ?? []).map((declaration) =>
    relRepo(declaration.getSourceFile().fileName)))].sort();
  assert.deepEqual(declarationFiles, [AUTHORIZE_FILE]);
  assert.equal(parameterSymbol, planSymbol);

  const violations: string[] = [];
  for (const source of program.getSourceFiles()) {
    const path = relRepo(source.fileName);
    if (!path.startsWith("core/src/") || path === AUTHORIZE_FILE) continue;
    violations.push(...derivationViolations(source, planSymbol!, checker));
  }
  assert.deepEqual(
    violations,
    [],
    ["AuthorizedPublishPlan must be constructed only by authorize.ts:", ...violations.map((detail) => `  ${detail}`)].join("\n"),
  );
});

test("the authorization table refuses every state except LANDED", () => {
  let refused = 0;
  for (const state of TASK_STATES) {
    if (state === "LANDED") continue;
    const result = authorizePublish(publishStatus(state), REPOSITORY, REMOTE, REFSPEC);
    assert.equal(result.decision, "refused", `${state} must be refused`);
    assert.equal(result.code, "not-landed", `${state} must fail the first truth-table row`);
    refused += 1;
  }

  assert.equal(refused, TASK_STATES.length - 1);
});
