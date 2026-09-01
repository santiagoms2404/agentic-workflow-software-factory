import type { AwsfConfig } from "../../config/schema.ts";
import { callCeilingsOf, ceilingFor, TIERS, type Tier } from "../../state/tiers.ts";
import { minimumCallsFor, workflowRecipe } from "../../workflow/catalog.ts";

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
  if (recipe === null) throw new Error(`workflow ${JSON.stringify(workflow)} has no shipped recipe`);
  if (!config.workflows.enabled.includes(workflow)) {
    throw new Error(`workflow ${JSON.stringify(workflow)} is not enabled`);
  }
  const parsed = requestedTier === undefined ? recipe.tier : Number(requestedTier.replace(/^T/u, ""));
  if (parsed !== 0 && parsed !== 1 && parsed !== 2) {
    throw new Error(`tier must be 0, 1, or 2; got ${requestedTier ?? ""}`);
  }
  if (parsed !== recipe.tier) {
    throw new Error(`workflow ${JSON.stringify(workflow)} requires --tier T${recipe.tier}; got T${parsed}`);
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
    const recipe = workflowRecipe(id);
    if (recipe === null) {
      lines.push(`${id}: enabled but no shipped recipe is registered`);
      continue;
    }
    const phases = recipe.phases
      .map((phase) => `${phase.id}[${phase.kind}:${phase.owner}]`)
      .join(" -> ");
    lines.push(
      `${recipe.id}: T${recipe.tier}, ${String(minimumCallsFor(recipe))} provider call(s), ` +
        `ceiling ${String(ceilingFor(recipe.tier, ceilings))} — ${phases}`,
    );
  }
  return Object.freeze(lines);
}
