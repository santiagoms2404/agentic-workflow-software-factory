import type { LifecycleState, PhaseStatus, SessionCard } from "../shared/types.ts";

const LIVE_SESSION_STATES: ReadonlySet<LifecycleState> = new Set(["RUNNING", "GATING", "REVIEWING", "LANDING"]);
const AGENT_FALLBACK_COLORS = ["var(--purple)", "var(--cyan)", "var(--red)", "var(--violet)", "var(--amber)"] as const;

export interface SessionExtent {
  readonly start: number;
  readonly end: number;
  readonly span: number;
  /** Null while the session is live, so duration formatting uses the current time. */
  readonly runtimeEnd: string | null;
}

export function sessionExtent(
  session: Pick<SessionCard, "startedAt" | "updatedAt" | "endedAt" | "state" | "activity">,
  now: number,
): SessionExtent {
  const start = Date.parse(session.startedAt);
  const observed = Math.max(
    Date.parse(session.updatedAt),
    ...session.activity.map((point) => Date.parse(point.endedAt ?? point.startedAt)),
  );
  const live = LIVE_SESSION_STATES.has(session.state);
  const end = Math.max(start + 1_000, session.endedAt ? Date.parse(session.endedAt) : live ? now : observed);
  return {
    start,
    end,
    span: Math.max(1_000, end - start),
    runtimeEnd: live && session.endedAt === null ? null : new Date(end).toISOString(),
  };
}

/** Stable for the same agent in the card, roster, and timeline. */
export function agentFallbackColor(agent: string): string {
  let hash = 0;
  for (const character of agent) hash = (hash * 31 + character.codePointAt(0)!) | 0;
  return AGENT_FALLBACK_COLORS[Math.abs(hash % AGENT_FALLBACK_COLORS.length)]!;
}

export function askLine(text: string | null, budget = 150): string | null {
  if (text === null) return null;
  const first = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  if (first.length === 0) return null;
  const characters = Array.from(first);
  return characters.length <= budget ? first : `${characters.slice(0, budget - 1).join("")}…`;
}

export function phaseStatusGlyph(status: PhaseStatus): string {
  if (status === "SUCCEEDED") return "●";
  if (status === "FAILED" || status === "CANCELLED") return "×";
  if (status === "RUNNING" || status === "VALIDATING" || status === "CORRECTING") return "◐";
  return "○";
}
