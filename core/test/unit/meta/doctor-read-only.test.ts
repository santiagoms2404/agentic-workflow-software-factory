import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

// An allowlist prevents a new fs writer (including aliases and Sync variants)
// from slipping past a list of known destructive spellings. Namespace/default
// imports are refused because they expose writers even when unused today.
const READ_FS = new Set([
  "access", "accessSync", "constants", "existsSync", "lstat", "lstatSync",
  "readFile", "readFileSync", "readdir", "readdirSync", "readlink", "readlinkSync",
  "realpath", "realpathSync", "stat", "statSync",
]);
const PROCESS_START = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);

function violations(text: string): string[] {
  const source = ts.createSourceFile("doctor.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const errors: string[] = [];
  const databaseOpeners = new Set<string>();
  const nameOf = (node: ts.Expression): string => ts.isIdentifier(node) ? node.text
    : ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : "";
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.isTypeOnly) return;
      const bindings = clause?.namedBindings;
      const imports = bindings && ts.isNamedImports(bindings) ? bindings.elements.filter(item => !item.isTypeOnly) : [];
      if (/^(?:node:)?fs(?:\/promises)?$/u.test(module)) {
        if (!clause || clause.name || !bindings || !ts.isNamedImports(bindings)) errors.push("unbounded filesystem import");
        for (const item of imports) if (!READ_FS.has((item.propertyName ?? item.name).text)) errors.push("filesystem writer import");
      }
      if (/^(?:node:)?(?:child_process|worker_threads|cluster|sqlite)$/u.test(module)) errors.push("process or database constructor import");
      if (module.endsWith("transport-broker.ts")) {
        if (clause?.name || bindings && !ts.isNamedImports(bindings)) errors.push("unbounded transport import");
        for (const item of imports) if (!["resolveExecutable", "runSystemCommand"].includes((item.propertyName ?? item.name).text)) errors.push("process must use runSystemCommand");
      }
      if (module.endsWith("observability/sqlite.ts")) {
        if (clause?.name || bindings && !ts.isNamedImports(bindings)) errors.push("unbounded database import");
        for (const item of imports) if (!["openDatabase", "closeDatabase"].includes((item.propertyName ?? item.name).text)) errors.push("database writer import");
      }
      for (const item of imports) {
        const name = (item.propertyName ?? item.name).text;
        if (/^(?:write|append|rename|remove|mkdir|unlink|rmdir|rm|acquire.*Lock|with.*Lock|AttemptLock|persist|projectJournal|rebuildDatabase)/u.test(name)) errors.push("writer or lock import");
        if (name === "openDatabase") databaseOpeners.add(item.name.text);
      }
    }
    if (ts.isCallExpression(node)) {
      const name = nameOf(node.expression);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || name === "require") errors.push("dynamic import cannot conceal a writer");
      if (PROCESS_START.has(name)) errors.push("process must use runSystemCommand");
      if (name === "kill" && !(node.arguments.length === 2 && node.arguments[1]?.getText(source) === "0")) errors.push("only PID liveness signal zero is read-only");
      if (databaseOpeners.has(name) || name === "openDatabase") {
        const options = node.arguments[1];
        const readonly = options && ts.isObjectLiteralExpression(options) && options.properties.length === 1 && options.properties.every(property =>
          ts.isPropertyAssignment(property) && property.name.getText(source).replace(/["']/gu, "") === "readonly" && property.initializer.kind === ts.SyntaxKind.TrueKeyword);
        if (!readonly) errors.push("database must be opened explicitly readonly");
      }
    }
    if (ts.isNewExpression(node) && /Database|Worker/u.test(nameOf(node.expression))) errors.push("process or database constructor");
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

test("doctor command and every doctor module import no writer or lock and start no process outside runSystemCommand", () => {
  const files = [join(repoRoot(), "core/src/cli/commands/doctor.ts"), ...walkFiles(join(repoRoot(), "core/src/doctor"), [".ts"])];
  assert.ok(files.length > 1, "the doctor module tree must be scanned");
  assert.deepEqual(files.flatMap(file => violations(readFileSync(file, "utf8")).map(error => `${relRepo(file)}: ${error}`)), []);
});

test("doctor fence rejects planted write imports, aliases, namespaces, locks, database writers and process starts", () => {
  for (const planted of [
    'import { writeFile } from "node:fs/promises";',
    'import { appendFileSync as read } from "node:fs";',
    'import { mkdir as measure } from "fs/promises";',
    'import { rename, rm, unlink, open } from "node:fs/promises";',
    'import * as fs from "node:fs"; fs.writeFileSync("x", "y");',
    'import fs from "node:fs";',
    'await import("node:fs/promises");',
    'const fs = require("node:fs");',
    'import { acquireAttemptLock as read } from "../../persistence/attempt-lock.ts";',
    'import { AttemptLock as Read } from "../../persistence/attempt-lock.ts";',
    'import * as db from "../../observability/sqlite.ts";',
    'import { openDatabase as inspect } from "../../observability/sqlite.ts"; inspect("x");',
    'import { openDatabase } from "../../observability/sqlite.ts"; openDatabase("x", { readonly: false });',
    'import { openDatabase } from "../../observability/sqlite.ts"; openDatabase("x", { readonly: true, ...options });',
    'import { openDatabase } from "../../observability/sqlite.ts"; openDatabase("x", { readonly: true, readonly: false });',
    'import { DatabaseSync as Read } from "node:sqlite"; new Read("x");',
    'import { spawn as read } from "node:child_process";',
    'import { Worker as Read } from "node:worker_threads";',
    'import { TransportBroker } from "../../execution/transport-broker.ts";',
    'process.kill(pid, "SIGTERM");',
    'commands.execFile("provider", []);',
  ]) assert.ok(violations(planted).length > 0, `planted defect must turn the fence red: ${planted}`);
  assert.deepEqual(violations('import { access, readFile as inspect } from "node:fs/promises"; import { openDatabase as read } from "../../observability/sqlite.ts"; read("x", { readonly: true }); process.kill(pid, 0);'), []);
});
