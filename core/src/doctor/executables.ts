import type { DoctorRow } from "../contracts/doctor-readout.ts";
export interface ExecutableFact {
  readonly name: string;
  readonly executable: string;
  readonly resolved: string | null;
  readonly enabled?: boolean;
}
export function executablesRow(facts: readonly ExecutableFact[]): DoctorRow {
  return {
    status: facts.some(fact => fact.enabled !== false && fact.resolved === null) ? "finding" : "ok",
    detail: facts.map(fact => `${fact.name}${fact.enabled === false ? " (disabled)" : ""}: ${fact.executable} ${fact.resolved === null ? "unresolvable" : `resolved to ${fact.resolved}`}`),
  };
}
