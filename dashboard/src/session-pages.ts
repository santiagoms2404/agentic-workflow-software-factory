import type { SessionCard, SessionsResponse } from "../shared/types.ts";

const PAGE_SIZE = 100;

/**
 * Every session, page by page. The sessions board, the groups view and the
 * canvas each count and draw the whole projection, so none of them may stop at
 * the API's newest page: a round of replays alone is more than one page.
 */
export async function loadAllSessions(request: (url: string) => Promise<Response> = fetch): Promise<SessionsResponse> {
  const sessions = new Map<string, SessionCard>();
  let plans: SessionsResponse["plans"] | null = null;
  // The plan list's flags ride with the first page's list: a stale or
  // unresolved catalog (O4) must reach the views, not be dropped here.
  let planFlags: Pick<SessionsResponse, "stale" | "planError"> = {};
  let before: SessionCard | undefined;
  for (;;) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (before !== undefined) {
      params.set("before", before.startedAt);
      params.set("beforeId", before.sessionId);
    }
    const response = await request(`/api/v1/sessions?${params}`);
    if (!response.ok) throw new Error("Sessions unavailable");
    const page = await response.json() as SessionsResponse;
    if (plans === null) {
      plans = page.plans;
      planFlags = {
        ...(page.stale === true ? { stale: true as const } : {}),
        ...(page.planError === undefined ? {} : { planError: page.planError }),
      };
    }
    for (const session of page.sessions) sessions.set(session.sessionId, session);
    if (page.sessions.length < PAGE_SIZE) return { sessions: [...sessions.values()], plans, ...planFlags };
    const last = page.sessions.at(-1)!;
    if (before !== undefined && (last.startedAt > before.startedAt
      || (last.startedAt === before.startedAt && last.sessionId <= before.sessionId))) {
      throw new Error("Session pagination did not advance");
    }
    before = last;
  }
}
