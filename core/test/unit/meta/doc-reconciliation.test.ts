import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CLI_COMMANDS } from "../../../src/cli/main.ts";
import { repoRoot } from "./_walk.ts";

const ROOT = repoRoot();
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const PLAN = readFileSync(join(ROOT, "specs", "awsf-plan.html"), "utf8");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const JUSTFILE = readFileSync(join(ROOT, "justfile"), "utf8");

function validationSection(): string {
  const match = /<section id="validation">([\s\S]*?)<\/section>/.exec(PLAN);
  assert.ok(match, "plan has a Validation section");
  return match[1] ?? "";
}

function commandText(source: string, html = false): string[] {
  return html
    ? [...source.matchAll(/<code>([\s\S]*?)<\/code>/g)].map((match) => match[1] ?? "")
    : [...source.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
}

const DOCUMENTED = [...commandText(README), ...commandText(validationSection(), true)];

function commands(pattern: RegExp): string[] {
  return DOCUMENTED.flatMap((text) => [...text.matchAll(pattern)].map((match) => match[1] ?? ""));
}

const npmScripts = commands(/\bnpm run ([a-z][\w:-]*)\b/g);
const cliCommands = commands(/(?:^|\s)awsf (db rebuild|[a-z]+)\b/g);
const justTargets = commands(/(?:^|\s)just ([a-z][\w-]*)\b/g);

function justRecipes(): Map<string, string> {
  const recipes = new Map<string, string>();
  for (const match of JUSTFILE.matchAll(/^([a-z][\w-]*)(?:\s+\*args)?:\n((?: {4}.*\n?)+)/gm)) {
    recipes.set(match[1] ?? "", match[2] ?? "");
  }
  return recipes;
}

test("every README and Validation npm run command is a root package script", () => {
  assert.deepEqual([...new Set(npmScripts.filter((script) => !(script in PACKAGE.scripts)))], []);
});

test("every README and Validation awsf command is in the CLI command table", () => {
  assert.deepEqual([...new Set(cliCommands.filter((command) => !CLI_COMMANDS.includes(command)))], []);
});

test("every README and Validation just command is a justfile target", () => {
  const recipes = justRecipes();
  assert.deepEqual([...new Set(justTargets.filter((target) => !recipes.has(target)))], []);
});

test("just targets only delegate to canonical root npm scripts", () => {
  const recipes = justRecipes();
  const offenders: string[] = [];
  for (const [target, body] of recipes) {
    const npmTest = /\bnpm test\b/.test(body);
    const script = /\bnpm run ([a-z][\w:-]*)\b/.exec(body)?.[1];
    if (!npmTest && (script === undefined || !(script in PACKAGE.scripts))) {
      offenders.push(`${target} is not an npm-script wrapper`);
    }
  }
  assert.deepEqual(offenders, []);
});
