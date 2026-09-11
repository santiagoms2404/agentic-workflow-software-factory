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

export interface GroupHeading {
  readonly summary: GroupSummary;
  /** How many runs currently on the board belong to this group. */
  readonly runs: number;
}

/**
 * Every recorded driving session, each carrying how many runs on the board
 * belong to it.
 *
 * The first cut showed ONLY the groups the visible runs named, because the
 * heading is meant to sit above a group of related runs and a title with no
 * runs under it is a floating heading. Measured against the real projection
 * that rule hid everything: no run predating `--group` carries one, legacy rows
 * are never backfilled, and so 19 recorded decisions and 56 recorded
 * alternatives were reachable only by typing an API URL. A history the screen
 * refuses to show is worth less than a heading that admits it has no runs
 * under it today.
 *
 * Groups with runs sort first, so the original reading — this ask produced
 * these runs — still comes first when it applies.
 */
export function groupsForRuns(
  summaries: readonly GroupSummary[],
  runGroupIds: readonly (string | null)[],
): readonly GroupHeading[] {
  const counts = new Map<string, number>();
  for (const id of runGroupIds) {
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const headings = summaries.map((summary) => ({ summary, runs: counts.get(summary.group) ?? 0 }));
  return [...headings.filter((heading) => heading.runs > 0), ...headings.filter((heading) => heading.runs === 0)];
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
