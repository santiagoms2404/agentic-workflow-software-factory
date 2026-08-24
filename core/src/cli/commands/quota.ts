import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config/load.ts";
import {
  resolveExecutable as resolveSystemExecutable,
  runSystemCommand,
} from "../../execution/transport-broker.ts";
import {
  DEFAULT_QUOTA_PROBE_TIMEOUTS,
  probeQuota,
  retainQuotaFailureInAttempt,
  type ResolveQuotaExecutable,
  type RunQuotaCommand,
} from "../../quota/probe.ts";
import {
  buildQuotaReadout,
  renderQuotaReadout,
  type QuotaReadout,
} from "../../quota/readout.ts";
import { resolveProjectQuotaRoutes } from "../../quota/routes.ts";
import { loadCatalog } from "../../registry/catalog.ts";
import { readPlacement } from "../../registry/placement.ts";
import type { Placement } from "../../registry/placement-schema.ts";

export interface QuotaCommandInput {
  readonly catalogPath: string;
  readonly stateRoot: string;
  readonly env: Readonly<Record<string, string>>;
  readonly now?: string;
  readonly runCommand?: RunQuotaCommand;
  readonly resolveExecutable?: ResolveQuotaExecutable;
}

export interface QuotaCommandReport {
  readonly readout: QuotaReadout;
  readonly lines: readonly string[];
}

function configuredInteractiveTimeout(
  routes: readonly { readonly adapterId: string }[],
  quotaStop: ReturnType<typeof loadConfig>["routing"]["quota_stop"],
): number {
  if (quotaStop === undefined) return DEFAULT_QUOTA_PROBE_TIMEOUTS.interactivePreflightMs;
  const values = routes.map((route) =>
    (quotaStop.by_adapter?.[route.adapterId] ?? quotaStop.default).probe_timeout_ms);
  return values.length === 0
    ? quotaStop.default.probe_timeout_ms
    : Math.max(...values);
}

async function registeredPlacement(
  catalogPath: string,
  stateRoot: string,
): Promise<Placement | undefined> {
  const catalog = loadCatalog(await readFile(catalogPath, "utf8"));
  try {
    return await readPlacement(stateRoot, catalog.project.slug);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Produces the interactive report with one shared quota probe. Route order is
 * the configuration order returned by resolveProjectQuotaRoutes.
 */
export async function quotaCommand(input: QuotaCommandInput): Promise<QuotaCommandReport> {
  const placement = await registeredPlacement(input.catalogPath, input.stateRoot);
  const resolved = await resolveProjectQuotaRoutes({
    catalogPath: input.catalogPath,
    ...(placement === undefined ? {} : { placement }),
  });
  const config = loadConfig(await readFile(resolved.configPath, "utf8"));
  const now = input.now ?? new Date().toISOString();
  const captureId = `preflight-${now.replace(/[^0-9A-Za-z]+/gu, "-")}`;
  const retainFailureBytes = retainQuotaFailureInAttempt(
    join(input.stateRoot, "quota-preflight"),
    captureId,
  );
  const interactivePreflightMs = configuredInteractiveTimeout(
    resolved.routes,
    config.routing.quota_stop,
  );

  // The callback is intentionally consumed by this owner-facing command. An
  // interactive preflight has no attempt journal, so its failure is rendered
  // in every affected row instead of being attached to a task that does not
  // exist.
  const observedFailures: unknown[] = [];
  const probeResult = await probeQuota({
    runCommand: input.runCommand ?? runSystemCommand,
    resolveExecutable: input.resolveExecutable ?? resolveSystemExecutable,
    routes: resolved.probeRoutes,
    purpose: "interactive-preflight",
    timeouts: {
      interactivePreflightMs,
      phaseBoundaryMs: DEFAULT_QUOTA_PROBE_TIMEOUTS.phaseBoundaryMs,
    },
    options: {
      cwd: resolved.planRepositoryPath,
      env: input.env,
      maxBuffer: 4 * 1024 * 1024,
    },
    now,
    journalFailure: (failure) => { observedFailures.push(failure); },
    retainFailureBytes,
  });
  if (probeResult.failure !== null && observedFailures.length !== 1) {
    throw new Error("quota probe returned an unavailable result without reporting its failure");
  }

  const quotaStop = config.routing.quota_stop;
  const readout = buildQuotaReadout({
    routes: resolved.routes,
    probeResult,
    defaultThreshold: quotaStop?.default ?? null,
    ...(quotaStop?.by_adapter === undefined
      ? {}
      : { thresholdsByAdapter: quotaStop.by_adapter }),
  });
  return Object.freeze({ readout, lines: Object.freeze(renderQuotaReadout(readout)) });
}
