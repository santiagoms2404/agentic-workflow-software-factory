import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { sourceImportCandidates } from "./_walk.ts";

type Body = ts.Block | ts.Expression;
type Binding = { module: string; exported: string } | { node: ts.Node };
const testExports = new Set(["default", "test", "it", "describe", "suite", "skip", "todo", "only"]);
const suiteExports = new Set(["describe", "suite"]);
const assertionModules = new Set(["assert", "assert/strict", "node:assert", "node:assert/strict"]);
const invokedCallbacks = new Set(["map", "flatMap", "forEach", "filter", "reduce", "some", "every", "find", "then", "catch", "finally"]);

function member(node: ts.Expression): { receiver: ts.Expression; name: string } | undefined {
  if (ts.isPropertyAccessExpression(node)) return { receiver: node.expression, name: node.name.text };
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return { receiver: node.expression, name: node.argumentExpression.text };
  }
  return undefined;
}

function propertyName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return undefined;
}

function functionBody(node: ts.Node): Body | undefined {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) return node.body;
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined) return functionBody(node.initializer);
  return undefined;
}

function declaration(statement: ts.Statement, name: string): ts.Node | undefined {
  if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.find(decl => ts.isIdentifier(decl.name) && decl.name.text === name);
  }
  return undefined;
}

function importBinding(statement: ts.Statement, name: string): Binding | undefined {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return undefined;
  const clause = statement.importClause;
  if (clause === undefined || clause.isTypeOnly) return undefined;
  const module = statement.moduleSpecifier.text;
  if (clause.name?.text === name) return { module, exported: "default" };
  const named = clause.namedBindings;
  if (named === undefined) return undefined;
  if (ts.isNamespaceImport(named)) return named.name.text === name ? { module, exported: "*" } : undefined;
  const element = named.elements.find(element => !element.isTypeOnly && element.name.text === name);
  return element === undefined ? undefined : { module, exported: (element.propertyName ?? element.name).text };
}

function lookup(at: ts.Node, name: string): Binding | undefined {
  for (let scope = at.parent; scope !== undefined; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      const parameter = scope.parameters.find(p => ts.isIdentifier(p.name) && p.name.text === name);
      if (parameter !== undefined) return { node: parameter };
    }
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      const found = declaration(statement, name);
      if (found !== undefined) return { node: found };
      const imported = importBinding(statement, name);
      if (imported !== undefined) return imported;
    }
  }
  return undefined;
}

function importedExpression(expression: ts.Expression): { module: string; exported: string } | undefined {
  const binding = ts.isIdentifier(expression) ? lookup(expression, expression.text) : undefined;
  if (binding !== undefined && "module" in binding) return binding;
  const access = member(expression);
  if (access === undefined || !ts.isIdentifier(access.receiver)) return undefined;
  const namespace = lookup(access.receiver, access.receiver.text);
  return namespace !== undefined && "module" in namespace && namespace.exported === "*"
    ? { module: namespace.module, exported: access.name } : undefined;
}

function testKind(expression: ts.Expression): string | undefined {
  const imported = importedExpression(expression);
  if (imported?.module === "node:test" && testExports.has(imported.exported)) return imported.exported;
  const access = member(expression);
  if (access === undefined) return undefined;
  if (access.name === "test" && isContext(access.receiver)) return "test";
  if (["todo", "only", "skip"].includes(access.name) && (testKind(access.receiver) !== undefined || isContext(access.receiver))) return access.name;
  return undefined;
}

function isContext(expression: ts.Expression): boolean {
  if (!ts.isIdentifier(expression)) return false;
  const binding = lookup(expression, expression.text);
  if (binding === undefined || !("node" in binding) || !ts.isParameter(binding.node)) return false;
  const parameter = binding.node;
  if (parameter.type?.getText() === "TestContext") return true;
  const fn = parameter.parent;
  return ts.isCallExpression(fn.parent) && fn.parent.arguments.includes(fn as ts.Expression) && testKind(fn.parent.expression) !== undefined;
}

