// What the mandatory opposite-provider reviewer is judged against, composed by
// the host from Git and from the phases that already ran.
//
// Extracted from the production runner when `awsf review` gained the right to
// buy a REPLACEMENT review. The replacement must be handed evidence composed
// exactly the way the original was, and a second copy of this code would be a
// second answer to "what did this candidate change" — which is the one question
// a review must never have two answers to. The runner and the command now share
// one answer, and `review_evidence_present` holds both to it.
//
// Everything here is host observation. Nothing is agent-claimed, and nothing
// depends on which command is asking.

import { createHash } from "node:crypto";
import { parseEnvelope } from "../contracts/parse-envelope.ts";
import {
  REVIEW_CONTEXT_DIFF_MAX_CHARS,
  REVIEW_CONTEXT_SCHEMA_ID,
  REVIEW_CONTEXT_STAT_MAX_CHARS,
  type ReviewContext,
} from "../contracts/review-context.ts";
import type { TestOutput } from "../contracts/test-output.ts";
import { runGit, systemGitRunner } from "../git/changes.ts";
import { GateReport } from "../gates/interface.ts";
import { reviewEvidenceFitness, type ReviewEvidenceExpectation } from "../gates/review.ts";
import { boundReviewDiff, diffRemovesLines, type DiffFileSection } from "../gates/review-diff.ts";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function tail(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(value.length - maximum);
}

/**
 * The paths the candidate actually changed, read from Git rather than from the
 * builder's claims — `verdict_consistent` uses this to reject a finding about a
 * file outside the change under review, so a claimed set would let a reviewer
 * and a builder agree with each other about a file neither touched. `-z` keeps
 * unusual bytes in a filename intact, and `--no-renames` makes both sides of a
 * rename explicit.
 */
export function candidatePathsBetween(worktree: string, baseSha: string, candidateSha: string): readonly string[] {
  const output = runGit(systemGitRunner(worktree), ["diff", "--name-only", "--no-renames", "-z", `${baseSha}..${candidateSha}`]);
  return Object.freeze([...new Set(output.split("\0").filter((path) => path.length > 0))].sort());
}

/**
 * The candidate's diff, read from Git once whole and once per file.
 *
 * The whole reading is the authority: it is what the digest is taken of and
 * what the host retains privately. The per-file readings are what bounding
 * selects from, and they exist because attributing a hunk to a path by parsing
 * `diff --git` headers means parsing Git's quoting rules — a path with a quote,
 * a newline, or a non-ASCII byte in it would be attributed to the wrong file or
 * to none, and `diffOmittedFiles` would then name the wrong thing. Asking Git
 * per path cannot get that wrong.
 */
function candidateDiff(
  worktree: string,
  baseSha: string,
  candidateSha: string,
  paths: readonly string[],
): { readonly whole: string; readonly sections: readonly DiffFileSection[]; readonly stat: string; readonly insertions: number; readonly deletions: number } {
  const git = systemGitRunner(worktree);
  const range = `${baseSha}..${candidateSha}`;
  const whole = runGit(git, ["diff", "--no-renames", range, "--"]);
  // A fixed width, because the default depends on the terminal and evidence
  // that changes shape with the caller's window is not evidence.
  const stat = runGit(git, ["diff", "--no-renames", "--stat=200,160", range, "--"]);
  let insertions = 0;
  let deletions = 0;
  for (const record of runGit(git, ["diff", "--numstat", "--no-renames", "-z", range, "--"]).split("\0")) {
    const fields = record.split("\t");
    if (fields.length < 3) continue;
    // Binary files report `-` for both counts; they are not zero-line changes,
    // they are unmeasurable ones, and adding them as zero would be a lie.
    insertions += Number.parseInt(fields[0] ?? "", 10) || 0;
    deletions += Number.parseInt(fields[1] ?? "", 10) || 0;
  }
  const sections = paths.map((path) => ({
    path,
    text: runGit(git, ["diff", "--no-renames", range, "--", path]),
  }));
  return { whole, sections: Object.freeze(sections), stat, insertions, deletions };
}

/** A review context that could not be evidence never reaches a provider. */
export class ReviewEvidenceUnfit extends Error {
  readonly report: GateReport;
  constructor(report: GateReport) {
    const failed = report.checks.filter((check) => !check.ok).map((check) => `${check.item}: ${check.note}`);
    super(`composed review evidence is unfit and no review call may be spent on it: ${failed.join("; ")}`);
    this.name = "ReviewEvidenceUnfit";
    this.report = report;
  }
}

/**
 * What was asked for. Without it a reviewer can judge code quality and cannot
 * judge whether the candidate is the requested change, which is the only thing
 * a T2 review is mandatory for.
 */
