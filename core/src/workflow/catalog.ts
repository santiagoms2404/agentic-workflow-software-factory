import type { WorkflowRecipe } from "./compiler.ts";
import { WORKFLOW_IDS } from "../config/workflow-ids.ts";
import { ceilingFor, type ResolvedCeiling, type Tier } from "../state/tiers.ts";
import { COMPILED_WORKFLOW_IDS, type CompiledWorkflowId } from "./compiled-ids.ts";
import { buildWorkflow } from "./recipes/build.ts";
import { buildReviewWorkflow } from "./recipes/build-review.ts";
import { designToPlanWorkflow } from "./recipes/design-to-plan.ts";
import { intakeWorkflow } from "./recipes/intake.ts";
import { planWorkflow } from "./recipes/plan.ts";
import { planBuildTestWorkflow } from "./recipes/plan-build-test.ts";
import { scoutWorkflow } from "./recipes/scout.ts";
import { simpleSdlcWorkflow } from "./recipes/simple-sdlc.ts";
import { compileShift, SHIFT_TIER_FLOOR, SHIFT_WORKFLOW_ID } from "./shift/compile.ts";

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

/**
 * A workflow whose recipe exists only once a selection is bound to an attempt.
 * It declares only what is true of every compilation; `shift-catalog.test.ts`
 * compiles one and checks each field. Anything a selection decides, such as
 * the phase count, is left out rather than guessed.
 */
export interface CompiledWorkflow {
  readonly id: CompiledWorkflowId;
  /** The least tier a compilation carries. A selection may raise it, never lower it. */
  readonly tierFloor: Tier;
  /** The agents every compilation routes to, in first-use order. */
  readonly agentOwners: readonly string[];
  /** Whether every compilation ends in a review phase. */
  readonly buysReview: boolean;
  readonly compile: typeof compileShift;
}

/** The compiler registry. A compiled id is resolved here, never through WORKFLOW_RECIPES. */
export const COMPILED_WORKFLOWS: readonly CompiledWorkflow[] = Object.freeze([
  Object.freeze({
    id: SHIFT_WORKFLOW_ID,
    tierFloor: SHIFT_TIER_FLOOR,
    agentOwners: Object.freeze(["builder", "reviewer"]),
    buysReview: true,
    compile: compileShift,
  }),
]);

const COMPILED_BY_ID: ReadonlyMap<string, CompiledWorkflow> = new Map(
  COMPILED_WORKFLOWS.map((compiled) => [compiled.id, compiled]),
);

/**
 * Every compiled id has exactly one compiler and is neither a shipped id nor a
 * registered recipe. Checked before the shipped assertion, so a placeholder
 * recipe registered under a compiled id is reported as what it is. Registering
 * one in both shipped lists would satisfy the shipped assertion and make
 * `minimumCallsFor` report a call count no selection has.
 */
export function assertCompiledVocabulary(
  compiledIds: readonly string[],
  compilers: readonly { readonly id: string }[],
  shippedIds: readonly string[],
  recipes: readonly { readonly id: string }[],
): void {
  const compilerIds = new Set(compilers.map((compiler) => compiler.id));
  if (compilerIds.size !== compilers.length ||
      compilerIds.size !== new Set(compiledIds).size ||
      compiledIds.some((id) => !compilerIds.has(id) || shippedIds.includes(id) || recipes.some((recipe) => recipe.id === id))) {
    throw new Error("compiled workflow ids and their compilers disagree, or a compiled id is registered as a shipped recipe");
  }
}

assertCompiledVocabulary(COMPILED_WORKFLOW_IDS, COMPILED_WORKFLOWS, WORKFLOW_IDS, WORKFLOW_RECIPES);

if (BY_ID.size !== WORKFLOW_RECIPES.length ||
    WORKFLOW_IDS.some((id) => !BY_ID.has(id)) ||
    WORKFLOW_RECIPES.some((recipe) => !(WORKFLOW_IDS as readonly string[]).includes(recipe.id))) {
  throw new Error("shipped workflow ids and registered recipes disagree");
}

export function workflowRecipe(id: string): WorkflowRecipe | null {
  return BY_ID.get(id) ?? null;
}

/** The compiler for a compiled id, or null for a shipped or unknown one. */
export function compiledWorkflow(id: string): CompiledWorkflow | null {
  return COMPILED_BY_ID.get(id) ?? null;
}

/**
 * A compiled workflow asked for its recipe where no selection is bound. Its
 * phase list does not exist until one is, so the refusal names that rather
 * than calling the id unknown.
 */
export class CompiledWorkflowUnbound extends Error {
  readonly workflow: CompiledWorkflowId;

  constructor(workflow: CompiledWorkflowId, where: string) {
    super(
      `workflow ${JSON.stringify(workflow)} compiles its phase list from a selection bound to its attempt, ` +
        `and ${where} has none; nothing was compiled and no call was spent`,
    );
    this.name = "CompiledWorkflowUnbound";
    this.workflow = workflow;
  }
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
