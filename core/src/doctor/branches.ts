import type { DoctorRow } from "../contracts/doctor-readout.ts";

export interface BranchFact {
  readonly name: string;
  readonly tip: string;
  readonly contained: boolean;
  readonly terminalTask: string | null;
}

/** Descriptive only: these branches are not gc candidates. */
export function branchesRow(facts: readonly BranchFact[] | null, defaultBranch: string | null, notes: readonly string[] = []): DoctorRow {
  if (facts === null) return { status: "warn", detail: ["local branches not measured", ...notes] };
  const stale = facts.filter(fact => fact.name !== defaultBranch && (fact.contained || fact.terminalTask !== null));
  return { status: stale.length > 0 || defaultBranch === null || notes.length > 0 ? "warn" : "ok",
    detail: [`local branches=${facts.length}; stale=${stale.length}; default=${defaultBranch ?? "not measured"}`,
      ...stale.map(fact => `${fact.name} at ${fact.tip}: ${[fact.contained ? "tip contained by default branch" : null,
        fact.terminalTask === null ? null : `task ${fact.terminalTask}: all attempts terminal`].filter(Boolean).join("; ")}`), ...notes] };
}
