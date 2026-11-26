import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { repoRoot, walkFiles } from "./_walk.ts";

const ROOTS = ["core/src", "dashboard/src", "dashboard/shared", "docs/driving"];
const GIT_ENV = "core/src/git/environment.ts";
const CLI = "core/src/cli/main.ts";
// The external surfaces: executable CLI and launcher, loopback HTTP and its
// dashboard frontend, and Pi's shipped driving extension. Library command
// calls are checked in every root, not just in these entry modules.
const ENTRY_POINTS = [CLI, "core/src/execution/launcher.ts", "core/src/api/server.ts",
  "core/src/cli/commands/operator.ts", "dashboard/src/main.ts", "docs/driving/marimba/marimba-guard.pi.ts"];

function scanRoot(root: string): readonly string[] {
  const paths = walkFiles(root);
  assert.ok(paths.length > 0, `empty scan root: ${root}`);
  return paths;
}

function parse(path: string, text: string): ts.SourceFile {
  if (path.endsWith(".vue")) {
    // Keep line offsets and inspect both normal and setup scripts, not template prose.
    text = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gu)]
      .reduce((out, match) => {
        const start = match.index + match[0].indexOf(">") + 1;
        return out.slice(0, start) + match[1] + out.slice(start + match[1]!.length);
      }, text.replace(/[^\n]/gu, " "));
  }
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".vue") ? ts.ScriptKind.TS : undefined);
}

function sources(): ts.SourceFile[] {
  const root = repoRoot();
  return ROOTS.flatMap(dir => scanRoot(join(root, dir))
    .map(path => parse(relative(root, path).split("\\").join("/"), readFileSync(path, "utf8"))));
}

function spelling(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  if (ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return undefined;
}

function prop(node: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  const field = node.properties.find(p => ts.isPropertyAssignment(p) && spelling(p.name) === key);
  return field && ts.isPropertyAssignment(field) ? field.initializer : undefined;
}

function gitBuilderImported(file: ts.SourceFile, name: string | undefined): boolean {
  return file.statements.some(node => ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier) && posix.join(posix.dirname(file.fileName), node.moduleSpecifier.text) === GIT_ENV &&
    node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings) &&
    node.importClause.namedBindings.elements.some(e => e.name.text === name && (e.propertyName ?? e.name).text === "buildGitEnvironment"));
}

