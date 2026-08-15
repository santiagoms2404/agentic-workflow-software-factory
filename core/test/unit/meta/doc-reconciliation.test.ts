import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CLI_COMMANDS } from "../../../src/cli/main.ts";
import { repoRoot, relRepo } from "./_walk.ts";
import { DRIVING_REL, drivingDocs } from "./_driving.ts";

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

function commandsIn(texts: string[], pattern: RegExp): string[] {
  return texts.flatMap((text) => [...text.matchAll(pattern)].map((match) => match[1] ?? ""));
}

function commands(pattern: RegExp): string[] {
  return commandsIn(DOCUMENTED, pattern);
}

const NPM_RUN = /\bnpm run ([a-z][\w:-]*)\b/g;
/** `db rebuild` is the one two-word command; the alternation cannot match a hyphen. */
const AWSF_CLI = /(?:^|\s)awsf (db rebuild|[a-z]+)\b/g;
const JUST_TARGET = /(?:^|\s)just ([a-z][\w-]*)\b/g;

const npmScripts = commands(NPM_RUN);
const cliCommands = commands(AWSF_CLI);
const justTargets = commands(JUST_TARGET);

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

// ---------------------------------------------------------------------------
// The driving-document tree, scanned NARROWLY — fenced blocks only.
//
// `commandText` above treats EVERY backticked string as a claim that a command
// exists. That is right for a README, whose backticks are almost always the
// thing itself, and wrong for a cookbook, which names commands constantly in
// explanatory sentences and sometimes names them deliberately as
// counter-examples. Scanning inline backticks across a tree of prose would
// produce failures that teach authors to stop using backticks — the worst
// outcome, because it degrades the documents to protect the test.
//
// So: a fenced ```bash / ```sh / ```console block is a thing a session copies
// and runs, therefore a claim; prose is explanation. Lines beginning with `#`
// are comments and are skipped, and a `$ ` console prompt is stripped.
//
// The residual gap is named and ACCEPTED: prose naming a command that does not
// exist goes uncaught. Do not close it with a cleverer regex — the cost of the
// false positives is higher than the cost of the gap.
// ---------------------------------------------------------------------------

const SHELL_FENCE = /^```(?:bash|sh|console)[^\n]*\n([\s\S]*?)^```/gm;

function fencedShellLines(markdown: string): string[] {
  const lines: string[] = [];
  for (const block of markdown.matchAll(SHELL_FENCE)) {
    for (const raw of (block[1] ?? "").split("\n")) {
      const line = raw.trim().replace(/^\$\s+/, "");
      if (line === "" || line.startsWith("#")) continue;
      lines.push(line);
    }
  }
  return lines;
}

test("every command in a driving-document shell fence exists", () => {
  // Vacuous until docs/driving/ exists — `walkFiles` returns [] for a missing
  // directory. The test below is what proves this one will bite when it does.
  const recipes = justRecipes();
  const offenders: string[] = [];
  for (const file of drivingDocs()) {
    const lines = fencedShellLines(readFileSync(file, "utf8"));
    const unknown = [
      ...commandsIn(lines, NPM_RUN)
        .filter((script) => !(script in PACKAGE.scripts))
        .map((script) => `npm run ${script}`),
      ...commandsIn(lines, AWSF_CLI)
        .filter((command) => !CLI_COMMANDS.includes(command))
        .map((command) => `awsf ${command}`),
      ...commandsIn(lines, JUST_TARGET)
        .filter((target) => !recipes.has(target))
        .map((target) => `just ${target}`),
    ];
    offenders.push(...[...new Set(unknown)].map((name) => `${relRepo(file)}: ${name}`));
  }
  assert.deepEqual(offenders, []);
});

test("the driving-tree scanner reads fences and not prose, and its matchers bite", () => {
  const specimen = [
    "Never run `awsf frobnicate` — it does not exist, and this sentence is prose,",
    "so the scanner must not read it as a claim.",
    "",
    "```bash",
    "# awsf quuxify would be caught if this line were not a comment",
    "awsf status T1",
    "$ awsf frobnicate T1",
    "npm run test:unit",
    "just check",
    "```",
    "",
    "```json",
    '{ "note": "not a shell fence, so awsf nonsense here is invisible" }',
    "```",
  ].join("\n");

  const lines = fencedShellLines(specimen);
  assert.deepEqual(lines, ["awsf status T1", "awsf frobnicate T1", "npm run test:unit", "just check"]);

  // The real command passes and the invented one is caught — from inside the
  // fence, including behind a `$ ` console prompt.
  const found = commandsIn(lines, AWSF_CLI);
  assert.deepEqual(found, ["status", "frobnicate"]);
  assert.deepEqual(
    found.filter((command) => !CLI_COMMANDS.includes(command)),
    ["frobnicate"],
    `an unknown command in a ${DRIVING_REL} fence must be reported`,
  );

  // The other two extractors reach into fences too.
  assert.deepEqual(commandsIn(lines, NPM_RUN), ["test:unit"]);
  assert.ok("test:unit" in PACKAGE.scripts);
  assert.deepEqual(commandsIn(lines, JUST_TARGET), ["check"]);
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
