import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { reviewDeliveryFixture } from "../../fixtures/review-diff-delivery.ts";
import { sha256 } from "../../../src/workflow/review-evidence.ts";
import { deliverReviewDiff, redeliverReviewDiff, reviewDiffPrompt } from "../../../src/workflow/review-diff-delivery.ts";
import { boundReviewDiff } from "../../../src/gates/review-diff.ts";
import { reviewEvidenceFitness } from "../../../src/gates/review.ts";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { validReviewContext } from "../contracts/fixtures.ts";

test("full per-path delivery reproduces the retained diff byte for byte, including unusual literal paths and binary headers", async () => {
  const world = await reviewDeliveryFixture();
  try {
    const context = world.composed.context;
    assert.equal(context.diffTruncated, true);
    assert.ok(context.diffOmittedFiles.includes("huge.ts"));
    assert.ok(context.limitationRequiredFiles.includes("partial.ts"));
    const delivery = context.diffDelivery!;
    const bytes = await Promise.all(delivery.files.map(file => readFile(join(delivery.directory, file.file))));
    assert.deepEqual(Buffer.concat(bytes), Buffer.from(world.retained));
    for (const [i, file] of delivery.files.entries()) {
      assert.equal(file.bytes, bytes[i]!.length);
      assert.equal((await stat(join(delivery.directory, file.file))).mode & 0o777, 0o400);
    }
    const indexText = await readFile(join(delivery.directory, delivery.indexFile), "utf8");
    const index = JSON.parse(indexText);
    assert.equal(index.diffSha256, context.diffSha256);
    assert.equal(sha256(indexText), delivery.indexSha256);
    assert.deepEqual(index.files, delivery.files);
    assert.equal(delivery.files.find(file => file.path === "huge.ts")!.inlineOmitted, true);
    assert.equal(delivery.files.find(file => file.path === "partial.ts")!.inlineTruncated, true);
    assert.equal(JSON.stringify(context).includes(index.token), false);
    const prompt = reviewDiffPrompt(context);
    assert.ok(prompt.includes(delivery.directory));
    assert.ok(prompt.includes(join(delivery.directory, delivery.indexFile)));
    assert.ok(prompt.includes("no command may be run"));
    assert.ok(prompt.includes("every path the inline diff omitted or truncated"));
    assert.equal(prompt.includes(index.token), false);
    assert.equal(parseEnvelope(JSON.stringify(context), context.schema).valid, true);
    assert.equal(parseEnvelope(JSON.stringify(validReviewContext()), context.schema).valid, true, "old retained contexts remain valid");
    const replayed = await redeliverReviewDiff(context, world.location);
    assert.deepEqual(replayed, context, "recovery verifies without changing a retained index");
    const retry = await redeliverReviewDiff(context, { ...world.location, runId: "retry" });
    assert.notEqual(retry.diffDelivery!.directory, delivery.directory);
    assert.notEqual(retry.diffDelivery!.indexSha256, delivery.indexSha256, "a new run has a new token");
  } finally { world.cleanup(); }
});

test("even a single hunk larger than the inline cap is fit when the host proved full delivery", async () => {
  const world = await reviewDeliveryFixture(true);
  try {
    assert.equal(world.composed.context.diff, "");
    assert.deepEqual(world.composed.context.diffOmittedFiles, ["huge.ts"]);
    assert.equal(reviewEvidenceFitness(world.composed.context, world.composed.expectation).passed, true);
    assert.equal(reviewEvidenceFitness(world.composed.context, { ...world.composed.expectation, fullDiffDelivered: false }).passed, false,
      "delivery metadata alone is not host proof");
  } finally { world.cleanup(); }
});

test("delivery refuses a changed index or file, and non-reproducing sections", async () => {
  const world = await reviewDeliveryFixture();
  try {
    const context = world.composed.context;
    const index = join(context.diffDelivery!.directory, context.diffDelivery!.indexFile);
    const originalIndex = await readFile(index, "utf8");
    await chmod(index, 0o600);
    await writeFile(index, "{}\n");
    await assert.rejects(redeliverReviewDiff(context, world.location), /retained delivery index changed/);
    await writeFile(index, originalIndex);
    await assert.rejects(deliverReviewDiff({ ...world.location, runId: "bad-sections" }, "whole", [{ path: "a.ts", text: "part" }], [], []), /does not reproduce/);
    const path = join(context.diffDelivery!.directory, context.diffDelivery!.files[0]!.file);
    await chmod(path, 0o600); await writeFile(path, "changed");
    await assert.rejects(redeliverReviewDiff(context, { ...world.location, runId: "retry" }), /retained delivered diff changed/);
  } finally { world.cleanup(); }
});

test("partial status preserves exact paths with newline bytes rather than parsing marker prose", () => {
  const path = "newline\nfile.ts";
  const text = `diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n@@ -99 +99 @@\n+${"x".repeat(500)}\n`;
  const bounded = boundReviewDiff([{ path, text }], 200);
  assert.deepEqual(bounded.partialFiles, [path]);
  assert.deepEqual(bounded.omittedFiles, []);
});

test("input delivery refuses overlap with either checkout or the whole state root", async () => {
  const world = await reviewDeliveryFixture();
  try {
    const text = "diff";
    for (const attemptDir of [world.location.worktree, world.location.repository]) {
      await assert.rejects(deliverReviewDiff({ ...world.location, attemptDir }, text, [{ path: "a.ts", text }], [], []), /overlaps a checkout/);
    }
    const context = world.composed.context;
    await assert.rejects(redeliverReviewDiff(context, { ...world.location, stateRoot: context.diffDelivery!.directory }), /whole state root/);
  } finally { world.cleanup(); }
});
