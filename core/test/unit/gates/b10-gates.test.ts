import assert from "node:assert/strict";
import { test } from "node:test";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import type { ReviewContext } from "../../../src/contracts/review-context.ts";
import type { ReviewOutput } from "../../../src/contracts/review-output.ts";
import {
  DEFAULT_EVIDENCE_BUDGET,
  boundCommandOutput,
  renderBoundedEvidence,
} from "../../../src/gates/command-evidence.ts";
import { diffRemovesLines } from "../../../src/gates/review-diff.ts";
import { verdictConsistent } from "../../../src/gates/review.ts";
import { validReviewContext, validReviewOutput } from "../contracts/fixtures.ts";

// ---------------------------------------------------------------------------
// B10-09: failureWindow non-overlapping head and tail bounds
// ---------------------------------------------------------------------------

test("B10-09: failure at start of output does not duplicate characters into head window", () => {
  // Line 1 is failure marker followed by large block of output
  const output = [
    "not ok 1 - failure right at start",
    "  error: expected true but got false",
    ...Array.from({ length: 300 }, (_, index) => `ok ${index + 2} - passing assertions with plenty of trailing filler text`),
    "# tests 301",
    "# pass 300",
    "# fail 1",
  ].join("\n");

  const evidence = boundCommandOutput(output, { budget: 1000 });
  assert.equal(evidence.complete, false);
  // Head is clipped from text strictly before the failure window start.
  // Because the failure is on line 1, textBefore is empty, so head must be empty.
  assert.equal(evidence.head, "", "head must not duplicate failure window content");
  assert.ok(evidence.failure.includes("not ok 1"));
  assert.ok(evidence.tail.includes("# fail 1"));

  // Exact character accounting: kept characters must be disjoint subsegments
  const kept = evidence.head.length + evidence.failure.length + evidence.tail.length;
  assert.equal(evidence.omittedChars, evidence.totalChars - kept, "omitted count must be exact");
});

test("B10-09: failure near end of output does not duplicate characters into tail window", () => {
  const output = [
    ...Array.from({ length: 300 }, (_, index) => `ok ${index + 1} - passing assertions with plenty of leading filler text`),
    "not ok 301 - failure at the very end",
    "  error: trailing failure",
    "# tests 301",
    "# pass 300",
    "# fail 1",
  ].join("\n");

  const evidence = boundCommandOutput(output, { budget: 1000 });
  assert.equal(evidence.complete, false);
  assert.ok(evidence.failure.includes("not ok 301"));
  assert.ok(evidence.head.length > 0);

  // Exact accounting without duplicated characters
  const kept = evidence.head.length + evidence.failure.length + evidence.tail.length;
  assert.equal(evidence.omittedChars, evidence.totalChars - kept, "omitted count must be exact");
});

test("B10-09: probe reproduction: 4517-character output with line 1 failure computes exact omission", () => {
  const line1 = "not ok 1 - test failed immediately";
  const line2 = "x".repeat(1500);
  const filler = Array.from({ length: 150 }, (_, i) => `ok ${i + 2} - passing test padding`).join("\n");
  const raw = `${line1}\n${line2}\n${filler}`;
  const totalChars = raw.length;

  const bounded = boundCommandOutput(raw, { budget: 2000 });
  const kept = bounded.head.length + bounded.failure.length + bounded.tail.length;
  assert.equal(bounded.omittedChars, totalChars - kept, "omittedChars must equal total minus kept");
  assert.equal(bounded.head, "");
});

// ---------------------------------------------------------------------------
// B10-10: diffRemovesLines inside hunk recognizes '--' removed lines
// ---------------------------------------------------------------------------

test("B10-10: diffRemovesLines recognizes removed SQL comment ('--- comment')", () => {
  const sqlDiff = [
    "diff --git a/schema.sql b/schema.sql",
    "--- a/schema.sql",
    "+++ b/schema.sql",
    "@@ -1,3 +1,2 @@",
    " CREATE TABLE users (id int);",
    "--- drop legacy index comment",
    " CREATE INDEX idx_users ON users(id);",
  ].join("\n");

  assert.equal(diffRemovesLines(sqlDiff), true);
});

