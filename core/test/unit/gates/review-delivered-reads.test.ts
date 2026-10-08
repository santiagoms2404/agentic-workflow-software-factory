import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewOutput } from "../../../src/contracts/review-output.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import { verdictConsistent } from "../../../src/gates/review.ts";
import { validReviewContext, validReviewOutput } from "../contracts/fixtures.ts";

const context = { ...validReviewContext(), diffTruncated: true, diffOmittedChars: 100,
  diffOmittedFiles: ["omitted.ts"], limitationRequiredFiles: ["omitted.ts", "partial.ts"],
  diffDelivery: { directory: "/private/inputs/run", indexFile: "index.json", indexSha256: "d".repeat(64), files: [
    { path: "omitted.ts", file: "000001.diff", bytes: 90, inlineOmitted: true, inlineTruncated: false },
    { path: "partial.ts", file: "000002.diff", bytes: 110, inlineOmitted: false, inlineTruncated: true },
  ] },
};
const output: ReviewOutput = { ...validReviewOutput(), verdict: "accept", findings: [], limitations: [] };
function read(file: string, patch: Partial<Extract<NormalizedEvent, { kind: "tool.requested" }>> = {}): NormalizedEvent {
  return { kind: "tool.requested", runId: "review-run", seq: 1, hostAt: "now", providerAt: null,
    toolCallId: "t1", name: "Read", inputSummary: JSON.stringify({ file_path: `/private/inputs/run/${file}` }), ...patch };
}
function gate(events: readonly NormalizedEvent[], review = output) {
  return verdictConsistent(review, { candidateSha: output.reviewedSha, candidatePaths: context.changedFiles,
    reviewContext: context, runId: "review-run", observedEvents: events });
}

test("only own-run host-observed Read requests discharge omitted and partial path limitations", () => {
  assert.equal(gate([read("000001.diff"), read("000002.diff", { name: "read", inputSummary: JSON.stringify({ path: "/private/inputs/run/000002.diff" }) })]).passed, true);
  assert.equal(gate([read("000001.diff")]).passed, false, "partial path still needs a limitation");
  assert.equal(gate([read("000001.diff")], { ...output, limitations: [{ detail: "partial unread", affectedFiles: ["partial.ts"] }] }).passed, true);
});

test("unobserved delivery keeps the exact named-limitation rule", () => {
  assert.equal(gate([]).passed, false);
  assert.equal(gate([], { ...output, limitations: [{ detail: "not read", affectedFiles: ["omitted.ts", "partial.ts"] }] }).passed, true);
  assert.equal(gate([], { ...output, limitations: [{ detail: "bounded", affectedFiles: [] }] }).passed, false);
});

test("claimed reads without observed reads never satisfy the gate", () => {
  const claim = "I read /private/inputs/run/000001.diff and /private/inputs/run/000002.diff in full.";
  assert.equal(gate([], { ...output, summary: claim, notesForNextPhase: claim }).passed, false);
  assert.equal(gate([{ kind: "text.delta", runId: "review-run", seq: 1, hostAt: "now", providerAt: null, text: claim }]).passed, false);
});

test("other runs, grep/glob, index reads, and prefix matches are not observed delivered reads", () => {
  for (const events of [
    [read("000001.diff", { runId: "other-run" }), read("000002.diff", { runId: "other-run" })],
    [read("000001.diff", { name: "Grep" }), read("000002.diff", { name: "Glob" })],
    [read("index.json")],
    [read("000001.diff.extra"), read("000002.diff.extra")],
  ]) assert.equal(gate(events).passed, false);
});

test("inline markers remain independent evidence, and delivered paths preserve embedded newlines", () => {
  const report = (candidate: typeof context, events: readonly NormalizedEvent[]) => verdictConsistent(output, {
    candidateSha: output.reviewedSha, candidatePaths: candidate.changedFiles, reviewContext: candidate,
    runId: "review-run", observedEvents: events,
  });
  const inconsistent = { ...context, diffOmittedFiles: [], limitationRequiredFiles: [],
    diff: "*** awsf: 1 of 2 hunk(s) omitted from omitted.ts\n", diffDelivery: { ...context.diffDelivery,
      files: context.diffDelivery.files.map(file => ({ ...file, inlineOmitted: false, inlineTruncated: false })) } };
  assert.equal(report(inconsistent, []).passed, false);
  assert.equal(report(inconsistent, [read("000001.diff")]).passed, true);
  const unusual = { ...context, diffOmittedFiles: [], limitationRequiredFiles: ["newline\nfile.ts"],
    diff: "*** awsf: 1 of 2 hunk(s) omitted from newline\nfile.ts\n", diffDelivery: { ...context.diffDelivery,
      files: [{ ...context.diffDelivery.files[0]!, path: "newline\nfile.ts", inlineOmitted: false, inlineTruncated: true }] } };
  assert.equal(report(unusual, []).passed, false);
  assert.equal(report(unusual, [read("000001.diff")]).passed, true, "no spurious newline-prefix path needs a limitation");
});
