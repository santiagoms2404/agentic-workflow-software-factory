import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { BuildOutput } from "../contracts/build-output.ts";
import type { DocumentOutput } from "../contracts/document-output.ts";
import { RUN_REPORT_PATH_PATTERN } from "../contracts/document-output.ts";
import type { PlanOutput } from "../contracts/plan-output.ts";
import type { ReviewOutput } from "../contracts/review-output.ts";
import type { AttemptStatus } from "../cli/commands/attempt.ts";
import type { AttemptEvidence } from "./attempt-evidence.ts";

export interface RunReportLocation {
  readonly absolutePath: string;
  /** Safe path relative to the task root; suitable for the dashboard API. */
  readonly taskRelativePath: string;
}

/** Reports are disposable projections beside attempts, never post-seal writes inside one. */
export function runReportLocation(
  attemptDirectory: string,
  attempt: number,
  logicalPath: string,
): RunReportLocation {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error(`invalid run-report attempt number: ${String(attempt)}`);
  }
  if (!new RegExp(RUN_REPORT_PATH_PATTERN).test(logicalPath)) {
    throw new Error(`invalid logical run-report path: ${JSON.stringify(logicalPath)}`);
  }
  const reportName = logicalPath.slice("reports/".length);
  const taskRelativePath = `run-reports/attempt-${String(attempt)}-${reportName}`;
  return Object.freeze({
    absolutePath: join(dirname(attemptDirectory), taskRelativePath),
    taskRelativePath,
  });
}

