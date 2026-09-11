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

import { groupSummary, listGroupIds, readGroupTree, type GroupSummary, type GroupTree } from "../planning/views.ts";

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

export async function listGroupSummaries(options: PlanningReadOptions): Promise<GroupsResponse> {
  const groups: GroupSummary[] = [];
  const unreadable: string[] = [];
  for (const group of await listGroupIds(options.stateRoot, options.project)) {
    try {
      groups.push(groupSummary(await readGroupTree({ ...options, group })));
    } catch {
      unreadable.push(group);
    }
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
