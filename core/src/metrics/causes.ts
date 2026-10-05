// The stop/cancel cause ledger. Pure over projected runs: latest owner event
// wins over the BLOCKED heuristic; unknown (including a recorded unknown) is
// a missing cause, not a counted cause. Never count role-rows: a stop may have
// none, and one run may have several.

import type { MetricsAttribution, MetricsCauseSummary, MetricsRun } from "../../../dashboard/shared/types.ts";

type NamedCause = Exclude<MetricsAttribution, "unknown">;

type CauseCounts = Partial<Record<NamedCause, number>>;

export function summarizeCauses(runs: readonly MetricsRun[]): MetricsCauseSummary {
  const stops: { total: number; byCause: CauseCounts } = { total: 0, byCause: {} };
  const cancels: { total: number; byCause: CauseCounts } = { total: 0, byCause: {} };
  const withoutCause: MetricsCauseSummary["withoutCause"][number][] = [];
  for (const run of runs) {
    const state = run.lifecycleState;
    if (state !== "BLOCKED" && state !== "CANCELLED") continue;
    const bucket = state === "BLOCKED" ? stops : cancels;
    bucket.total++;
    const cause = run.attribution;
    if (cause === null || cause === "unknown") {
      withoutCause.push({ project: run.project, taskId: run.taskId, attempt: run.attempt, lifecycleState: state });
    } else {
      bucket.byCause[cause] = (bucket.byCause[cause] ?? 0) + 1;
    }
  }
  return { stops, cancels, withoutCause };
}
