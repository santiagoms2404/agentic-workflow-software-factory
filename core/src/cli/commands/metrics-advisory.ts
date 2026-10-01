// Owner-facing evidence only. No runner imports this module or its metrics readers.
import { registeredAdapter } from "../../adapters/registry.ts";
import type { AwsfConfig } from "../../config/schema.ts";
import { requestedPhaseRoute } from "../../workflow/phase-routing.ts";
import type { ShiftSelection } from "../../workflow/shift/select.ts";
import type { MetricsResponse } from "../../../../dashboard/shared/types.ts";
import { observedModels, priorLookup } from "../../../../dashboard/shared/benchmark-priors.ts";
import { formatListEquivalent, listPrice } from "../../../../dashboard/shared/rate-card.ts";
import { depth, recommend, routeKey, stats, taskClassOf, type MetricsRoute } from "../../../../dashboard/shared/route-metrics.ts";
import { readMetricsPayload } from "./metrics.ts";

export const ADVISORY_END = "advisory: the runner never routes on this";
export const KEEP_CONFIGURED = "insufficient evidence: keep the configured route";
export type AdvisoryRole = "builder" | "reviewer";

export interface MetricsAdviceOptions {
  readonly dbPath: string;
  readonly extractedAt: string;
  readonly config: AwsfConfig;
  readonly role?: string;
  readonly selection?: ShiftSelection;
  /** Preflight must still print and enforce admission when the projection is unavailable. */
  readonly allowUnavailableProjection?: boolean;
}

/** --role is deliberately narrower here than in the ordinary metrics table. */
export function advisoryRole(role: string | undefined): AdvisoryRole | undefined {
  if (role !== undefined && role !== "builder" && role !== "reviewer") {
    throw new Error("--advise --role must be builder or reviewer");
  }
  return role;
}

/** Resolve configured controls exactly as a compiled shift does, without selecting a new route. */
async function configuredRoute(config: AwsfConfig, role: AdvisoryRole): Promise<string> {
  const agent = config.agents.find((agent) => agent.name === role);
  if (agent === undefined) return "not configured";
  try {
    const requested = requestedPhaseRoute(config, role, agent).requested;
    const adapter = registeredAdapter(config.adapters, requested.adapterId, config.runtime);
    // getModelInfo in registered adapters reads constants; it launches no process.
    const info = adapter === null ? null : await adapter.getModelInfo(requested.model);
    return `${requested.adapterId}/${requested.provider ?? info?.provider ?? "?"}/${requested.model}@${requested.effort}`;
  } catch (error) {
    return `unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
}

function spelling(route: MetricsRoute): string | null {
  if (route.adapter === null || route.provider === null || route.model === null || route.effort === null) return null;
  return `${route.adapter}/${route.provider}/${route.model}@${route.effort}`;
}

function percent(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

/** One block per role and class; every statistic and recommendation is shared with the tab. */
export async function metricsAdvisoryReadout(
  payload: MetricsResponse | null,
  options: Pick<MetricsAdviceOptions, "config" | "role" | "selection">,
  unavailable?: string,
): Promise<readonly string[]> {
  const selectedRole = advisoryRole(options.role);
  const roles: readonly AdvisoryRole[] = selectedRole === undefined ? ["builder", "reviewer"] : [selectedRole];
  const rows = payload?.roleRows ?? [];
  const prior = priorLookup(observedModels(rows));
  const selectionClasses = options.selection === undefined ? null :
    [...new Set(options.selection.tickets.map((record) => record.ticket.task_class ?? "unclassified"))].sort();
  const lines: string[] = [];
  for (const role of roles) {
    const configured = await configuredRoute(options.config, role);
    // Only shift builder phases inherit a ticket class; reviewers remain unclassified.
    const classes = selectionClasses === null
      ? [...new Set(rows.filter((row) => row.role === role && row.source === "production").map(taskClassOf))].sort()
      : role === "builder" ? selectionClasses : ["unclassified"];
    for (const taskClass of classes.length === 0 ? ["unclassified"] : classes) {
      lines.push(`Route advisory · ${role} · ${taskClass} · production evidence`);
      lines.push(`  configured route: ${configured}`);
      if (unavailable !== undefined) lines.push(`  evidence unavailable: ${unavailable}`);
      const rec = payload === null ? null : recommend(rows, role, taskClass, "production", {
        price: listPrice, prior, untested: payload.untestedRoutes,
      });
      if (rec !== null) {
        lines.push(`  recommendation basis: ${rec.basis}`);
        for (const evidence of rec.ranked) {
          const s = stats(rows.filter((row) => row.role === role && row.source === "production" &&
            taskClassOf(row) === taskClass && routeKey(row.route) === evidence.key), listPrice);
          lines.push(`  ${spelling(evidence.route) ?? evidence.key}${evidence.unconfirmed ? " (identity unconfirmed)" : ""}` +
            ` · depth ${depth(evidence.firstPass, evidence.settled)} · n ${s.n} · settled ${evidence.settled}` +
            ` · first pass ${percent(evidence.firstPass.p)} [95% CI ${percent(evidence.firstPass.lo)}–${percent(evidence.firstPass.hi)}]` +
            ` · ${formatListEquivalent(evidence.listPerRow)} per row`);
        }
      }
      const choice = rec === null ? null : spelling(rec.choice.route);
      if (rec === null || choice === null || (rec.basis === "prior only" && rec.choice.priorScore === null)) {
        lines.push(`  ${KEEP_CONFIGURED}`);
      } else {
        lines.push(`  recommendation: ${choice}${rec.choice.unconfirmed ? " (identity unconfirmed)" : ""} · ${rec.basis}`);
        lines.push(`  --route ${role}=${choice}`);
      }
      lines.push(ADVISORY_END);
    }
  }
  return lines;
}

/** A single read of the shared API payload, never a write or a routing capability. */
export async function metricsAdviceCommand(options: MetricsAdviceOptions): Promise<readonly string[]> {
  advisoryRole(options.role);
  let payload: MetricsResponse;
  try {
    payload = readMetricsPayload(options.dbPath, options.extractedAt);
  } catch (error) {
    if (options.allowUnavailableProjection !== true) throw error;
    return metricsAdvisoryReadout(null, options, error instanceof Error ? error.message : String(error));
  }
  return metricsAdvisoryReadout(payload, options);
}
