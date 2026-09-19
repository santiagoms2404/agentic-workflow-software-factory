import type { GroupSummary, SessionCard } from "../shared/types.ts";
import { groupsForRuns, unrecordedGroupIds } from "./group-tree.ts";
import { matchesSelections, type FilterableSession } from "./session-filters.ts";

/**
 * The bucket a run with no driving session falls into.
 *
 * A group id is validated as `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, so a leading
 * colon can never be one. That matters: this value sits in the same selection
 * array as real group ids, and a sentinel a driver could accidentally mint
 * would silently merge that session with every legacy run on the board.
 *
 * It is not a small bucket. Every one of the owner's forty-four recorded runs
 * predates `--group`, and D7 forbids backfilling them, so on the real
 * projection this bucket holds the entire board and the recorded groups hold
 * nothing. It is listed FIRST for that reason: the menu scrolls after two
 * entries, and a bucket holding every visible run does not belong below the
 * fold behind two sessions that have none.
 */
export const NO_DRIVING_SESSION = ":no-driving-session";

export interface GroupedSession {
  readonly groupId: string | null;
  /** The group filter's value for this run: its group id, or the sentinel. */
  readonly groupKey: string;
}

export interface GroupFilterEntry {
  readonly value: string;
  /** Runs on the board, constrained only by the OTHER three menus. */
  readonly count: number;
  /** The planning journal behind this group, where one exists. */
  readonly summary: GroupSummary | null;
  /** A group a run names that no journal recorded, reported rather than hidden. */
  readonly unrecorded: boolean;
}

export function groupKeyOf(groupId: string | null): string {
  return groupId ?? NO_DRIVING_SESSION;
}

/** Annotates each run with its bucket once, so every count reads one field. */
export function withGroupKey<Session extends Pick<SessionCard, "groupId">>(
  sessions: readonly Session[],
): readonly (Session & GroupedSession)[] {
  return sessions.map((session) => ({ ...session, groupId: session.groupId, groupKey: groupKeyOf(session.groupId) }));
}

/**
 * Every value the group menu can offer, in menu order.
 *
 * Derived from the recorded journals and from the ids the runs themselves
 * name, so a group with a journal and no runs still gets a control, and so
 * does a group a driver minted without capturing an ask under it. Both are
 * real states and a menu that offers neither leaves those runs unreachable.
 *
 * Computed over ALL runs rather than the filtered ones: an entry that vanishes
 * when its own runs are hidden takes away the only control that brings them
 * back.
 */
export function groupFilterValues(
  sessions: readonly Pick<SessionCard, "groupId">[],
  summaries: readonly GroupSummary[],
): readonly string[] {
  const named = sessions.map((session) => session.groupId);
  return [
    NO_DRIVING_SESSION,
    ...summaries.map((summary) => summary.group),
    ...unrecordedGroupIds(summaries, named),
  ];
}

/**
 * Group counts, constrained only by the other three menus — the same contract
 * `workflowFilterEntries`, `stateFilterEntries` and `planKindFilterEntries`
 * already keep, so a fourth menu joins that convention rather than inventing
 * its own.
 *
 * Ordering reuses `groupsForRuns`, so a session with runs on this board still
 * reads before one without, and the sentinel keeps its fixed first place.
 */
export function groupFilterEntries<Session extends FilterableSession & GroupedSession>(
  sessions: readonly Session[],
  summaries: readonly GroupSummary[],
  selectedWorkflows: readonly string[],
  selectedStates: readonly string[],
  selectedPlanKinds: readonly string[],
): readonly GroupFilterEntry[] {
  // Every key present, so this menu never narrows its own counts. Built here
  // rather than asked of the caller: three of these arguments constrain and one
  // must not, and a caller that forgets which reports zero for every session.
  const others = matchesSelections(
    selectedWorkflows,
    selectedStates,
    selectedPlanKinds,
    sessions.map((session) => session.groupKey),
  );
  const constrained = sessions.filter((session) => others(session));
  const counts = new Map<string, number>();
  for (const session of constrained) counts.set(session.groupKey, (counts.get(session.groupKey) ?? 0) + 1);
  const headings = groupsForRuns(summaries, constrained.map((session) => session.groupId));
  const unrecorded = unrecordedGroupIds(summaries, sessions.map((session) => session.groupId));
  return [
    { value: NO_DRIVING_SESSION, count: counts.get(NO_DRIVING_SESSION) ?? 0, summary: null, unrecorded: false },
    ...headings.map((heading) => ({
      value: heading.summary.group,
      count: heading.runs,
      summary: heading.summary,
      unrecorded: false,
    })),
    ...unrecorded.map((group) => ({
      value: group,
      count: counts.get(group) ?? 0,
      summary: null,
      unrecorded: true,
    })),
  ];
}

/**
 * What a driving session is called, wherever it is named.
 *
 * One source for the menu entry, the heading above a cluster of related runs
 * and the tree's own screen, so the same session cannot read as three
 * different things on three surfaces. It is the group's first recorded Input,
 * never a generated summary: a group with no ask says so.
 */
export function groupTitle(summary: GroupSummary | null | undefined): string {
  return summary?.title ?? "no ask recorded in this group";
}

/** What the menu calls a bucket that is not a driving session at all. */
export function groupFilterLabel(entry: GroupFilterEntry): string {
  if (entry.value === NO_DRIVING_SESSION) return "no driving session";
  if (entry.unrecorded) return "no ask recorded under this id";
  return groupTitle(entry.summary);
}