test("B10-10: diffRemovesLines recognizes removed CSS custom property ('----var')", () => {
  const cssDiff = [
    "diff --git a/styles.css b/styles.css",
    "--- a/styles.css",
    "+++ b/styles.css",
    "@@ -10,3 +10,2 @@",
    " :root {",
    "----primary-color: #fff;",
    " }",
  ].join("\n");

  assert.equal(diffRemovesLines(cssDiff), true);
});

test("B10-10: diffRemovesLines returns false for addition-only diff even with '---' header", () => {
  const addOnly = [
    "diff --git a/query.sql b/query.sql",
    "--- a/query.sql",
    "+++ b/query.sql",
    "@@ -1,2 +1,3 @@",
    " SELECT 1;",
    "+-- new comment added",
    " SELECT 2;",
  ].join("\n");

  assert.equal(diffRemovesLines(addOnly), false);
});

test("B10-10: multi-file diff tracks hunk state across files", () => {
  const multiDiff = [
    "diff --git a/add.sql b/add.sql",
    "--- a/add.sql",
    "+++ b/add.sql",
    "@@ -1,1 +1,2 @@",
    " SELECT 1;",
    "+SELECT 2;",
    "diff --git a/remove.sql b/remove.sql",
    "--- a/remove.sql",
    "+++ b/remove.sql",
    "@@ -1,2 +1,1 @@",
    "--- obsolete sql comment",
    " SELECT 3;",
  ].join("\n");

  assert.equal(diffRemovesLines(multiDiff), true);
});

// ---------------------------------------------------------------------------
// B10-11 & B10-12: observedDeliveredReads requires tool.completed ok and no partial bounds
// ---------------------------------------------------------------------------

function makeReviewSetup() {
  const context: ReviewContext = {
    ...validReviewContext(),
    diffTruncated: true,
    diffOmittedChars: 200,
    diffOmittedFiles: ["omitted.ts"],
    limitationRequiredFiles: ["omitted.ts"],
    diffDelivery: {
      directory: "/private/inputs/run",
      indexFile: "index.json",
      indexSha256: "d".repeat(64),
      files: [
        { path: "omitted.ts", file: "000001.diff", bytes: 100, inlineOmitted: true, inlineTruncated: false },
      ],
    },
  };

  const output: ReviewOutput = {
    ...validReviewOutput(),
    verdict: "accept",
    findings: [],
    limitations: [],
  };

  const runId = "review-run";

  const gate = (events: readonly NormalizedEvent[]) =>
    verdictConsistent(output, {
      candidateSha: output.reviewedSha,
      candidatePaths: context.changedFiles,
      reviewContext: context,
      runId,
      observedEvents: events,
    });

  return { context, output, runId, gate };
}

test("B10-11: completed ok read discharges limitation", () => {
  const { gate, runId } = makeReviewSetup();
  const events: NormalizedEvent[] = [
    {
      kind: "tool.requested",
      runId,
      seq: 1,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      name: "Read",
      inputSummary: JSON.stringify({ file_path: "/private/inputs/run/000001.diff" }),
    },
    {
      kind: "tool.completed",
      runId,
      seq: 2,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      outcome: "ok",
      durationMs: 50,
      resultSnippet: "diff content",
    },
  ];

  const report = gate(events);
  assert.equal(report.passed, true);
});

test("B10-11: read that failed with error does not discharge limitation", () => {
  const { gate, runId } = makeReviewSetup();
  const events: NormalizedEvent[] = [
    {
      kind: "tool.requested",
      runId,
      seq: 1,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      name: "Read",
      inputSummary: JSON.stringify({ file_path: "/private/inputs/run/000001.diff" }),
    },
    {
      kind: "tool.completed",
      runId,
      seq: 2,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      outcome: "error",
      durationMs: 50,
      resultSnippet: "EACCES: permission denied",
    },
  ];

  const report = gate(events);
  assert.equal(report.passed, false, "error outcome must not discharge delivered read");
});

