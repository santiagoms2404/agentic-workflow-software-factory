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

function section(heading: string): string {
  const marker = `## ${heading}\n`;
  const start = README.indexOf(marker);
  assert.notEqual(start, -1, `README must retain its ${heading} reference`);
  const contentStart = start + marker.length;
  const end = README.indexOf("\n## ", contentStart);
  return README.slice(contentStart, end === -1 ? undefined : end);
}

function tableIds(text: string): string[] {
  return [...text.matchAll(/^\| `([^`]+)` \|/gmu)].map(match => match[1]!);
}

function assertVocabulary(heading: string, expected: readonly string[]): void {
  const actual = tableIds(section(heading));
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

test("README visual-reference example parses as a real binding", () => {
  const examples = [...section("Visual references").matchAll(/^```yaml\n([\s\S]*?)^```/gmu)];
  assert.equal(examples.length, 1, "retain one complete binding example");
  const binding = parseVisualBinding(examples[0]![1]!);
  assert.deepEqual(binding.selection, { frames: ["main-screen", "detail-screen"] });
  assert.deepEqual(binding.phases, ["builder"]);
  // Parsing proves the example's shape, not that its placeholder files exist
  // or that the referenced images satisfy admission and delivery checks.
});

test("README local documentation and source links resolve", () => {
  const local = [...README.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/gu)]
    .map(match => match[1]!)
    .filter(target => !target.startsWith("https://") && !target.startsWith("#"));
  assert.ok(local.length > 0, "the reference must link to its sources");
  const missing = local.filter(target => !existsSync(join(ROOT, decodeURIComponent(target.split("#")[0]!))));
  assert.deepEqual(missing, []);
});
