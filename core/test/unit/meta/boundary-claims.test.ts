import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, relRepo, walkFiles } from "./_walk.ts";
import { DRIVING_REL, drivingDocs } from "./_driving.ts";
import { OWNER_ACT_LIST, ownerActName, type OwnerActReach } from "../../../../docs/driving/marimba/owner-acts.mts";
import { hasOwnerTerminalFallback, ownerActsIn, ownerHelperFlagIsGuarded } from "./_owner-terminal.ts";

// ---------------------------------------------------------------------------
// Two fences over the driving tree, both about the same failure: a document
// telling a driving session something about the owner boundary that the code
// does not say.
//
//   HALF 1 — the claim ban. No document may assert that the owner-terminal
//   check AUTHORISES an act. `process.stdin.isTTY` is a terminal-shape test:
//   it stops an accidental non-interactive invocation and nothing else. A PTY
//   makes it pass. Three documents claimed otherwise until W01 M1 task 1, and
//   the claim is the kind that reads as reassuring and is load-free — nobody
//   notices it is wrong, because nothing fails when it is.
//
//   HALF 2 — the derivation. The owner acts are whatever `main.ts` says they
//   are. Before task 1 the tree held three lists of them — five, six and five.
//   The repair made them agree; this half makes them unable to disagree again,
//   by reading the six out of the source text rather than writing them here.
//
// Both halves sweep a walked list, and `walkFiles` returns [] for a missing
// directory, so each ships a companion that feeds its matcher a synthetic
// offender held in memory. driving-tree.test.ts proves the walk arrives; the
// companions here prove the matchers bite once it does.
//
// THE GAP, NAMED AND ACCEPTED — the same accounting doc-reconciliation.test.ts
// makes for prose naming a command that does not exist:
//
//   A banned-phrase list is escapable by paraphrase. A sentence that means
//   "the terminal check is what stops you" but shares no phrase with the list
//   passes. That is accepted. Do not close it with a cleverer regex: the
//   patterns below sit next to sentences that say the TRUE thing using the
//   same nouns, and a pattern wide enough to catch every paraphrase catches
//   those too. A fence that over-fires teaches authors to stop writing plainly
//   about the boundary — which costs more than the sentences it would catch.
//
//   A second residual, specific to this ban: "there is no flag that bypasses
//   it" was false as an absolute and is true as written today ("no flag
//   bypasses it, but a PTY makes the check pass"). No pattern can separate
//   those two, so none is written. The over-fire control below is what keeps
//   that decision honest.
// ---------------------------------------------------------------------------

const ROOT = repoRoot();

/**
 * The nouns a claim about the terminal check has to reach for. Every pattern
 * below is anchored on one, so the ban is about sentences describing THIS
 * check rather than about the words "enforces" or "cannot" in general — the
 * tree uses both correctly elsewhere, and the innocents prove it.
 */
const TERMINAL = String.raw`(?:\bTTYs?\b|\bterminals?\b|\bstandard input\b|\bstdin\b|\bnon-interactive\b)`;

interface ClaimPattern {
  readonly name: string;
  readonly why: string;
  readonly pattern: RegExp;
}

/**
 * Small on purpose. Each entry names the sentence it retires, so a later
 * author can tell whether a red line is this fence working or this fence
 * over-reaching. `[^.]{0,N}` keeps every match inside one sentence.
 */
