import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateHygiene } from "../../../src/gates/candidate-hygiene.ts";

const BASE = "a".repeat(40);
const CANDIDATE = "b".repeat(40);

test("candidate_hygiene records the exact range, clean tree, zero exit, and bounded evidence", () => {
  const report = candidateHygiene({
    expectedBaseSha: BASE,
    observedBaseSha: BASE,
    expectedCandidateSha: CANDIDATE,
    headBefore: CANDIDATE,
    headAfter: CANDIDATE,
    cleanBefore: true,
    cleanAfter: true,
    exitCode: 0,
    output: "",
  });
  assert.equal(report.gateId, "candidate_hygiene");
  assert.equal(report.passed, true);
  assert.ok(report.checks.every((check) => check.note.length <= 4_000));
  assert.ok(report.checks.some((check) => check.note.includes(`${BASE}..${CANDIDATE}`)));
});

test("candidate_hygiene rejects Markdown end-of-line spaces without changing candidate evidence", () => {
  const finding = "core/src/generated.md:1: trailing whitespace.\n+intentional Markdown break  ";
  const report = candidateHygiene({
    expectedBaseSha: BASE,
    observedBaseSha: BASE,
    expectedCandidateSha: CANDIDATE,
    headBefore: CANDIDATE,
    headAfter: CANDIDATE,
    cleanBefore: true,
    cleanAfter: true,
    exitCode: 2,
    output: `${finding}${"x".repeat(8_000)}`,
  });
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((check) => check.item === "git diff --check")?.ok, false);
  assert.match(report.checks.find((check) => check.item === "git diff --check")?.note ?? "", /generated\.md:1: trailing whitespace/);
  assert.ok(report.checks.every((check) => check.note.length <= 4_000));
  assert.equal(report.checks.find((check) => check.item === "candidate HEAD before")?.ok, true);
  assert.equal(report.checks.find((check) => check.item === "candidate HEAD after")?.ok, true);
});
