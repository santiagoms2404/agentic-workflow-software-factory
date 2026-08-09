import { BLOCKING_SEVERITIES, type ReviewFinding, type ReviewOutput } from "../contracts/review-output.ts";
import { GateReport } from "./interface.ts";

function concrete(finding: ReviewFinding): boolean {
  return finding.file.trim().length > 0 && finding.title.trim().length > 0 && finding.detail.trim().length > 0 && finding.evidence.trim().length > 0;
}

export interface ReviewGateContext {
  readonly candidateSha: string;
  readonly candidatePaths: readonly string[];
}

export function verdictConsistent(output: ReviewOutput, context: ReviewGateContext): GateReport {
  const report = new GateReport("verdict_consistent");
  const blocking = output.findings.filter((finding) =>
    BLOCKING_SEVERITIES.some((severity) => severity === finding.severity),
  );
  const concreteFindings = output.findings.filter(concrete);
  const candidatePaths = new Set(context.candidatePaths);
  const outside = output.findings.filter((finding) => !candidatePaths.has(finding.file));

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
  return report;
}
