import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

// W01-Q2 as decided (specs/awsf-v3-w01-driver-checks.html, task 11): K1 is
// enforced in `awsf start`, not in L1's guard, so the guarantee that no other
// path reaches PREPARED is this fence. start.ts is the only module under
// core/src that asks for PREPARED, as a transition target or as a status write.
// The machine under core/src/state declares the edge and requests nothing.

interface Source { readonly path: string; readonly text: string }
const START = "core/src/cli/commands/start.ts";
const MACHINE = "core/src/state/";
const PREPARED = "PREPARED";

/** A transition or authorization whose target is PREPARED, or a status written straight to PREPARED, as text. */
const REQUESTS_PREPARED = /\b(?:to|lifecycleState)\s*:\s*(['"`])PREPARED\1/u;

/**
 * Keys that carry a transition target or a status. A PREPARED value under any of them is a request,
 * whatever the spelling. `from` is deliberately absent: a PREPARED source is a read, not a request.
 */
const TARGET_KEYS = new Set(["to", "lifecycleState", "status", "state", "target"]);

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) {
    current = current.expression;
  }
  return current;
}

function literalText(node: ts.Node): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

/** Whether an expression evaluates to PREPARED: a literal, an enum-style member, or a constant already bound to one. */
function isPreparedValue(node: ts.Expression, aliases: ReadonlySet<string>): boolean {
  const value = unwrap(node);
  if (ts.isIdentifier(value)) return value.text === PREPARED || aliases.has(value.text);
  if (ts.isPropertyAccessExpression(value)) return value.name.text === PREPARED;
  if (ts.isElementAccessExpression(value)) return literalText(unwrap(value.argumentExpression)) === PREPARED;
  return literalText(value) === PREPARED;
}

function propertyKey(name: ts.PropertyName): string | undefined {
  if (ts.isComputedPropertyName(name)) return literalText(unwrap(name.expression));
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return undefined;
}

/** The property a member expression writes, when its name is spelled out. */
function memberKey(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return literalText(unwrap(node.argumentExpression));
  return undefined;
}

/** Lines that write PREPARED as a target or a status, by every spelling the syntax tree resolves. */
function preparedWriteLines(path: string, text: string): number[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = new Set<number>();
  const lineOf = (node: ts.Node): number => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const aliases = new Set<string>();

  // A constant bound to PREPARED is itself a site, and later writes that use its name are sites too.
  // Declarations are visited in source order, so an alias of an alias is seen after its target.
  const bindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined
      && isPreparedValue(node.initializer, aliases)) {
      aliases.add(node.name.text);
      lines.add(lineOf(node));
    }
    ts.forEachChild(node, bindings);
  };
  bindings(file);

  const writes = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const key = propertyKey(node.name);
      if (key !== undefined && TARGET_KEYS.has(key) && isPreparedValue(node.initializer, aliases)) lines.add(lineOf(node));
    } else if (ts.isShorthandPropertyAssignment(node)) {
      if (TARGET_KEYS.has(node.name.text) && aliases.has(node.name.text)) lines.add(lineOf(node));
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const key = memberKey(unwrap(node.left));
      if (key !== undefined && TARGET_KEYS.has(key) && isPreparedValue(node.right, aliases)) lines.add(lineOf(node));
    }
    ts.forEachChild(node, writes);
  };
  writes(file);
  return [...lines];
}

/** The text pattern is kept as a floor: it also sees a request spelled inside a string or a comment. */
function requestLines(path: string, text: string): number[] {
  const textual = text.split("\n").flatMap((line, index) => REQUESTS_PREPARED.test(line) ? [index + 1] : []);
  return [...new Set([...textual, ...preparedWriteLines(path, text)])].sort((a, b) => a - b);
}

function requestSites(sources: readonly Source[]): string[] {
  return sources.flatMap(({ path, text }) => path.startsWith(MACHINE) ? []
    : requestLines(path, text).map((line) => `${path}:${String(line)}`));
}

