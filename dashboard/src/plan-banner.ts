import type { PlanResolutionError, SessionsResponse, TicketsResponse } from "../shared/types.ts";

/**
 * What the plan board says when its catalog did not resolve (inv 12, owner
 * decision O4). The tickets route answers in two ways, and both used to look
 * like an ordinary board: a refusal coded `PlanUnresolved` when no catalog has
 * resolved yet (the board was empty with HTTP 200), and the last good board
 * beside `stale: true` (the board looked current). Either one shows a banner
 * carrying the server's own message; a fresh board shows none.
 */
export interface PlanBanner {
  readonly kind: "refused" | "stale";
  readonly heading: string;
  readonly detail: string;
}

/** The tickets route's answer, as far as the banner needs it. */
export type PlanBoardRead =
  | { readonly ok: true; readonly body: Pick<TicketsResponse, "stale" | "planError"> }
  | { readonly ok: false; readonly body: unknown };

const PLAN_UNRESOLVED: PlanResolutionError["code"] = "PlanUnresolved";

/** The named refusal in a failed response's body, or null for any other failure. */
export function planRefusal(body: unknown): PlanResolutionError | null {
  if (typeof body !== "object" || body === null) return null;
  const { code, error } = body as { code?: unknown; error?: unknown };
  if (code !== PLAN_UNRESOLVED || typeof error !== "string") return null;
  return { code: PLAN_UNRESOLVED, message: error };
}

/**
 * The banner over the views that draw runs against the sessions route's plan
 * list (the sessions board, the groups view, the canvas). That route never
 * refuses, because its runs are database rows, so its two failed answers are a
 * last good plan list beside `stale: true`, and an empty one beside the error.
 */
export function sessionsPlanBanner(body: Pick<SessionsResponse, "stale" | "planError">): PlanBanner | null {
  if (body.planError === undefined) return null;
  if (body.stale === true) {
    return {
      kind: "stale",
      heading: "The plan catalog no longer resolves. Runs are shown against the last plan list that did.",
      detail: body.planError.message,
    };
  }
  return {
    kind: "refused",
    heading: "The plan catalog does not resolve, so runs are shown without their plans.",
    detail: body.planError.message,
  };
}

/** The banner for one read of the board, or null when the board is current. */
export function planBanner(read: PlanBoardRead): PlanBanner | null {
  if (!read.ok) {
    const refusal = planRefusal(read.body);
    if (refusal === null) return null;
    return {
      kind: "refused",
      heading: "The plan catalog does not resolve, so there is no board to show.",
      detail: refusal.message,
    };
  }
  if (read.body.stale !== true) return null;
  return {
    kind: "stale",
    heading: "The plan catalog no longer resolves. This is the last board that did.",
    detail: read.body.planError?.message ?? "The server did not name the error.",
  };
}
