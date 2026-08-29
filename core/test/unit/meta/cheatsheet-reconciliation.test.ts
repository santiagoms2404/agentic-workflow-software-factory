import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CLI_COMMANDS } from "../../../src/cli/main.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { LEGAL_EDGES, TASK_STATES } from "../../../src/state/task-machine.ts";
import { DEFAULT_CALL_CEILINGS, TIERS } from "../../../src/state/tiers.ts";
import { repoRoot } from "./_walk.ts";

// ---------------------------------------------------------------------------
// The cheatsheet gets its own reconciliation file because it is one future
// HTML document with exact, marked fact sets. doc-reconciliation.test.ts scans
// command-shaped text across existing documents; widening that prose scanner
// would make both contracts less precise.
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
// The file is deliberately inert while docs/cheatsheet.html is absent. M2
// builds fences before M4 writes their subject. Once that one known path exists,
// every class assertion below becomes live and a missing marker fails loudly.
// ---------------------------------------------------------------------------

const ROOT = repoRoot();
const CHEATSHEET_PATH = join(ROOT, "docs", "cheatsheet.html");
const CONFIG_PATH = join(ROOT, "awsf.config.yaml");
const GUARD_PATH = join(ROOT, "docs", "driving", "marimba", "delegation-guard.sh");
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

for (const factClass of FACT_CLASSES) {
  test(`${factClass.name} are set-equal between the source and cheatsheet`, () => {
    const sourceEntries = factClass.source();
    assert.ok(sourceEntries.length > 0, `${factClass.name}: source extractor returned an empty set`);
    if (CHEATSHEET === undefined) return;
    assertSetEquality(factClass, sourceEntries, documentFacts(CHEATSHEET, factClass));
  });
}
