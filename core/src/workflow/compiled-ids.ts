// The second workflow vocabulary. A compiled workflow has no static recipe:
// its phase list is compiled only when an attempt is bound to a selection,
// so it never appears in WORKFLOW_IDS or WORKFLOW_RECIPES and `catalog.ts`'s
// shipped assertion keeps its exact meaning. This module is a leaf on purpose,
// so config validation can read the vocabulary without loading a compiler.
// `catalog.ts` asserts at module load that each id here has a compiler whose
// own id is the same string.

/**
 * Workflows compiled only after selection binding: a shift from its sealed
 * ticket manifest, a prove replay from its frozen item, and a plan author from
 * exactly one sealed spine ticket. The author has a fixed shape but no unbound recipe.
 */
export const COMPILED_WORKFLOW_IDS = Object.freeze(["shift", "prove", "plan-author"] as const);

export type CompiledWorkflowId = (typeof COMPILED_WORKFLOW_IDS)[number];

export function isCompiledWorkflowId(id: string): id is CompiledWorkflowId {
  return (COMPILED_WORKFLOW_IDS as readonly string[]).includes(id);
}
