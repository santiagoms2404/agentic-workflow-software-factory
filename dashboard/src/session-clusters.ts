import {
  groupSessionStacks,
  relatedSessions,
  type SessionStack,
  type StackableSession,
} from "./session-stacks.ts";

/**
 * Connection strings, derived — and never stored.
 *
 * A group-to-group connection already exists in the data: two runs that the
 * projection records as related, naming two different driving sessions. There
 * are exactly two such recorded relationships, and `session-stacks.ts` already
 * computes over both — the same task under a different attempt, and one task
 * declaring that it continues another. `awsf retry` refusing to inherit its
 * predecessor's group is what makes the first of those cross a session
 * boundary at all.
 *
 * Storing a separate group-to-group link would let it drift out of agreement
 * with the task chain it is meant to summarise. So there is no such record,
 * here or anywhere: every edge on this screen is read out of the two columns
 * the projector already writes, and from nothing else.
 *
 * `continues_task` is written onto EVERY session of a task, not only its
 * newest attempt, so a declaration made after the fact links each of them and
 * nothing here reads one attempt and assumes it speaks for the rest.
 */

export interface GroupableSession extends StackableSession {
  readonly groupId: string | null;
}

export interface GroupConnection {
  /** The two driving sessions this edge joins, in a stable order. */
  readonly from: string;
  readonly to: string;
  /** The two runs the edge was read from; the edge exists because they do. */
  readonly fromSessionId: string;
  readonly toSessionId: string;
  readonly kind: "same-task" | "continuation";
}

function connectionKey(connection: GroupConnection): string {
  return `${connection.from}|${connection.to}|${connection.fromSessionId}|${connection.toSessionId}`;
}

/** Every cross-group edge the recorded relationships imply, deduplicated. */
export function groupConnections(sessions: readonly GroupableSession[]): readonly GroupConnection[] {
  const found = new Map<string, GroupConnection>();
  for (let left = 0; left < sessions.length; left += 1) {
    for (let right = left + 1; right < sessions.length; right += 1) {
      const one = sessions[left]!;
      const other = sessions[right]!;
      if (one.groupId === null || other.groupId === null || one.groupId === other.groupId) continue;
      if (!relatedSessions(one, other)) continue;
      const forward = one.groupId < other.groupId;
      const connection: GroupConnection = {
        from: forward ? one.groupId : other.groupId,
        to: forward ? other.groupId : one.groupId,
        fromSessionId: forward ? one.sessionId : other.sessionId,
        toSessionId: forward ? other.sessionId : one.sessionId,
        kind: one.taskId === other.taskId ? "same-task" : "continuation",
      };
      found.set(connectionKey(connection), connection);
    }
  }
  return [...found.values()].sort((left, right) => connectionKey(left).localeCompare(connectionKey(right)));
}

/**
 * Which cluster each driving session belongs to, keyed by its lexicographically
 * first member so the key is stable across polls and does not depend on the
 * order the rows happened to arrive in.
 */
export function clusterKeys(
  groupIds: readonly string[],
  connections: readonly GroupConnection[],
): ReadonlyMap<string, string> {
  const roots = new Map<string, string>();
  for (const group of groupIds) roots.set(group, group);
  const find = (group: string): string => {
    let root = group;
    while (roots.get(root) !== root) root = roots.get(root) ?? root;
    return root;
  };
  for (const connection of connections) {
    if (!roots.has(connection.from) || !roots.has(connection.to)) continue;
    const left = find(connection.from);
    const right = find(connection.to);
    if (left !== right) roots.set(left < right ? right : left, left < right ? left : right);
  }
  return new Map([...roots.keys()].map((group) => [group, find(group)]));
}

/**
 * One deck of related runs, and the driving sessions its members name.
 *
 * `groupIds` is empty for a deck whose runs recorded no session — on the real
 * projection that is every deck on the board. One id is the ordinary case. Two
 * or more is the connection itself: a task whose attempts span two sessions is
 * one deck belonging to the seam rather than to either side, so it is drawn at
 * cluster level instead of being cut in half to fit inside a group card.
 */
