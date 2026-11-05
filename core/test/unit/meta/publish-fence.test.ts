// This fence has three legs, and its ceiling is explicit. A unique-symbol brand
// is defeatable by a sufficiently indirect cast. The derivation leg detects
// direct construction, casts, and any-typed values given the branded type
// outside authorize.ts, but a helper can launder a value through unknown across
// files. If that scan is evaded, the locality leg still confines every literal
// naming a remote-writing git verb (push, send-pack) to the sole argv site. Both
// detectors are also run on in-memory fixtures, so their reach is tested, not
// only the real tree's silence.

import assert from "node:assert/strict";
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
import { relRepo, repoRoot } from "./_walk.ts";
import { functionDeclaration, repoSourceFile, sourceLocation, sourceProgram } from "./_type-program.ts";

const SOURCE_ROOT = join(repoRoot(), "core", "src");
const AUTHORIZE_FILE = "core/src/publish/authorize.ts";
const ARGV_FILE = "core/src/publish/argv.ts";
// The locality leg reads every literal fragment the parser sees (quoted strings,
// template literals and template parts) rather than one quote spelling of push.
// Two remote-writing verbs count: push and its plumbing twin send-pack. A
// fragment that IS the verb is an argv element; a fragment holding `git ... push`
// is a command string a shell would run. Comments, `.push(` calls and prose such
// as "A push URL" or the `--push` flag are not literals naming the verb. The
// ceiling: a verb assembled at run time ("pu" + "sh") is not seen.
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue"];
const VERB_ELEMENT = /^\s*(push|send-pack)\s*$/u;
const GIT_COMMAND_VERB = /\bgit\b[^\n;&|]*?(?<![\w-])(push|send-pack)(?![\w-])/u;
const SEND_PACK = /(?<![\w-])(?:git-)?(send-pack)(?![\w-])/u;

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[mc]?js$/u.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

// A Vue file keeps only its <script> bodies, blanked in place so positions hold.
function scriptText(fileName: string, text: string): string {
  if (!fileName.endsWith(".vue")) return text;
  let kept = text.replace(/[^\n]/gu, " ");
  for (const match of text.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gu)) {
    const start = match.index + match[1]!.length;
    kept = kept.slice(0, start) + match[2]! + kept.slice(start + match[2]!.length);
  }
  return kept;
}

function literalVerb(text: string): string | undefined {
  return VERB_ELEMENT.exec(text)?.[1] ?? GIT_COMMAND_VERB.exec(text)?.[1] ?? SEND_PACK.exec(text)?.[1];
}