const CLAIM_PATTERNS: ClaimPattern[] = [
  {
    name: "sole-path",
    why: 'SKILL.md said "Landing exists only through a human at a TTY", and gotchas §8 quoted it back as the thing the refusal makes true. It is the strongest form of the false claim: the check as the only door.',
    pattern: new RegExp(
      String.raw`\b(?:exists|happens|occurs|is possible|is available)\s+only\s+(?:through|via|behind|with|at)\b[^.]{0,40}?` +
        TERMINAL,
      "i",
    ),
  },
  {
    name: "structurally-cannot",
    why: 'owner_acts.md said a session that cannot type into a terminal "structurally cannot take one of these edges". It cannot type, and it can still take the edge through a PTY. Anchored on a terminal noun because gotchas H2 uses "structurally cannot" correctly about a counter.',
    pattern: new RegExp(TERMINAL + String.raw`[^.]{0,80}?\bstructurally\s+(?:cannot|can(?:no|')t|could not|unable)\b`, "i"),
  },
  {
    name: "terminal-enforces",
    why: "The check as the actor: the terminal, not the owner, doing the authorising. Order matters and is deliberate — the noun before the verb. \"Landing is authorised by the owner at a terminal\" is true and reads the other way round, so it does not match.",
    pattern: new RegExp(
      TERMINAL +
        String.raw`[^.]{0,60}?\b(?:enforces|guarantees|prevents|blocks|authoris(?:e|es|ed|ing)|authoriz(?:e|es|ed|ing)|makes it impossible)\b`,
      "i",
    ),
  },
  {
    name: "terminal-is-the-boundary",
    why: "The claim stated outright. The repaired documents all say the inverse — a shape test, NOT the authorisation boundary — and the inverse does not match, because the pattern needs the copula immediately before the noun phrase.",
    pattern: new RegExp(
      TERMINAL +
        String.raw`[^.]{0,60}?\bis\s+(?:the|an?|our)\s+(?:(?:authoris|authoriz)ation|security|trust|privilege)\s+boundary\b`,
      "i",
    ),
  },
];

interface ClaimHit {
  readonly pattern: string;
  readonly text: string;
}

/**
 * Markdown in this tree is hard-wrapped, so a claim spans lines. Whitespace is
 * collapsed before matching and the matched phrase is reported instead of a
 * line number — the phrase is what a reader greps for anyway.
 */
function claimHits(markdown: string): ClaimHit[] {
  const flat = markdown.replace(/\s+/g, " ");
  const hits: ClaimHit[] = [];
  for (const { name, pattern } of CLAIM_PATTERNS) {
    const found = pattern.exec(flat);
    if (found) hits.push({ pattern: name, text: found[0].slice(0, 100) });
  }
  return hits;
}

