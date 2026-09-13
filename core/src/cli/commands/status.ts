import { ceilingFor } from "../../state/tiers.ts";
import type { AttemptEvidence } from "../../observability/attempt-evidence.ts";
import { diagnoseRecovery, formatRecoveryDiagnostic } from "../../observability/recovery-diagnostics.ts";
import { locateRunReport, runReportRevision } from "../../observability/run-report.ts";
import { readAttemptEvidence } from "./review-record.ts";
import { readAttempt, type AttemptStatus } from "./attempt.ts";

function phaseLine(status: AttemptStatus): string {
  if (status.phase === null) return "Phase: none — no phase is active; follow Next action";
  return `Phase: ${status.phase.name} ${status.phase.state} — inspect changes with \`awsf watch ${status.taskId}\``;
}

function roundLine(status: AttemptStatus): string {
  if (status.phase === null) return "Rounds: 0/0 — no correction round is active";
  const remaining = Math.max(0, status.phase.maximumRounds - status.phase.round);
  return `Rounds: ${status.phase.round}/${status.phase.maximumRounds} — ${remaining} correction round(s) remain`;
}

function modelLine(status: AttemptStatus): string {
  if (status.model === null) return "Model: unresolved (unknown) — wait for a model.resolved event; no route guess is shown";
  const explanation = status.model.provenance === "stream-authoritative"
    ? "provider stream reported this identity"
    : status.model.provenance === "route-attributed"
      ? "route attribution; provider stream did not name it"
      : "identity provenance is not yet known";
  return `Model: ${status.model.resolved} (${status.model.provenance}) — ${explanation}`;
}

/** Stable, line-oriented owner display. Every meter says what to do with it. */
export function formatStatus(status: AttemptStatus): readonly string[] {
  const ceiling = ceilingFor(status.tier, status.budget.ceiling);
  const committed = status.budget.callsSpent + status.budget.callsReserved;
  const remaining = Math.max(0, ceiling - committed);
  const granted = status.ceilingGrants.reduce((total, grant) => total + grant.calls, 0);
  // Silent when nothing was granted, so the ordinary case gains no noise and
  // the raised case can never be mistaken for a configured ceiling.
  const raised = granted === 0
    ? ""
    : `, including ${granted} owner-granted by ${status.ceilingGrants.length} raise(s)`;
  const blocker = status.blocker === null
    ? ""
    : `; blocker ${status.blocker.code}: ${status.blocker.detail}`;
  return Object.freeze([
    `State: ${status.lifecycleState}${blocker} — ${status.nextAction}`,
    phaseLine(status),
    roundLine(status),
    `Calls: ${status.budget.callsSpent}/${ceiling} spent, ${status.budget.callsReserved} reserved — ${remaining} call(s) remain${raised}`,
    modelLine(status),
    `Last activity: ${status.lastActivityAt} — ${status.lastActivity}; refresh with \`awsf status ${status.taskId}\``,
    `Budget: auto ${status.budget.correctionsAuto}/${status.budget.allowance.auto}, owner ${status.budget.correctionsOwner}/${status.budget.allowance.owner} per phase — intra-phase corrections, refreshed each phase`,
    `Owner re-entries: ${status.budget.ownerReentries}/${status.budget.allowance.ownerReentries} this attempt — request owner rework or a replacement review only while this remains`,
    `Next action: ${status.nextAction} — this is the only recommended state-changing command`,
  ]);
}

function boundedJson(value: unknown, maximum = 12_000): string {
  const rendered = JSON.stringify(value, null, 2);
  return rendered.length <= maximum ? rendered : `${rendered.slice(0, maximum)}\n… ${String(rendered.length - maximum)} character(s) omitted`;
}

/** The blocker plus the three retained records needed to diagnose it. */
export function formatStatusEvidence(evidence: readonly AttemptEvidence[]): readonly string[] {
  const latestGates = new Map<string, Extract<AttemptEvidence, { type: "gate" }>>();
  let envelope: Extract<AttemptEvidence, { type: "envelope" }> | null = null;
  let process: Extract<AttemptEvidence, { type: "process" }> | null = null;
  for (const record of evidence) {
    if (record.type === "gate") latestGates.set(`${record.phaseId}|${record.gateId}`, record);
    if (record.type === "envelope") envelope = record;
    if (record.type === "process") process = record;
  }
  const failing = [...latestGates.values()].filter((record) => !record.passed);
  const lines: string[] = ["Evidence:", "Failing gate rows:"];
  if (failing.length === 0) lines.push("  none");
  for (const gate of failing) {
    lines.push(`  ${gate.phaseId} round ${gate.round} ${gate.gateId}: FAIL`);
    for (const check of gate.checks.filter((candidate) => !candidate.ok)) {
      lines.push(`    ${check.item}: ${check.note}`);
    }
  }
  lines.push("Last envelope:");
  if (envelope === null) lines.push("  none");
  else {
    lines.push(`  ${envelope.phaseId} round ${envelope.envelope.correctionRound} ${envelope.envelope.schemaId} valid=${String(envelope.envelope.valid)}`);
    for (const row of boundedJson(envelope.envelope.payload ?? envelope.envelope.violations).split("\n")) lines.push(`  ${row}`);
  }
  lines.push("Retained process record:");
  if (process === null) lines.push("  none");
  else {
    lines.push(`  ${process.phaseId} ${process.status}; exit=${process.exitCode === null ? "none" : String(process.exitCode)}; signal=${process.exitSignal ?? "none"}`);
    lines.push(`  command=${JSON.stringify(process.record.command)}`);
    lines.push(`  cwd=${process.record.cwd}`);
  }
  return Object.freeze(lines);
}

function pidIsLive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function statusCommand(
  attemptDir: string,
  options: { readonly evidence?: boolean } = {},
): Promise<readonly string[]> {
  const [status, records, report] = await Promise.all([
    readAttempt(attemptDir),
    readAttemptEvidence(attemptDir),
    locateRunReport(attemptDir),
  ]);
  const lines = [...formatStatus(status)];
  if (status.recovery != null && status.process === null && status.budget.callsReserved === 0) {
    lines.push(`Recovery: ${status.recovery.kind === "quota-pause" ? "quota-paused" : "saved accepted phase result"}; ${status.recovery.prefix.length} completed phase(s). Native interrupted-turn reconnect is not implied.`);
  }
  if (report !== null) {
    // Every command that moves the candidate, the verdict or the lifecycle
    // re-renders this. The stamp is the belt-and-braces: a writer that forgets
    // makes the report say so instead of presenting a superseded run as current.
    const rendered = await runReportRevision(report.absolutePath);
    const stale = rendered !== null && rendered !== status.revision
      ? ` (stale: rendered at revision ${String(rendered)}, attempt is at ${String(status.revision)})`
      : "";
    lines.push(`Run report: ${report.absolutePath} — human-readable projection of the retained attempt evidence${stale}`);
  }
  if (options.evidence === true) {
    lines.push(...formatRecoveryDiagnostic(diagnoseRecovery(status, records, pidIsLive)));
    lines.push(...formatStatusEvidence(records));
  }
  return Object.freeze(lines);
}