function pushSites(fileName: string, text: string): readonly string[] {
  const source = ts.createSourceFile(
    fileName,
    scriptText(fileName, text),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const sites: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      const verb = literalVerb(node.text);
      if (verb !== undefined) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        sites.push(`${String(position.line + 1)}:${String(position.character + 1)} ${verb}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
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
    // `any` is assignable to the brand with no literal and no cast, so an
    // any-typed expression whose contextual type is the plan (an annotated
    // initializer, an argument, a return) forges one. A parenthesized
    // expression is reported at its inner node, and a cast operand is already
    // reported as the cast.
    if (
      ts.isExpression(node)
      && !ts.isParenthesizedExpression(node)
      && !ts.isAsExpression(node.parent)
      && !ts.isTypeAssertionExpression(node.parent)
    ) {
      const contextual = checker.getContextualType(node);
      if (
        contextual !== undefined
        && typeContainsSymbol(contextual, target, checker)
        && (checker.getTypeAtLocation(node).flags & ts.TypeFlags.Any) !== 0
      ) {
        violations.push(`${sourceLocation(source, node)} assigns an any-typed value to AuthorizedPublishPlan`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

// The derivation detector is exercised on an in-memory program, so its reach is
// proven against forged spellings that the real tree must never contain.
const FIXTURE_ROOT = join(repoRoot(), "publish-fence-fixture");
const FIXTURE_AUTHORIZE = [
  "declare const authorized: unique symbol;",
  "export interface AuthorizedPublishPlan {",
  "  readonly [authorized]: true;",
  "  readonly remoteName: string;",
  "}",
  "export declare function authorizePublish(): AuthorizedPublishPlan | null;",
  "export declare function publishArgv(plan: AuthorizedPublishPlan): readonly string[];",
  "",
].join("\n");

function fixtureDerivationViolations(forgeText: string): readonly string[] {
  const files = new Map([
    [resolve(FIXTURE_ROOT, "authorize.ts"), FIXTURE_AUTHORIZE],
    [resolve(FIXTURE_ROOT, "forge.ts"), forgeText],
  ]);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2023.d.ts"],
    types: [],
    strict: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options, true);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  // The fixture directory exists only in memory; module resolution asks for it first.
  host.directoryExists = (directoryName) =>
    resolve(directoryName) === FIXTURE_ROOT || (directoryExists?.(directoryName) ?? true);
  host.fileExists = (fileName) => files.has(resolve(fileName)) || fileExists(fileName);
  host.readFile = (fileName) => files.get(resolve(fileName)) ?? readFile(fileName);
  host.getSourceFile = (fileName, language, onError, shouldCreate) => {
    const text = files.get(resolve(fileName));
    return text === undefined
      ? getSourceFile(fileName, language, onError, shouldCreate)
      : ts.createSourceFile(fileName, text, language, true);
  };
  const program = ts.createProgram({ rootNames: [...files.keys()], options, host });
  const checker = program.getTypeChecker();
  const planDeclaration = interfaceDeclaration(
    program.getSourceFile(resolve(FIXTURE_ROOT, "authorize.ts"))!,
    "AuthorizedPublishPlan",
  );
  const planSymbol = checker.getSymbolAtLocation(planDeclaration.name);
  assert.notEqual(planSymbol, undefined, "the fixture AuthorizedPublishPlan must have a checked symbol");
  const forge = program.getSourceFile(resolve(FIXTURE_ROOT, "forge.ts"));
  assert.notEqual(forge, undefined, "the fixture program must load forge.ts");
  return derivationViolations(forge!, planSymbol!, checker);
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
  const { program, rootNames } = sourceProgram(SOURCE_ROOT, SCANNED_EXTENSIONS);
  const sites = rootNames
    .filter((file) => {
      const source = program.getSourceFile(file);
      assert.ok(source !== undefined, `program omitted scanned source ${relRepo(file)}`);
      return pushSites(file, source.text).length > 0;
    })
    .map(relRepo)
    .sort();

  assert.deepEqual(sites, [ARGV_FILE]);
});

test("the push detector flags a quoted push argv element", () => {
  assert.deepEqual(pushSites("quoted.ts", 'export const argv = ["push", "origin"];'), ["1:22 push"]);
});

test("the push detector flags a template-literal push argv element", () => {
  assert.deepEqual(pushSites("template.ts", "export const argv = [`git`, `push`, `origin`];"), ["1:29 push"]);
});

test("the push detector flags a push inside one command string", () => {
  assert.deepEqual(
    pushSites("shell.ts", 'runSystemCommand("sh", ["-c", "git push origin main"], 5000);'),
    ["1:31 push"],
  );
  assert.deepEqual(
    pushSites("chained.ts", 'export const line = "cd repo && git -C repo push --porcelain origin main";'),
    ["1:21 push"],
  );
});

test("the push detector flags git send-pack in every spelling", () => {
  assert.deepEqual(pushSites("plumbing.ts", 'export const argv = ["send-pack", remote, spec];'), ["1:22 send-pack"]);
  assert.deepEqual(pushSites("plumbing-template.ts", "export const argv = [`send-pack`, remote];"), ["1:22 send-pack"]);
  assert.deepEqual(pushSites("plumbing-line.ts", 'export const line = "git send-pack origin main";'), ["1:21 send-pack"]);
});

test("the push detector ignores method calls, prose and the --push flag", () => {
  const text = [
    "const lines: string[] = [];",
    'lines.push("chunk");',
    'export const prose = "A push URL of the publication remote names its host ambiguously.";',
    "export const done = `Nothing was pushed.`;",
    'export const urls = ["remote", "get-url", "--push", "--all", "origin"];',
    "// a comment may say git push freely",
  ].join("\n");

  assert.deepEqual(pushSites("clean.ts", text), []);
});

test("publish argv derives only from the branded authorization type", () => {
  const { program, checker } = sourceProgram(SOURCE_ROOT, SCANNED_EXTENSIONS);
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

test("the derivation detector flags an any-typed value given AuthorizedPublishPlan", () => {
  const forge = [
    'import { publishArgv, type AuthorizedPublishPlan } from "./authorize.ts";',
    "declare const raw: string;",
    "export const plan: AuthorizedPublishPlan = JSON.parse(raw);",
    "export const argv = publishArgv(JSON.parse(raw));",
    "export function load(): AuthorizedPublishPlan { return JSON.parse(raw); }",
    "",
  ].join("\n");

  assert.deepEqual(fixtureDerivationViolations(forge), [
    "publish-fence-fixture/forge.ts:3:44 assigns an any-typed value to AuthorizedPublishPlan",
    "publish-fence-fixture/forge.ts:4:33 assigns an any-typed value to AuthorizedPublishPlan",
    "publish-fence-fixture/forge.ts:5:56 assigns an any-typed value to AuthorizedPublishPlan",
  ]);
});

test("the derivation detector still flags a literal and a cast, once each", () => {
  const forge = [
    'import type { AuthorizedPublishPlan } from "./authorize.ts";',
    "declare const raw: string;",
    'export const built: AuthorizedPublishPlan = { remoteName: "origin" };',
    "export const cast = JSON.parse(raw) as AuthorizedPublishPlan;",
    "",
  ].join("\n");

  assert.deepEqual(fixtureDerivationViolations(forge), [
    "publish-fence-fixture/forge.ts:3:45 constructs AuthorizedPublishPlan",
    "publish-fence-fixture/forge.ts:4:21 casts to AuthorizedPublishPlan",
  ]);
});

test("the derivation detector passes a plan that came from authorizePublish", () => {
  const forge = [
    'import { authorizePublish, publishArgv } from "./authorize.ts";',
    "declare const raw: string;",
    "const plan = authorizePublish();",
    "export const argv = plan === null ? [] : publishArgv(plan);",
    "export const parsed: unknown = JSON.parse(raw);",
    "",
  ].join("\n");

  assert.deepEqual(fixtureDerivationViolations(forge), []);
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
