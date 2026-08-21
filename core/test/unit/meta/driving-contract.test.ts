import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DRIVING_REL, drivingDir } from "./_driving.ts";
import { routes } from "./driving-routes.test.ts";

// ---------------------------------------------------------------------------
// The contract is the one driving document that is not READ — it is DELIVERED,
// appended to a marimba session's system prompt at launch. That single
// difference is where all four properties below come from, and none of them is
// a house style:
//
//   COMMAND-FREE  a session cannot be told to run something the tree owns the
//                 list of. The contract states the rule; the guard enforces the
//                 list; the cookbook explains the choice. One source each.
//   ROUTE-FREE    the contract travels and the tree may not. It is injected
//                 into a session that may be driving a different project
//                 entirely, so a relative path inside it is an instruction to
//                 read a file that is not there.
//   NO LIVE STATE invariant 1, in the one file every marimba session reads.
//   BUDGET        it is paid on every request, not once when it is needed.
//
// Every matcher here ships a companion feeding it a synthetic offender held IN
// MEMORY — no companion writes a file. The contract exists today, so these are
// not vacuous the way a walked-tree fence is; the companions guard the other
// failure, where a matcher silently stops matching and reports green over a
// document it can no longer read.
//
// The route matcher is IMPORTED from driving-routes.test.ts rather than
// re-declared. That import also registers that file's own two tests in this
// file's process, which is noise in the output and the correct trade: a second
// copy of the regex is how "route-free" and "every route resolves" would
// quietly stop being the same property.
// ---------------------------------------------------------------------------

const CONTRACT_REL = `${DRIVING_REL}/marimba/CONTRACT.md`;
const CONTRACT = join(drivingDir(), "marimba", "CONTRACT.md");

function contractText(): string {
  assert.ok(existsSync(CONTRACT), `${CONTRACT_REL} is missing — there is no contract to check`);
  return readFileSync(CONTRACT, "utf8");
}

/** `path:line — what is wrong`, with the line derived from the match offset. */
function at(text: string, index: number, detail: string): string {
  return `line ${String(text.slice(0, index).split("\n").length)} — ${detail}`;
}

// ---------------------------------------------------------------------------
// 1. Command-free, defined mechanically as two things and NOT as a third.
// ---------------------------------------------------------------------------

/**
 * A block a session copies and runs. Only the opening line is needed: an
 * unclosed fence is still a fence as far as the reader is concerned, and
 * matching the pair would let a malformed one through.
 *
 * `sh` cannot swallow `shell` or `shellcheck` — the boundary after it requires
 * a non-word character, which a newline or an info-string space supplies.
 */
