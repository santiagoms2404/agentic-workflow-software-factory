import type { LifecycleState, SessionCard } from "../shared/types.ts";

export type StackableSession = Pick<
  SessionCard,
  "sessionId" | "project" | "taskId" | "continuesTask" | "attempt" | "startedAt" | "state"
>;

export const MAX_SESSION_STACK_BANDS = 3;
export const SESSION_STACK_TONE_COUNT = 5;

export interface SessionStack<Session extends StackableSession = StackableSession> {
  readonly key: string;
  readonly sessions: readonly Session[];
}

function related(left: StackableSession, right: StackableSession): boolean {
  if (left.project !== right.project) return false;
  return (left.taskId === right.taskId && left.attempt !== right.attempt)
    || left.continuesTask === right.taskId
    || right.continuesTask === left.taskId;
}

/**
 * Connected components over only the two recorded relationships. Stack order
 * follows the first member in the supplied grid order; task ids are compared
 * literally and are never parsed for a naming convention.
 */
export function groupSessionStacks<Session extends StackableSession>(
  sessions: readonly Session[],
): readonly SessionStack<Session>[] {
  const parents = sessions.map((_session, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root]!;
    while (parents[index] !== index) {
      const next = parents[index]!;
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const join = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < sessions.length; left += 1) {
    for (let right = left + 1; right < sessions.length; right += 1) {
      if (related(sessions[left]!, sessions[right]!)) join(left, right);
    }
  }

  const grouped = new Map<number, Session[]>();
  for (let index = 0; index < sessions.length; index += 1) {
    const root = find(index);
    const stack = grouped.get(root);
    if (stack === undefined) grouped.set(root, [sessions[index]!]);
    else stack.push(sessions[index]!);
  }
  return [...grouped.values()].map((stack) => ({ key: stack[0]!.sessionId, sessions: stack }));
}

function chronological<Session extends StackableSession>(left: Session, right: Session): number {
  return left.startedAt.localeCompare(right.startedAt) || left.sessionId.localeCompare(right.sessionId);
}

function settledRank(state: LifecycleState): number {
  if (state === "LANDED") return 2;
  if (state === "PUBLISHED") return 1;
  return 0;
}

/** Highest-priority front first: LANDED, then PUBLISHED, then newest. */
export function compareSessionFronts<Session extends StackableSession>(left: Session, right: Session): number {
  return settledRank(right.state) - settledRank(left.state)
    || right.startedAt.localeCompare(left.startedAt)
    || left.sessionId.localeCompare(right.sessionId);
}

/** Oldest peek first and the deterministic default front last. */
export function orderSessionStack<Session extends StackableSession>(
  sessions: readonly Session[],
): readonly Session[] {
  if (sessions.length < 2) return [...sessions];
  const front = [...sessions].sort(compareSessionFronts)[0]!;
  return [
    ...sessions.filter((session) => session.sessionId !== front.sessionId).sort(chronological),
    front,
  ];
}

export interface SessionPeekWindow<Session extends StackableSession = StackableSession> {
  readonly visible: readonly Session[];
  readonly hiddenCount: number;
}

/** Keep the front card tall enough by replacing surplus rear peeks with one band. */
export function sessionPeekWindow<Session extends StackableSession>(
  ordered: readonly Session[],
): SessionPeekWindow<Session> {
  const peeks = ordered.slice(0, -1);
  if (peeks.length <= MAX_SESSION_STACK_BANDS) return { visible: peeks, hiddenCount: 0 };
  const visibleCount = MAX_SESSION_STACK_BANDS - 1;
  return {
    visible: peeks.slice(-visibleCount),
    hiddenCount: peeks.length - visibleCount,
  };
}

/**
 * Tone depth is one-based behind the front card. The front is deliberately
 * untoned, while depths beyond the finite ramp retain its lightest endpoint.
 */
export function sessionStackToneClass(depthFromFront: number): string | undefined {
  if (!Number.isInteger(depthFromFront) || depthFromFront < 1) return undefined;
  return `session-stack-tone-${Math.min(depthFromFront, SESSION_STACK_TONE_COUNT)}`;
}

/** Assign the nearest peek tone one, then walk the ramp toward the rear. */
export function sessionStackTones<Session extends StackableSession>(
  ordered: readonly Session[],
): ReadonlyMap<string, string> {
  const tones = new Map<string, string>();
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const tone = sessionStackToneClass(ordered.length - 1 - index);
    if (tone !== undefined) tones.set(ordered[index]!.sessionId, tone);
  }
  return tones;
}

/** Expand every peek inside the deck's bounded scrolling viewport. */
export function sessionVisiblePeeks<Session extends StackableSession>(
  ordered: readonly Session[],
  expanded: boolean,
): readonly Session[] {
  return expanded ? ordered.slice(0, -1) : sessionPeekWindow(ordered).visible;
}

/**
 * Move one peek to the front while putting the former front directly behind
 * it. Every other run retains its current relative order.
 */
export function promoteSession<Session extends StackableSession>(
  ordered: readonly Session[],
  sessionId: string,
): readonly Session[] {
  const selected = ordered.find((session) => session.sessionId === sessionId);
  const previousFront = ordered[ordered.length - 1];
  if (selected === undefined || previousFront === undefined || selected === previousFront) return [...ordered];
  return [
    ...ordered.filter((session) => session !== selected && session !== previousFront),
    previousFront,
    selected,
  ];
}

export interface SessionPromotion<Session extends StackableSession = StackableSession> {
  readonly ordered: readonly Session[];
  readonly frontToneClass: string | undefined;
}

/** Promote a peek and carry the positional tone visible at selection time. */
export function promoteSessionWithTone<Session extends StackableSession>(
  ordered: readonly Session[],
  sessionId: string,
): SessionPromotion<Session> {
  return {
    ordered: promoteSession(ordered, sessionId),
    frontToneClass: sessionStackTones(ordered).get(sessionId),
  };
}

/** Removing the front reveals the run directly behind it without a blank slot. */
export function removeSessionFromStack<Session extends StackableSession>(
  ordered: readonly Session[],
  sessionId: string,
): readonly Session[] {
  return ordered.filter((session) => session.sessionId !== sessionId);
}
