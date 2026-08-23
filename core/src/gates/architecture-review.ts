import type {
  ArchitectureReviewFinding,
  ArchitectureReviewOutput,
} from "../contracts/architecture-review-output.ts";
import type { DesignOutput } from "../contracts/design-output.ts";
import { BLOCKING_SEVERITIES } from "../contracts/review-output.ts";
import { GateReport } from "./interface.ts";

function concrete(finding: ArchitectureReviewFinding): boolean {
  return finding.subject.trim().length > 0
    && finding.title.trim().length > 0
    && finding.detail.trim().length > 0
    && finding.evidence.trim().length > 0;
}

function listed(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

/** Validate an architecture review's references and verdict shape against the design it judged. */
export function architectureVerdictConsistent(
  review: ArchitectureReviewOutput,
  design: DesignOutput,
): GateReport {
  const report = new GateReport("architecture_verdict_consistent");
  const declaredSubjects = new Set([
    ...design.invariants.map((declaration) => declaration.id),
    ...design.acceptanceCriteria.map((declaration) => declaration.id),
    ...design.decisions.map((declaration) => declaration.id),
    ...design.components.map((component) => component.name),
  ]);
  const unresolvedSubjects = review.findings
    .map((finding) => finding.subject)
    .filter((subject) => !declaredSubjects.has(subject));
  const blocking = review.findings.filter((finding) =>
    BLOCKING_SEVERITIES.some((severity) => severity === finding.severity),
  );
  const concreteFindings = review.findings.filter(concrete);
  const declaredLimitations = review.limitations.filter((limitation) => limitation.trim().length > 0);

  report.check(
    "reviewed design exact",
    review.reviewedDesign === design.summary,
    `expected=${JSON.stringify(design.summary)}; reviewed=${JSON.stringify(review.reviewedDesign)}`,
  );
  report.check(
    "finding subjects resolve against the design",
    unresolvedSubjects.length === 0,
    unresolvedSubjects.length === 0
      ? `${String(review.findings.length)} finding subject(s) resolved to a declared identifier or named component`
      : `unresolved finding subject(s): ${listed(unresolvedSubjects)}`,
  );
  report.check(
    "accept has no high/critical findings",
    review.verdict !== "accept" || blocking.length === 0,
    `${String(blocking.length)} blocking of ${String(review.findings.length)} finding(s); this gate checks the verdict's shape, not the review's thoroughness — a zero here is envelope consistency, never a clean design`,
  );
  report.check(
    "concern has a concrete finding",
    review.verdict !== "concern" || concreteFindings.length > 0,
    review.verdict === "concern"
      ? `${String(concreteFindings.length)} finding(s) carry subject, title, detail, and evidence`
      : "not a concern verdict",
  );
  report.check(
    "review limitations declared",
    declaredLimitations.length > 0,
    declaredLimitations.length > 0
      ? `reviewer declared it did not check: ${declaredLimitations.join("; ")}`
      : "reviewer declared it did not check: nothing",
  );
  return report;
}