test("B10-11: read that was cancelled does not discharge limitation", () => {
  const { gate, runId } = makeReviewSetup();
  const events: NormalizedEvent[] = [
    {
      kind: "tool.requested",
      runId,
      seq: 1,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      name: "Read",
      inputSummary: JSON.stringify({ file_path: "/private/inputs/run/000001.diff" }),
    },
    {
      kind: "tool.completed",
      runId,
      seq: 2,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      outcome: "cancelled",
      durationMs: 50,
      resultSnippet: "cancelled",
    },
  ];

  const report = gate(events);
  assert.equal(report.passed, false, "cancelled outcome must not discharge delivered read");
});

test("B10-11: read requested but never settled (no tool.completed) does not discharge limitation", () => {
  const { gate, runId } = makeReviewSetup();
  const events: NormalizedEvent[] = [
    {
      kind: "tool.requested",
      runId,
      seq: 1,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      name: "Read",
      inputSummary: JSON.stringify({ file_path: "/private/inputs/run/000001.diff" }),
    },
  ];

  const report = gate(events);
  assert.equal(report.passed, false, "unsettled read must not discharge delivered read");
});

test("B10-12: read with limit does not discharge limitation", () => {
  const { gate, runId } = makeReviewSetup();
  const events: NormalizedEvent[] = [
    {
      kind: "tool.requested",
      runId,
      seq: 1,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      name: "Read",
      inputSummary: JSON.stringify({ file_path: "/private/inputs/run/000001.diff", limit: 40 }),
    },
    {
      kind: "tool.completed",
      runId,
      seq: 2,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      outcome: "ok",
      durationMs: 50,
      resultSnippet: "diff content",
    },
  ];

  const report = gate(events);
  assert.equal(report.passed, false, "read with limit must not discharge delivered read");
});

test("B10-12: read with offset does not discharge limitation", () => {
  const { gate, runId } = makeReviewSetup();
  const events: NormalizedEvent[] = [
    {
      kind: "tool.requested",
      runId,
      seq: 1,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      name: "Read",
      inputSummary: JSON.stringify({ file_path: "/private/inputs/run/000001.diff", offset: 10 }),
    },
    {
      kind: "tool.completed",
      runId,
      seq: 2,
      hostAt: "now",
      providerAt: null,
      toolCallId: "t1",
      outcome: "ok",
      durationMs: 50,
      resultSnippet: "diff content",
    },
  ];

  const report = gate(events);
  assert.equal(report.passed, false, "read with offset must not discharge delivered read");
});

// ---------------------------------------------------------------------------
// B10-42: renderBoundedEvidence keeps failure diagnostics under outputTail ceiling
// ---------------------------------------------------------------------------

test("B10-42: renderBoundedEvidence preserves failing gate header and failure under ceiling", () => {
  const earlyFailureSection = [
    "### test_gate (exit 1)",
    "--- output head ---",
    "Running test suite...",
    "--- first failure (line 3) ---",
    "not ok 3 - critical invariant broken",
    "  AssertionError: expected true but got false",
    "--- output tail ---",
    "# tests 100",
    "# pass 99",
    "# fail 1",
  ].join("\n");

  const longPassingSection = [
    "### lint_gate (exit 0)",
    ...Array.from({ length: 150 }, (_, i) => `ok ${i + 1} - rule ${i + 1} passed cleanly without issues`),
  ].join("\n");

  const joined = `${earlyFailureSection}\n\n${longPassingSection}`;
  assert.ok(joined.length > DEFAULT_EVIDENCE_BUDGET);

  // safeTail (simple slice(-4000)) would drop earlyFailureSection completely
  const trailingOnly = joined.slice(-DEFAULT_EVIDENCE_BUDGET);
  assert.equal(trailingOnly.includes("not ok 3"), false);

  // renderBoundedEvidence keeps the failure line and stays within ceiling
  const bounded = renderBoundedEvidence(joined, DEFAULT_EVIDENCE_BUDGET);
  assert.ok(bounded.length <= DEFAULT_EVIDENCE_BUDGET);
  assert.ok(bounded.includes("not ok 3"), "failing diagnostic must be preserved");
});
