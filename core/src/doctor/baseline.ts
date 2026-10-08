import type { DoctorRow } from "../contracts/doctor-readout.ts";

export interface BaselineFact {
  readonly path: string | null;
  readonly present: boolean | null;
  readonly foreign: boolean | null;
  readonly head: string | null;
  readonly defaultHead: string | null;
  readonly dirty: boolean | null;
  readonly seededNodeModules: boolean;
  readonly nodeModulesMtime: number | null;
  readonly lockfileMtime: number | null;
}

/** Age is a diagnostic, not proof of seed-byte freshness (preflight owns that). */
export function baselineRow(fact: BaselineFact): DoctorRow {
  if (fact.path === null || fact.present === null) return { status: "warn", detail: ["baseline not measured"] };
  if (!fact.present) return { status: "warn", detail: [`${fact.path}: absent`] };
  const same = fact.head !== null && fact.defaultHead !== null ? fact.head === fact.defaultHead : null;
  const older = fact.nodeModulesMtime !== null && fact.lockfileMtime !== null ? fact.nodeModulesMtime < fact.lockfileMtime : null;
  const warn = fact.foreign !== false || fact.dirty !== false || same !== true || (fact.seededNodeModules && older !== false);
  return { status: warn ? "warn" : "ok", detail: [
    `${fact.path}: present; foreign=${fact.foreign ?? "not measured"}; dirty=${fact.dirty ?? "not measured"}`,
    `HEAD=${fact.head ?? "not measured"}; default HEAD=${fact.defaultHead ?? "not measured"}; matches default=${same ?? "not measured"}`,
    `seeded node_modules=${fact.seededNodeModules}; older than repository lockfile=${fact.seededNodeModules ? older ?? "not measured (seed or lockfile absent/unreadable)" : "not applicable"} (directory mtime only; not a byte-freshness proof)`,
  ] };
}