const BROKER_CALLS = new Set(["runSystemCommand", "runCommand", "run"]);
const STARTS = new Set([...BROKER_CALLS, "exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "execve"]);
const GIT_EXECUTABLE_NAMES = /^(?:git|gitExecutable)$/iu;
const GIT = /^(?:[^\s]*[/\\])?git(?:\.exe)?$/iu;
const SHELL_GIT = /^(?:[^\s]*[/\\])?git(?:\.exe)?\s/iu;
const IDENTITY_KEY = /^user\.(?:name|email)$/iu;
const IDENTITY_ARGV = /(?:^|\s)config\s.*\buser\.(?:name|email)(?:\s|$)/iu;

function gitStart(file: ts.SourceFile, node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = spelling(node.expression) ?? "";
  if (!STARTS.has(callee)) return false;
  const command = node.arguments[0];
  if (command === undefined) return false;
  const literal = ts.isStringLiteralLike(command) ? command.text : ts.isTemplateExpression(command) ? command.head.text : "";
  const resolvedGit = (ts.isIdentifier(command) && GIT_EXECUTABLE_NAMES.test(command.text)) ||
    (ts.isPropertyAccessExpression(command) && spelling(command.expression) === "git" && command.name.text === "resolved");
  if (!resolvedGit && !GIT.test(literal) && !SHELL_GIT.test(literal)) return false;
  const options = node.arguments[2];
  if (!BROKER_CALLS.has(callee) || options === undefined || !ts.isObjectLiteralExpression(options)) return true;
  if (options.properties.some(p => (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) ||
      !["env", "timeoutMs", "encoding", "cwd", "maxBuffer"].includes(spelling(p.name) ?? "")) ||
      options.properties.filter(p => spelling(p.name) === "env").length !== 1) return true;
  const env = prop(options, "env");
  return env === undefined || !ts.isCallExpression(env) || !ts.isIdentifier(env.expression) || !gitBuilderImported(file, env.expression.text);
}

function configIdentity(_file: ts.SourceFile, node: ts.Node): boolean {
  // No standalone key is needed in production: explicit host assignments
  // use user.name=... and user.email=..., never a query key. This also catches
  // a key stored in a variable before the config call.
  return (ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) &&
    (IDENTITY_KEY.test(node.text) || (SHELL_GIT.test(node.text) && IDENTITY_ARGV.test(node.text)));
}

// Test doubles are selected by the embedding caller, never constructed at a
// production command boundary. Only two named CLI forwards are intentional:
// they project JS function options, not flags, env, or request objects.
const COMMAND_SEAMS = new Map<string, readonly string[]>([
  ["startCommand", ["preflight", "adapterAvailability", "now"]],
  ["preflightCommand", ["runCommand"]],
  ["runProductionCommand", ["infrastructure"]], ["resumeProductionCommand", ["infrastructure"]],
  ["adoptCommand", ["infrastructure"]], ["reworkCommand", ["infrastructure"]], ["reviewCommand", ["infrastructure"]],
  ["dashCommand", ["assetRoot", "onListening"]], ["runStubCommand", ["wait"]],
  ["gatherDoctorRows", ["runCommand", "resolveExecutable"]], ["quotaCommand", ["runCommand", "resolveExecutable"]],
  ["main", ["intakeExecution", "terminal", "writeOut", "writeError"]],
]);

function injectedDouble(file: ts.SourceFile, node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = spelling(node.expression) ?? "";
  if (callee === "main" && file.fileName === CLI) return node.arguments.length !== 0;
  if (callee === "main" && node.arguments.length === 0) return false;
  const seams = COMMAND_SEAMS.get(callee);
  if (seams === undefined) return false;
  function inspect(options: ts.Node): boolean {
    if (ts.isObjectLiteralExpression(options)) return options.properties.some(property => {
      if (ts.isSpreadAssignment(property)) return inspect(property.expression);
      const key = spelling(property.name);
      if (key === undefined) return true;
      if (!seams!.includes(key)) return false;
      const value = ts.isPropertyAssignment(property) ? property.initializer.getText(file) : "";
      return !(file.fileName === CLI &&
        ((callee === "startCommand" && key === "preflight" && value === "options.intakeExecution.preflight") ||
        (callee === "runProductionCommand" && key === "infrastructure" && value === "options.intakeExecution.infrastructure")));
    });
    if (ts.isConditionalExpression(options)) return inspect(options.whenTrue) || inspect(options.whenFalse);
    if (ts.isParenthesizedExpression(options)) return inspect(options.expression);
    // A computed options object can hide a test seam. Construct it explicitly.
    return true;
  }
  const options = node.arguments[callee === "runStubCommand" ? 1 : 0];
  return options === undefined ? callee !== "runStubCommand" : inspect(options);
}

// The owner-protected checks already distinguish the parent segment from ..x.
// Exempt only these exact calls, once per file, not their surrounding code.
const PROTECTED_CONTAINMENT = new Map([
  ["core/src/policy/path-policy.ts", 'normalized.startsWith("../")'],
  ["core/src/policy/sandbox-broker.ts", 'path.startsWith(`..${sep}`)'],
]);

/** Known leading text, ending at the first dynamic part of a string expression. */
function leadingText(expr: ts.Expression): { text: string; complete: boolean } {
  if (ts.isStringLiteralLike(expr)) return { text: expr.text, complete: true };
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr) ||
      ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) return leadingText(expr.expression);
  if (ts.isTemplateExpression(expr)) {
    let text = expr.head.text;
    for (const span of expr.templateSpans) {
      const part = leadingText(span.expression);
      text += part.text;
      if (!part.complete) return { text, complete: false };
      text += span.literal.text;
    }
    return { text, complete: true };
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = leadingText(expr.left);
    if (!left.complete) return left;
    const right = leadingText(expr.right);
    return { text: left.text + right.text, complete: right.complete };
  }
  return { text: "", complete: false };
}

function rawContainment(_file: ts.SourceFile, node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || spelling(node.expression) !== "startsWith") return false;
  const [prefix] = node.arguments;
  return prefix !== undefined && leadingText(prefix).text.startsWith("..");
}

// The HTTP-date subtraction must compare epoch times. Dashboard polling and
// rendering keep their existing wall-clock reads; do not grant new ones.
const WALL_CLOCK = new Map<string, number>([
  ["core/src/decision/jev-transport.ts", 1],
  ["dashboard/src/App.vue", 3], ["dashboard/src/composables/usePolling.ts", 1], ["dashboard/src/display.ts", 1],
  ["dashboard/src/components/CanvasRunCard.vue", 1], ["dashboard/src/components/SessionCard.vue", 1],
  ["dashboard/src/components/SessionHeader.vue", 1], ["dashboard/src/components/SwimlaneChart.vue", 1],
  ["dashboard/src/components/CanvasMap.vue", 1], ["dashboard/src/components/LiveIndicator.vue", 2],
]);

function wallClock(_file: ts.SourceFile, node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const access = node.expression;
  return (ts.isPropertyAccessExpression(access) || ts.isElementAccessExpression(access)) &&
    spelling(access.expression) === "Date" && spelling(access) === "now";
}

