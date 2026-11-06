// The one read-only path from the API to the planning store.
//
// `planning-isolation.test.ts` permits exactly two files to import
// `core/src/planning/`: the CLI's `group.ts`, and this file. The fence's stated
// purpose is that "gates, lifecycle and accounting cannot acquire a planning
// import", and a dashboard read route is none of those — but the allowance is
// exactly one named path and exactly one imported module, so the route lives
// here rather than in `routes.ts`, where a later edit could reach for anything
// under `planning/` without anyone noticing the fence had widened.
//
// `views.ts` is the read-only module. Nothing here replays a journal to write
// one, and no operation, event, capture, proposal or approval type is imported:
// the tree is a projection, and this file can only read it.

import { listGroupIds, readGroupSummary, readGroupTree, type GroupSummary, type GroupTree } from "../planning/views.ts";

export interface GroupsResponse {
  readonly groups: readonly GroupSummary[];
  /**
   * Groups whose journal could not be replayed, named rather than dropped. A
   * group that vanishes from the list because it is corrupt is worse than one
   * that says it is corrupt.
   */
  readonly unreadable: readonly string[];
}

export interface PlanningReadOptions {
  readonly stateRoot: string;
  readonly project: string;
}

function isJournalReplayError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof RangeError ||
    error instanceof SyntaxError ||
    error.name === "AssertionError"
  ) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "EACCES" || code === "EPERM") return true;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("journal") ||
    msg.includes("corrupt") ||
    msg.includes("digest") ||
    msg.includes("schema") ||
    msg.includes("revision") ||
    msg.includes("event") ||
    msg.includes("proposal") ||
    msg.includes("prerequisite") ||
    msg.includes("split") ||
    msg.includes("unit") ||
    msg.includes("symlink") ||
    msg.includes("append")
  );
}

export async function listGroupSummaries(options: PlanningReadOptions): Promise<GroupsResponse> {
  const groups: GroupSummary[] = [];
  const unreadable: string[] = [];
  for (const group of await listGroupIds(options.stateRoot, options.project)) {
    let summary: GroupSummary;
    try {
      summary = await readGroupSummary({ ...options, group });
    } catch (error) {
      if (isJournalReplayError(error)) {
        unreadable.push(group);
        continue;
      }
      throw error;
    }
    // A directory can survive a failed first capture without any journal. The
    // detail route and CLI both treat revision zero as absent, so the list must
    // not advertise it as a group that can be opened.
    if (summary.revision !== 0) groups.push(summary);
  }
  // Newest first: the group a reader is most likely looking for is the one they
  // were just driving. A group with no input has no time and sorts last.
  groups.sort((left, right) => (right.at ?? "").localeCompare(left.at ?? "") || left.group.localeCompare(right.group));
  return { groups, unreadable };
}

export async function readGroupDecisionTree(options: PlanningReadOptions & { readonly group: string }): Promise<GroupTree> {
  return readGroupTree(options);
}

export type { GroupSummary, GroupTree };
