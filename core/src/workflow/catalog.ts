import type { WorkflowRecipe } from "./compiler.ts";
import { WORKFLOW_IDS } from "../config/workflow-ids.ts";
import { ceilingFor, type ResolvedCeiling } from "../state/tiers.ts";
import { buildWorkflow } from "./recipes/build.ts";
import { buildReviewWorkflow } from "./recipes/build-review.ts";
import { designToPlanWorkflow } from "./recipes/design-to-plan.ts";
import { intakeWorkflow } from "./recipes/intake.ts";
import { planWorkflow } from "./recipes/plan.ts";
import { planBuildTestWorkflow } from "./recipes/plan-build-test.ts";
import { scoutWorkflow } from "./recipes/scout.ts";
import { simpleSdlcWorkflow } from "./recipes/simple-sdlc.ts";

/** The shipped recipe catalogue. Configuration can enable a subset, never invent another recipe. */
export const WORKFLOW_RECIPES: readonly WorkflowRecipe[] = Object.freeze([
  scoutWorkflow,
  planWorkflow,
  buildWorkflow,
  planBuildTestWorkflow,
  buildReviewWorkflow,
  simpleSdlcWorkflow,
  intakeWorkflow,
  designToPlanWorkflow,
]);

const BY_ID: ReadonlyMap<string, WorkflowRecipe> = new Map(
  WORKFLOW_RECIPES.map((recipe) => [recipe.id, recipe]),
);

if (BY_ID.size !== WORKFLOW_RECIPES.length ||
    WORKFLOW_IDS.some((id) => !BY_ID.has(id)) ||
    WORKFLOW_RECIPES.some((recipe) => !(WORKFLOW_IDS as readonly string[]).includes(recipe.id))) {
  throw new Error("shipped workflow ids and registered recipes disagree");
}

export function workflowRecipe(id: string): WorkflowRecipe | null {
  return BY_ID.get(id) ?? null;
}

export function minimumCallsFor(recipe: WorkflowRecipe): number {
  return recipe.phases.filter((phase) => phase.kind === "agent").length;
}

/**
 * The number every correction round on a cold route is spent from: what the
 * ceiling allows minus what the route must spend to finish once.
 *
 * A route whose agents are `continuity: none` pays a whole provider call to
 * re-ask a phase, so this number — not `maxCorrections` — decides whether a
 * declared correction round exists in practice. Three enabled recipes sit at
 * zero, which is why the first envelope defect on them was terminal on its
 * first occurrence while the recipe declared it recoverable.
 */
export function correctionsFundableFor(recipe: WorkflowRecipe, resolved?: ResolvedCeiling): number {
  return ceilingFor(recipe.tier, resolved) - minimumCallsFor(recipe);
}
