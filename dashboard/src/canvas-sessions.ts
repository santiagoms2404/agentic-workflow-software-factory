import type { SessionCard, SessionsResponse } from "../shared/types.ts";

const PAGE_SIZE = 100;

/** The canvas needs the whole formation, not the sessions board's newest page. */
export async function loadCanvasSessions(request: (url: string) => Promise<Response> = fetch): Promise<SessionsResponse> {
  const sessions = new Map<string, SessionCard>();
  let plans: SessionsResponse["plans"] | null = null;
  let before: SessionCard | undefined;
  for (;;) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (before !== undefined) {
      params.set("before", before.startedAt);
      params.set("beforeId", before.sessionId);
    }
    const response = await request(`/api/v1/sessions?${params}`);
    if (!response.ok) throw new Error("Canvas sessions unavailable");
    const page = await response.json() as SessionsResponse;
    plans ??= page.plans;
    for (const session of page.sessions) sessions.set(session.sessionId, session);
    if (page.sessions.length < PAGE_SIZE) return { sessions: [...sessions.values()], plans };
    const last = page.sessions.at(-1)!;
    if (before !== undefined && (last.startedAt > before.startedAt
      || (last.startedAt === before.startedAt && last.sessionId <= before.sessionId))) {
      throw new Error("Canvas session pagination did not advance");
    }
    before = last;
  }
}