export interface BoardMember<Session extends GroupableSession = GroupableSession> {
  readonly key: string;
  readonly groupIds: readonly string[];
  readonly stacks: readonly SessionStack<Session>[];
  /**
   * Runs in this deck that recorded no driving session at all.
   *
   * A deck is the atom: a task whose first attempt predates `--group` and
   * whose second carries one is still one deck, and cutting it in half to make
   * every card inside a session card honest would break the wallet the reader
   * already knows. So it travels with its deck and the card says how many.
   */
  readonly unsessioned: number;
  /** Newest visible run in this member; empty when the filters hide them all. */
  readonly rank: string;
}

/**
 * How many run cards a session card shows before it has to be opened.
 *
 * A container that grows with its contents takes the whole board row for four
 * runs and leaves the row beside it empty. Three is what a session card can
 * hold and still sit beside another one, so past three the card keeps its width
 * and grows a control instead.
 */
export const COLLAPSED_STACK_LIMIT = 3;

/**
 * How many board columns one session card occupies: one per deck it shows, and
 * never more than the collapse limit. A session with nine decks is three cards
 * wide and the other six are behind its expand control.
 */
export function memberSpan(member: Pick<BoardMember, "stacks">): number {
  return Math.min(Math.max(member.stacks.length, 1), COLLAPSED_STACK_LIMIT);
}

/**
 * How many board columns a section occupies.
 *
 * The SUM of its session cards, not the widest of them. Sessions inside a
 * cluster sit beside each other rather than stacking, so a two-deck session and
 * a one-deck session make a three-column card with no hole in it — the first
 * cut took the widest, which left the narrower session's row half empty inside
 * a card nothing else could be placed in.
 *
 * Capped at the collapse limit, so a cluster never eats more of the row than a
 * single session would, and expanding a session grows the card downward rather
 * than changing the width of the board under the reader.
 */
export function sectionSpan(section: Pick<BoardSection, "members">): number {
  const total = section.members.reduce((columns, member) => columns + memberSpan(member), 0);
  return Math.min(Math.max(total, 1), COLLAPSED_STACK_LIMIT);
}

export interface BoardSection<Session extends GroupableSession = GroupableSession> {
  readonly key: string;
  /**
   * `run` is a deck with no driving session and takes no container at all;
   * `group` is one session; `cluster` is two or more, connected. A container
   * appears only when it holds more than its child already shows.
   */
  readonly kind: "run" | "group" | "cluster";
  readonly members: readonly BoardMember<Session>[];
  readonly connections: readonly GroupConnection[];
  /**
   * Runs that carry a connection in this cluster and are not on the board.
   *
   * The cluster is derived from every run the board holds, never from the
   * filtered set, so hiding the only bridge between two sessions cannot split
   * them silently. It is reported here instead, because a cluster that stays
   * whole for a reason the reader cannot see is its own kind of lie.
   */
  readonly hiddenBridges: readonly string[];
  readonly rank: string;
}

function rankOf(stacks: readonly SessionStack<GroupableSession>[]): string {
  let newest = "";
  for (const stack of stacks) {
    for (const session of stack.sessions) if (session.startedAt > newest) newest = session.startedAt;
  }
  return newest;
}

/** Newest first, then by key, so a poll that changes nothing reorders nothing. */
function byRankThenKey(
  left: { readonly rank: string; readonly key: string },
  right: { readonly rank: string; readonly key: string },
): number {
  return right.rank.localeCompare(left.rank) || left.key.localeCompare(right.key);
}

