import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANDING_SUMMARY_FILE, LANDING_SUMMARY_SECTIONS, readLandingSummary, writeLandingSummary, type LandingSummary } from "../../../src/persistence/landing-summary.ts";

const summary: LandingSummary = {
  problem: "Fix the parser.\n## Changes\nThe request also asks for a list of changes.",
  changes: "- Added the actual change",
  verification: "- Deterministic gates passed",
  risks: "- Risk tier T2",
};

test("B4-19: a request heading stays in Problem instead of becoming Changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awsf-b4-19-"));
  try {
    await writeLandingSummary(dir, summary);
    assert.deepEqual(await readLandingSummary(dir), summary);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const field of ["problem", "changes", "verification", "risks"] as const) {
  test(`B4-19: ${field} preserves repeated headings, code fences, and literal escapes`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "awsf-b4-19-"));
    try {
      const text = ["Request café 🦋", ...LANDING_SUMMARY_SECTIONS.map(heading => `## ${heading}`),
        "```markdown", "## Changes", "```", "~~~", "## Verification", "~~~",
        "\\## Changes", "\\\\## Risks", "\\literal", "inline ## Changes", "### Changes", "## Other", "tail"].join("\n");
      const expected = { ...summary, [field]: text };
      await writeLandingSummary(dir, expected);
      assert.deepEqual(await readLandingSummary(dir), expected);
      const source = await readFile(join(dir, LANDING_SUMMARY_FILE), "utf8");
      assert.deepEqual(source.split("\n").filter(line => LANDING_SUMMARY_SECTIONS.some(heading => line === `## ${heading}`)),
        LANDING_SUMMARY_SECTIONS.map(heading => `## ${heading}`), "only the four structural headings remain unescaped");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

const legacy = "# Landing Summary\n\n## Problem\nLegacy request\n\\## Changes\ninline ## Verification\n\n## Changes\nActual changes\n\n## Verification\nPassed\n\n## Risks\nNone\n";

test("B4-19: an unambiguous legacy summary preserves literal escapes and inline heading text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awsf-b4-19-"));
  try {
    await writeFile(join(dir, LANDING_SUMMARY_FILE), legacy);
    assert.deepEqual(await readLandingSummary(dir), {
      problem: "Legacy request\n\\## Changes\ninline ## Verification", changes: "Actual changes", verification: "Passed", risks: "None",
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const [name, source] of [
  ["duplicate legacy heading", legacy.replace("Legacy request", "Legacy request\n## Changes\ninjected")],
  ["legacy heading inside a fence", legacy.replace("Legacy request", "```\n## Changes\n```")],
  ["reordered sections", legacy.replace("## Problem\n", "## Risks\n").replace("## Risks\nNone", "## Problem\nNone")],
  ["empty body", legacy.replace("Actual changes", "")],
  ["missing section", legacy.replace("## Verification\nPassed\n", "")],
] as const) {
  test(`B4-19: ${name} is absent rather than misattributed`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "awsf-b4-19-"));
    try {
      await writeFile(join(dir, LANDING_SUMMARY_FILE), source);
      assert.equal(await readLandingSummary(dir), null);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
