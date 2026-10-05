import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { OWNER_ACTS } from "../../../../docs/driving/marimba/marimba-guard-rules.mts";
import {
  OWNER_ACT_ROWS, OWNER_ACT_SPELLINGS, invocationPrefixes, shellFenceLines,
  spellingForPrefix, uncoveredPrefixes,
} from "./_owner-act-spellings.ts";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

function assertCovered(lines: readonly string[]): void {
  assert.deepEqual(uncoveredPrefixes(lines), [], "documented launcher has no owner-act matrix spelling");
}

test("owner-act matrix is the full imported acts × seven decided spellings product", () => {
  assert.equal(OWNER_ACT_SPELLINGS.length, 7);
  assert.equal(OWNER_ACT_ROWS.length, OWNER_ACTS.length * 7);
  assert.equal(new Set(OWNER_ACT_ROWS.map((row) => row.label)).size, OWNER_ACT_ROWS.length);
  for (const act of OWNER_ACTS) {
    assert.deepEqual(OWNER_ACT_ROWS.filter((row) => row.act === act).map((row) => row.spelling),
      OWNER_ACT_SPELLINGS.map((spelling) => spelling.id));
  }
  for (const row of OWNER_ACT_ROWS) {
    const prefixes = invocationPrefixes(row.command);
    assert.equal(prefixes.length, 1, row.label);
    assert.equal(spellingForPrefix(prefixes[0]!), row.spelling, row.label);
  }
});

test("README and every docs shell fence use only matrix-covered invocation prefixes", () => {
  const root = repoRoot();
  const docs = walkFiles(join(root, "docs"), [".md", ".html", ".txt"]);
  assert.ok(docs.length > 0, "the document sweep must not be vacuous");
  const files = [join(root, "README.md"), ...docs];
  const offenders: string[] = [];
  let invocations = 0;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const lines = shellFenceLines(source);
    // README's inline command references are claims too, as in doc-reconciliation.
    if (file === files[0]) lines.push(...[...source.matchAll(/`([^`\n]+)`/gu)].map((match) => match[1]!));
    invocations += lines.flatMap(invocationPrefixes).length;
    offenders.push(...uncoveredPrefixes(lines).map((prefix) => `${relRepo(file)}: ${prefix}`));
  }
  assert.ok(invocations > 0, "the scanner must read actual documented invocations");
  assert.deepEqual(offenders, []);
});

test("document coverage rejects planted new launchers instead of accepting their awsf suffix", () => {
  for (const line of ["yarn awsf land T01", "npm exec awsf -- land T01",
    "npm run --quiet awsf -- land T01", "node --import tsx core/src/cli/main.ts land T01"]) {
    const fixture = `Prose alone: \`awsf invented\`.\n\n\`\`\`bash\n$ ${line}\n\`\`\`\n`;
    assert.equal(uncoveredPrefixes(shellFenceLines(fixture)).length, 1, line);
    assert.throws(() => assertCovered(shellFenceLines(fixture)), /no owner-act matrix spelling/u);
  }
});

test("the document scanner covers console and HTML fences, prefix directories, and ignores comments/prose", () => {
  const specimen = [
    "Prose: `yarn awsf land T01` is not a shell claim.",
    "```console", "# yarn awsf land T01", "$ npm --prefix '../fixture project' run awsf -- land T01", "```",
    "```json", '{ "note": "yarn awsf land T01" }', "```",
    "<pre><code>npm run awsf --silent -- land TASK &amp;&amp; just awsf status TASK</code></pre>",
  ].join("\n");
  const lines = shellFenceLines(specimen);
  assert.deepEqual(lines, ["npm --prefix '../fixture project' run awsf -- land T01",
    "npm run awsf --silent -- land TASK && just awsf status TASK"]);
  assert.equal(lines.flatMap(invocationPrefixes).length, 3);
  assertCovered(lines);
});
