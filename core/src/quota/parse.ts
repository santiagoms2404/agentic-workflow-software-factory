// Pure parsing boundary for quota-axi's default JSON report. Process state,
// filesystem state, and the current time are all supplied by the caller or not
// used at all.

export interface QuotaScopeReadout {
  readonly scope: string | null;
  readonly effectivePercentRemaining: number | null;
  readonly minutesToReset: number | null;
}

export interface QuotaProviderReadout {
  readonly provider: string | null;
  readonly stateStatus: string | null;
  readonly quotaSemanticsStatus: string | null;
  readonly reason: string | null;
  readonly remedy: string | null;
  readonly scopes: readonly QuotaScopeReadout[];
}

export interface QuotaReadoutRecord {
  readonly providers: readonly QuotaProviderReadout[];
}

export interface ParsedQuotaReadout {
  readonly readout: QuotaReadoutRecord;
  /** Everything about the report the host could not read. Empty is the good case. */
  readonly faults: readonly string[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(
  source: JsonObject,
  field: string,
  path: string,
  faults: string[],
): string | null {
  const value = source[field];
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  faults.push(`${path}.${field} was ${JSON.stringify(value)}, which is not a string — recorded as null`);
  return null;
}

function requiredString(
  source: JsonObject,
  field: string,
  path: string,
  faults: string[],
): string | null {
  const value = optionalString(source, field, path, faults);
  if (value === null && (source[field] === undefined || source[field] === null)) {
    faults.push(`${path}.${field} was missing — recorded as null`);
  }
  return value;
}

function unavailableProvider(provider: string | null = null): QuotaProviderReadout {
  return {
    provider,
    stateStatus: null,
    quotaSemanticsStatus: null,
    reason: null,
    remedy: null,
    scopes: [],
  };
}

function limitingWindowId(
  effective: JsonObject,
  runway: JsonObject,
  runwayStatus: string,
  path: string,
  faults: string[],
): string | null {
  if (runwayStatus === "projected_exhaustion") {
    return requiredString(runway, "limitingWindowId", `${path}.runway`, faults);
  }

  if (runwayStatus !== "through_reset") return null;

  const ids = effective["limitingWindowIds"];
  if (!Array.isArray(ids)) {
    faults.push(`${path}.limitingWindowIds was not an array — minutes to reset recorded as null`);
    return null;
  }
  const strings = ids.filter((id): id is string => typeof id === "string");
  if (strings.length !== ids.length) {
    faults.push(`${path}.limitingWindowIds contained a non-string id — minutes to reset recorded as null`);
  }
  if (strings.length !== 1 || strings.length !== ids.length) {
    faults.push(`${path}.limitingWindowIds did not name exactly one binding window — minutes to reset recorded as null`);
    return null;
  }
  return strings[0] ?? null;
}

function minutesForBindingWindow(
  rawWindows: readonly unknown[],
  bindingWindowId: string,
  nowMs: number | null,
  path: string,
  faults: string[],
): number | null {
  if (nowMs === null) return null;

  // The id is selected solely by effectiveAvailability. Raw windows are only
  // dereferenced to find the reset instant attached to that already-named id.
  const matches = rawWindows.filter(
    (candidate): candidate is JsonObject => isObject(candidate) && candidate["id"] === bindingWindowId,
  );
  if (matches.length !== 1) {
    faults.push(`${path} could not dereference binding window ${JSON.stringify(bindingWindowId)} exactly once — minutes to reset recorded as null`);
    return null;
  }

  const resetsAt = matches[0]?.["resetsAt"];
  if (typeof resetsAt !== "string") {
    faults.push(`${path}.${bindingWindowId}.resetsAt was not a string — minutes to reset recorded as null`);
    return null;
  }
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) {
    faults.push(`${path}.${bindingWindowId}.resetsAt was not an instant — minutes to reset recorded as null`);
    return null;
  }
  return Math.max(0, Math.ceil((resetMs - nowMs) / 60_000));
}

function parseScope(
  raw: unknown,
  index: number,
  stateStatus: string | null,
  semanticsStatus: string | null,
  rawWindows: readonly unknown[],
  nowMs: number | null,
  providerPath: string,
  faults: string[],
): QuotaScopeReadout {
  const path = `${providerPath}.quotaSemantics.effectiveAvailability[${String(index)}]`;
  if (!isObject(raw)) {
    faults.push(`${path} was not an object — recorded as unavailable`);
    return { scope: null, effectivePercentRemaining: null, minutesToReset: null };
  }

  const scope = requiredString(raw, "scope", path, faults);
  const effectiveStatus = requiredString(raw, "status", path, faults);

  // Freshness and semantic resolution are structural payload facts. Raw
  // windows remain diagnostic data and cannot override either one.
  if (stateStatus !== "fresh" || semanticsStatus !== "known" || effectiveStatus !== "known") {
    return { scope, effectivePercentRemaining: null, minutesToReset: null };
  }

  const percentage = raw["effectivePercentRemaining"];
  if (typeof percentage !== "number" || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    faults.push(`${path}.effectivePercentRemaining was ${JSON.stringify(percentage)}, which is not a percentage — recorded as unavailable`);
    return { scope, effectivePercentRemaining: null, minutesToReset: null };
  }

  const runway = raw["runway"];
  if (!isObject(runway)) {
    faults.push(`${path}.runway was not an object — minutes to reset recorded as null`);
    return { scope, effectivePercentRemaining: percentage, minutesToReset: null };
  }
  const runwayStatus = requiredString(runway, "status", `${path}.runway`, faults);
  if (runwayStatus === "unknown") {
    return { scope, effectivePercentRemaining: percentage, minutesToReset: null };
  }
  if (runwayStatus !== "through_reset" && runwayStatus !== "projected_exhaustion") {
    if (runwayStatus !== null) {
      faults.push(`${path}.runway.status was ${JSON.stringify(runwayStatus)}, which is not understood — minutes to reset recorded as null`);
    }
    return { scope, effectivePercentRemaining: percentage, minutesToReset: null };
  }

  const bindingId = limitingWindowId(raw, runway, runwayStatus, path, faults);
  if (bindingId === null) {
    return { scope, effectivePercentRemaining: percentage, minutesToReset: null };
  }
  return {
    scope,
    effectivePercentRemaining: percentage,
    minutesToReset: minutesForBindingWindow(rawWindows, bindingId, nowMs, `${providerPath}.windows`, faults),
  };
}

function parseProvider(
  raw: unknown,
  index: number,
  nowMs: number | null,
  faults: string[],
): QuotaProviderReadout {
  const path = `providers[${String(index)}]`;
  if (!isObject(raw)) {
    faults.push(`${path} was not an object — recorded as unavailable`);
    return unavailableProvider();
  }

  const provider = requiredString(raw, "provider", path, faults);
  const state = raw["state"];
  if (!isObject(state)) {
    faults.push(`${path}.state was not an object — recorded as unavailable`);
    return unavailableProvider(provider);
  }
  const stateStatus = requiredString(state, "status", `${path}.state`, faults);
  const reason = optionalString(state, "reason", `${path}.state`, faults);
  const remedy = optionalString(state, "remedy", `${path}.state`, faults);

  const semantics = raw["quotaSemantics"];
  if (!isObject(semantics)) {
    faults.push(`${path}.quotaSemantics was not an object — recorded as unavailable`);
    return { provider, stateStatus, quotaSemanticsStatus: null, reason, remedy, scopes: [] };
  }
  const quotaSemanticsStatus = requiredString(semantics, "status", `${path}.quotaSemantics`, faults);

  const windows = raw["windows"];
  const rawWindows: readonly unknown[] = Array.isArray(windows) ? windows : [];
  if (!Array.isArray(windows)) {
    faults.push(`${path}.windows was not an array — reset instants are unavailable`);
  }

  const availability = semantics["effectiveAvailability"];
  if (!Array.isArray(availability)) {
    faults.push(`${path}.quotaSemantics.effectiveAvailability was not an array — recorded as unavailable`);
    return { provider, stateStatus, quotaSemanticsStatus, reason, remedy, scopes: [] };
  }

  return {
    provider,
    stateStatus,
    quotaSemanticsStatus,
    reason,
    remedy,
    scopes: availability.map((scope, scopeIndex) =>
      parseScope(scope, scopeIndex, stateStatus, quotaSemanticsStatus, rawWindows, nowMs, path, faults),
    ),
  };
}

/**
 * Parses quota-axi default JSON bytes using the caller's pinned instant.
 *
 * Unknown values stay null. Every malformed field encountered is reported, and
 * malformed input always returns an unavailable record instead of throwing.
 */
export function parseQuotaReadout(rawText: string, now: string): ParsedQuotaReadout {
  const faults: string[] = [];
  const parsedNow = Date.parse(now);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : null;
  if (nowMs === null) faults.push(`now was ${JSON.stringify(now)}, which is not an instant`);

  let raw: unknown;
  try {
    raw = JSON.parse(rawText) as unknown;
  } catch {
    faults.push("quota report was not JSON — recorded as unavailable");
    return { readout: { providers: [] }, faults };
  }

  if (!isObject(raw)) {
    faults.push("quota report was not an object — recorded as unavailable");
    return { readout: { providers: [] }, faults };
  }
  const providers = raw["providers"];
  if (!Array.isArray(providers)) {
    faults.push("quota report providers was not an array — recorded as unavailable");
    return { readout: { providers: [] }, faults };
  }

  return {
    readout: {
      providers: providers.map((provider, index) => parseProvider(provider, index, nowMs, faults)),
    },
    faults,
  };
}
