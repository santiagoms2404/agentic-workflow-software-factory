import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, relRepo } from "./_walk.ts";
import { DRIVING_REL, drivingDocs } from "./_driving.ts";

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
// HALF 2 — the six owner acts, derived.
// ---------------------------------------------------------------------------

// Read as TEXT, deliberately, and not imported. The fence is about what the
// file SAYS: a value imported at runtime would keep passing while the source
// grew a seventh arm in a shape the parser no longer recognises, which is the
// drift this exists to catch. doc-reconciliation.test.ts reads the justfile the
// same way and for the same reason.
const MAIN_TS_REL = "core/src/cli/main.ts";
const MAIN_TS = readFileSync(join(ROOT, ...MAIN_TS_REL.split("/")), "utf8");

/** `case "x": {` … up to the next arm or the `default:` that closes the switch. */
const CASE_ARM = /\bcase "([a-z][\w-]*)":|\bdefault:/g;
const OWNER_TERMINAL = "processOwnerTerminal()";

/**
 * The owner acts are the CLI commands that construct an owner terminal. The
 * count is NOT written down here: if a seventh command ever takes one, the
 * documents owe a seventh name, and a hardcoded six would fail on the code
 * rather than on the drift.
 */
function ownerActsIn(source: string): string[] {
  const arms = [...source.matchAll(CASE_ARM)];
  const acts: string[] = [];
  for (const [index, arm] of arms.entries()) {
    const name = arm[1];
    if (name === undefined) continue; // the `default:` sentinel, which only ends the arm before it
    const body = source.slice(arm.index, arms[index + 1]?.index ?? source.length);
    if (body.includes(OWNER_TERMINAL)) acts.push(name);
  }
  return acts;
}

const OWNER_ACTS = ownerActsIn(MAIN_TS);

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

function enumerationOffenders(files: { label: string; text: string }[]): string[] {
  const expected = [...OWNER_ACTS].sort();
  const offenders: string[] = [];
  for (const { label, text } of files) {
    const named = enumeratedActs(text);
    if (named === undefined) continue;
    const found = [...named].sort();
    if (found.join(",") !== expected.join(",")) {
      const missing = expected.filter((act) => !named.has(act));
      const extra = found.filter((act) => !OWNER_ACTS.includes(act));
      offenders.push(`${label}: missing [${missing.join(", ")}], not an owner act [${extra.join(", ")}]`);
    }
  }
  return offenders;
}

test(`the owner acts are derived from ${MAIN_TS_REL}, not copied into this test`, () => {
  assert.ok(
    OWNER_ACTS.length > 0,
    `no case arm in ${MAIN_TS_REL} constructs ${OWNER_TERMINAL} — either the CLI changed shape or the parser ` +
      `stopped working, and half 2 is now checking every document against an empty set`,
  );
  // `retry` is a case arm and is not an owner act: it takes no terminal. It is
  // asserted here because it is the one thing that separates "the parser found
  // the owner acts" from "the parser listed every command".
  assert.ok(MAIN_TS.includes('case "retry":'), `${MAIN_TS_REL} no longer has a retry arm to discriminate against`);
  assert.ok(!OWNER_ACTS.includes("retry"), "retry constructs no owner terminal and must not be derived as an act");
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
