import type { AwsfConfig } from "../../config/schema.ts";
import { callCeilingsOf, ceilingFor, TIERS, type ResolvedCeiling, type Tier } from "../../state/tiers.ts";
import type { WorkflowRecipe } from "../../workflow/compiler.ts";
import {
  COMPILED_WORKFLOWS,
  compiledWorkflow,
  correctionsFundableFor,
  minimumCallsFor,
  workflowRecipe,
} from "../../workflow/catalog.ts";

export interface WorkflowSelection {
  readonly workflow: string;
  readonly tier: Tier;
}

/** Resolves the recipe and tier as one choice, before a DRAFT attempt exists. */
export function selectWorkflow(
  config: AwsfConfig,
  workflow: string,
  requestedTier?: string,
): WorkflowSelection {
  const recipe = workflowRecipe(workflow);
  const compiled = recipe === null ? compiledWorkflow(workflow) : null;
  if (recipe === null && compiled === null) throw new Error(`workflow ${JSON.stringify(workflow)} has no shipped recipe`);
  if (!config.workflows.enabled.includes(workflow)) {
    throw new Error(`workflow ${JSON.stringify(workflow)} is not enabled`);
  }
  // A compiled workflow has no recipe tier yet, only the floor every
  // selection starts from. A selection may raise it, so a higher tier is
  // admitted and a lower one never is.
  const required = recipe?.tier ?? compiled!.tierFloor;
  const parsed = requestedTier === undefined ? required : Number(requestedTier.replace(/^T/u, ""));
  if (parsed !== 0 && parsed !== 1 && parsed !== 2) {
    throw new Error(`tier must be 0, 1, or 2; got ${requestedTier ?? ""}`);
  }
  if (recipe !== null && parsed !== recipe.tier) {
    throw new Error(`workflow ${JSON.stringify(workflow)} requires --tier T${recipe.tier}; got T${parsed}`);
  }
  if (compiled !== null && parsed < compiled.tierFloor) {
    throw new Error(`workflow ${JSON.stringify(workflow)} is compiled at T${compiled.tierFloor} or above; got T${parsed}`);
  }
  return Object.freeze({ workflow, tier: parsed });
}

/** Renders the live configured catalogue without copying recipe or ceiling data into prose. */
export function workflowsCommand(config: AwsfConfig): readonly string[] {
  const ceilings = callCeilingsOf(config.risk.call_ceiling);
  const lines: string[] = [
    `Tier ceilings: ${TIERS.map((tier) => `T${tier}=${String(ceilingFor(tier, ceilings))}`).join(", ")}`,
  ];
  for (const id of config.workflows.enabled) {
    if (compiledWorkflow(id) !== null) continue;
    const recipe = workflowRecipe(id);
    if (recipe === null) {
      lines.push(`${id}: enabled but no shipped recipe is registered`);
      continue;
    }
    const phases = recipe.phases
      .map((phase) => `${phase.id}[${phase.kind}:${phase.owner}]`)
      .join(" -> ");
    const headroom = correctionHeadroom(config, recipe, ceilings);
    lines.push(
      `${recipe.id}: T${recipe.tier}, ${String(minimumCallsFor(recipe))} provider call(s), ` +
        `ceiling ${String(ceilingFor(recipe.tier, ceilings))}, ` +
        `corrections fundable: ${headroom.fundable <= 0 ? `${String(headroom.fundable)} (none)` : String(headroom.fundable)} — ${phases}`,
    );
  }
  // A compiled workflow's phases, calls and headroom are all counted from the
  // tickets a selection names, so any number printed here would be wrong for
  // most selections. It gets its own section and says so.
  lines.push("Compiled per selection (phase count is selection-dependent):");
  for (const compiled of COMPILED_WORKFLOWS) {
    lines.push(
      `${compiled.id}: ${config.workflows.enabled.includes(compiled.id) ? "enabled" : "not enabled"}, ` +
        `T${compiled.tierFloor} or above, phase count selection-dependent — agents ${compiled.agentOwners.join(", ")}`,
    );
  }
  return Object.freeze(lines);
}

export interface CorrectionHeadroom {
  /** `ceiling − minimumCalls`: how many cold correction rounds this route can pay for. */
  readonly fundable: number;
  /** Agent phases declaring a correction round on a route that has to re-ask cold. */
  readonly coldCorrectingPhases: readonly string[];
  /** A declared correction round no call can pay for. */
  readonly unfundable: boolean;
  /** Calls an owner must grant before one cold correction becomes payable. */
  readonly callsNeeded: number;
}

/**
 * What a recipe's declared correction rounds actually cost against its ceiling.
 *
 * `maxCorrections` is a promise about rounds; on a `continuity: none` route a
 * round is a whole provider call, so the promise is only real when the ceiling
 * has room for it. A `same-session` route re-asks inside the call it already
 * bought and needs no headroom, which is why continuity is read here rather
 * than assumed.
 */
export function correctionHeadroom(
  config: AwsfConfig,
  recipe: WorkflowRecipe,
  resolved: ResolvedCeiling = callCeilingsOf(config.risk.call_ceiling),
): CorrectionHeadroom {
  const cold = new Set(
    config.agents.filter((agent) => agent.harness.continuity === "none").map((agent) => agent.name),
  );
  const coldCorrectingPhases = recipe.phases
    .filter((phase) => phase.kind === "agent" && phase.maxCorrections > 0 && cold.has(phase.owner))
    .map((phase) => phase.id);
  const fundable = correctionsFundableFor(recipe, resolved);
  return Object.freeze({
    fundable,
    coldCorrectingPhases: Object.freeze(coldCorrectingPhases),
    unfundable: coldCorrectingPhases.length > 0 && fundable < 1,
    callsNeeded: Math.max(0, minimumCallsFor(recipe) + 1 - ceilingFor(recipe.tier, resolved)),
  });
}
