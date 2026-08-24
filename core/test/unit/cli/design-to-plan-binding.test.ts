import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  composeProductionPlanContext,
  renderProductionPlanIntoWorktree,
} from "../../../src/cli/commands/production-run.ts";
import { transition } from "../../../src/state/task-machine.ts";
import {
  validArchitectureReviewOutput,
  validDesignOutput,
  validDesignPlanOutput,
  validPlanContext,
} from "../contracts/fixtures.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function repository(root: string): string {
  const path = join(root, "repository");
  mkdirSync(path, { recursive: true });
  execFileSync("git", ["init", "-b", "main", path], { stdio: "ignore" });
  writeFileSync(join(path, "README.md"), "seed\n");
  git(path, "add", "README.md");
  git(
    path,
    "-c", "user.name=Santiago Marin",
    "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-m", "test: seed repository",
  );
  return path;
}

const budget = {
  attempt: 1,
  callsSpent: 2,
  callsReserved: 0,
  correctionsAuto: 0,
  correctionsOwner: 0,
  ownerReentries: 0,
  allowance: { auto: 1, owner: 1, ownerReentries: 1 },
  ceiling: 3,
} as const;

test("plan-context carries the stored design spine only after the stored review clears", () => {
  const design = validDesignOutput();
  const review = validArchitectureReviewOutput();
  const composed = composeProductionPlanContext(design, review);

  assert.equal(composed.report.gateId, "architecture_review_clear");
  assert.equal(composed.report.passed, true);
  assert.notEqual(composed.context, null);
  assert.deepEqual(composed.context?.identifierSet, {
    invariants: design.invariants,
    acceptanceCriteria: design.acceptanceCriteria,
  });
  assert.deepEqual(composed.context?.nonBlockingFindings, review.findings);
});

test("a blocking architecture review produces no plan context and uses existing L8", () => {
  const review = validArchitectureReviewOutput();
  const blockedReview = {
    ...review,
    verdict: "concern" as const,
    findings: review.findings.map((finding) => ({ ...finding, severity: "high" as const })),
  };
  const composed = composeProductionPlanContext(validDesignOutput(), blockedReview);

  assert.equal(composed.context, null);
  assert.equal(composed.report.passed, false);
  assert.equal(composed.report.checks.find((check) => check.item === "no blocking findings")?.ok, false);
  assert.equal(transition({
    from: "RUNNING",
    to: "BLOCKED",
    actor: "host",
    tier: 1,
    reason: { source: "process", code: "phase-abort", detail: "architecture_review_clear failed" },
    interactive: false,
    budget,
  }).edge, "L8");
});

test("plan-render writes only inside the managed worktree and gates the committed diff", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-plan-render-binding-"));
  const worktree = repository(root);
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "unchanged\n");
  try {
    const base = git(worktree, "rev-parse", "HEAD");
    const result = await renderProductionPlanIntoWorktree({
      worktree,
      stem: "generated-plan",
      plan: validDesignPlanOutput(),
      identifierSet: validPlanContext().identifierSet,
      protectedPaths: ["awsf.config.yaml", "core/src/state/**"],
    });

    assert.notEqual(result.candidateSha, null);
    assert.equal(git(worktree, "status", "--porcelain"), "");
    const committedPaths = git(worktree, "diff", "--name-only", `${base}..${result.candidateSha!}`, "--")
      .split("\n")
      .filter(Boolean)
      .sort();
    assert.deepEqual(result.output.changedFiles, committedPaths);
    assert.deepEqual(result.reports.map((report) => [report.gateId, report.passed]), [
      ["no_protected_paths", true],
      ["diff_matches_claims", true],
    ]);
    assert.ok(result.output.changedFiles.includes("specs/generated-plan.html"));
    assert.ok(result.output.changedFiles.includes("specs/generated-plan-build-prompts.md"));
    assert.ok(result.output.changedFiles.includes("specs/tickets/generated-plan/README.md"));
    assert.ok(result.output.changedFiles.includes("specs/tickets/generated-plan/T01.md"));
    assert.equal(readFileSync(outside, "utf8"), "unchanged\n");
    assert.equal(existsSync(join(root, "specs", "generated-plan.html")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plan-render refuses a symlink that redirects a rendered parent outside the worktree", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-plan-render-symlink-"));
  const worktree = repository(root);
  const outside = join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(worktree, "specs"), "dir");
  git(worktree, "add", "specs");
  git(
    worktree,
    "-c", "user.name=Santiago Marin",
    "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-m", "test: seed redirected specs path",
  );
  try {
    await assert.rejects(
      renderProductionPlanIntoWorktree({
        worktree,
        stem: "escaped-plan",
        plan: validDesignPlanOutput(),
        identifierSet: validPlanContext().identifierSet,
        protectedPaths: [],
      }),
      /rendered plan parent is not a managed directory/u,
    );
    assert.equal(existsSync(join(outside, "escaped-plan.html")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plan-render refuses a protected rendered path before creating a commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-plan-render-protected-"));
  const worktree = repository(root);
  try {
    const base = git(worktree, "rev-parse", "HEAD");
    const result = await renderProductionPlanIntoWorktree({
      worktree,
      stem: "protected-plan",
      plan: validDesignPlanOutput(),
      identifierSet: validPlanContext().identifierSet,
      protectedPaths: ["specs/**"],
    });

    assert.equal(result.candidateSha, null);
    assert.equal(result.reports[0]?.gateId, "no_protected_paths");
    assert.equal(result.reports[0]?.passed, false);
    assert.equal(git(worktree, "rev-parse", "HEAD"), base);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
