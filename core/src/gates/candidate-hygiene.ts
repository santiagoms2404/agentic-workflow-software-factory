import { GateReport } from "./interface.ts";

const EVIDENCE_MAX_CHARS = 4_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface CandidateHygieneObservation {
  readonly expectedBaseSha: string;
  readonly observedBaseSha: string;
  readonly expectedCandidateSha: string;
  readonly headBefore: string;
  readonly headAfter: string;
  readonly cleanBefore: boolean;
  readonly cleanAfter: boolean;
  readonly exitCode: number;
  readonly output: string;
}

function bounded(value: string): string {
  return value.length <= EVIDENCE_MAX_CHARS ? value : value.slice(0, EVIDENCE_MAX_CHARS);
}

/** Immutable host structural gate over exactly base..candidate. */
export function candidateHygiene(observation: CandidateHygieneObservation): GateReport {
  const report = new GateReport("candidate_hygiene");
  const range = `${observation.expectedBaseSha}..${observation.expectedCandidateSha}`;
  report.check(
    "base SHA exact",
    SHA_PATTERN.test(observation.expectedBaseSha) && observation.observedBaseSha === observation.expectedBaseSha,
    bounded(`range=${range}; observed base=${observation.observedBaseSha}`),
  );
  report.check(
    "candidate HEAD before",
    SHA_PATTERN.test(observation.expectedCandidateSha) && observation.headBefore === observation.expectedCandidateSha,
    bounded(`expected=${observation.expectedCandidateSha}; observed=${observation.headBefore}`),
  );
  report.check("clean before", observation.cleanBefore, observation.cleanBefore ? "worktree clean" : "worktree dirty before candidate hygiene");
  report.check(
    "git diff --check",
    observation.exitCode === 0 && observation.output.length === 0,
    bounded(observation.output.length === 0 ? `git diff --check ${range} --: no findings` : observation.output),
  );
  report.check(
    "candidate HEAD after",
    observation.headAfter === observation.expectedCandidateSha,
    bounded(`expected=${observation.expectedCandidateSha}; observed=${observation.headAfter}`),
  );
  report.check("clean after", observation.cleanAfter, observation.cleanAfter ? "worktree clean" : "worktree dirty after candidate hygiene");
  return report;
}
