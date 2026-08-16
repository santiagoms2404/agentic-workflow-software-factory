import { queryBacklog, type Backlog } from "../../backlog.ts";
import { backlogSessionCosts } from "../../observability/queries.ts";
import { openDatabase } from "../../observability/sqlite.ts";
import type { TicketStore } from "../../persistence/ticket-store.ts";

/** Render-only CLI view of the same query served by GET /api/v1/tickets. */
export async function backlogCommand(store: TicketStore, dbPath: string): Promise<readonly string[]> {
  let sessions = [] as ReturnType<typeof backlogSessionCosts>;
  try {
    const db = openDatabase(dbPath, { readonly: true });
    try { sessions = backlogSessionCosts(db); } finally { db.close(); }
  } catch { /* A first-use backlog has no projection yet; its cost is partial. */ }
  return renderBacklog(await queryBacklog(store, sessions.map((row) => ({ taskId: row.task_id, estimatedCostUsd: row.estimated_cost_usd, costAuthority: row.cost_authority }))));
}

export function renderBacklog(backlog: Backlog): readonly string[] {
  const cost = backlog.projectedCost;
  const amount = cost.usd === null ? "—" : `${cost.authority === "catalog-estimate" ? "≈ " : ""}$${cost.usd.toFixed(2)}`;
  const authority = cost.partial ? "partial" : cost.authority === "catalog-estimate" ? "estimate" : cost.authority;
  return [
    `state: ${Object.entries(backlog.counts.state).map(([key, value]) => `${key}=${value}`).join(" ")}`,
    `milestone: ${Object.entries(backlog.counts.milestone).map(([key, value]) => `${key}=${value}`).join(" ")}`,
    `tier: ${Object.entries(backlog.counts.tier).map(([key, value]) => `${key}=${value}`).join(" ")}`,
    `ready (${backlog.ready.length}): ${backlog.ready.map((ticket) => ticket.id).join(", ") || "—"}`,
    `projected cost: ${amount} · ${authority}`,
  ];
}
