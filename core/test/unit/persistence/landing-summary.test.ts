import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LANDING_SUMMARY_FILE,
  readLandingSummary,
  writeLandingSummary,
  type LandingSummary,
} from "../../../src/persistence/landing-summary.ts";

const summary: LandingSummary = {
  problem: "Make the owner-visible change understandable.",
  changes: "feat: add one portable record\n2 files changed",
  verification: "- deterministic gates passed",
  risks: "- risk tier T2",
};

test("the landing summary round-trips all four fixed Markdown sections", async () => {
  const root = await mkdtemp(join(tmpdir(), "awsf-landing-summary-"));
  try {
    await writeLandingSummary(root, summary);
    assert.deepEqual(await readLandingSummary(root), summary);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing and malformed landing summaries are absent on the read surface", async () => {
  const root = await mkdtemp(join(tmpdir(), "awsf-landing-summary-invalid-"));
  try {
    assert.equal(await readLandingSummary(root), null);
    await writeFile(join(root, LANDING_SUMMARY_FILE), "# Landing Summary\n\n## Problem\nonly one section\n");
    assert.equal(await readLandingSummary(root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
