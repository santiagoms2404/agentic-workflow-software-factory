import { ceilingFor } from "../../state/tiers.ts";
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
  const ceiling = ceilingFor(status.tier);
  const committed = status.budget.callsSpent + status.budget.callsReserved;
  const remaining = Math.max(0, ceiling - committed);
  const blocker = status.blocker === null
    ? ""
    : `; blocker ${status.blocker.code}: ${status.blocker.detail}`;
  return Object.freeze([
    `State: ${status.lifecycleState}${blocker} — ${status.nextAction}`,
    phaseLine(status),
    roundLine(status),
    `Calls: ${status.budget.callsSpent}/${ceiling} spent, ${status.budget.callsReserved} reserved — ${remaining} call(s) remain`,
    modelLine(status),
    `Last activity: ${status.lastActivityAt} — ${status.lastActivity}; refresh with \`awsf status ${status.taskId}\``,
    `Budget: auto ${status.budget.correctionsAuto}/${status.budget.allowance.auto}, owner ${status.budget.correctionsOwner}/${status.budget.allowance.owner} per phase — intra-phase corrections, refreshed each phase`,
    `Owner re-entries: ${status.budget.ownerReentries}/${status.budget.allowance.ownerReentries} this attempt — request owner rework or a replacement review only while this remains`,
    `Next action: ${status.nextAction} — this is the only recommended state-changing command`,
  ]);
}

export async function statusCommand(attemptDir: string): Promise<readonly string[]> {
  return formatStatus(await readAttempt(attemptDir));
}