function assertOnlyStart(sources: readonly Source[]): void {
  const outside = requestSites(sources).filter((site) => !site.startsWith(`${START}:`));
  assert.deepEqual(outside, [], "only start.ts may request DRAFT to PREPARED");
}

let cachedCoreSources: readonly Source[] | undefined;

function coreSources(): readonly Source[] {
  if (cachedCoreSources === undefined) {
    cachedCoreSources = walkFiles(join(repoRoot(), "core", "src"))
      .map((file) => ({ path: relRepo(file), text: readFileSync(file, "utf8") }));
  }
  return cachedCoreSources;
}

test("start.ts is the only module under core/src that requests a transition to PREPARED", () => {
  const sources = coreSources();
  assert.ok(sources.some((source) => source.path === START), `${START} is outside the sweep`);
  assert.ok(requestSites(sources).some((site) => site.startsWith(`${START}:`)), "the matcher must see start.ts's own request");
  assertOnlyStart(sources);
});

test("the fence bites a planted second site, whatever its spelling", () => {
  const sources = coreSources();
  for (const [path, line] of [
    ["core/src/cli/commands/planted.ts", 'transition({ from: "DRAFT", to: "PREPARED", actor: "host", tier, reason, interactive: false, budget });'],
    ["core/src/workflow/planted.ts", "budget.authorize({ from: 'DRAFT', to: 'PREPARED' });"],
    ["core/src/cli/main.ts", "await persistAttempt(dir, revision, { kind: \"attempt.transitioned\", next: nextRevision(status, { lifecycleState: `PREPARED` }) });"],
    ["core/src/cli/commands/planted.ts", 'persist({ status: "PREPARED" });'],
    ["core/src/cli/commands/planted.ts", "budget.authorize({ target: 'PREPARED' });"],
    ["core/src/cli/commands/planted.ts", 'transition({ from: "DRAFT", to: LifecycleState.PREPARED });'],
    ["core/src/cli/commands/planted.ts", "transition({ from: 'DRAFT', to: quietly['PREPARED'] });"],
    ["core/src/cli/commands/planted.ts", 'attempt.lifecycleState = "PREPARED";'],
    ["core/src/cli/commands/planted.ts", "next.lifecycleState = `PREPARED`;"],
  ] as const) {
    const planted = { path, text: `// planted offline\n${line}\n` };
    assert.deepEqual(requestSites([planted]), [`${path}:2`], line);
    assert.throws(() => assertOnlyStart([...sources, planted]), { name: "AssertionError" }, path);
  }
  // A constant bound to PREPARED is a site where it is bound, and a write of that constant is a site too.
  const aliased = { path: "core/src/cli/commands/planted.ts", text: '// planted offline\nconst READY = "PREPARED";\ntransition({ from: "DRAFT", to: READY });\n' };
  assert.deepEqual(requestSites([aliased]), [`${aliased.path}:2`, `${aliased.path}:3`]);
  assert.throws(() => assertOnlyStart([...sources, aliased]), { name: "AssertionError" });
  // Reading a state, naming it in a list, using it as a source, or declaring the edge in the machine is not a request.
  assertOnlyStart([
    { path: "core/src/cli/commands/run.ts", text: 'if (status.lifecycleState !== "PREPARED") throw new Error("stub run requires PREPARED");' },
    { path: "core/src/state/task-machine.ts", text: '{ id: "L1",  from: "DRAFT", to: "PREPARED", actors: ["host"] },' },
    { path: "core/src/api/routes.ts", text: 'const states = ["DRAFT", "PREPARED", "RUNNING"]; if (state === "PREPARED") return ["run in terminal"];' },
    { path: "core/src/cli/commands/production-run.ts", text: 'const edge = { from: "PREPARED", to: "RUNNING", edge: "L4" };' },
  ]);
});
