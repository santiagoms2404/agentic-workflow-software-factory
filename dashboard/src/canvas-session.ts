import type { GroupTree, TreeProposal } from "../shared/types.ts";

/**
 * A driving session, told one decision at a time.
 *
 * The same wheel the runs use, over the spine of applied decisions — the
 * sequence that actually happened. A proposal nobody took is a branch off that
 * sequence rather than a step in it, so it stays on the reading and the tree,
 * where it is already drawn as not taken; putting it in the wheel would make
 * the story claim something was decided that never was.
 */

export interface DecisionSlide {
  readonly key: string;
  readonly decision: TreeProposal;
  /**
   * The owner's own words that this decision came out of, pinned above the
   * wheel and changing as it turns. Null when the journal records no ask
   * before it, which is a real state and is shown as one.
   */
  readonly ask: string | null;
}

export function decisionSlides(tree: GroupTree | null): readonly DecisionSlide[] {
  if (tree === null) return [];
  const asks = new Map(tree.asks.map((ask) => [ask.inputId, ask.text]));
  return tree.spine.map((decision) => ({
    key: decision.id,
    decision,
    ask: decision.ask === null ? null : asks.get(decision.ask) ?? null,
  }));
}

/** The first non-empty line of an ask, bounded, for the strip above the wheel. */
export function askLine(text: string | null, budget = 150): string | null {
  if (text === null) return null;
  const first = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  if (first.length === 0) return null;
  return first.length <= budget ? first : `${first.slice(0, budget - 1)}…`;
}

/**
 * What the wheel is not showing, said out loud.
 *
 * The wheel walks the decisions; the asks, the proposals nobody took and the
 * unit records are all on the other two readings of the same journal. A count
 * here is what stops the wheel from looking like the whole record.
 */
export function elsewhere(tree: GroupTree | null): string | null {
  if (tree === null) return null;
  const parts: string[] = [];
  if (tree.counts.notTaken > 0) parts.push(`${tree.counts.notTaken} proposed and not taken`);
  if (tree.counts.inputs > 0) parts.push(`${tree.counts.inputs} asks`);
  if (tree.counts.units > 0) parts.push(`${tree.counts.units} units`);
  return parts.length === 0 ? null : `${parts.join(" · ")} — on the reading and the tree`;
}
