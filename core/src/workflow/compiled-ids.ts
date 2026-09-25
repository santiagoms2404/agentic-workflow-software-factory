// The second workflow vocabulary. A compiled workflow has no static recipe:
// its phase list is compiled from a selection when an attempt is bound to one,
// so it never appears in WORKFLOW_IDS or WORKFLOW_RECIPES and `catalog.ts`'s
// shipped assertion keeps its exact meaning. This module is a leaf on purpose,
// so config validation can read the vocabulary without loading a compiler.
// `catalog.ts` asserts at module load that each id here has a compiler whose
// own id is the same string.

/** Workflows whose phase list is compiled per selection rather than shipped. */
export const COMPILED_WORKFLOW_IDS = Object.freeze(["shift"] as const);

export type CompiledWorkflowId = (typeof COMPILED_WORKFLOW_IDS)[number];

export function isCompiledWorkflowId(id: string): id is CompiledWorkflowId {
  return (COMPILED_WORKFLOW_IDS as readonly string[]).includes(id);
}
