// W02-Q1: selection over projected facts, not filesystem discovery or a clock.
// terminalAt must be the terminal transition's instant, not lastActivityAt:
// attribution and other later evidence can update a sealed attempt.
export const SEED_CUT = "2026-10-07T23:59:59Z";

export interface PopulationAttempt {
  readonly project: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly lifecycleState: string;
  readonly workflow: string;
  readonly terminalAt: string | null;
}

/** Shared stop definition; the dated seed and live coverage views only differ at the cut. */
export function isRegisteredStop(attempt: PopulationAttempt, registeredProjects: ReadonlySet<string>): boolean {
  return registeredProjects.has(attempt.project)
    && (attempt.lifecycleState === "BLOCKED" || attempt.lifecycleState === "CANCELLED")
    && attempt.workflow !== "prove"
    && attempt.terminalAt !== null && Number.isFinite(Date.parse(attempt.terminalAt));
}

export function isStopSinceCut(attempt: PopulationAttempt, registeredProjects: ReadonlySet<string>, cut: string = SEED_CUT): boolean {
  return isRegisteredStop(attempt, registeredProjects) && Date.parse(attempt.terminalAt!) > Date.parse(cut);
}

export function isPopulationStop(
  attempt: PopulationAttempt,
  registeredProjects: ReadonlySet<string>,
  cut: string = SEED_CUT,
): boolean {
  const terminal = attempt.terminalAt === null ? NaN : Date.parse(attempt.terminalAt);
  const boundary = Date.parse(cut);
  return isRegisteredStop(attempt, registeredProjects)
    && Number.isFinite(boundary) && terminal <= boundary;
}

export function selectPopulation<T extends PopulationAttempt>(
  attempts: readonly T[], registeredProjects: ReadonlySet<string>, cut: string = SEED_CUT,
): T[] {
  return attempts.filter(attempt => isPopulationStop(attempt, registeredProjects, cut));
}
