import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { parse } from "yaml";
import { repoRoot, walkFiles } from "./_walk.ts";
import { delegationViolation, ownerActViolation, OWNER_ACTS } from "../../../../docs/driving/marimba/marimba-guard-rules.mts";

const root = repoRoot();

/**
 * The two files permitted a planning import, and nothing else.
 *
 * `group.ts` is the CLI's planning route and may reach the whole store. The API
 * read layer is the D9 allowance: the fence exists so "gates, lifecycle and
 * accounting cannot acquire a planning import", and a read-only dashboard route
 * is none of those. It is widened by exactly one path, and the test below holds
 * that path to reading only.
 */
const API_READ_PATH = "core/src/api/planning-route.ts";

test("only the dedicated CLI planning route reaches planning modules", () => {
  const allowed = new Set([join(root, "core/src/cli/commands/group.ts"), join(root, API_READ_PATH)]);
  const violations: string[] = [];
  for (const path of walkFiles(join(root, "core/src"), [".ts"])) {
    if (path.startsWith(join(root, "core/src/planning") + "/") || allowed.has(path)) continue;
    const text = readFileSync(path, "utf8");
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node)) {
        const resolved = resolve(dirname(path), node.text);
        if (resolved.startsWith(join(root, "core/src/planning") + "/")) violations.push(path);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(violations, [], "gates, lifecycle and accounting cannot acquire a planning import");
  const main = readFileSync(join(root, "core/src/cli/main.ts"), "utf8");
  assert.match(main, /if \(command === "group"\) \{[\s\S]*?await import\("\.\/commands\/group\.ts"\)/u);
  assert.equal(main.split('./commands/group.ts').length - 1, 1);
});

test("the API read layer reaches only the read-only view module, and no mutating function through it", () => {
  const source = readFileSync(join(root, API_READ_PATH), "utf8");
  const ast = ts.createSourceFile(API_READ_PATH, source, ts.ScriptTarget.Latest, true);

  // ONE planning module, and it is the read-only one. `store.ts` is where
  // `capture`, `propose` and `apply` live, so naming views.ts is the whole
  // point of the allowance rather than an incidental detail of it.
  const planningImports: string[] = [];
  const visitImports = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      const resolved = resolve(dirname(join(root, API_READ_PATH)), node.text);
      if (resolved.startsWith(join(root, "core/src/planning") + "/")) planningImports.push(resolved);
    }
    ts.forEachChild(node, visitImports);
  };
  visitImports(ast);
  assert.deepEqual(planningImports, [join(root, "core/src/planning/views.ts")]);

  // No mutating identity is reachable through the path: not a write API, not
  // the journal or lock that would let it write one itself, and not the event
  // or operation types that only a writer needs.
  const forbidden = new Set([
    "capture", "propose", "apply", "reduceEvent", "applyChanges", "previewGroup",
    "Journal", "AttemptLock", "writeFile", "appendFile", "mkdir", "rename", "unlink", "rm",
    "Event", "Operation", "Proposal", "WriteOptions",
  ]);
  const offenders: string[] = [];
  const visitIdentifiers = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && forbidden.has(node.text)) offenders.push(node.text);
    ts.forEachChild(node, visitIdentifiers);
  };
  visitIdentifiers(ast);
  assert.deepEqual(offenders, [], "the API read layer must reach no planning write surface");

  // And the module it does import exports no writer either, so the allowance
  // cannot be widened later by re-exporting one from views.ts.
  const views = readFileSync(join(root, "core/src/planning/views.ts"), "utf8");
  for (const name of ["capture", "propose", "apply", "reduceEvent"]) {
    assert.doesNotMatch(views, new RegExp(String.raw`export\s+(?:async\s+)?function\s+${name}\b`, "u"), name);
    assert.doesNotMatch(views, new RegExp(String.raw`export\s*\{[^}]*\b${name}\b`, "u"), name);
  }
});

test("planning never calls lifecycle or accounting mutation APIs", () => {
  const forbidden = new Set(["persistAttempt", "nextRevision", "newCommand", "startCommand", "runProductionCommand", "runStubCommand", "reworkCommand", "landCommand", "cancelCommand", "retryCommand", "publishCommand", "raiseCommand", "CallBudget", "transition", "phaseTransition"]);
  const offenders: string[] = [];
  for (const path of walkFiles(join(root, "core/src/planning"), [".ts"])) {
    const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && forbidden.has(node.text)) offenders.push(`${path}: ${node.text}`);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(offenders, []);
  const evidence = readFileSync(join(root, "core/src/planning/evidence.ts"), "utf8");
  assert.match(evidence, /import \{ readFile, readdir \} from "node:fs\/promises"/u);
  assert.doesNotMatch(evidence, /\b(?:writeFile|appendFile|unlink|rename|mkdir|rm)\b/u);
});

test("the installable skill is small, references shipped commands and loads through the allowed read tool", () => {
  const directory = join(root, "docs/driving/skills/marimba-plan");
  const body = readFileSync(join(directory, "SKILL.md"), "utf8");
  assert.ok(Buffer.byteLength(body) <= 5 * 1024);
  const frontmatter = parse(/^---\n([\s\S]*?)\n---/u.exec(body)?.[1] ?? "") as Record<string, unknown>;
  assert.equal(frontmatter.name, "marimba-plan");
  assert.equal(typeof frontmatter.description, "string");
  assert.ok(String(frontmatter.description).length <= 1024);
  for (const match of body.matchAll(/\]\((references\/[^)]+)\)/gu)) assert.ok(existsSync(join(directory, match[1]!)));
  assert.equal(delegationViolation("read"), false);
  assert.equal(delegationViolation("agent"), true);
  for (const act of OWNER_ACTS) assert.equal(ownerActViolation(`npm run awsf --silent -- awsf ${act} example`), act);
  assert.match(body, /Keep mandatory priming/u);
  assert.match(body, /The owner runs `group apply`/u);
  assert.match(readFileSync(join(directory, "references/activation.md"), "utf8"), /Keep its existing `-e` guard/u);
  // No installation in worker auto-discovery roots is part of this package.
  for (const path of [".claude/skills/marimba-plan", ".pi/skills/marimba-plan", ".agents/skills/marimba-plan"]) assert.equal(existsSync(join(root, path)), false);
});