export async function locateRunReport(attemptDirectory: string): Promise<RunReportLocation | null> {
  const attempt = basename(attemptDirectory);
  const prefix = `attempt-${attempt}-`;
  const directory = join(dirname(attemptDirectory), "run-reports");
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) &&
        new RegExp(RUN_REPORT_PATH_PATTERN).test(`reports/${entry.name.slice(prefix.length)}`))
      .map((entry) => entry.name)
      .sort();
    if (names[0] === undefined) return null;
    return Object.freeze({
      absolutePath: join(directory, names[0]),
      taskRelativePath: `run-reports/${names[0]}`,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export interface RenderedRunReport {
  readonly path: string;
  readonly markdown: string;
  readonly documenterDraftPresent: boolean;
}

function latestEnvelope<T>(
  evidence: readonly AttemptEvidence[],
  schemaId: string,
  phaseKey?: string,
): T | null {
  for (let index = evidence.length - 1; index >= 0; index -= 1) {
    const record = evidence[index]!;
    if (record.type !== "envelope" || record.envelope.schemaId !== schemaId) continue;
    if (phaseKey !== undefined && !record.phaseId.endsWith(`:${phaseKey}`)) continue;
    if (!record.envelope.valid || record.envelope.payload === null) continue;
    return record.envelope.payload as T;
  }
  return null;
}

function total(
  evidence: readonly AttemptEvidence[],
  field: "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "reasoningTokens",
): number | null {
  let sum = 0;
  let observed = false;
  for (const record of evidence) {
    if (record.type !== "agent") continue;
    const value = record.usage[field];
    if (value === null) continue;
    observed = true;
    sum += value;
  }
  return observed ? sum : null;
}

function latestGateRows(evidence: readonly AttemptEvidence[]): readonly Extract<AttemptEvidence, { type: "gate" }>[] {
  const rows = new Map<string, Extract<AttemptEvidence, { type: "gate" }>>();
  for (const record of evidence) {
    if (record.type !== "gate") continue;
    rows.set(`${record.phaseId}|${record.gateId}`, record);
  }
  return Object.freeze([...rows.values()]);
}

function line(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

function sectionList(values: readonly string[], empty: string): string {
  return values.length === 0 ? empty : values.map((value) => `- ${value}`).join("\n");
}

/** A readable projection. The journal and Git remain the evidence stores. */
export function renderRunReport(
  status: AttemptStatus,
  evidence: readonly AttemptEvidence[],
): RenderedRunReport {
  const plan = latestEnvelope<PlanOutput>(evidence, "awsf.plan-output/v1", "planner") ??
    latestEnvelope<PlanOutput>(evidence, "awsf.plan-output/v1", "request");
  const build = latestEnvelope<BuildOutput>(evidence, "awsf.build-output/v1", "builder");
  const document = latestEnvelope<DocumentOutput>(evidence, "awsf.document-output/v1", "documenter");
  const review = latestEnvelope<ReviewOutput>(evidence, "awsf.review-output/v1");
  const draft = document?.runReport;
  const path = draft?.path ?? "reports/run-report.md";
  if (!new RegExp(RUN_REPORT_PATH_PATTERN).test(path)) {
    throw new Error(`documenter selected an invalid run-report path: ${JSON.stringify(path)}`);
  }

  const phases = new Map<string, Extract<AttemptEvidence, { type: "phase" }>["phase"]>();
  for (const record of evidence) {
    if (record.type === "phase") phases.set(record.phase.key, record.phase);
  }
  const phaseLines = [...phases.values()]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((phase) => `${phase.ordinal}. ${phase.key} — ${phase.status}`);

  const gates = latestGateRows(evidence);
  const gateLines = gates.map((gate) => {
    const failures = gate.checks.filter((check) => !check.ok).map((check) => `${check.item}: ${check.note}`);
    return `${gate.phaseId.split(":").at(-1) ?? gate.phaseId}/${gate.gateId} — ${gate.passed ? "PASS" : `FAIL (${failures.join("; ") || "no failed sub-check recorded"})`}`;
  });

  const findings = review?.findings.map((finding) =>
    `${finding.severity.toUpperCase()} ${finding.file}:${finding.line === null ? "file-wide" : String(finding.line)} — ${finding.title}\n  ${finding.detail}\n  Consequence: ${finding.consequence}`,
  ) ?? [];
  const agentCalls = evidence
    .filter((record): record is Extract<AttemptEvidence, { type: "agent" }> => record.type === "agent");
  const dollarValues = agentCalls.map((record) => record.costUsd).filter((value): value is number => value !== null);
  const missingDollarValues = agentCalls.length - dollarValues.length;
  const dollars = dollarValues.length === 0
    ? "unavailable (subscription route or provider supplied no monetary figure)"
    : `$${dollarValues.reduce((sum, value) => sum + value, 0).toFixed(6)}` +
      (missingDollarValues === 0 ? "" : ` (partial; ${String(missingDollarValues)} call(s) supplied no monetary figure)`);

  const markdown = [
    `# AWSF run report: ${status.taskId}`,
    "",
    "> This is a readable projection of the attempt journal and Git evidence. It is not a receipt or a second evidence store.",
    "",
    "## Request",
    "",
    status.request,
    "",
    "## Plan",
    "",
    plan === null
      ? "No plan envelope completed."
      : `${plan.summary}\n\n${sectionList(plan.implementationSteps.map((step) => `${step.id}: ${step.title}`), "No implementation steps were declared.")}`,
    "",
    "## Build",
    "",
    build === null
      ? "No build envelope completed."
      : `${build.summary}\n\nCandidate: ${status.candidateSha ?? "none"}\n\n${sectionList(build.changedFiles, "No repository files changed.")}`,
    "",
    "## Phases",
    "",
    sectionList(phaseLines, "No phase record exists."),
    "",
    "## Host gates",
    "",
    sectionList(gateLines, "No gate row exists."),
    "",
    "## Documenter narrative",
    "",
    draft?.markdown ?? "The documenter did not run before this attempt stopped. The host generated the remaining sections from retained evidence.",
    "",
    "## Review",
    "",
    review === null
      ? "No review envelope completed."
      : `Verdict: ${review.verdict}\n\n${sectionList(findings, "No findings were reported.")}\n\nLimitations:\n${sectionList(review.limitations, "- None declared.")}`,
    "",
    "## Final lifecycle",
    "",
    `State: ${status.lifecycleState}`,
    `Blocker: ${status.blocker === null ? "none" : `${status.blocker.code} — ${status.blocker.detail}`}`,
    `Next action: ${status.nextAction}`,
    "",
    "## Cost and usage",
    "",
    `Calls: ${status.budget.callsSpent} spent, ${status.budget.callsReserved} reserved, ceiling ${status.budget.ceiling}`,
    `Input tokens: ${line(total(evidence, "inputTokens"))}`,
    `Output tokens: ${line(total(evidence, "outputTokens"))}`,
    `Cache-read tokens: ${line(total(evidence, "cacheReadTokens"))}`,
    `Cache-write tokens: ${line(total(evidence, "cacheWriteTokens"))}`,
    `Reasoning tokens: ${line(total(evidence, "reasoningTokens"))}`,
    `Monetary cost: ${dollars}`,
    "",
  ].join("\n");

  return Object.freeze({ path, markdown, documenterDraftPresent: draft !== undefined });
}
