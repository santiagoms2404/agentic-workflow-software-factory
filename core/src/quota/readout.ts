import type { QuotaStopEntry } from "../config/schema.ts";
import {
  isBelowQuotaStopThreshold,
  knownMinuteFigure,
  type QuotaProbeResult,
  type QuotaUnavailableReasonCode,
} from "./probe.ts";
import type { QuotaProviderReadout, QuotaScopeReadout } from "./parse.ts";
import type { ProjectQuotaRoute } from "./routes.ts";

export type QuotaReadoutVerdict = "above" | "below" | "disabled" | "unknown";

/**
 * The complete route-row surface. Keep this record descriptive: it has no
 * comparator, ordering, rank, recommendation, preference, or routing boolean.
 */
export interface QuotaRouteReadoutRow {
  readonly adapterId: string;
  readonly provider: string | null;
  readonly scope: string | null;
  readonly effectivePercentRemaining: number | null;
  readonly minutesToReset: number | null;
  readonly configuredThresholdMinutes: number | null;
  readonly verdict: QuotaReadoutVerdict;
  readonly reasonCode: string | null;
  readonly remedy: string | null;
}

const ROUTE_READOUT_FIELD_LIST = [
  "adapterId",
  "provider",
  "scope",
  "effectivePercentRemaining",
  "minutesToReset",
  "configuredThresholdMinutes",
  "verdict",
  "reasonCode",
  "remedy",
] as const;

/** The exhaustive field list used by the quota fence. */
export const QUOTA_ROUTE_READOUT_FIELDS: readonly (keyof QuotaRouteReadoutRow)[] =
  ROUTE_READOUT_FIELD_LIST;

type Assert<T extends true> = T;
type SameFields<Left, Right> =
  Exclude<keyof Left, Right> extends never
    ? Exclude<Right, keyof Left> extends never
      ? true
      : false
    : false;

// This assignment fails typechecking if the interface gains a field without an
// explicit field-list change, or if the list names a field the record lacks.
const ASSERT_CLOSED_ROUTE_READOUT_FIELDS: Assert<
  SameFields<QuotaRouteReadoutRow, (typeof ROUTE_READOUT_FIELD_LIST)[number]>
> = true;
void ASSERT_CLOSED_ROUTE_READOUT_FIELDS;

export interface QuotaReadout {
  readonly rows: readonly QuotaRouteReadoutRow[];
}

export const ACCOUNT_WIDE_QUOTA_NOTICE =
  "This percentage is account-wide. Another client on the same account moves the same number, the figure is an integer percentage, and nothing in the payload carries task identity.";