test(`no ${DRIVING_REL} document claims the owner-terminal check authorises an act`, () => {
  const offenders: string[] = [];
  for (const file of drivingDocs()) {
    for (const hit of claimHits(readFileSync(file, "utf8"))) {
      offenders.push(`${relRepo(file)} [${hit.pattern}]: ${hit.text}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "the terminal check is a shape test, not the authorisation boundary; the boundary is the per-invocation tool-surface denial",
  );
});

test("each claim pattern bites its own offender, and none of them fires on a true sentence", () => {
  // The first two are the sentences task 1 deleted, verbatim. The other two are
  // the same claim written the two other obvious ways.
  const offenders: Record<string, string> = {
    "sole-path": "Landing exists only through a human at a TTY.",
    "structurally-cannot":
      "A driving session that cannot type into a terminal structurally cannot take one of these edges.",
    "terminal-enforces": "The terminal check enforces that only the owner may land.",
    "terminal-is-the-boundary": "The interactive owner terminal is the authorisation boundary for these six acts.",
  };
  assert.deepEqual(
    Object.keys(offenders).sort(),
    CLAIM_PATTERNS.map((p) => p.name).sort(),
    "every pattern needs an offender proving it bites, and every offender a pattern",
  );
  for (const [name, sentence] of Object.entries(offenders)) {
    assert.deepEqual(
      claimHits(sentence).map((hit) => hit.pattern),
      [name],
      `${name} must catch its own offender and no other pattern may claim it`,
    );
  }

  // The over-fire control. Both innocents are REAL sentences from this tree
  // that a careless pattern catches: the first is a structural claim about a
  // command with no repair path, the second about a counter, and neither is
  // about a terminal at all. A pattern reaching for "by construction",
  // "read-only" or a bare "structurally cannot" would fail here rather than in
  // a document six months from now.
  const innocents = [
    "The diagnosis command is read-only by construction and has no repair path — a finding is evidence for the owner, never permission to alter an attempt.",
    "An attempt-scoped allowance now carries owner re-entry, and the phase machine is handed only the per-phase pair, so a phase structurally cannot spend a lifecycle allowance.",
    // The repaired sentences themselves: the ban has to survive the tree it was
    // written for, and these are the hardest case — the true claim uses the
    // same nouns as the false one, negated.
    "Landing is authorised by the owner at a terminal — the terminal check is a shape test, not the authorisation boundary, and the boundary marimba operates under is the per-invocation tool-surface denial.",
    "The check is a terminal-shape test (`process.stdin.isTTY`), not the authorisation boundary itself.",
    "No flag bypasses it, but a PTY makes the check pass — `script -qec` supplies one and clears it.",
  ];
  for (const sentence of innocents) {
    assert.deepEqual(claimHits(sentence), [], `over-fire on a true sentence: ${sentence}`);
  }
});

// ---------------------------------------------------------------------------
// HALF 2 — the owner acts, listed once and held to the code.
//
// B5-05/B5-45: deriving the acts from the `case` arms alone missed three that
// build their terminal elsewhere (seed, group apply, retry --adopt-as), and
// both guards copied the miss. The list is now data in owner-acts.mts, and
// this half checks it against the source from the other side: EVERY
// `processOwnerTerminal()` call site in core/src must map to a listed act, and
// every listed act must have one.
// ---------------------------------------------------------------------------

// Read as TEXT, deliberately, and not imported. The fence is about what the
// file SAYS: a value imported at runtime would keep passing while the source
// grew a seventh arm in a shape the parser no longer recognises, which is the
// drift this exists to catch. doc-reconciliation.test.ts reads the justfile the
// same way and for the same reason.
const MAIN_TS_REL = "core/src/cli/main.ts";
const MAIN_TS = readFileSync(join(ROOT, ...MAIN_TS_REL.split("/")), "utf8");
const CLI_DIR_REL = "core/src/cli/";

const OWNER_TERMINAL = "processOwnerTerminal()";

/** The case-arm part of the list: what documents enumerate and the shell `for verb` loop names. */
const OWNER_ACTS: readonly string[] = OWNER_ACT_LIST.filter((entry) => entry.reach === "case-arm").map((entry) => entry.verb);
const LISTED_ACTS: ReadonlySet<string> = new Set(OWNER_ACT_LIST.map(ownerActName));

/**
 * The nearest enclosing shape a call site can sit in: a case arm, a
 * `default:` (which ends the arm before it and belongs to no act), an
 * `if (command === "x")` block, or a named helper function.
 */
const ANCHOR = /\bcase "([a-z][\w-]*)":|\bdefault:|\bif \(command === "([a-z][\w-]*)"\)|\bfunction (\w+)\(/g;

function anchorBefore(source: string, index: number): RegExpExecArray | undefined {
  let last: RegExpExecArray | undefined;
  for (const match of source.matchAll(ANCHOR)) {
    if (match.index >= index) break;
    last = match;
  }
  return last;
}

/** The text of the arm opening at `start`, up to the next arm or `default:`. */
function armBody(source: string, start: number): string {
  const rest = source.slice(start + 1);
  const next = /\bcase "[a-z][\w-]*":|\bdefault:/.exec(rest);
  return source.slice(start, next === null ? source.length : start + 1 + next.index);
}

/**
 * The listed act for `verb` built through `reach`, or an `unlisted:` line. A
 * flagged entry needs its arm to read the flag, which is what separates
 * `retry --adopt-as` from the plain `retry` that builds no terminal.
 */
function actFor(verb: string, reach: OwnerActReach, body: string, callIndex = body.length): string {
  const entry = OWNER_ACT_LIST.find((candidate) =>
    candidate.verb === verb && candidate.reach === reach &&
    (candidate.flag === undefined || ownerHelperFlagIsGuarded(body, candidate.flag, callIndex)));
  return entry === undefined ? `unlisted: ${verb} (${reach})` : ownerActName(entry);
}

/** The acts a `processOwnerTerminal()` at `index` of main.ts-shaped `source` is built for. */
function mainSiteActs(source: string, index: number, viaHelper = false, depth = 0, helperName?: string): string[] {
  const anchor = anchorBefore(source, index);
  if (anchor?.[1] !== undefined) {
    const body = armBody(source, anchor.index);
    const callIndex = index - anchor.index;
    if (viaHelper && helperName !== "ownerTerminal") {
      return [actFor(anchor[1], "helper", body, callIndex)];
    }
    const caseAct = actFor(anchor[1], "case-arm", body, callIndex);
    return viaHelper && helperName === "ownerTerminal" && caseAct.startsWith("unlisted:")
      ? [actFor(anchor[1], "helper", body, callIndex)]
      : [caseAct];
  }
  if (anchor?.[2] !== undefined) {
    return [actFor(anchor[2], viaHelper && helperName !== "ownerTerminal" ? "helper" : "if-block", "")];
  }
  const helper = anchor?.[3];
  if (helper !== undefined && depth < 3) {
    const callers = [...source.matchAll(new RegExp(String.raw`(?<!function )\b${helper}\(`, "g"))];
    if (callers.length === 0) return [`unattributed: helper ${helper} has no caller`];
    return callers.flatMap((call) => mainSiteActs(source, call.index, true, depth + 1, helper));
  }
  return ["unattributed: no case arm, command block or helper encloses it"];
}

/**
 * A command module's call site belongs to the command whose block in main.ts
 * loads the module, and to the operation the terminal is handed to on that
 * line: `group.ts`'s `await apply(…, processOwnerTerminal())` is `group apply`.
 * A terminal handed to anything else reads as an unlisted act, which is the
 * loud direction to fail in.
 */
function moduleSiteActs(fileRel: string, source: string, index: number): string[] {
  if (!fileRel.startsWith(CLI_DIR_REL)) return [`unattributed: ${fileRel} is not a CLI module`];
  const specifier = `./${fileRel.slice(CLI_DIR_REL.length)}`;
  const load = MAIN_TS.indexOf(`import("${specifier}")`);
  const command = load < 0 ? undefined : anchorBefore(MAIN_TS, load)?.[2];
  if (command === undefined) return [`unattributed: no command block in ${MAIN_TS_REL} loads ${specifier}`];
  const line = source.slice(source.lastIndexOf("\n", index) + 1, source.indexOf("\n", index));
  const callee = /\bawait (\w+)\(/u.exec(line)?.[1];
  return callee === undefined ? ["unattributed: the terminal is handed to no awaited operation"] : [actFor(`${command} ${callee}`, "module", "")];
}

interface OwnerTerminalSite {
  readonly where: string;
  readonly acts: readonly string[];
}

/** Every `processOwnerTerminal()` call in core/src, comments and the definition aside. */
function ownerTerminalSites(): OwnerTerminalSite[] {
  const sites: OwnerTerminalSite[] = [];
  for (const file of walkFiles(join(ROOT, "core", "src"), [".ts"])) {
    const fileRel = relRepo(file);
    const source = fileRel === MAIN_TS_REL ? MAIN_TS : readFileSync(file, "utf8");
    for (const match of source.matchAll(/processOwnerTerminal\(\)/g)) {
      const line = source.slice(source.lastIndexOf("\n", match.index) + 1, source.indexOf("\n", match.index));
      if (/^\s*(?:\/\/|\*|\/\*)/u.test(line) || line.includes("function processOwnerTerminal")) continue;
      const where = `${fileRel}:${source.slice(0, match.index).split("\n").length}`;
      const acts = fileRel === MAIN_TS_REL ? mainSiteActs(source, match.index) : moduleSiteActs(fileRel, source, match.index);
      sites.push({ where, acts });
    }
  }
  return sites;
}

/** Sites that map to nothing listed, and listed acts no site builds. */
function siteOffenders(sites: readonly OwnerTerminalSite[]): { unmapped: string[]; unbuilt: string[] } {
  const unmapped = sites.flatMap((site) => site.acts.filter((act) => !LISTED_ACTS.has(act)).map((act) => `${site.where} → ${act}`));
  const built = new Set(sites.flatMap((site) => site.acts));
  return { unmapped, unbuilt: [...LISTED_ACTS].filter((act) => !built.has(act)) };
}

/**
 * A run of backticked names joined by commas, `and` or `or` — a list, as
 * opposed to two names that happen to sit in one sentence.
 */
const LIST_RUN = /`[^`\n]+`(?:\s*(?:,\s*(?:and\s+|or\s+)?|(?:and|or)\s+)`[^`\n]+`)+/g;
const RUN_ITEM = /`([^`\n]+)`/g;

/**
 * Four, not three. A run naming four or more of the acts is a document
 * enumerating them; a shorter one is a sentence that happens to name a few
 * ("bring `cancel`, `land` and `rework`'s prompts up to standard"), and reading
 * that as a claim about the whole set is the over-fire that would teach authors
 * to stop naming acts together.
 */
const ENUMERATION_FLOOR = 4;

function listRuns(markdown: string): string[][] {
  return [...markdown.matchAll(LIST_RUN)].map((run) =>
    [...(run[0] ?? "").matchAll(RUN_ITEM)].map((item) => (item[1] ?? "").replace(/^awsf\s+/, "").trim()),
  );
}

/**
 * Scoped per DOCUMENT and not per run, because a partial run is legitimate:
 * gotchas §8's symptom names the five acts a reader actually hits, and its
 * cause two lines below names all six. What is not legitimate is a document
 * whose lists, taken together, disagree with the code.
 */
function enumeratedActs(markdown: string): Set<string> | undefined {
  const acts = new Set(OWNER_ACTS);
  const enumerations = listRuns(markdown).filter(
    (run) => run.filter((item) => acts.has(item)).length >= ENUMERATION_FLOOR,
  );
  if (enumerations.length === 0) return undefined;
  return new Set(enumerations.flat());
}

/**
 * A document owes every case-arm act and may name nothing unlisted. The three
 * acts built outside an arm may be named and are not yet owed: whether the
 * driving documents enumerate them is a documentation change of its own.
 */
function enumerationOffenders(files: { label: string; text: string }[]): string[] {
  const expected = [...OWNER_ACTS].sort();
  const offenders: string[] = [];
  for (const { label, text } of files) {
    const named = enumeratedActs(text);
    if (named === undefined) continue;
    const missing = expected.filter((act) => !named.has(act));
    const extra = [...named].sort().filter((act) => !LISTED_ACTS.has(act));
    if (missing.length > 0 || extra.length > 0) {
      offenders.push(`${label}: missing [${missing.join(", ")}], not an owner act [${extra.join(", ")}]`);
    }
  }
  return offenders;
}

test(`the list's case-arm acts are exactly the ${MAIN_TS_REL} arms that construct an owner terminal`, () => {
  const derived = ownerActsIn(MAIN_TS);
  assert.ok(
    derived.length > 0,
    `no case arm in ${MAIN_TS_REL} constructs ${OWNER_TERMINAL} — either the CLI changed shape or the parser ` +
      `stopped working, and half 2 is now checking every document against an empty set`,
  );
  assert.deepEqual([...derived].sort(), [...OWNER_ACTS].sort());
});

test(`every ${OWNER_TERMINAL} call site in core/src maps to a listed act, and every listed act has one`, () => {
  assert.equal(hasOwnerTerminalFallback(MAIN_TS), true, "the shared CLI helper must default to processOwnerTerminal()");
  const sites = ownerTerminalSites();
  const derivedActs = sites.flatMap((site) => site.acts);
  assert.equal(derivedActs.length, OWNER_ACT_LIST.length, "every owner act must have exactly one terminal site after following helper callers");
  assert.deepEqual(siteOffenders(sites), { unmapped: [], unbuilt: [] });
  assert.deepEqual(derivedActs.sort(), [...LISTED_ACTS].sort());
  // `retry` is a case arm and plain `retry` is not an owner act: only its
  // `--adopt-as` path builds a terminal, through a helper. It is asserted here
  // because it separates "the sweep found the owner acts" from "the sweep
  // listed every command" (B9-08: this line used to say retry builds none).
  assert.ok(MAIN_TS.includes('case "retry":'), `${MAIN_TS_REL} no longer has a retry arm to discriminate against`);
  assert.ok(!LISTED_ACTS.has("retry"), "plain retry builds no owner terminal and must not be listed as an act");
  assert.ok(sites.some((site) => site.acts.includes("retry --adopt-as")), "the adoption helper's call site must map to retry --adopt-as");
});

test("the executable driving guard denies every listed owner act", () => {
  const guard = readFileSync(join(ROOT, "docs/driving/marimba/delegation-guard.sh"), "utf8");
  const match = /^\s*for verb in ([^;\n]+); do$/m.exec(guard);
  assert.ok(match, "the owner-act denial list must remain explicit");
  assert.deepEqual(match[1]!.trim().split(/\s+/).sort(), [...OWNER_ACTS].sort());
  // The acts built outside an arm: `+` writes a two-word act as one shell word.
  const phrases = /^\s*for phrase in ([^;\n]+); do$/m.exec(guard);
  assert.ok(phrases, "the outside-arm owner-act denial list must remain explicit");
  const outside = OWNER_ACT_LIST.filter((entry) => entry.reach !== "case-arm");
  assert.deepEqual(
    phrases[1]!.trim().split(/\s+/).map((phrase) => phrase.replaceAll("+", " ")).sort(),
    outside.filter((entry) => entry.flag === undefined).map((entry) => entry.verb).sort(),
  );
  for (const entry of outside.filter((candidate) => candidate.flag !== undefined)) {
    assert.ok(guard.includes(`*" ${entry.flag} "*`) && guard.includes(`*"awsf ${entry.verb}"*`),
      `delegation-guard.sh must deny ${ownerActName(entry)}`);
  }
});

test("the call-site sweep follows the shared fallback and every caller", () => {
  const source = [
    "function ownerTerminal(provided) { return provided ?? processOwnerTerminal(); }",
    "switch (command) {",
    '  case "land": { await landCommand({ terminal: ownerTerminal(provided) }); }',
    '  case "retry": {',
    '    const targetTaskId = parsed.flags["adopt-as"];',
    '    if (targetTaskId !== undefined) { await adoptCommand({ terminal: ownerTerminal(provided) }); }',
    "  }",
    '  case "invented": { await otherCommand({ terminal: ownerTerminal(provided) }); }',
    "  default:",
    "    break;",
    "}",
  ].join("\n");
  assert.equal(hasOwnerTerminalFallback(source), true);
  const fallbackAt = source.indexOf(OWNER_TERMINAL);
  assert.deepEqual(mainSiteActs(source, fallbackAt), ["land", "retry --adopt-as", "unlisted: invented (helper)"]);
  assert.deepEqual(ownerActsIn(source), ["land", "invented"]);

  const brokenFallback = source.replace("provided ?? processOwnerTerminal()", "provided ?? inertTerminal()");
  assert.equal(hasOwnerTerminalFallback(brokenFallback), false);
  assert.deepEqual(ownerActsIn(brokenFallback), []);
  const unguardedRetry = source.replace("targetTaskId !== undefined", "targetTaskId === undefined");
  assert.deepEqual(ownerActsIn(unguardedRetry), ["land", "retry", "invented"]);
});

test("the call-site sweep attributes arms, command blocks and helpers, and reports what is unlisted", () => {
  const source = [
    "function adoptionTerminal(provided) {",
    "  return provided ?? processOwnerTerminal();",
    "}",
    'if (command === "seed") {',
    "  await seedCommand({ terminal: options.terminal ?? processOwnerTerminal() });",
    "}",
    'if (command === "invented") {',
    "  await inventedCommand({ terminal: options.terminal ?? processOwnerTerminal() });",
    "}",
    "switch (command) {",
    '  case "land": {',
    "    await landCommand({ terminal: options.terminal ?? processOwnerTerminal() });",
    "  }",
    '  case "retry": {',
    '    const targetTaskId = parsed.flags["adopt-as"];',
    "    if (targetTaskId !== undefined) await adoptCommand({ terminal: adoptionTerminal(options.terminal) });",
    "  }",
    '  case "cancel": {',
    "    await cancelCommand({ terminal: adoptionTerminal(options.terminal) });",
    "  }",
    "  default:",
    "    throw new Error(USAGE);",
    "}",
  ].join("\n");
  const at = (needle: string): number => source.indexOf("processOwnerTerminal()", source.indexOf(needle));
  assert.deepEqual(mainSiteActs(source, at("function adoptionTerminal")), ["retry --adopt-as", "unlisted: cancel (helper)"],
    "a helper's site is every caller's act, and a helper called from an arm with no listed flag is unlisted");
  assert.deepEqual(mainSiteActs(source, at('command === "seed"')), ["seed"]);
  assert.deepEqual(mainSiteActs(source, at('command === "invented"')), ["unlisted: invented (if-block)"]);
  assert.deepEqual(mainSiteActs(source, at('case "land"')), ["land"]);

  // Both directions of the set check bite.
  assert.deepEqual(siteOffenders([{ where: "x.ts:1", acts: ["unlisted: invented (if-block)"] }]).unmapped,
    ["x.ts:1 → unlisted: invented (if-block)"]);
  assert.deepEqual(siteOffenders([]).unbuilt, [...LISTED_ACTS]);

  // A module's site belongs to the command block that loads it, then to the operation it is handed to.
  assert.deepEqual(moduleSiteActs("core/src/cli/commands/group.ts", "  result = await apply(w, processOwnerTerminal());\n", 30),
    ["group apply"]);
  assert.deepEqual(moduleSiteActs("core/src/cli/commands/group.ts", "  result = await propose(w, processOwnerTerminal());\n", 30),
    ["unlisted: group propose (module)"]);
});

test(`every ${DRIVING_REL} document enumerating owner acts enumerates exactly the derived set`, () => {
  const files = drivingDocs().map((file) => ({ label: relRepo(file), text: readFileSync(file, "utf8") }));
  assert.deepEqual(enumerationOffenders(files), []);
});

test("the derivation reads arms rather than commands, and a wrong list in a document is reported", () => {
  const source = [
    '      case "watch":',
    "        await watchCommand({ attemptDir: located.attemptDir });",
    "        return 0;",
    '      case "land": {',
    "        const result = await landCommand({",
    "          attemptDir: located.attemptDir,",
    "          terminal: options.terminal ?? processOwnerTerminal(),",
    "        });",
    "        return 0;",
    "      }",
    '      case "cancel": {',
    "        const result = await cancelCommand({",
    "          terminal: options.terminal ?? processOwnerTerminal(),",
    "        });",
    "        return 0;",
    "      }",
    '      case "retry": {',
    "        const result = await retryCommand({ attemptDir: located.attemptDir });",
    "        return 0;",
    "      }",
    "      default:",
    "        throw new Error(USAGE);",
  ].join("\n");
  assert.deepEqual(
    ownerActsIn(source),
    ["land", "cancel"],
    "an arm that takes no terminal is not an act, and `default:` must not extend the arm before it",
  );

  // A prose mention is not a list; a list of four or more acts is.
  assert.deepEqual(listRuns("`watch` polls the same projection `status` prints."), []);
  assert.deepEqual(listRuns("Prepare `rework` and `review` before `land`."), [["rework", "review"]]);

  const full = OWNER_ACTS.map((act) => `\`${act}\``);
  const document = (items: string[]): string =>
    `# Acts\n\nThe owner's own: ${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}.\n`;

  assert.deepEqual(enumerationOffenders([{ label: "ok.md", text: document(full) }]), []);

  // The seventh fake name — a document inventing an act.
  const seventh = enumerationOffenders([{ label: "fake.md", text: document([...full, "`abdicate`"]) }]);
  assert.deepEqual(seventh, ["fake.md: missing [], not an owner act [abdicate]"]);

  // And the historic failure: a list that drops one. `awsf land` proves the
  // command prefix is stripped, which is how gotchas §8's symptom line parses.
  const dropped = enumerationOffenders([
    { label: "short.md", text: document(["`awsf " + (full[0] ?? "").slice(1), ...full.slice(1, -1)]) },
  ]);
  assert.deepEqual(dropped, [`short.md: missing [${OWNER_ACTS[OWNER_ACTS.length - 1]}], not an owner act []`]);

  // A three-name run is prose about some acts, not a claim about all of them.
  assert.deepEqual(enumerationOffenders([{ label: "prose.md", text: document(full.slice(0, 3)) }]), []);
});
