import type { GroupSummary, GroupTree, TreeNarrative, TreeProposal } from "../shared/types.ts";

/**
 * Where a line of text came from. The `authority` field on a stage already
 * carries this, so nothing here re-derives it — these are the three classes the
 * renderer distinguishes, and they exist so the owner's own words are never
 * shown in the same voice as the assistant's reading of them.
 */
export type TreeVoice = "owner-input" | "assistant-proposal" | "owner-decision";

export const VOICE_LABEL: Readonly<Record<TreeVoice, string>> = {
  "owner-input": "the owner asked",
  "assistant-proposal": "the assistant proposed",
  "owner-decision": "the owner decided",
};

/**
 * A recorded field, or the fact that it is missing.
 *
 * Every narrative field is a plain string that may be empty, and an empty one
 * means it was never written. Rendering "" as blank space reads as a layout
 * bug; rendering it as invented prose would be a lie. So it becomes an explicit
 * absence, and the caller styles it as one.
 */
export interface RecordedField {
  readonly recorded: boolean;
  readonly text: string;
}

export function field(value: string): RecordedField {
  const text = value.trim();
  return text.length === 0 ? { recorded: false, text: "not recorded" } : { recorded: true, text };
}

export interface NarrativeFields {
  readonly explanation: RecordedField;
  readonly changes: RecordedField;
  readonly reason: RecordedField;
  readonly friction: RecordedField;
}

export function narrativeFields(narrative: TreeNarrative): NarrativeFields {
  return {
    explanation: field(narrative.explanation),
    changes: field(narrative.changes),
    reason: field(narrative.reason),
    friction: field(narrative.friction),
  };
}

/**
 * Why a proposal is on the tree and not on the spine.
 *
 * A proposal nobody has decided on yet and one a later stage has already
 * overtaken are both "not taken", and they are not the same thing: the first is
 * still open, the second can no longer be applied without being re-proposed.
 */
export function notTakenReason(proposal: TreeProposal): string {
  return proposal.appliable
    ? "proposed and not yet decided"
    : "never applied; a later stage overtook it, so it can no longer be taken without being re-proposed";
}

/** The groups a set of runs belongs to, in the order the group list gives. */
export function groupsForRuns(
  summaries: readonly GroupSummary[],
  runGroupIds: readonly (string | null)[],
): readonly GroupSummary[] {
  const present = new Set(runGroupIds.filter((id): id is string => id !== null));
  return summaries.filter((summary) => present.has(summary.group));
}

/**
 * Group ids a run names that the planning store has no record of.
 *
 * Reported rather than hidden: a run carrying a group with no journal behind it
 * is a real state — the driver minted an id and never captured an input under
 * it — and a screen that silently drops the heading makes that look like a run
 * that belonged to nothing.
 */
export function unrecordedGroupIds(
  summaries: readonly GroupSummary[],
  runGroupIds: readonly (string | null)[],
): readonly string[] {
  const known = new Set(summaries.map((summary) => summary.group));
  return [...new Set(runGroupIds.filter((id): id is string => id !== null && !known.has(id)))].sort();
}

/** The asks and decisions that name one task, for tracing a run back. */
export function traceTask(tree: GroupTree, taskId: string): { readonly proposals: readonly string[]; readonly asks: readonly string[] } {
  return tree.byTask[taskId] ?? { proposals: [], asks: [] };
}