function nonBlank(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function thresholdFor(
  adapterId: string,
  defaultEntry: QuotaStopEntry | null,
  byAdapter: Readonly<Record<string, QuotaStopEntry>>,
): QuotaStopEntry | null {
  return byAdapter[adapterId] ?? defaultEntry;
}

function providerReadout(
  result: QuotaProbeResult,
  provider: string,
): QuotaProviderReadout | null {
  return result.readout.providers.find((candidate) => candidate.provider === provider) ?? null;
}

function globalFailureCode(result: QuotaProbeResult): QuotaUnavailableReasonCode | null {
  if (result.failure === null) return null;
  switch (result.failure.reasonCode) {
    case "stale":
    case "semantics-unresolved":
      return null;
    default:
      return result.failure.reasonCode;
  }
}

function providerFailureCode(
  result: QuotaProbeResult,
  provider: QuotaProviderReadout,
): string | null {
  if (provider.stateStatus === "stale") return "stale";
  const toolReason = nonBlank(provider.reason);
  if (toolReason !== null) return toolReason;
  if (
    provider.stateStatus !== "fresh"
    || provider.quotaSemanticsStatus !== "known"
    || provider.scopes.length === 0
  ) {
    return "semantics-unresolved";
  }
  if (
    result.failure?.reasonCode === "semantics-unresolved"
    && result.failure.providers.includes(provider.provider)
  ) {
    return "semantics-unresolved";
  }
  return null;
}

function verdict(
  thresholdMinutes: number | null,
  minutesToReset: number | null,
): QuotaReadoutVerdict {
  if (thresholdMinutes === null) return "disabled";
  const figure = knownMinuteFigure(minutesToReset);
  if (figure === null) return "unknown";
  return isBelowQuotaStopThreshold(figure, thresholdMinutes) ? "below" : "above";
}

interface Figure {
  readonly scope: QuotaScopeReadout | null;
  readonly reasonCode: string | null;
  readonly remedy: string | null;
}

function figureFor(
  route: ProjectQuotaRoute,
  result: QuotaProbeResult,
): Figure {
  if (route.providers.length === 0) {
    return { scope: null, reasonCode: route.reason, remedy: null };
  }
  if (route.providers.length !== 1) {
    return { scope: null, reasonCode: "multiple-providers", remedy: null };
  }

  const parsedProvider = providerReadout(result, route.providers[0]!);
  const fatalFailure = globalFailureCode(result);
  if (fatalFailure !== null) {
    return {
      scope: null,
      reasonCode: fatalFailure,
      remedy: nonBlank(parsedProvider?.remedy ?? null),
    };
  }

  if (parsedProvider === null) {
    return { scope: null, reasonCode: "provider-not-returned", remedy: null };
  }
  const parsedReason = providerFailureCode(result, parsedProvider);
  const remedy = nonBlank(parsedProvider.remedy);
  if (parsedReason !== null) return { scope: null, reasonCode: parsedReason, remedy };
  if (parsedProvider.scopes.length !== 1) {
    return { scope: null, reasonCode: "multiple-scopes", remedy };
  }

  const scope = parsedProvider.scopes[0]!;
  if (scope.effectivePercentRemaining === null || scope.minutesToReset === null) {
    return { scope, reasonCode: "semantics-unresolved", remedy };
  }
  return { scope, reasonCode: null, remedy: null };
}

export interface BuildQuotaReadoutInput {
  readonly routes: readonly ProjectQuotaRoute[];
  readonly probeResult: QuotaProbeResult;
  readonly defaultThreshold: QuotaStopEntry | null;
  readonly thresholdsByAdapter?: Readonly<Record<string, QuotaStopEntry>>;
}

/** Builds rows in configured route order. No metric participates in ordering. */
export function buildQuotaReadout(input: BuildQuotaReadoutInput): QuotaReadout {
  const byAdapter = input.thresholdsByAdapter ?? {};
  return Object.freeze({
    rows: Object.freeze(input.routes.map((route): QuotaRouteReadoutRow => {
      const configured = thresholdFor(route.adapterId, input.defaultThreshold, byAdapter);
      const figure = figureFor(route, input.probeResult);
      const scope = figure.scope;
      return Object.freeze({
        adapterId: route.adapterId,
        provider: route.providers.length === 0 ? null : route.providers.join(","),
        scope: scope?.scope ?? null,
        effectivePercentRemaining: scope?.effectivePercentRemaining ?? null,
        minutesToReset: scope?.minutesToReset ?? null,
        configuredThresholdMinutes: configured?.minutes ?? null,
        verdict: verdict(configured?.minutes ?? null, scope?.minutesToReset ?? null),
        reasonCode: figure.reasonCode,
        remedy: figure.remedy,
      });
    })),
  });
}

function shown(value: string | number | null, unavailable: string): string {
  return value === null || value === "" ? unavailable : String(value);
}

/** Renders every unknown value in words. No unknown is represented as zero. */
export function renderQuotaReadout(readout: QuotaReadout): readonly string[] {
  return readout.rows.map((row) => {
    const percentage = row.effectivePercentRemaining === null
      ? "unknown"
      : `${String(row.effectivePercentRemaining)}%`;
    const threshold = row.configuredThresholdMinutes === null
      ? "disabled"
      : String(row.configuredThresholdMinutes);
    const reason = row.reasonCode ?? "available";
    const remedy = row.remedy ?? (row.reasonCode === null ? "not applicable" : "not supplied");
    return [
      `adapter=${row.adapterId}`,
      `provider=${shown(row.provider, "not applicable")}`,
      `effective remaining=${percentage} (scope=${shown(row.scope, "unknown")}). ${ACCOUNT_WIDE_QUOTA_NOTICE}`,
      `minutes to reset=${shown(row.minutesToReset, "unknown")}`,
      `threshold minutes=${threshold}`,
      `verdict=${row.verdict}`,
      `reason=${reason}`,
      `remedy=${remedy}`,
    ].join(" | ");
  });
}
