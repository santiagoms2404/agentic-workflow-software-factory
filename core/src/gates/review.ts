import { MAX_ENVELOPE_BYTES } from "../contracts/parse-envelope.ts";
import type { ReviewContext } from "../contracts/review-context.ts";
import { BLOCKING_SEVERITIES, type ReviewFinding, type ReviewOutput } from "../contracts/review-output.ts";
import { utf8ByteLength } from "../contracts/typebox.ts";
import { GateReport } from "./interface.ts";
import { diffRemovesLines } from "./review-diff.ts";

function concrete(finding: ReviewFinding): boolean {
  return finding.file.trim().length > 0 && finding.title.trim().length > 0 && finding.detail.trim().length > 0 && finding.evidence.trim().length > 0;
}

export interface ReviewGateContext {
  readonly candidateSha: string;
  readonly candidatePaths: readonly string[];
  /** Host-composed candidate evidence. Required for the Q2 omitted-evidence rule. */
  readonly reviewContext: ReviewContext | null;
}

export interface ReviewFindingSpecificity {
  readonly candidateFile: boolean;
  readonly lineOrFileWideScope: boolean;
  readonly observedMechanismOrCondition: boolean;
  readonly concreteConsequence: boolean;
  readonly score: number;
}

const OBSERVATION_WORD = /\b(?:adds?|after|before|calls?|contains?|declares?|deletes?|equals?|false|if|invokes?|is|lacks?|missing|null|references?|removes?|returns?|sets?|throws?|true|undefined|uses?|when|while|writes?)\b/i;
const CODE_SHAPE = /[`'"()[\]{}=<>:/]|\.|->/;

export const REVIEW_FINDING_COMPLETENESS_ITEMS = Object.freeze({
  scope: "findings name a line or explicit file-wide scope",
  mechanism: "findings state an observed mechanism or condition",
  consequence: "findings state a concrete consequence",
} as const);

function terms(value: string): readonly string[] {
  return value.match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/** The decided four-point rubric, scored per finding without rewarding finding count. */
export function reviewFindingSpecificity(
  finding: ReviewFinding,
  candidatePaths: ReadonlySet<string>,
): ReviewFindingSpecificity {
  const evidenceTerms = terms(finding.evidence);
  const candidateFile = candidatePaths.has(finding.file);
  // `null` is the contract's explicit file-wide scope. It is never replaced by a fake line.
  const lineOrFileWideScope = finding.line === null || (Number.isInteger(finding.line) && finding.line > 0);
  const observedMechanismOrCondition = evidenceTerms.length >= 2 && (
    CODE_SHAPE.test(finding.evidence) || OBSERVATION_WORD.test(finding.evidence)
  );
  // Consequences are prose, not a fixed list of failure verbs. Accept the
  // prompt's explicit marker or ordinary conditional/causal grammar; both
  // distinguish an outcome from a long mechanism-only observation without
  // requiring the outcome to use one particular verb.
  const consequenceText = `${finding.title} ${finding.detail}`;
  const consequenceRelation = /\b(?:because|can(?:not)?|could|if|unless|when(?:ever)?|where|with(?:out)?|would|will|causes?|leads?|results?|therefore|so)\b/iu;
  const concreteConsequence = terms(finding.detail).length >= 4 &&
    (/\bConsequence\s*:/iu.test(finding.detail) || consequenceRelation.test(consequenceText));
  return Object.freeze({
    candidateFile,
    lineOrFileWideScope,
    observedMechanismOrCondition,
    concreteConsequence,
    score: [candidateFile, lineOrFileWideScope, observedMechanismOrCondition, concreteConsequence]
      .filter(Boolean).length,
  });
}

function omittedEvidencePaths(context: ReviewContext): readonly string[] {
  const paths = new Set(context.diffOmittedFiles);
  const marker = /^\*\*\* awsf: \d+ of \d+ hunk\(s\) omitted from (.+)$/gm;
  for (const match of context.diff.matchAll(marker)) {
    const path = match[1]?.trim();
    if (path !== undefined && path.length > 0) paths.add(path);
  }
  return Object.freeze([...paths].sort());
}

const EVIDENCE_LIMITATION = /\b(?:bound(?:ed|ing)?|could not (?:check|inspect|see|verify)|diff|hunk|omitt\w*|not (?:shown|supplied|visible)|truncat\w*|unable to (?:check|inspect|see|verify))\b/i;

function hasRequiredEvidenceLimitation(output: ReviewOutput, context: ReviewContext): {
  readonly required: boolean;
  readonly ok: boolean;
  readonly paths: readonly string[];
} {
  const paths = omittedEvidencePaths(context);
  const required = context.diffTruncated || context.diffOmittedChars > 0 || paths.length > 0;
  if (!required) return { required, ok: true, paths };
  const relevant = output.limitations.filter((limitation) => EVIDENCE_LIMITATION.test(limitation));
  const named = paths.every((path) => relevant.some((limitation) => limitation.includes(path)));
  return { required, ok: relevant.length > 0 && named, paths };
}

/**
 * Completeness checks a reviewer can repair without changing its verdict.
 *
 * These checks deliberately report under `envelope_valid`, not
 * `verdict_consistent`. Missing scope, mechanism, or consequence is a malformed
 * finding record. The verdict may still be substantively consistent, and
 * treating record completeness as verdict content used to strand a green
 * candidate in REVIEWING with no legal lifecycle exit.
 */
export function reviewEnvelopeComplete(output: ReviewOutput): GateReport {
  const report = new GateReport("envelope_valid");
  const declaredPaths = new Set(output.findings.map((finding) => finding.file));
  const specificity = output.findings.map((finding) => ({
    id: finding.id,
    result: reviewFindingSpecificity(finding, declaredPaths),
  }));
  const failing = (point: keyof Omit<ReviewFindingSpecificity, "score">): readonly string[] =>
    specificity.filter((finding) => !finding.result[point]).map((finding) => finding.id);

  const badScope = failing("lineOrFileWideScope");
  report.check(
    REVIEW_FINDING_COMPLETENESS_ITEMS.scope,
    badScope.length === 0,
    badScope.length === 0 ? `${output.findings.length} finding scope(s) verified` : `missing scope: ${badScope.join(", ")}`,
  );
  const badMechanism = failing("observedMechanismOrCondition");
  report.check(
    REVIEW_FINDING_COMPLETENESS_ITEMS.mechanism,
    badMechanism.length === 0,
    badMechanism.length === 0 ? `${output.findings.length} finding mechanism(s) verified` : `vague evidence: ${badMechanism.join(", ")}`,
  );
  const badConsequence = failing("concreteConsequence");
  report.check(
    REVIEW_FINDING_COMPLETENESS_ITEMS.consequence,
    badConsequence.length === 0,
    badConsequence.length === 0 ? `${output.findings.length} finding consequence(s) verified` : `missing consequence: ${badConsequence.join(", ")}`,
  );
  return report;
}

export function verdictConsistent(output: ReviewOutput, context: ReviewGateContext): GateReport {
  const report = new GateReport("verdict_consistent");
  const blocking = output.findings.filter((finding) =>
    BLOCKING_SEVERITIES.some((severity) => severity === finding.severity),
  );
  const concreteFindings = output.findings.filter(concrete);
  const candidatePaths = new Set(context.candidatePaths);
  const outside = output.findings.filter((finding) => !candidatePaths.has(finding.file));
  const evidenceLimitation = context.reviewContext === null
    ? null
    : hasRequiredEvidenceLimitation(output, context.reviewContext);

  report.check("reviewed SHA exact", output.reviewedSha === context.candidateSha, `expected=${context.candidateSha}; reviewed=${output.reviewedSha}`);
  report.check(
    "accept has no high/critical findings",
    output.verdict !== "accept" || blocking.length === 0,
    output.verdict === "accept" ? `${blocking.length} high/critical finding(s)` : "not an accept verdict",
  );
  report.check(
    "concern has a concrete finding",
    output.verdict !== "concern" || concreteFindings.length > 0,
    output.verdict === "concern" ? `${concreteFindings.length} concrete finding(s)` : "not a concern verdict",
  );
  report.check(
    "finding paths inside candidate context",
    outside.length === 0,
    outside.length === 0 ? `${output.findings.length} finding path(s) verified` : `outside candidate: ${outside.map((finding) => finding.file).join(", ")}`,
  );
  report.check(
    "candidate context available for specificity",
    context.reviewContext !== null,
    context.reviewContext === null ? "no host-composed review context" : `${context.reviewContext.changedFiles.length} changed file(s) in context`,
  );
  report.check(
    "bounded or omitted evidence has a specific limitation",
    evidenceLimitation?.ok ?? false,
    evidenceLimitation === null
      ? "no host-composed review context"
      : !evidenceLimitation.required
        ? "the supplied diff is complete"
        : evidenceLimitation.ok
          ? `bounded evidence acknowledged; ${evidenceLimitation.paths.length} omitted or partial file(s) named`
          : `bounded evidence requires a limitation${evidenceLimitation.paths.length === 0 ? "" : ` naming: ${evidenceLimitation.paths.join(", ")}`}`,
  );
  return report;
}

// ---------------------------------------------------------------------------
// review_evidence_present — two halves, and BOTH are required.
//
// The defect this closes is that a review with no evidence passed everything:
// `verdict_consistent`'s four checks are all vacuous for an empty `findings`
// array, and `findings` was empty because nothing was inspectable. Checking two
// fields of a composed context does not close it either — a context carrying
// the right SHA and the right filenames with `diff: ""` satisfies them and
// still could not have been evidence.
//
// So the gate is split by WHEN it can prove what:
//
//   fitness (pre-GO)  — could this context be evidence at all? Runs before any
//                       provider starts, so a review that could not have been
//                       evidence is never bought. It is a host precondition,
//                       not a persisted gate row: the durable record of a
//                       PASSING fitness check is the composed context envelope
//                       itself, and the record of a failing one is the phase
//                       failure that stops the run.
//   presence (gate)   — did that context actually reach the model? Its subject
//                       is the SERIALIZED PROMPT, compared by digest against
//                       the context the host composed and against what Git
//                       independently says about the tree.
// ---------------------------------------------------------------------------

/** What the host independently observed, against which a context is judged. */
export interface ReviewEvidenceExpectation {
  readonly baseSha: string;
  readonly candidateSha: string;
  /** From `candidatePathsBetween` — Git's answer, never the context's. */
  readonly changedFiles: readonly string[];
  /** Digest of the FULL diff as read back from the host-private copy on disk. */
  readonly fullDiffSha256: string;
  /** Whether the full diff removes any line, so a bounded copy that dropped every deletion is caught. */
  readonly fullDiffRemovesLines: boolean;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const other = new Set(right);
  return left.every((value) => other.has(value));
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const other = new Set(right);
  return left.filter((value) => !other.has(value));
}

/**
 * Could this context be evidence? Answered BEFORE the call is spent.
 *
 * Contract validation is the caller's first step and is assumed here: this
 * checks the things a valid-but-useless context can still get wrong.
 */
export function reviewEvidenceFitness(
  context: ReviewContext,
  expected: ReviewEvidenceExpectation,
): GateReport {
  const report = new GateReport("review_evidence_present");
  const missing = difference(expected.changedFiles, context.changedFiles);
  const extra = difference(context.changedFiles, expected.changedFiles);
  const hunks = context.diff.split("\n").filter((line) => line.startsWith("@@ ")).length;
  const bytes = utf8ByteLength(JSON.stringify(context));

  report.check("request is recorded", context.request.trim().length > 0, `${context.request.trim().length} character(s)`);
  report.check(
    "acceptance criteria are recorded",
    context.acceptanceCriteria.length > 0,
    `${context.acceptanceCriteria.length} criterion/criteria`,
  );
  report.check("base SHA exact", context.baseSha === expected.baseSha, `expected=${expected.baseSha}; context=${context.baseSha}`);
  report.check("candidate SHA exact", context.candidateSha === expected.candidateSha, `expected=${expected.candidateSha}; context=${context.candidateSha}`);
  report.check(
    "changed files are the host-observed set",
    missing.length === 0 && extra.length === 0,
    missing.length === 0 && extra.length === 0
      ? `${context.changedFiles.length} path(s) verified against git`
      : `missing: ${missing.join(", ") || "none"}; unexpected: ${extra.join(", ") || "none"}`,
  );
  report.check(
    "a changed candidate carries at least one hunk",
    context.changedFiles.length === 0 || hunks > 0,
    `${context.changedFiles.length} changed file(s); ${String(hunks)} hunk header(s) in the bounded diff`,
  );
  report.check(
    "deletions survived bounding",
    !expected.fullDiffRemovesLines || diffRemovesLines(context.diff),
    expected.fullDiffRemovesLines
      ? `the candidate removes lines; the bounded diff ${diffRemovesLines(context.diff) ? "shows removals" : "shows none"}`
      : "the candidate removes no line",
  );
  report.check(
    "diff digest matches the full diff on disk",
    context.diffSha256 === expected.fullDiffSha256,
    `expected=${expected.fullDiffSha256}; context=${context.diffSha256}`,
  );
  report.check(
    "gate evidence is of this candidate and passed",
    context.testOutput.candidateSha === expected.candidateSha && context.testOutput.passed,
    `measured=${context.testOutput.candidateSha}; passed=${String(context.testOutput.passed)}`,
  );
  report.check(
    "the envelope fits the wire limit",
    bytes <= MAX_ENVELOPE_BYTES,
    `${String(bytes)} of ${String(MAX_ENVELOPE_BYTES)} byte(s)`,
  );
  return report;
}

export interface ReviewEvidenceGateContext extends ReviewEvidenceExpectation {
  /** The context the host composed, or null when the phase ran without one. */
  readonly context: ReviewContext | null;
  /** The exact text recorded as this phase's compiled user prompt. */
  readonly compiledPrompt: string;
  /** Digest of `JSON.stringify(context, null, 2)` — what `renderPrevious` substitutes. */
  readonly digest: (value: string) => string;
}

/**
 * Did the evidence reach the model? Runs after the phase, against the prompt.
 *
 * The serialization compared here is the compiler's own
 * (`JSON.stringify(previous, null, 2)`, `compiler.ts:75`), so "the prompt
 * contains this exact text" is the same claim as "this context was rendered
 * into this prompt" — and the digest makes the claim provable from the gate row
 * rather than only from a diff of two long strings.
 */
export function reviewEvidencePresent(gate: ReviewEvidenceGateContext): GateReport {
  const report = new GateReport("review_evidence_present");
  const context = gate.context;
  if (context === null) {
    return report.check("review context composed", false, "the review phase ran with no host-composed review context");
  }
  const serialized = JSON.stringify(context, null, 2);
  const rendered = gate.compiledPrompt.includes(serialized);
  const missing = difference(gate.changedFiles, context.changedFiles);
  const extra = difference(context.changedFiles, gate.changedFiles);
  const hunks = context.diff.split("\n").filter((line) => line.startsWith("@@ ")).length;

  report.check("review context composed", true, `${String(utf8ByteLength(serialized))} byte(s) of evidence`);
  report.check("candidate SHA exact", context.candidateSha === gate.candidateSha, `expected=${gate.candidateSha}; context=${context.candidateSha}`);
  report.check(
    "changed files are the host-observed set",
    sameSet(context.changedFiles, gate.changedFiles),
    missing.length === 0 && extra.length === 0
      ? `${context.changedFiles.length} path(s) verified against git`
      : `missing: ${missing.join(", ") || "none"}; unexpected: ${extra.join(", ") || "none"}`,
  );
  report.check(
    "diff digest matches the full diff on disk",
    context.diffSha256 === gate.fullDiffSha256,
    `expected=${gate.fullDiffSha256}; context=${context.diffSha256}`,
  );
  report.check(
    "a changed candidate carries at least one hunk",
    context.changedFiles.length === 0 || hunks > 0,
    `${String(hunks)} hunk header(s) in the bounded diff`,
  );
  // The half that two matching fields could never prove: the evidence was not
  // merely composed, it was serialized into the prompt this phase was given.
  report.check(
    "the composed context was serialized into the compiled prompt",
    rendered,
    rendered
      ? `context digest ${gate.digest(serialized)} present in a ${String(gate.compiledPrompt.length)}-character prompt`
      : `context digest ${gate.digest(serialized)} does not appear in the ${String(gate.compiledPrompt.length)}-character compiled prompt`,
  );
  return report;
}
