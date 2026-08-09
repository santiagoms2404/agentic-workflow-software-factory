import { GateReport } from "./interface.ts";

export interface JourneyEvidence {
  readonly journeyId: string;
  readonly ran: boolean;
  readonly passed: boolean;
  readonly candidateSha: string | null;
}

/** A journey is useful evidence only when it passed against the exact candidate. */
export function journeyPasses(evidence: JourneyEvidence, candidateSha: string): GateReport {
  return new GateReport("journey_passes")
    .check("journey ran", evidence.ran, evidence.ran ? `ran ${evidence.journeyId}` : `${evidence.journeyId} did not run`)
    .check("journey passed", evidence.ran && evidence.passed, evidence.passed ? "passed" : "failed or unavailable")
    .check("candidate SHA exact", evidence.candidateSha === candidateSha, `expected=${candidateSha}; observed=${evidence.candidateSha ?? "none"}`);
}
