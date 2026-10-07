// The protected grant K1 plans and the runner checks (specs/awsf-v3-w01-driver-checks.html,
// task 12). A grant cannot exist at L1, because `awsf grant` needs a PREPARED
// attempt or a resumable boundary, so `awsf preflight` records which phase owes
// which protected path and the runner refuses that phase until its grant is
// recorded. Pure: callers read the record, the grants and the recipe.
//
// A grant binds the pre-write HEAD of its phase, and an earlier writing phase
// moves HEAD. So the grant owed at a boundary is only ever the next writing
// phase's: the first writing phase's at PREPARED, a later one's at its own
// boundary (the plan's Rejected: every grant at L4).

import type { AwsfConfig } from "../config/schema.ts";
import type { ProtectedPlanEntry } from "../contracts/driver-preflight.ts";
import { matchesPathGlob } from "../policy/path-policy.ts";
import type { WorkflowRecipe } from "../workflow/compiler.ts";
import type { WritingPhase } from "./fields.ts";

/** Each agent phase whose role writes the repository, in recipe order, keyed by phase id as `awsf grant` keys it. */
export function writingPhases(recipe: Pick<WorkflowRecipe, "phases">, agents: AwsfConfig["agents"]): WritingPhase[] {
  const roles = new Map(agents.map((agent) => [agent.name, agent]));
  return recipe.phases.flatMap((phase) => {
    const writes = phase.kind === "agent" ? roles.get(phase.owner)?.writes ?? [] : [];
    return writes.length === 0 ? [] : [{ phase: phase.id, writes: [...writes] }];
  });
}

/** A recorded grant as the check reads it: the phase it names and its exact files. */
export interface RecordedGrant {
  readonly id: string;
  readonly phase: string;
  readonly files: readonly string[];
}

/** The planned protected paths one phase still needs a grant for. */
export interface GrantOwed {
  readonly phase: string;
  /** Planned paths no recorded file covers, in plan order; never empty. */
  readonly paths: readonly string[];
  /**
   * The phase's recorded grant, when one exists but covers none of `paths`.
   * A phase takes one grant, so that grant cannot be widened on this attempt.
   */
  readonly grantId: string | null;
}

/**
 * Whether an exact granted file is under a planned path. A plan path is a file,
 * a directory spelling or a protected glob, matched as widely as the preflight
 * scan matched it, so case never decides a refusal on its own.
 */
export function grantFileCovers(planPath: string, file: string): boolean {
  for (const glob of [planPath, `${planPath.replace(/\/+$/u, "")}/**`]) {
    try {
      if (matchesPathGlob(file, glob, false)) return true;
    } catch {
      // An unparsable spelling covers nothing.
    }
  }
  return false;
}

/** The grant `phase` owes under the plan, or null when the plan names none or every planned path is covered. */
export function grantOwedFor(plan: readonly ProtectedPlanEntry[], grants: readonly RecordedGrant[], phase: string): GrantOwed | null {
  const planned = [...new Set(plan.filter((entry) => entry.phase === phase).map((entry) => entry.path))];
  if (planned.length === 0) return null;
  const grant = grants.find((candidate) => candidate.phase === phase) ?? null;
  const paths = planned.filter((path) => !(grant?.files ?? []).some((file) => grantFileCovers(path, file)));
  return paths.length === 0 ? null : { phase, paths, grantId: grant?.id ?? null };
}

/**
 * The grant owed at a boundary: the next writing phase's, when the plan names
 * it and no recorded grant covers it. `pending` is the recipe's writing phases
 * not yet settled, in order; a later writing phase is never owed here.
 */
export function grantOwedAt(plan: readonly ProtectedPlanEntry[], grants: readonly RecordedGrant[], pending: readonly string[]): GrantOwed | null {
  const next = pending[0];
  return next === undefined ? null : grantOwedFor(plan, grants, next);
}