export interface ReviewEvidenceIntent {
  /** The owner's verbatim recorded request, never a phase's restatement of it. */
  readonly request: string;
  readonly goals: readonly string[];
  readonly nonGoals: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly testStrategy: readonly string[];
}

export interface ReviewEvidenceRequest {
  readonly worktree: string;
  readonly baseSha: string;
  readonly candidateSha: string;
  readonly intent: ReviewEvidenceIntent;
  /** The COMPLETE `TestOutput` of the last code phase, nested whole. */
  readonly testOutput: TestOutput;
  /** Attempt-relative path of the host-private full diff, mode 0600. */
  readonly diffRef: string;
  /**
   * Retains the full diff privately and returns what is on disk afterwards.
   *
   * The read-back is the point: the claim `review_evidence_present` will make is
   * about a file on disk, so the digest is taken of the file rather than of the
   * string that was meant to be written to it.
   */
  retainFullDiff(relativePath: string, diff: string): Promise<string>;
}

export interface ComposedReviewEvidence {
  readonly context: ReviewContext;
  /** What Git independently said, against which the gate judges the context. */
  readonly expectation: ReviewEvidenceExpectation;
  readonly changedFiles: readonly string[];
  readonly truncated: boolean;
  readonly omittedFiles: readonly string[];
}

/**
 * Composes the review context and proves it could be evidence, BEFORE any call
 * is spent. A context that fails either check throws `ReviewEvidenceUnfit` and
 * no provider starts.
 */
export async function composeReviewEvidence(request: ReviewEvidenceRequest): Promise<ComposedReviewEvidence> {
  const changedFiles = candidatePathsBetween(request.worktree, request.baseSha, request.candidateSha);
  const observed = candidateDiff(request.worktree, request.baseSha, request.candidateSha, changedFiles);
  const bounded = boundReviewDiff(observed.sections, REVIEW_CONTEXT_DIFF_MAX_CHARS);
  const limitationRequiredFiles = new Set(bounded.omittedFiles);
  for (const match of bounded.diff.matchAll(/^\*\*\* awsf: \d+ of \d+ hunk\(s\) omitted from (.+)$/gmu)) {
    const path = match[1]?.trim();
    if (path !== undefined && path.length > 0) limitationRequiredFiles.add(path);
  }
  const onDisk = await request.retainFullDiff(request.diffRef, observed.whole);
  const context: ReviewContext = {
    schema: REVIEW_CONTEXT_SCHEMA_ID,
    producerStatus: "success",
    summary: `Candidate ${request.candidateSha} against base ${request.baseSha}: ${String(changedFiles.length)} file(s), +${String(observed.insertions)}/-${String(observed.deletions)}`,
    artifacts: [],
    notesForNextPhase: "Judge this candidate against the recorded request. The diff below is the host's; no command may be run.",
    request: request.intent.request,
    goals: [...request.intent.goals],
    nonGoals: [...request.intent.nonGoals],
    acceptanceCriteria: [...request.intent.acceptanceCriteria],
    testStrategy: [...request.intent.testStrategy],
    baseSha: request.baseSha,
    candidateSha: request.candidateSha,
    changedFiles: [...changedFiles],
    insertions: observed.insertions,
    deletions: observed.deletions,
    stat: tail(observed.stat, REVIEW_CONTEXT_STAT_MAX_CHARS),
    diff: bounded.diff,
    diffTruncated: bounded.truncated,
    diffOmittedChars: bounded.omittedChars,
    diffOmittedFiles: [...bounded.omittedFiles],
    limitationRequiredFiles: [...limitationRequiredFiles].sort(),
    diffSha256: sha256(observed.whole),
    diffRef: request.diffRef,
    testOutput: request.testOutput,
  };
  const expectation: ReviewEvidenceExpectation = {
    baseSha: request.baseSha,
    candidateSha: request.candidateSha,
    changedFiles,
    fullDiffSha256: sha256(onDisk),
    fullDiffRemovesLines: diffRemovesLines(onDisk),
  };
  const parsed = parseEnvelope(JSON.stringify(context), REVIEW_CONTEXT_SCHEMA_ID);
  if (!parsed.valid) {
    const report = new GateReport("review_evidence_present");
    for (const violation of parsed.violations) {
      report.check(`contract ${violation.path || "(root)"}`, false, violation.message);
    }
    throw new ReviewEvidenceUnfit(report);
  }
  const fitness = reviewEvidenceFitness(context, expectation);
  if (!fitness.passed) throw new ReviewEvidenceUnfit(fitness);
  return {
    context,
    expectation,
    changedFiles,
    truncated: bounded.truncated,
    omittedFiles: bounded.omittedFiles,
  };
}
