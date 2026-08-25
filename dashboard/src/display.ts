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

export function formatTokens(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatUsage(usage: UsageTotals): string {
  return formatTokens(usage.totalTokens);
}

export function formatUsageBreakdown(usage: Pick<UsageTotals,
  "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "reasoningTokens"
>): string {
  const input = usage.inputTokens === null ? null : `${formatTokens(usage.inputTokens)} in`;
  const output = usage.outputTokens === null ? null : `${formatTokens(usage.outputTokens)} out`;
  const primary = [input, output].filter((part): part is string => part !== null).join(" / ");
  const secondary = [
    usage.cacheReadTokens === null ? null : `${formatTokens(usage.cacheReadTokens)} cached`,
    usage.cacheWriteTokens === null ? null : `${formatTokens(usage.cacheWriteTokens)} cache write`,
    usage.reasoningTokens === null ? null : `${formatTokens(usage.reasoningTokens)} reasoning`,
  ].filter((part): part is string => part !== null);
  return [primary, ...secondary].filter(Boolean).join(" · ") || "—";
}

export function formatDuration(startedAt: string, endedAt: string | null, now = Date.now()): string {
  const milliseconds = Math.max(0, (endedAt ? Date.parse(endedAt) : now) - Date.parse(startedAt));
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatOffset(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m${String(remainder).padStart(2, "0")}s`;
}

export function axisTicks(spanMs: number, count = 5): Array<{ percent: number; label: string }> {
  const span = Math.max(1, spanMs);
  return Array.from({ length: count }, (_unused, index) => {
    const percent = count === 1 ? 0 : (index / (count - 1)) * 100;
    return { percent, label: formatOffset(span * percent / 100) };
  });
}

export function formatDate(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  const date = new Date(time);
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${date.toLocaleTimeString([], { hour12: false })}`;
}

export function modelProvenanceLabel(provenance: ModelProvenance): string {
  return provenance ?? "unrecorded";
}

export function contextMeterPercent(tokens: number | null, window: number | null): number | null {
  if (tokens === null || window === null || window <= 0) return null;
  return Math.min(100, (tokens / window) * 100);
}

export function stateTone(state: LifecycleState): "ok" | "running" | "error" | "warn" {
  if (state === "LANDED" || state === "PUBLISHED") return "ok";
  if (state === "BLOCKED" || state === "CANCELLED") return "error";
  if (state === "AWAITING_OWNER") return "warn";
  return "running";
}

export function stateLabel(state: LifecycleState): string {
  if (state === "LANDED") return "✓ landed";
  if (state === "PUBLISHED") return "✓ published";
  if (state === "RUNNING") return "◌ running";
  if (state === "AWAITING_OWNER") return "! owner review";
  if (state === "BLOCKED") return "× blocked";
  if (state === "CANCELLED") return "× cancelled";
  return state.toLowerCase().replaceAll("_", " ");
}

/** Exact recorded provider IDs only; unknown providers keep their full label. */
export function providerMark(provider: string): string {
  const marks: Readonly<Record<string, string>> = {
    "anthropic": "A",
    "openai": "O",
    "openai-codex": "O",
    "google": "G",
  };
  return marks[provider] ?? "◆";
}
