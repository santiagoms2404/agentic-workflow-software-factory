import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CLI_BOOLEAN_FLAGS, CLI_COMMANDS } from "../../../src/cli/main.ts";
import { repoRoot, relRepo, walkFiles } from "./_walk.ts";
import {
  AWSF_CLI,
  DRIVING_REL,
  JUST_TARGET,
  NPM_RUN,
  commandsIn,
  drivingDocs,
  justRecipes,
} from "./_driving.ts";

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
  return commandsIn(DOCUMENTED, pattern);
}

test("awsf command extraction recognizes every invocation form", () => {
  const npmInvocation = "npm run awsf -- land TASK";
  assert.deepEqual([...npmInvocation.matchAll(AWSF_CLI)].map((match) => match[1] ?? ""), []);
  assert.deepEqual(
    commandsIn(["awsf land TASK", npmInvocation, "just awsf land TASK"], AWSF_CLI),
    ["land", "land", "land"],
  );
  assert.deepEqual(commandsIn(["npm run awsf -- db rebuild"], AWSF_CLI), ["db rebuild"]);
  assert.deepEqual(commandsIn(["just awsf doctor"], JUST_TARGET), ["awsf"]);
});

const npmScripts = commands(NPM_RUN);
const cliCommands = commands(AWSF_CLI);
const justTargets = commands(JUST_TARGET);

test("every README and Validation npm run command is a root package script", () => {
  assert.deepEqual([...new Set(npmScripts.filter((script) => !(script in PACKAGE.scripts)))], []);
});

test("every README and Validation awsf command is in the CLI command table", () => {
  assert.deepEqual([...new Set(cliCommands.filter((command) => !CLI_COMMANDS.includes(command)))], []);
});