const FENCES = [
  { name: "Git starts use the shared environment", check: gitStart, plants: [
    ...[...STARTS].map(start => `${start}("git", argv)`),
    'runSystemCommand("git", argv, 1000)', 'runSystemCommand("git", argv, { timeoutMs: 1000, env: process.env })',
    'spawn("/usr/bin/git", argv)', 'execSync(`git status`)',
    'run(git.resolved, argv, { env: process.env })', 'run(gitExecutable, argv)', 'run(git, argv)',
    'runSystemCommand("git", argv, { env: buildGitEnvironment(), ...options })',
  ] },
  { name: "no Git config identity", check: configIdentity, plants: [
    'git(["config", "user.name"])', 'runGit(git, ["config", "--get", "user.email"])', 'execSync("git config --get user.email")',
    'const identityKey = "user.name"; git(["config", "--get", identityKey]);',
  ] },
  { name: "production arguments do not bind test doubles", check: injectedDouble, plants: [
    'startCommand({ ...(flags.stub ? { adapterAvailability: () => true } : {}) })',
    'startCommand({ preflight: flags.test ? fake : undefined })',
    'runProductionCommand({ infrastructure: process.env.TEST_MODE ? fake : undefined })',
    'resumeProductionCommand({ infrastructure })', 'adoptCommand({ infrastructure })', 'reworkCommand({ infrastructure })',
    'reviewCommand({ infrastructure })', 'preflightCommand({ runCommand })', 'dashCommand({ onListening })',
    'dashCommand({ assetRoot })', 'startCommand({ now })', 'runStubCommand(dir, { wait: fake })',
    'main({ ["intakeExecution"]: flags.test ? fake : undefined })', 'main({ terminal })',
    'main({ writeOut })', 'main({ writeError })', 'gatherDoctorRows({ runCommand: fake })',
    'quotaCommand({ resolveExecutable: fake })',
  ] },
  { name: "no raw containment prefixes", check: rawContainment, plants: [
    'offset.startsWith("..")', "offset['startsWith']('../')", 'offset.startsWith("..\\\\")',
    'offset.startsWith("..x")', 'offset.startsWith(`..${sep}`)', 'offset.startsWith(`../`)',
    'offset.startsWith(".." + sep)', 'offset.startsWith(("." + ".") + sep)',
    'offset.startsWith(`.${"."}${sep}`)', 'offset.startsWith((".." as const) + sep)',
  ] },
  { name: "wall-clock reads are explicitly named", check: wallClock, budget: WALL_CLOCK, plants: [
    'Date.now()', 'Date["now"]()',
  ] },
];

function violations(file: ts.SourceFile, fence: (typeof FENCES)[number]): string[] {
  const matches: string[] = [];
  let usedProtectedException = false;
  function visit(node: ts.Node): void {
    if (fence.check(file, node)) {
      if (fence.check === rawContainment && !usedProtectedException &&
          node.getText(file) === PROTECTED_CONTAINMENT.get(file.fileName)) {
        usedProtectedException = true;
      } else {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        matches.push(`${file.fileName}:${line + 1}: ${node.getText(file).split("\n")[0]}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return matches.slice("budget" in fence ? fence.budget?.get(file.fileName) ?? 0 : 0);
}

const production = sources();
for (const fence of FENCES) {
  test(`T22 fence: ${fence.name}`, () => {
    assert.deepEqual(production.flatMap(file => violations(file, fence)), []);
  });
  test(`T22 plants: ${fence.name}`, (t) => {
    const empty = mkdtempSync(join(tmpdir(), "awsf-t22-empty-"));
    t.after(() => rmdirSync(empty));
    assert.throws(() => scanRoot(empty), /empty scan root/u);
    for (const root of ROOTS) {
      for (const plant of fence.plants) {
        const path = `${root}/planted${root === "dashboard/src" ? ".vue" : ".ts"}`;
        const file = parse(path, path.endsWith(".vue") ? `<script setup lang="ts">${plant}</script>` : plant);
        assert.equal(violations(file, fence).length, 1, `${root}: ${plant}`);
      }
    }
  });
}

test("T22 production entry points are scanned; CLI bootstrap binds no test options", () => {
  for (const path of ENTRY_POINTS) assert.ok(production.some(file => file.fileName === path), path);
  const fence = FENCES[2]!;
  const cli = production.find(file => file.fileName === CLI)!;
  // Prove the actual bootstrap, not only that an options object would be refused.
  assert.match(cli.text, /process\.exitCode = await main\(\);/u);
  assert.equal(violations(parse(CLI, 'process.exitCode = await main({ intakeExecution: process.env.TEST ? fake : undefined });'), fence).length, 1);
});

test("T22's wall-clock allowlist does not admit extra reads in a named file", () => {
  const path = "core/src/decision/jev-transport.ts";
  const actual = production.find(file => file.fileName === path)!;
  assert.equal(violations(parse(path, `${actual.text}\nDate.now();`), FENCES[4]!).length, 1);
});

test("T22's named protected containment exceptions each cover only one expression", () => {
  for (const [path, expression] of PROTECTED_CONTAINMENT) {
    const file = production.find(file => file.fileName === path)!;
    assert.ok(file.text.includes(expression), path);
    assert.equal(violations(parse(path, `${file.text}\n${expression}; offset.startsWith("..");`), FENCES[3]!).length, 2);
  }
  assert.deepEqual(violations(parse("core/src/planted.ts", 'offset.startsWith(`.${separator}..`);'), FENCES[3]!), []);
});