const SHELL_FENCE = /^```(?:bash|sh|console)\b/gm;

const BACKTICKED = /`([^`\n]+)`/g;

/**
 * An invocation inside a backtick span: `awsf <verb>`, `just <target>` or
 * `npm run <script>`. Anchored to the start of the span or a space so a flag
 * or an identifier the contract legitimately quotes cannot trip it.
 *
 * DELIBERATELY NOT WIDENED to prose. The contract has to be able to say the
 * word "command" — it says it four times, describing what fence 2 reads — and a
 * matcher that fired on that would be a matcher authors route around by writing
 * less plainly about the boundary. What is banned is a token a session can copy
 * and run, and a token is backticked.
 */
const INVOCATION = /(?:^|\s)(?:awsf\s+[a-z][\w-]*|just\s+[a-z][\w-]*|npm\s+run\s+[a-z][\w:-]*)/;

function commandOffences(markdown: string): string[] {
  const offences: string[] = [];
  for (const fence of markdown.matchAll(SHELL_FENCE)) {
    offences.push(at(markdown, fence.index, `shell fence ${JSON.stringify(fence[0])}`));
  }
  for (const span of markdown.matchAll(BACKTICKED)) {
    const found = INVOCATION.exec(span[1] ?? "");
    if (found !== null) offences.push(at(markdown, span.index, `backticked invocation ${JSON.stringify(found[0].trim())}`));
  }
  return offences;
}

test(`${CONTRACT_REL} names no command`, () => {
  assert.deepEqual(
    commandOffences(contractText()),
    [],
    "the contract states the rule and the tree owns the list; it names the owner acts by their property, never by invocation",
  );
});

test("the command-free matcher bites, and leaves prose about commands alone", () => {
  const offenders = [
    ["```bash", "awsf status", "```"].join("\n"),
    ["```sh", "just awsf doctor", "```"].join("\n"),
    ["```console", "$ npm run test:unit", "```"].join("\n"),
    "Run `awsf status` first.",
    "Then `just awsf doctor`.",
    "Finally `npm run test:unit`.",
  ];
  for (const offender of offenders) {
    assert.equal(commandOffences(offender).length, 1, `must be reported: ${JSON.stringify(offender)}`);
  }

  // The over-fire control, and the reason the matcher is not widened. Every
  // line here is either a real sentence from the contract or the shape of one,
  // and a matcher reaching for the word "command" would fail on all of them.
  const innocents = [
    "**Fence 2 — owner-act command TEXT.** A shell command invoking one of the acts the lifecycle reserves for the owner is denied.",
    "Fence 2 only ever looks at a command field, so a file-writing tool aimed at the guard's own script is allowed.",
    "The collection command lists what is reclaimable and removes nothing.",
    "`--settings` merges rather than excludes, and `--setting-sources` is what excludes.",
    "A project's own `PreToolUse` hook does not override the deny, and `permissions.allow` is a different mechanism.",
    "```json",
    "A fence for output is not a fence a session runs.",
  ];
  for (const innocent of innocents) {
    assert.deepEqual(commandOffences(innocent), [], `over-fire on legitimate text: ${innocent}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Route-free — the imported matcher, applied with the opposite expectation.
// ---------------------------------------------------------------------------

test(`${CONTRACT_REL} declares no route`, () => {
  assert.deepEqual(
    routes(contractText()),
    [],
    "the contract is injected into a session that may be driving another project; a relative path in it points at a file that is not there",
  );
});

test("the imported route matcher is the routes fence's own, and it still bites", () => {
  // If this file had copied the regex instead, this companion would pass while
  // the two definitions drifted. It cannot: `routes` is the binding the routes
  // fence checks the router with.
  assert.deepEqual(routes("A route to `cookbooks/preflight_a_task.md` and one to `references/gotchas.md`."), [
    "cookbooks/preflight_a_task.md",
    "references/gotchas.md",
  ]);
  assert.deepEqual(routes("An escape to `../../../README.md` is a route too."), ["../../../README.md"]);
  assert.deepEqual(routes("But `AGENTS.md` is a bare basename, and `--settings` is a flag."), []);
});

// ---------------------------------------------------------------------------
// 3. No live task state — invariant 1.
// ---------------------------------------------------------------------------

interface LiveStatePattern {
  readonly name: string;
  readonly why: string;
  readonly pattern: RegExp;
}

/**
 * Two shapes, both of which can only be a runtime value. Anything vaguer would
 * fire on the contract's own section 8, which has to be able to say the words
 * "task", "attempt", "session" and "run" in order to ban them.
 */
const LIVE_STATE: LiveStatePattern[] = [
  {
    name: "uuid",
    why: "session ids are `randomUUID()` — core/src/cli/commands/new.ts — and a task id embeds one. A UUID in a committed document is a pointer to work that ended.",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  },
  {
    name: "run-id",
    why: "a run id is `<session>:<phase>:run` or `<phase>:run`, optionally `-<attempt>` — core/src/cli/commands/production-run.ts and rework.ts. The colon run is what makes it a locator rather than the word.",
    pattern: /\b[\w.-]+(?::[\w.-]+)?:run(?:-\d+)?\b/,
  },
];

function liveStateOffences(markdown: string): string[] {
  const offences: string[] = [];
  for (const { name, pattern } of LIVE_STATE) {
    const found = pattern.exec(markdown);
    if (found !== null) offences.push(at(markdown, found.index, `${name} ${JSON.stringify(found[0])}`));
  }
  return offences;
}

test(`${CONTRACT_REL} carries no live task state`, () => {
  assert.deepEqual(
    liveStateOffences(contractText()),
    [],
    "which work is running lives in the journal and the status store at runtime, and nowhere else",
  );
});

test("each live-state pattern bites its own offender, and neither fires on the contract's own rule", () => {
  const offenders: Record<string, string> = {
    uuid: "Resume session 3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d before deciding.",
    "run-id": "The failing run was build:run-2, so read its tail first.",
  };
  assert.deepEqual(
    Object.keys(offenders).sort(),
    LIVE_STATE.map(({ name }) => name).sort(),
    "every pattern needs an offender proving it bites, and every offender a pattern",
  );
  for (const [name, sentence] of Object.entries(offenders)) {
    assert.deepEqual(
      liveStateOffences(sentence).map((offence) => offence.split(" — ")[1]?.split(" ")[0]),
      [name],
      `${name} must catch its own offender and no other pattern may claim it`,
    );
  }

  // The over-fire control: the ban has to be statable in the document it
  // governs, and section 8 states it using every noun the patterns are about.
  const innocents = [
    "**No live task state, ever.** This text names no task, attempt, session or run, carries no continuity locator and no machine path.",
    "It does not implement a task, does not edit a managed worktree, and does not hand-edit anything under the state root. Workers do that inside attempts.",
    "marimba prepares work, launches runs, reads the journal and the status store.",
  ];
  for (const innocent of innocents) {
    assert.deepEqual(liveStateOffences(innocent), [], `over-fire on legitimate text: ${innocent}`);
  }
});

// ---------------------------------------------------------------------------
// 4. Budget.
// ---------------------------------------------------------------------------

// A cookbook is read once, when a session needs it. The contract is appended to
// the system prompt, so its whole text is re-sent on EVERY request of every
// marimba session for as long as that session lives. The limits are the plan's,
// and they are what stops the document growing into the restatement of the tree
// that every other layer here already owns a piece of.
const MAX_LINES = 120;
const MAX_WORDS = 1_100;

function budgetOffences(markdown: string): string[] {
  const lines = markdown.split("\n").length;
  const words = markdown.split(/\s+/).filter((word) => word !== "").length;
  const offences: string[] = [];
  if (lines > MAX_LINES) offences.push(`${String(lines)} lines exceeds ${String(MAX_LINES)}`);
  if (words > MAX_WORDS) offences.push(`${String(words)} words exceeds ${String(MAX_WORDS)}`);
  return offences;
}

test(`${CONTRACT_REL} is within budget`, () => {
  assert.deepEqual(
    budgetOffences(contractText()),
    [],
    "the contract is re-sent on every request of every marimba session; cut a restatement rather than raising the limit",
  );
});

test("the budget matcher bites on both limits and counts words rather than lines", () => {
  const overLines = Array.from({ length: MAX_LINES + 1 }, () => "x").join("\n");
  assert.deepEqual(budgetOffences(overLines), [`${String(MAX_LINES + 1)} lines exceeds ${String(MAX_LINES)}`]);

  // One line, over the word limit — the two counts have to be independent, or a
  // reflowed document would slip past both.
  const overWords = Array.from({ length: MAX_WORDS + 1 }, () => "word").join(" ");
  assert.deepEqual(budgetOffences(overWords), [`${String(MAX_WORDS + 1)} words exceeds ${String(MAX_WORDS)}`]);

  assert.deepEqual(budgetOffences(["# Title", "", "Two words."].join("\n")), []);
});