test("every README and Validation just command is a justfile target", () => {
  const recipes = justRecipes(JUSTFILE);
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
  const recipes = justRecipes(JUSTFILE);
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
  const recipes = justRecipes(JUSTFILE);
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

// ---------------------------------------------------------------------------
// A driving document may not deny a surface the CLI actually has.
//
// The fence-only scan above catches an invented command inside a runnable
// block. It cannot catch the opposite failure, which is what actually happened:
// three cookbook sections went on asserting gaps the code had already closed,
// and one told the driver not to type `awsf status --evidence` — a flag that
// exists and answers the question the same paragraph poses.
//
// This is deliberately NOT the "cleverer regex over prose" the comment above
// refuses. It does not read backticks as existence claims. It reads a short,
// explicit list of DENIAL phrases, and holds each one to two rules:
//
//   A. It must name its subject in backticks. A denial that names nothing
//      cannot be checked by anything, which is how all three survived.
//   B. Every subject it names must be genuinely absent from the live table.
//
// The phrase list is narrow on purpose. "No command can supply this line for
// you" (how_to_prompt_for_the_owner.md) and "No flag bypasses it"
// (gotchas.md) are true, are about judgement rather than the catalogue, and
// must keep passing. Widen the list only with the same test in front of you.
// ---------------------------------------------------------------------------

const DENIAL_PHRASES: readonly RegExp[] = Object.freeze([
  /\bno command prints\b/iu,
  /\bdoes not exist (?:today|yet)\b/iu,
  /\baccepts no flags\b/iu,
  /\bno such command\b/iu,
  /\bno flag named\b/iu,
]);

/** The flags `main.ts` actually reads, derived from it rather than restated. */
function liveFlags(): ReadonlySet<string> {
  const source = readFileSync(join(ROOT, "core", "src", "cli", "main.ts"), "utf8");
  const names = [
    ...[...source.matchAll(/\bflags\.([a-zA-Z][\w]*)/gu)].map((match) => match[1] ?? ""),
    ...[...source.matchAll(/\bflags\["([a-z][\w-]*)"\]/gu)].map((match) => match[1] ?? ""),
    ...CLI_BOOLEAN_FLAGS,
  ];
  return new Set(names.filter((name) => name.length > 0));
}

function paragraphs(markdown: string): string[] {
  return markdown.split(/\n\s*\n/u);
}

/** Backticked `awsf <command>` and `--flag` subjects a denial paragraph names. */
function deniedSubjects(paragraph: string): { commands: string[]; flags: string[] } {
  const quoted = [...paragraph.matchAll(/`([^`]+)`/gu)].map((match) => match[1] ?? "");
  return {
    commands: commandsIn(quoted, AWSF_CLI),
    flags: quoted.flatMap((text) => [...text.matchAll(/--([a-z][\w-]*)/gu)].map((match) => match[1] ?? "")),
  };
}

function denialOffences(markdown: string, flags: ReadonlySet<string>): string[] {
  const offences: string[] = [];
  for (const paragraph of paragraphs(markdown)) {
    const phrase = DENIAL_PHRASES.find((pattern) => pattern.test(paragraph));
    if (phrase === undefined) continue;
    const named = deniedSubjects(paragraph);
    const live = [
      ...named.commands.filter((command) => CLI_COMMANDS.includes(command)).map((command) => `awsf ${command}`),
      ...named.flags.filter((flag) => flags.has(flag)).map((flag) => `--${flag}`),
    ];
    if (live.length > 0) {
      offences.push(`denies a live surface (${[...new Set(live)].join(", ")}) near ${String(phrase)}`);
      continue;
    }
    if (named.commands.length === 0 && named.flags.length === 0) {
      offences.push(`denial ${String(phrase)} names no subject in backticks, so nothing can check it`);
    }
  }
  return offences;
}

test("no driving document denies a command or flag the CLI actually has", () => {
  const flags = liveFlags();
  // The derivation has to have found something, or the rule is vacuous.
  assert.ok(flags.has("evidence") && flags.has("tier") && flags.size >= 10, `live flags: ${[...flags].join(", ")}`);

  const offenders: string[] = [];
  for (const file of drivingDocs()) {
    offenders.push(
      ...denialOffences(readFileSync(file, "utf8"), flags).map((offence) => `${relRepo(file)}: ${offence}`),
    );
  }
  assert.deepEqual(offenders, []);
});

test("the denial fence bites on the three sections that carried this defect, and spares judgement prose", () => {
  const flags = liveFlags();

  // Verbatim from the cookbooks before this change. Each must be reported.
  const historical = [
    "There is a real gap behind that restraint, and it is worth naming rather than\nabsorbing: **no command prints the enabled workflows, their phases or the tier\nceilings.**",
    "So the backlog item is an evidence mode on the status command that prints those\nthree beside the blocker it already shows. It does not exist today, and `awsf status` accepts no\nflags of its own — do not write one into a runnable block.",
    "Read them there — a number copied here goes stale in\nsilence. No command prints that catalogue today.",
  ];
  for (const paragraph of historical) {
    assert.equal(denialOffences(paragraph, flags).length > 0, true, paragraph.slice(0, 48));
  }
  // The one that denies a live surface says which, rather than only that a
  // subject was missing.
  assert.match(denialOffences(historical[1]!, flags)[0] ?? "", /denies a live surface \(awsf status\)/u);

  // Judgement prose about what a command cannot decide is not a catalogue
  // claim, and stays legal.
  for (const spared of [
    "that is a finding to report rather than a gap to paper over. No command can\nsupply this line for you — it is the one place where the judgment is irreducible.",
    "**Guard.** No flag bypasses it, but a PTY makes the check pass.",
    "What this document still does not contain is the judgment, and that is deliberate.",
  ]) {
    assert.deepEqual(denialOffences(spared, flags), [], spared.slice(0, 48));
  }

  // A denial of a genuinely absent command stays legal — the rule is about
  // truth, not about forbidding the vocabulary.
  assert.deepEqual(denialOffences("`awsf frobnicate` does not exist today.", flags), []);
});

// ---------------------------------------------------------------------------
// `awsf raise` takes its call count as a FLAG, and every written invocation
// must say so.
//
// `main.ts` reads `parsed.flags["calls"]` and defaults it to 1. A positional
// spelling — `awsf raise TASK 3 --reason "..."` — therefore does not fail. It
// succeeds and grants ONE call, silently, which is worse: the owner reads
// "ceiling raised" and starts a run with a third of the headroom they asked
// for. `raise.ts`, `review.ts` and `rework.ts` had the flag form from the
// start; a later change wrote the positional form into the `awsf start`
// refusal, a cookbook and the walkthrough at once, so this is a fence rather
// than a fixed typo.
// ---------------------------------------------------------------------------

/**
 * A written `awsf raise` that supplies a COUNT, with that count not behind
 * `--calls`.
 *
 * Keyed on the count rather than on the invocation, so prose that merely names
 * the command — `awsf raise requires --reason ...` in `raise.ts` — is not a
 * false positive, while both broken spellings are caught: a bare number
 * (`awsf raise TASK 3 --reason`) and a placeholder (`awsf raise TASK <calls>
 * --reason`). A task id containing digits is not a bare number and does not
 * trip it.
 */
export function positionalRaiseCounts(text: string): readonly string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/awsf raise\b([^`\n]*?)--reason/gu)) {
    const between = match[1] ?? "";
    if (between.includes("--calls")) continue;
    if (!/(?:^|\s)(?:\d+|<[^>]+>)(?=\s|$)/u.test(between)) continue;
    found.push(match[0]);
  }
  return found;
}

test("every written `awsf raise` passes its call count as --calls", () => {
  const offenders: string[] = [];
  const files = [
    ...walkFiles(join(ROOT, "core", "src"), [".ts"]),
    ...walkFiles(join(ROOT, "docs"), [".md", ".html"]),
    join(ROOT, "README.md"),
  ];
  for (const file of files) {
    for (const invocation of positionalRaiseCounts(readFileSync(file, "utf8"))) {
      offenders.push(`${relRepo(file)}: ${invocation}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the raise-spelling fence bites on both broken spellings and spares prose", () => {
  // The two forms that silently grant one call instead of the count written.
  assert.equal(positionalRaiseCounts('`awsf raise my-task 3 --reason "<why>"`').length, 1);
  assert.equal(positionalRaiseCounts('awsf raise TASK <calls> --reason "<why>"').length, 1);
  // The legal form, in both a literal and an interpolated spelling.
  assert.deepEqual(positionalRaiseCounts('`awsf raise my-task --calls 3 --reason "<why>"`'), []);
  assert.deepEqual(positionalRaiseCounts("`awsf raise ${id} --calls ${n} --reason \"x\"`"), []);
  // Prose naming the command, which is what made the first cut of this fence
  // report `raise.ts` and is why it keys on the count.
  assert.deepEqual(positionalRaiseCounts("awsf raise requires --reason naming why"), []);
  // A task id that merely contains digits is not a count.
  assert.deepEqual(positionalRaiseCounts("`awsf raise T01-fixture --calls 2 --reason \"x\"`"), []);
});
