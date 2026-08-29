import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CLI_COMMANDS } from "../../../src/cli/main.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { LEGAL_EDGES, TASK_STATES } from "../../../src/state/task-machine.ts";
import { DEFAULT_CALL_CEILINGS, TIERS } from "../../../src/state/tiers.ts";
import { AWSF_CLI, JUST_TARGET, NPM_RUN, commandsIn, justRecipes } from "./_driving.ts";
import { repoRoot } from "./_walk.ts";

// ---------------------------------------------------------------------------
// The cheatsheet has its own reconciliation file because it is one known HTML
// path whose absence is a defect. doc-reconciliation.test.ts owns the README,
// the v1 plan, and an optional driving-document tree. Mixing those scopes would
// hide their different absence contracts and scatter this document's five HTML
// fences across an unrelated suite.
//
// COMMAND SCOPE: only `<pre>` command blocks are claims. Commands named in
// prose remain exempt, as they are in the driving tree. Here the reader drives
// a session rather than a terminal, so the hazard a prose ban would address is
// answered by the document's own warning: the reader does not type commands;
// an assistant runs them. The warning carries that trade, so it must have the
// `data-awsf-reader-warning` marker and precede the first command block.
//
// MARKER CONVENTION (the contract T16 writes against): each of the six classes
// appears exactly once as `<ul data-awsf-fact-class="CLASS">`. The marked ul is
// the element carrying the complete set. Every direct entry has the exact form
// `<li><code>VALUE</code></li>`, with no prose or markup inside VALUE. There are
// no per-entry data attributes: data-awsf-fact-class is the ONE machine-readable
// marker for that class. Prose explaining the class belongs beside the ul.
//
// Canonical VALUE forms are produced below: commands, states, and owner acts
// use their source strings; edges use
// `ID|FROM->TO|actors=A,B|spawn=BOOLEAN|interactive=BOOLEAN`; configured items
// use `workflow|ID` or `gate|ID`; tiers use `Tn|default=CALLS`.
//
// M2 builds these fences before M3 creates their subject. The explicit path
// assertion below keeps that intentional absence loud rather than vacuously
// green; the content assertions become live as soon as the file lands.
// ---------------------------------------------------------------------------

const ROOT = repoRoot();
const CHEATSHEET_PATH = join(ROOT, "docs", "cheatsheet.html");
const CONFIG_PATH = join(ROOT, "awsf.config.yaml");
const GUARD_PATH = join(ROOT, "docs", "driving", "marimba", "delegation-guard.sh");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const JUSTFILE = readFileSync(join(ROOT, "justfile"), "utf8");
const CHEATSHEET = existsSync(CHEATSHEET_PATH) ? readFileSync(CHEATSHEET_PATH, "utf8") : undefined;

interface FactClass {
  readonly marker: string;
  readonly name: string;
  readonly source: () => readonly string[];
}

function configFacts(): readonly string[] {
  // The loader, rather than a second YAML parser, defines what configuration
  // the factory actually admits. The fence must compare against that result.
  const config = loadConfig(readFileSync(CONFIG_PATH, "utf8"));
  return [
    ...config.workflows.enabled.map((id) => `workflow|${id}`),
    ...Object.keys(config.gates).map((id) => `gate|${id}`),
  ];
}

function ownerActFacts(): readonly string[] {
  const guard = readFileSync(GUARD_PATH, "utf8");
  // Read the executable verb LOOP, never the header comment. Measured when this
  // fence was written: the stale header says six acts while this loop iterates
  // seven (`land cancel rework review journey raise publish`).
  const match = /^\s*for verb in ([^;\n]+); do$/m.exec(guard);
  assert.ok(match, "owner acts: the guard's `for verb in ...; do` loop must remain extractable");
  return (match[1] ?? "").trim().split(/\s+/);
}

