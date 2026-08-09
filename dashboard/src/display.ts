import type { CostAuthority, LifecycleState, ModelProvenance, UsageTotals } from "../shared/types.ts";

export function formatCost(authority: CostAuthority, usd: number | null): string {
  if (authority === "unavailable") return "— subscription";
  if (usd === null) return "—";
  const amount = `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
  return authority === "catalog-estimate" ? `≈ ${amount}` : amount;
}

export function costAuthorityLabel(authority: CostAuthority): string {
  return authority === "provider" ? "provider" : authority === "catalog-estimate" ? "estimate" : "subscription";
}

export function formatUsage(usage: UsageTotals): string {
  if (usage.totalTokens === null) return "—";
  if (usage.totalTokens >= 1_000_000) return `${(usage.totalTokens / 1_000_000).toFixed(2)}M`;
  if (usage.totalTokens >= 1_000) return `${(usage.totalTokens / 1_000).toFixed(1)}k`;
  return String(usage.totalTokens);
}

export function formatDuration(startedAt: string, endedAt: string | null, now = Date.now()): string {
  const milliseconds = Math.max(0, (endedAt ? Date.parse(endedAt) : now) - Date.parse(startedAt));
  const seconds = Math.floor(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

export function modelProvenanceLabel(provenance: ModelProvenance): string {
  return provenance ?? "unrecorded";
}

export function contextMeterPercent(tokens: number | null, window: number | null): number | null {
  return window === null ? null : Math.min(100, ((tokens ?? 0) / window) * 100);
}

export function stateTone(state: LifecycleState): "ok" | "running" | "error" | "warn" {
  if (state === "LANDED") return "ok";
  if (state === "BLOCKED" || state === "CANCELLED") return "error";
  if (state === "AWAITING_OWNER") return "warn";
  return "running";
}