export function parseTestSource(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function registration(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && testKind(node.expression) !== undefined;
}

export function registeredTestNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (registration(node)) {
      const name = node.arguments[0];
      if (name !== undefined) names.add(ts.isStringLiteralLike(name) ? name.text : name.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function disabled(node: ts.Expression | undefined): boolean {
  return node !== undefined && node.kind === ts.SyntaxKind.FalseKeyword;
}

function staticTruth(node: ts.Expression): boolean | undefined {
  if (ts.isParenthesizedExpression(node)) return staticTruth(node.expression);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (disabled(node) || node.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isStringLiteralLike(node)) return node.text.length > 0;
  if (ts.isNumericLiteral(node)) return Number(node.text) !== 0;
  return undefined;
}

/** Conservative source check, not a proof of runtime reachability. Follow
 * direct local/imported helpers and common invoked callbacks, not arbitrary
 * callees or dormant closures. A test without a visible failure path fails. */
export function createTestAudit(root: string): (source: ts.SourceFile, exempt?: ReadonlySet<string>) => string[] {
  const cache = new Map<string, ts.SourceFile>();
  const testRoot = join(root, "core/test") + "/";
  const productionRoot = join(root, "core/src") + "/";

  function resolveBody(expression: ts.Expression, callbacks: ReadonlyMap<ts.Node, Body> = new Map(), followProduction = false): Body | undefined {
    if (ts.isParenthesizedExpression(expression)) return resolveBody(expression.expression, callbacks, followProduction);
    const inline = functionBody(expression);
    if (inline !== undefined) return inline;
    const binding = ts.isIdentifier(expression) ? lookup(expression, expression.text) : undefined;
    if (binding !== undefined && "node" in binding) return callbacks.get(binding.node) ?? functionBody(binding.node);
    const imported = importedExpression(expression);
    if (imported === undefined || !imported.module.startsWith(".")) return undefined;
    const path = sourceImportCandidates(resolve(dirname(expression.getSourceFile().fileName), imported.module))
      .find(candidate => (candidate.startsWith(testRoot) || followProduction && candidate.startsWith(productionRoot)) &&
        /\.[cm]?[jt]sx?$/u.test(candidate) && existsSync(candidate));
    if (path === undefined) return undefined;
    let source = cache.get(path);
    if (source === undefined) {
      source = parseTestSource(path, readFileSync(path, "utf8"));
      cache.set(path, source);
    }
    for (const statement of source.statements) {
      const target = declaration(statement, imported.exported);
      if (target !== undefined) return functionBody(target);
    }
    return undefined;
  }

  function argumentBindings(fn: ts.SignatureDeclaration, call: ts.CallExpression, inherited: ReadonlyMap<ts.Node, Body>): Map<ts.Node, Body> {
    const bound = new Map(inherited);
    for (const [index, parameter] of fn.parameters.entries()) {
      const arg = call.arguments[index];
      const passed = arg === undefined ? undefined : resolveBody(arg, inherited);
      if (passed !== undefined) bound.set(parameter, passed);
    }
    return bound;
  }

  function canFail(body: Body, bindings: ReadonlyMap<ts.Node, Body> = new Map()): boolean {
    const visited = new Set<ts.Node>();
    const visit = (node: ts.Node, caught = false, callbacks = bindings): boolean => {
      const see = (child: ts.Node, isCaught = caught) => visit(child, isCaught, callbacks);
      if (ts.isFunctionLike(node)) return false;
      if (ts.isThrowStatement(node)) {
        // Rethrowing a caught setup/I/O error does not add a test check.
        for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
          if (ts.isCatchClause(parent) && parent.variableDeclaration?.name.getText() === node.expression.getText()) return false;
          if (ts.isFunctionLike(parent)) break;
        }
        return !caught;
      }
      if (ts.isBlock(node)) {
        for (const statement of node.statements) {
          if (see(statement)) return true;
          if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) break;
        }
        return false;
      }
      if (ts.isIfStatement(node) || ts.isConditionalExpression(node)) {
        if (see(ts.isIfStatement(node) ? node.expression : node.condition)) return true;
        const truth = staticTruth(ts.isIfStatement(node) ? node.expression : node.condition);
        const yes = ts.isIfStatement(node) ? node.thenStatement : node.whenTrue;
        const no = ts.isIfStatement(node) ? node.elseStatement : node.whenFalse;
        return (truth !== false && see(yes)) || (truth !== true && no !== undefined && see(no));
      }
      if (ts.isWhileStatement(node) && staticTruth(node.expression) === false) return false;
      if (ts.isForStatement(node) && node.condition !== undefined && staticTruth(node.condition) === false) {
        return node.initializer !== undefined && see(node.initializer);
      }
      if (ts.isBinaryExpression(node)) {
        const truth = staticTruth(node.left);
        if (truth === false && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            truth === true && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) return see(node.left);
      }
      if (ts.isTryStatement(node)) {
        return see(node.tryBlock, caught || node.catchClause !== undefined) ||
          (node.catchClause !== undefined && see(node.catchClause.block)) ||
          (node.finallyBlock !== undefined && see(node.finallyBlock));
      }
      if (ts.isCallExpression(node)) {
        const access = member(node.expression);
        const imported = importedExpression(access?.receiver ?? node.expression) ?? importedExpression(node.expression);
        if (!caught && (assertionModules.has(imported?.module ?? "") ||
          (access !== undefined && member(access.receiver)?.name === "assert" && isContext(member(access.receiver)!.receiver)))) return true;
        const invoked = resolveBody(node.expression, callbacks, node.arguments.some(arg => resolveBody(arg, callbacks) !== undefined));
        if (invoked !== undefined && !visited.has(invoked)) {
          visited.add(invoked);
          const bound = ts.isFunctionLike(invoked.parent) ? argumentBindings(invoked.parent, node, callbacks) : callbacks;
          const fails = visit(invoked, caught, bound);
          visited.delete(invoked);
          if (fails) return true;
        }
        if (access !== undefined && invokedCallbacks.has(access.name) && node.arguments.some(arg => {
          const body = resolveBody(arg, callbacks);
          if (body === undefined || visited.has(body)) return false;
          visited.add(body);
          const fails = see(body);
          visited.delete(body);
          return fails;
        })) return true;
        // Nested tests are checked independently by the registration walk.
        if (registration(node) && access !== undefined && isContext(access.receiver)) return true;
      }
      return ts.forEachChild(node, child => see(child) || undefined) === true;
    };
    return visit(body);
  }

  return (source, exempt = new Set()) => {
    const issues: string[] = [];
    const callSites = new Map<ts.Node, ts.CallExpression[]>();
    const gatherCalls = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const binding = lookup(node.expression, node.expression.text);
        if (binding !== undefined && "node" in binding && ts.isFunctionDeclaration(binding.node)) {
          const calls = callSites.get(binding.node) ?? [];
          calls.push(node);
          callSites.set(binding.node, calls);
        }
      }
      ts.forEachChild(node, gatherCalls);
    };
    gatherCalls(source);
    const issue = (node: ts.Node, text: string) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      issues.push(`${source.fileName}:${line + 1}: ${text}`);
    };
    const visit = (node: ts.Node): void => {
      if (registration(node)) {
        const kind = testKind(node.expression);
        if (kind === "todo" || kind === "only") issue(node, `${kind} test marker`);
        for (const arg of node.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) continue;
          for (const prop of arg.properties) {
            const key = propertyName(prop.name);
            if ((key === "todo" || key === "only") && (!ts.isPropertyAssignment(prop) || !disabled(prop.initializer))) issue(prop, `${key} test option`);
          }
        }
        const name = node.arguments[0];
        const title = name !== undefined && ts.isStringLiteralLike(name) ? name.text : name?.getText(source) ?? "unnamed test";
        const candidates = node.arguments.toReversed();
        const body = candidates.map(arg => resolveBody(arg)).find(candidate => candidate !== undefined);
        const factory = body === undefined ? candidates.find(ts.isCallExpression) : undefined;
        const builder = factory === undefined ? undefined : resolveBody(factory.expression);
        const returned = builder !== undefined && ts.isBlock(builder) && builder.statements.length === 1 && ts.isReturnStatement(builder.statements[0]!)
          ? builder.statements[0]!.expression : undefined;
        const built = returned === undefined ? undefined : functionBody(returned);
        const receiver = member(node.expression)?.receiver;
        const suite = suiteExports.has(kind ?? "") || receiver !== undefined && suiteExports.has(testKind(receiver) ?? "");
        const contextSkip = kind === "skip" && receiver !== undefined && isContext(receiver);
        const directPath = body !== undefined && canFail(body);
        const factoryPath = built !== undefined && factory !== undefined && builder !== undefined && ts.isFunctionLike(builder.parent) &&
          canFail(built, argumentBindings(builder.parent, factory, new Map()));
        if (!suite && kind !== "todo" && !contextSkip && !exempt.has(title) && !directPath && !factoryPath) {
          // If a local wrapper registers the same test for several callbacks,
          // each call site must supply a callback with a failure path.
          let owner = node.parent;
          while (owner !== undefined && !ts.isFunctionLike(owner)) owner = owner.parent;
          const calls = owner === undefined ? undefined : callSites.get(owner);
          if (body !== undefined && owner !== undefined && ts.isFunctionLike(owner) && calls !== undefined) {
            for (const call of calls) {
              if (!canFail(body, argumentBindings(owner, call, new Map()))) issue(call, `no reachable assertion or throw: ${title}`);
            }
          } else issue(node, `no reachable assertion or throw: ${title}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return issues;
  };
}
