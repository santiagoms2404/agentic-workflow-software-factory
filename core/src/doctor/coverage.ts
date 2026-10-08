import type { DoctorRow } from "../contracts/doctor-readout.ts";
import type { TrapsReadout } from "../contracts/traps-readout.ts";
import { trapsExitCode } from "../traps/readout.ts";

/** Reports the journal reader's coverage; never runs or repairs the trap layer. */
export function coverageRow(readout: TrapsReadout): DoctorRow {
  return {
    status: trapsExitCode(readout) === 0 ? "ok" : "finding",
    detail: [
      `unlinked stops=${readout.stops.unlinked.length}; missing traps=${readout.stops.missingTrap.length}; next free id=${readout.nextFreeTrapId}`,
      ...readout.projects.map(project => {
        const newest = project.newestLanded;
        return `${project.project}: newest landed traps=${newest?.traps.passed === null || newest === null ? "not measured" : newest.traps.passed ? "passed" : "failed"}; measured sha=${newest?.traps.sha ?? "not measured"}; base sha=${newest?.baseSha ?? "not measured"}; candidate sha=${newest?.candidateSha ?? "not measured"}`;
      }),
    ],
  };
}
