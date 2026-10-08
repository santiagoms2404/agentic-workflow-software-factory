import type { AwsfConfig } from "../config/schema.ts";
import type { DoctorRow } from "../contracts/doctor-readout.ts";
import type { QuotaProbeResult } from "../quota/probe.ts";
import { buildQuotaReadout, renderQuotaReadout } from "../quota/readout.ts";
import type { ProjectQuotaRoute } from "../quota/routes.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Whitelisted diagnostic fields only: no account, auth source, or raw output. */
export function quotaDiagnostics(text: string): readonly string[] {
  let parsed: Record<string, unknown> | null;
  try { parsed = object(JSON.parse(text)); } catch { return []; }
  const providers = parsed?.providers;
  if (!Array.isArray(providers)) return [];
  return providers.flatMap((raw: unknown) => {
    const provider = object(raw);
    if (provider?.provider !== "claude" && provider?.provider !== "codex") return [];
    const details: string[] = [];
    if (Array.isArray(provider.windows)) for (const rawWindow of provider.windows) {
      const window = object(rawWindow);
      if (window === null) continue;
      const id = typeof window.id === "string" ? window.id : "not measured";
      const percent = typeof window.percentRemaining === "number" && window.percentRemaining >= 0 && window.percentRemaining <= 100 ? `${window.percentRemaining}%` : "not measured";
      const reset = typeof window.resetsAt === "string" && Number.isFinite(Date.parse(window.resetsAt)) ? window.resetsAt : "not measured";
      details.push(`provider=${provider.provider}; window=${id}; remaining=${percent}; reset=${reset}`);
    }
    const effective = object(provider.quotaSemantics)?.effectiveAvailability;
    if (Array.isArray(effective)) for (const rawScope of effective) {
      const scope = object(rawScope);
      const runway = object(scope?.runway);
      const status = ["through_reset", "projected_exhaustion", "unknown"].includes(String(runway?.status)) ? String(runway?.status) : "not measured";
      const seconds = typeof runway?.usableRunwaySeconds === "number" && Number.isFinite(runway.usableRunwaySeconds) && runway.usableRunwaySeconds >= 0 ? runway.usableRunwaySeconds : "not measured";
      details.push(`provider=${provider.provider}; runway=${status}; usable runway seconds=${seconds}`);
    }
    return details;
  });
}

/** Quota remains diagnostic: no route ranking, selection, or refusal. */
export function quotaRow(routes: readonly ProjectQuotaRoute[], result: QuotaProbeResult | null, stop: AwsfConfig["routing"]["quota_stop"], latencyMs: number, diagnostics: readonly string[] = []): DoctorRow {
  if (result === null) return { status: "warn", detail: ["not measured: no configured routes", `probe latency=${latencyMs} ms`] };
  const readout = buildQuotaReadout({ routes, probeResult: result, defaultThreshold: stop?.default ?? null,
    ...(stop?.by_adapter === undefined ? {} : { thresholdsByAdapter: stop.by_adapter }) });
  const low = readout.rows.some(row => row.verdict === "below" || row.effectivePercentRemaining === 0)
    || result.readout.providers.some(provider => provider.scopes.some(scope => scope.rejected));
  return {
    status: result.availability === "unavailable" ? "finding" : low ? "warn" : "ok",
    detail: [
      `probe=${result.availability}${result.failure === null ? "" : ` (${result.failure.reasonCode})`}; latency=${latencyMs} ms`,
      ...renderQuotaReadout(readout),
      ...diagnostics,
      ...result.readout.providers.flatMap(provider => provider.scopes.map(scope =>
        `provider=${provider.provider}; scope=${scope.scope}; binding window=${scope.windowId ?? "not measured"}; reset=${scope.resetsAt ?? "not measured"}; rejected=${scope.rejected}; ${scope.effectivePercentRemaining === null ? "not measured" : scope.effectivePercentRemaining === 0 ? "exhausted" : "not exhausted"}`)),
    ],
  };
}
