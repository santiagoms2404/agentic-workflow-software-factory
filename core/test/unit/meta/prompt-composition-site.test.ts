import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

import { repoRoot, walkFiles } from "./_walk.ts";

const COMPOSITION_SITE = "core/src/workflow/prompt-composition.ts";
const SHARED_BLOCK_NAME = /shared(?:System)?Block|sharedBlockBytes|renderedSharedBytes/iu;

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

/** A read of a `.prompt` member, however it is spelled: dotted, optional, bracketed, or a bare `prompt` binding. */
function readsPrompt(node: ts.Expression): boolean {
  const value = unwrap(node);
  if (ts.isPropertyAccessExpression(value)) return value.name.text === "prompt";
  if (ts.isElementAccessExpression(value)) return literalText(unwrap(value.argumentExpression)) === "prompt";
  return ts.isIdentifier(value) && value.text === "prompt";
}

/** A read of `.system` off a `.prompt` member: `agent.prompt.system`, `agent.prompt?.system`, `agent.prompt["system"]`. */
function readsConfiguredSystem(node: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "system" && readsPrompt(node.expression);
  if (ts.isElementAccessExpression(node)) return literalText(unwrap(node.argumentExpression)) === "system" && readsPrompt(node.expression);
  return false;
}

/** An operand that names the shared system block: the binding itself or a member carrying its name. */
function namesSharedBlock(node: ts.Expression): boolean {
  const value = unwrap(node);
  if (ts.isIdentifier(value)) return SHARED_BLOCK_NAME.test(value.text);
  if (ts.isPropertyAccessExpression(value)) return SHARED_BLOCK_NAME.test(value.name.text);
  return false;
}

/**
 * A composition site either reads a configured role-system path or joins a shared system block, by an array
 * `join` or by plain `+` concatenation. Callers that only consume a composed bundle match neither condition
 * and therefore do not become composition implementations.
 */
function composesSystemPrompt(fileName: string, source: string): boolean {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let site = false;
  const visit = (node: ts.Node): void => {
    if (site) return;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (readsConfiguredSystem(node)) site = true;
    }
    // const { system } = agent.prompt;
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer !== undefined
      && readsPrompt(node.initializer)) {
      for (const element of node.name.elements) {
        const key = element.propertyName ?? element.name;
        if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && key.text === "system") site = true;
      }
    }
    // [roleSystemBytes, renderedSharedBytes].join("\n\n")
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "join") {
      const receiver = unwrap(node.expression.expression);
      if (ts.isArrayLiteralExpression(receiver) && receiver.elements.some((element) => namesSharedBlock(element))) site = true;
    }
    // roleSystemBytes + "\n\n" + renderedSharedBytes
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
      && (namesSharedBlock(node.left) || namesSharedBlock(node.right))) site = true;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return site;
}

function compositionSites(root: string): readonly string[] {
  return walkFiles(join(root, "core", "src"))
    .filter((path) => composesSystemPrompt(path, readFileSync(path, "utf8")))
    .map((path) => relative(root, path).split("\\").join("/"))
    .sort();
}

function assertPermittedLayout(sites: readonly string[]): void {
  const current = [...sites].sort();
  assert.deepEqual(
    current,
    [COMPOSITION_SITE],
    `system-prompt composition site must be only ${COMPOSITION_SITE}; observed: ${current.join(", ") || "none"}`,
  );
}

function write(root: string, path: string, source: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

test("the repository has one prompt-composition site in the approved module", () => {
  const sites = compositionSites(repoRoot());
  assert.deepEqual(sites, [COMPOSITION_SITE]);
  assertPermittedLayout(sites);
});

test("the fence recognizes both mechanical definitions in the approved module", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-prompt-site-"));
  try {
    write(root, COMPOSITION_SITE, [
      "export function compose(agent: { prompt: { system: string } }) {",
      "  return agent.prompt.system;",
      "}",
    ].join("\n"));
    assert.deepEqual(compositionSites(root), [COMPOSITION_SITE]);
    assertPermittedLayout(compositionSites(root));

    write(root, COMPOSITION_SITE, [
      "export function compose(roleSystemBytes: string, renderedSharedBytes: string) {",
      "  return [roleSystemBytes, renderedSharedBytes].join('\\n\\n');",
      "}",
    ].join("\n"));
    assert.deepEqual(compositionSites(root), [COMPOSITION_SITE], "joining the shared system block is independently counted");
    assertPermittedLayout(compositionSites(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the one-site fence proves red on a temporary second composition site", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-prompt-site-red-"));
  try {
    write(root, COMPOSITION_SITE, "export const compose = (agent: any) => agent.prompt.system;\n");
    write(root, "core/src/cli/commands/second-site.ts", "export const second = (agent: any) => agent.prompt.system;\n");
    const sites = compositionSites(root);
    assert.deepEqual(sites, [
      "core/src/cli/commands/second-site.ts",
      COMPOSITION_SITE,
    ]);
    assert.throws(
      () => assertPermittedLayout(sites),
      /system-prompt composition site must be.*observed: core\/src\/cli\/commands\/second-site\.ts, core\/src\/workflow\/prompt-composition\.ts/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every spelling of a configured-system read or a shared-block join is a composition site", () => {
  const spellings = [
    "export const sys = (agent: any) => agent.prompt?.system;",
    "export const sys = (agent: any) => agent?.prompt.system;",
    "export const sys = (agent: any) => agent.prompt[\"system\"];",
    "export const sys = (agent: any) => agent.prompt['system'];",
    "export const sys = (agent: any) => { const { system } = agent.prompt; return system; };",
    "export const sys = (roleSystemBytes: string, renderedSharedBytes: string) => roleSystemBytes + \"\\n\\n\" + renderedSharedBytes;",
    "export const sys = (sharedBlockBytes: string, role: string) => sharedBlockBytes + role;",
  ];
  for (const source of spellings) {
    assert.equal(composesSystemPrompt("core/src/cli/commands/planted.ts", source), true, source);
  }
  // Reading other members, joining unrelated values, or consuming a composed bundle is not a site.
  for (const source of [
    "export const model = (agent: any) => agent.prompt.model;",
    "export const sys = (roleSystemBytes: string, other: string) => [roleSystemBytes, other].join('\\n');",
    "export const bundle = (composed: string) => composed.length + 1;",
  ]) {
    assert.equal(composesSystemPrompt("core/src/cli/commands/planted.ts", source), false, source);
  }
});
