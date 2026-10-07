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

export function isPopulationStop(
  attempt: PopulationAttempt,
  registeredProjects: ReadonlySet<string>,
  cut: string = SEED_CUT,
): boolean {
  const terminal = attempt.terminalAt === null ? NaN : Date.parse(attempt.terminalAt);
  const boundary = Date.parse(cut);
  return registeredProjects.has(attempt.project)
    && (attempt.lifecycleState === "BLOCKED" || attempt.lifecycleState === "CANCELLED")
    && attempt.workflow !== "prove"
    && Number.isFinite(terminal) && Number.isFinite(boundary) && terminal <= boundary;
}

export function selectPopulation<T extends PopulationAttempt>(
  attempts: readonly T[], registeredProjects: ReadonlySet<string>, cut: string = SEED_CUT,
): T[] {
  return attempts.filter(attempt => isPopulationStop(attempt, registeredProjects, cut));
}
