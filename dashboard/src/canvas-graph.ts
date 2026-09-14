import type { GroupSummary, SessionCard, SessionPlan } from "../shared/types.ts";
import { clusterKeys, groupConnections, type GroupableSession } from "./session-clusters.ts";
import { groupTitle } from "./session-groups.ts";
import { groupSessionStacks } from "./session-stacks.ts";

/**
 * The execution graph: what the canvas draws.
 *
 * A different graph from the one `#/groups/<id>` draws. That one is a session's
 * PLANNING journal — asks, decisions, alternatives. This one is EXECUTION —
 * runs, the sessions that produced them and the plans they came from. Two
 * surfaces, one design language, linked to each other rather than each drawing
 * half of the other.
 *
 * Every node and every edge is read out of the projection the board already
 * holds. Nothing here is stored, and nothing is inferred from the shape of a
 * name: a run says which plan it came from, so a plan edge is real, and a run
 * says nothing about which ticket, so no ticket edge is drawn.
 */

export type CanvasNodeKind = "run" | "session" | "plan";

/**
 * `continuation` is the owner's connection string: the two edges of a deck
 * whose runs name two different driving sessions. The string is drawn THROUGH
 * the deck rather than as a separate session-to-session line, because the deck
 * is the work that made the connection — a direct line beside these two would
 * draw a triangle over one relationship.
 */
export type CanvasEdgeKind = "continuation" | "membership" | "plan";

export interface CanvasNode {
  readonly id: string;
  readonly kind: CanvasNodeKind;
  /** Shown on hover, never at rest: the graph is a shape, not a wall of text. */
  readonly label: string;
  /** Runs behind this node, which is what sets its size on the canvas. */
  readonly weight: number;
  /** The sessions a run node's deck holds, in order of execution. */
  readonly sessionIds: readonly string[];
  /** The driving session or plan this node IS, for the routes that open it. */
  readonly ref: string | null;
}

export interface CanvasEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: CanvasEdgeKind;
}

export interface CanvasCluster {
  readonly key: string;
  /** Session node ids the region is drawn behind. */
  readonly nodeIds: readonly string[];
}

export interface CanvasGraph {
  /** What goes on the map: every node with at least one run behind it. */
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  readonly clusters: readonly CanvasCluster[];
  /**
   * Recorded, but nothing places it on the map yet.
   *
   * A driving session whose journal exists and whose runs are all elsewhere, or
   * a registered plan no run has named. On the owner's real projection that is
   * twelve plans and two sessions — fourteen of forty-seven dots, a third of
   * the canvas, every one of them connected to nothing.
   *
   * On the sessions strip the same state is a menu row reading "no runs on this
   * board", which is fine because a menu is a list. On a map it is a drift of
   * dots with no lines, which reads as a broken graph rather than as an honest
   * one. So they are kept — dropping them would make a recorded session
   * unreachable, which is the failure `72e967f` already fixed once — and
   * handed to the renderer separately, to sit in a rail that says what they
   * are rather than to float in the middle of the drawing.
   *
   * A RUN node is never parked here. It always has at least itself behind it,
   * and on a projection where no run carries a group or a plan the map is
   * nothing but run dots — which is the honest picture of that projection.
   */
  readonly unplaced: readonly CanvasNode[];
}

export type CanvasSession = GroupableSession & Pick<SessionCard, "planRef" | "taskId">;

export function runNodeId(sessionIds: readonly string[]): string {
  // The smallest session id, not the first: a deck's key follows the order the
  // rows arrived in, and a node id that moves when the API reorders its page
  // would break every stored position and every URL naming a selection.
  return `run:${[...sessionIds].sort()[0] ?? ""}`;
}

export function sessionNodeId(group: string): string {
  return `session:${group}`;
}

export function planNodeId(plan: string): string {
  return `plan:${plan}`;
}

/** Oldest first: a deck opens as a pipeline, and a pipeline runs forwards. */
function byExecution(left: CanvasSession, right: CanvasSession): number {
  return left.startedAt.localeCompare(right.startedAt) || left.sessionId.localeCompare(right.sessionId);
}

