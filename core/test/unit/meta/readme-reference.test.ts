import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { OWNER_ACT_LIST, ownerActName } from "../../../../docs/driving/marimba/owner-acts.mts";
import { WORKFLOW_IDS } from "../../../src/config/workflow-ids.ts";
import { GATE_IDS } from "../../../src/gates/interface.ts";
import { TASK_STATES } from "../../../src/state/task-machine.ts";
import { COMPILED_WORKFLOW_IDS } from "../../../src/workflow/compiled-ids.ts";
import { parseVisualBinding } from "../../../src/workflow/visual-references.ts";
import { repoRoot } from "./_walk.ts";

const ROOT = repoRoot();
const README = readFileSync(join(ROOT, "README.md"), "utf8");

function section(heading: string, text = README): string {
  const marker = `## ${heading}\n`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `README must retain its ${heading} reference`);
  const contentStart = start + marker.length;
  const end = text.indexOf("\n## ", contentStart);
  return text.slice(contentStart, end === -1 ? undefined : end);
}

function tableIds(text: string): string[] {
  return [...text.matchAll(/^\| `([^`]+)` \|/gmu)].map(match => match[1]!);
}

function assertVocabulary(heading: string, expected: readonly string[], text = README): void {
  const actual = tableIds(section(heading, text));
  assert.deepEqual(actual.toSorted(), [...expected].toSorted(),
    `README ${heading} must explain every current entry exactly once`);
}

// The detailed reference was once replaced by brief prose and links. Check
// source vocabulary coverage, not a line count or an exact prose snapshot.
test("README explains every task lifecycle state", () => {
  assertVocabulary("What the host owns", TASK_STATES);
});

test("README covers static and selection-compiled workflows", () => {
  assertVocabulary("Workflows, routes and budget", [...WORKFLOW_IDS, ...COMPILED_WORKFLOW_IDS]);
});

test("README explains every postcondition gate", () => {
  assertVocabulary("Gates and protected content", GATE_IDS);
});

test("README owner-act reference agrees with both guards' canonical list", () => {
  assertVocabulary("Owner acts", OWNER_ACT_LIST.map(ownerActName));
});

function checkVisualReference(text: string): void {
  const examples = [...section("Visual references", text).matchAll(/^```yaml\n([\s\S]*?)^```/gmu)];
  assert.equal(examples.length, 1, "retain one complete binding example");
  const binding = parseVisualBinding(examples[0]![1]!);
  assert.deepEqual(binding.selection, { frames: ["main-screen", "detail-screen"] });
  assert.deepEqual(binding.phases, ["builder"]);
  // Parsing proves the example's shape, not that its placeholder files exist
  // or that the referenced images satisfy admission and delivery checks.
}

function checkLocalLinks(text: string): void {
  const local = [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/gu)]
    .map(match => match[1]!)
    .filter(target => !target.startsWith("https://") && !target.startsWith("#"));
  assert.ok(local.length > 0, "the reference must link to its sources");
  const missing = local.filter(target => !existsSync(join(ROOT, decodeURIComponent(target.split("#")[0]!))));
  assert.deepEqual(missing, []);
}

test("README visual-reference example parses as a real binding", () => {
  checkVisualReference(README);
});

test("README local documentation and source links resolve", () => {
  checkLocalLinks(README);
});

test("README reference checks refuse planted omissions, a broken example and a dead link", () => {
  const heading = "What the host owns";
  const table = section(heading);
  const withoutFirstRow = README.replace(table, table.replace(/^\| `[^`]+` \|[^\n]*\n/mu, ""));
  assert.throws(() => assertVocabulary(heading, TASK_STATES, withoutFirstRow), /every current entry/u);
  assert.throws(() => assertVocabulary(heading, TASK_STATES, ""), /must retain/u);
  assert.throws(() => checkVisualReference("## Visual references\nNo binding here.\n"), /one complete binding/u);
  assert.throws(() => checkLocalLinks(`${README}\n[Planted](missing-readme-target.md)\n`), /missing-readme-target/u);
  assert.throws(() => checkLocalLinks(""), /link to its sources/u);
});