/**
 * The board, most recent first, with connected sessions adjacent.
 *
 * Two orderings can contradict each other — strict global run recency, and
 * chains that must sit together — so the level that owns recency is stated
 * once here rather than left to whichever sort ran last:
 *
 *   OUTER   a section ranks by its newest VISIBLE run. A cluster therefore
 *           takes the position of its most recent member, which is what pulls
 *           an older connected session up beside a newer one. Ranking by the
 *           newest run including hidden ones would float a section holding
 *           nothing a reader can see.
 *   INNER   members of a cluster rank the same way, so the session that was
 *           driven most recently reads first inside it.
 *   DECK    runs inside a deck keep the order `orderSessionStack` already
 *           gives them. Nothing here touches it.
 *   TIE     the section or member key, which is a session id or a joined list
 *           of group ids. Deterministic, and independent of arrival order.
 *
 * An unrelated newer run is its own section and cannot land inside a cluster,
 * so it never splits one it has nothing to do with.
 */
export function boardSections<Session extends GroupableSession>(
  all: readonly Session[],
  visible: readonly Session[],
): readonly BoardSection<Session>[] {
  const connections = groupConnections(all);
  const recordedGroupIds = [...new Set(all.map((session) => session.groupId).filter((id): id is string => id !== null))];
  const clusterOf = clusterKeys(recordedGroupIds, connections);
  const visibleIds = new Set(visible.map((session) => session.sessionId));

  const sections: BoardSection<Session>[] = [];
  const clusters = new Map<string, Map<string, SessionStack<Session>[]>>();

  for (const stack of groupSessionStacks(visible)) {
    const groupIds = [...new Set(stack.sessions.map((session) => session.groupId).filter((id): id is string => id !== null))].sort();
    if (groupIds.length === 0) {
      sections.push({
        key: stack.key,
        kind: "run",
        members: [{ key: stack.key, groupIds: [], stacks: [stack], unsessioned: stack.sessions.length, rank: rankOf([stack]) }],
        connections: [],
        hiddenBridges: [],
        rank: rankOf([stack]),
      });
      continue;
    }
    const cluster = clusterOf.get(groupIds[0]!) ?? groupIds[0]!;
    const members = clusters.get(cluster) ?? new Map<string, SessionStack<Session>[]>();
    const memberKey = groupIds.join("+");
    members.set(memberKey, [...(members.get(memberKey) ?? []), stack]);
    clusters.set(cluster, members);
  }

  // A session inside a visible cluster whose own runs are all filtered out
  // still gets a card saying so. Dropping it would make the cluster look like
  // a connection to a session that produced nothing.
  for (const [group, cluster] of clusterOf) {
    const members = clusters.get(cluster);
    if (members === undefined || members.has(group)) continue;
    if ([...members.keys()].some((key) => key.split("+").includes(group))) continue;
    members.set(group, []);
  }

  for (const [cluster, members] of clusters) {
    const groupIds = [...clusterOf.keys()].filter((group) => clusterOf.get(group) === cluster).sort();
    const clusterConnections = connections.filter((connection) => clusterOf.get(connection.from) === cluster);
    const hiddenBridges = [...new Set(clusterConnections.flatMap((connection) =>
      [connection.fromSessionId, connection.toSessionId].filter((sessionId) => !visibleIds.has(sessionId))))].sort();
    const boardMembers = [...members.entries()]
      .map(([key, stacks]) => ({
        key,
        groupIds: key.split("+"),
        stacks,
        unsessioned: stacks.reduce(
          (total, stack) => total + stack.sessions.filter((session) => session.groupId === null).length,
          0,
        ),
        rank: rankOf(stacks),
      }))
      .sort(byRankThenKey);
    sections.push({
      key: `cluster:${groupIds.join("+")}`,
      kind: groupIds.length > 1 ? "cluster" : "group",
      members: boardMembers,
      connections: clusterConnections,
      hiddenBridges,
      rank: boardMembers.reduce((newest, member) => (member.rank > newest ? member.rank : newest), ""),
    });
  }

  return sections.sort(byRankThenKey);
}