/**
 * Nodes and edges, from the runs the board is already holding.
 *
 * A deck is ONE node. Three attempts of a task and the continuation opened
 * against them are one dot that opens into a pipeline, which is what keeps
 * forty-four runs at thirty-six dots — and it is why no run-to-run edge exists
 * on this canvas: every recorded relationship between two runs is inside a
 * deck, and the wheel is where it is read.
 */
export function buildCanvasGraph(
  sessions: readonly CanvasSession[],
  summaries: readonly GroupSummary[],
  plans: readonly SessionPlan[],
): CanvasGraph {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const summaryOf = new Map(summaries.map((summary) => [summary.group, summary]));
  const planIds = new Set(plans.map((plan) => plan.id));
  const groupWeight = new Map<string, number>();
  const planWeight = new Map<string, number>();

  for (const stack of groupSessionStacks(sessions)) {
    const ordered = [...stack.sessions].sort(byExecution);
    const id = runNodeId(ordered.map((session) => session.sessionId));
    const groups = [...new Set(ordered.map((session) => session.groupId).filter((group): group is string => group !== null))].sort();
    const named = [...new Set(ordered.map((session) => session.planRef).filter((plan): plan is string => plan !== null))].sort();
    nodes.push({
      id,
      kind: "run",
      label: [...new Set(ordered.map((session) => session.taskId))].join(" → "),
      weight: ordered.length,
      sessionIds: ordered.map((session) => session.sessionId),
      ref: null,
    });
    // A deck naming two sessions IS the connection between them, so both of its
    // edges take the connection treatment rather than the faint membership one.
    const kind: CanvasEdgeKind = groups.length > 1 ? "continuation" : "membership";
    for (const group of groups) {
      edges.push({ from: id, to: sessionNodeId(group), kind });
      groupWeight.set(group, (groupWeight.get(group) ?? 0) + ordered.length);
    }
    for (const plan of named) {
      // A plan nobody registers gets no node, so it gets no edge either: the
      // run keeps the name it recorded on its own card, which is where an
      // unregistered plan is already reported.
      if (!planIds.has(plan)) continue;
      edges.push({ from: id, to: planNodeId(plan), kind: "plan" });
      planWeight.set(plan, (planWeight.get(plan) ?? 0) + ordered.length);
    }
  }

  // Every recorded session gets a node, including one no run on the board
  // names: its decisions are reachable from the map rather than only from a
  // URL, which is the same rule the sessions strip already keeps.
  const namedGroups = [...new Set(sessions.map((session) => session.groupId).filter((group): group is string => group !== null))];
  for (const group of [...new Set([...summaryOf.keys(), ...namedGroups])].sort()) {
    nodes.push({
      id: sessionNodeId(group),
      kind: "session",
      label: summaryOf.has(group) ? groupTitle(summaryOf.get(group)) : "no ask recorded under this id",
      weight: groupWeight.get(group) ?? 0,
      sessionIds: [],
      ref: group,
    });
  }
  for (const plan of plans) {
    nodes.push({
      id: planNodeId(plan.id),
      kind: "plan",
      label: plan.name,
      weight: planWeight.get(plan.id) ?? 0,
      sessionIds: [],
      ref: plan.id,
    });
  }

  const connections = groupConnections(sessions);
  const clusterOf = clusterKeys(namedGroups.slice().sort(), connections);
  const grouped = new Map<string, string[]>();
  for (const [group, cluster] of clusterOf) {
    grouped.set(cluster, [...(grouped.get(cluster) ?? []), sessionNodeId(group)]);
  }
  const clusters = [...grouped.entries()]
    // A region is drawn only where there is something to enclose: one session
    // in a cluster of its own is a dot, not a dot inside a box.
    .filter(([, nodeIds]) => nodeIds.length > 1)
    .map(([key, nodeIds]) => ({ key, nodeIds: nodeIds.slice().sort() }))
    .sort((left, right) => left.key.localeCompare(right.key));

  // Sorted, so the simulation below starts every node from the same place on
  // every load and the picture is reproducible.
  const ordered = nodes.sort((left, right) => left.id.localeCompare(right.id));
  const placed = (node: CanvasNode): boolean => node.kind === "run" || node.weight > 0;
  return {
    nodes: ordered.filter(placed),
    edges: edges.sort((left, right) => `${left.from}|${left.to}`.localeCompare(`${right.from}|${right.to}`)),
    clusters,
    unplaced: ordered.filter((node) => !placed(node)),
  };
}