const FACT_CLASSES: readonly FactClass[] = [
  {
    marker: "commands",
    name: "commands",
    source: () => CLI_COMMANDS,
  },
  {
    marker: "lifecycle-states",
    name: "lifecycle states",
    source: () => TASK_STATES,
  },
  {
    marker: "legal-edges",
    name: "legal edges",
    source: () => LEGAL_EDGES.map((edge) =>
      `${edge.id}|${edge.from}->${edge.to}|actors=${edge.actors.join(",")}|spawn=${edge.spawnSite}|interactive=${edge.interactive}`
    ),
  },
  {
    marker: "owner-acts",
    name: "owner acts",
    source: ownerActFacts,
  },
  {
    marker: "workflows-and-gates",
    name: "workflows and gates",
    source: configFacts,
  },
  {
    marker: "risk-tiers-and-ceilings",
    name: "risk tiers and ceilings",
    source: () => TIERS.map((tier) => `T${tier}|default=${DEFAULT_CALL_CEILINGS[tier]}`),
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function documentFacts(html: string, factClass: FactClass): readonly string[] {
  const opening = `<ul data-awsf-fact-class="${factClass.marker}">`;
  const markedLists = [...html.matchAll(new RegExp(`${escapeRegExp(opening)}([\\s\\S]*?)<\\/ul>`, "g"))];
  assert.equal(
    markedLists.length,
    1,
    `${factClass.name}: document marker count must be 1 for ${opening}, got ${markedLists.length}`,
  );

  const body = markedLists[0]?.[1] ?? "";
  const entryPattern = /\s*<li><code>([^<]*)<\/code><\/li>\s*/g;
  const entries = [...body.matchAll(entryPattern)].map((match) => match[1] ?? "");
  assert.equal(
    body.replace(entryPattern, ""),
    "",
    `${factClass.name}: marked set must contain only exact <li><code>VALUE</code></li> entries`,
  );
  return entries;
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((entry) => !right.has(entry)).sort();
}

function assertSetEquality(factClass: FactClass, sourceEntries: readonly string[], documentEntries: readonly string[]): void {
  const source = new Set(sourceEntries);
  const document = new Set(documentEntries);
  const missingFromDocument = difference(source, document);
  const inventedByDocument = difference(document, source);

  assert.deepEqual(
    missingFromDocument,
    [],
    `${factClass.name}: source -> document differs; missing entries: ${JSON.stringify(missingFromDocument)}`,
  );
  assert.deepEqual(
    inventedByDocument,
    [],
    `${factClass.name}: document -> source differs; invented entries: ${JSON.stringify(inventedByDocument)}`,
  );
}

const COMMAND_BLOCK = /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi;
const READER_WARNING_BLOCK =
  /<([a-z][\w-]*)\b[^>]*\bdata-awsf-reader-warning(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>([\s\S]*?)<\/\1>/i;

function commandBlocks(html: string): string[] {
  return [...html.matchAll(COMMAND_BLOCK)].map((match) => match[1] ?? "");
}

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function unknownCommands(html: string): string[] {
  const blocks = commandBlocks(html);
  const recipes = justRecipes(JUSTFILE);
  return [
    ...commandsIn(blocks, NPM_RUN)
      .filter((script) => !(script in PACKAGE.scripts))
      .map((script) => `npm run ${script}`),
    ...commandsIn(blocks, AWSF_CLI)
      .filter((command) => !CLI_COMMANDS.includes(command))
      .map((command) => `awsf ${command}`),
    ...commandsIn(blocks, JUST_TARGET)
      .filter((target) => !recipes.has(target))
      .map((target) => `just ${target}`),
  ];
}

test("the cheatsheet exists at its one required path", () => {
  assert.ok(
    CHEATSHEET !== undefined,
    "docs/cheatsheet.html is missing; this fence has one known subject, so absence is a defect, not a vacuous pass",
  );
});

test("every command in a cheatsheet command block exists", () => {
  if (CHEATSHEET === undefined) return;
  const offenders = [...new Set(unknownCommands(CHEATSHEET))];
  assert.deepEqual(
    offenders,
    [],
    `docs/cheatsheet.html command blocks name commands that do not exist: ${offenders.join(", ")}`,
  );
});

test("the reader warning exists before the first command block", () => {
  if (CHEATSHEET === undefined) return;
  const warning = READER_WARNING_BLOCK.exec(CHEATSHEET);
  assert.ok(
    warning,
    "docs/cheatsheet.html needs a data-awsf-reader-warning statement: it replaces the prose command ban for a reader who drives a session instead of a terminal",
  );

  const text = visibleText(warning[2] ?? "");
  assert.match(
    text,
    /(?:no need to type|(?:do|will) not type|never type)[^.]{0,160}\bcommands?\b/i,
    "the reader warning must say that the reader does not type the commands; this is what keeps command-shaped prose exempt",
  );
  assert.match(
    text,
    /\b(?:assistant|marimba)\b[^.]{0,160}\b(?:runs?|types?|typing)\b/i,
    "the reader warning must say that an assistant runs the commands; this answers the hazard the prose ban would have addressed",
  );

  const firstCommandBlock = /<pre\b[^>]*>/i.exec(CHEATSHEET)?.index;
  if (firstCommandBlock !== undefined) {
    assert.ok(
      warning.index < firstCommandBlock,
      "the reader warning must appear before the first command block so the reader knows an assistant, not the reader, runs what follows",
    );
  }
});

for (const factClass of FACT_CLASSES) {
  test(`${factClass.name} are set-equal between the source and cheatsheet`, () => {
    const sourceEntries = factClass.source();
    assert.ok(sourceEntries.length > 0, `${factClass.name}: source extractor returned an empty set`);
    if (CHEATSHEET === undefined) return;
    assertSetEquality(factClass, sourceEntries, documentFacts(CHEATSHEET, factClass));
  });
}
