import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommandResult } from "../execution/process-controller.ts";
import type { SystemCommandOptions } from "../execution/transport-broker.ts";
import {
  parseQuotaReadout,
  type ParsedQuotaReadout,
  type QuotaReadoutRecord,
} from "./parse.ts";

export const QUOTA_AXI_EXECUTABLE = "quota-axi";
export const QUOTA_AXI_VERSION_FLOOR = "0.1.29" as const;

/**
 * Estimated defaults for two different critical paths. Callers may replace
 * either value with durable configuration, but no invocation supplies a
 * timeout literal directly to the process capability.
 */
export const DEFAULT_QUOTA_PROBE_TIMEOUTS = Object.freeze({
  interactivePreflightMs: 8_000,
  phaseBoundaryMs: 2_500,
});

export type QuotaProbePurpose = "interactive-preflight" | "phase-boundary";

export interface QuotaProbeTimeouts {
  readonly interactivePreflightMs: number;
  readonly phaseBoundaryMs: number;
}

export const QUOTA_UNAVAILABLE_REASON_CODES = [
  "executable-not-found",
  "timeout",
  "nonzero-exit",
  "unparseable",
  "version-below-floor",
  "semantics-unresolved",
  "stale",
] as const;

export type QuotaUnavailableReasonCode = (typeof QUOTA_UNAVAILABLE_REASON_CODES)[number];

type QuotaCommandKind = "version" | "probe";

/** Closed failure vocabulary. Raw process bytes are deliberately absent. */
export type QuotaProbeFailure =
  | {
      readonly reasonCode: "executable-not-found";
      readonly executable: typeof QUOTA_AXI_EXECUTABLE;
    }
  | {
      readonly reasonCode: "timeout";
      readonly command: QuotaCommandKind;
      readonly timeoutMs: number;
    }
  | {
      readonly reasonCode: "nonzero-exit";
      readonly command: QuotaCommandKind;
      readonly exitCode: number | null;
      readonly retainedPath: string;
    }
  | {
      readonly reasonCode: "unparseable";
      readonly command: QuotaCommandKind;
      readonly faultCount: number;
      readonly retainedPath: string;
    }
  | {
      readonly reasonCode: "version-below-floor";
      readonly foundVersion: string;
      readonly floorVersion: typeof QUOTA_AXI_VERSION_FLOOR;
    }
  | {
      readonly reasonCode: "semantics-unresolved";
      readonly providers: readonly (string | null)[];
    }
  | {
      readonly reasonCode: "stale";
      readonly providers: readonly (string | null)[];
    };

export interface ConfiguredQuotaRoute {
  /** quota-axi provider name, resolved from the route's adapter kind by the caller. */
  readonly provider: string;
  /** An omitted value is enabled, matching the adapter configuration default. */
  readonly enabled?: boolean;
}

export type RunQuotaCommand = (
  executable: string,
  argv: readonly string[],
  options: SystemCommandOptions,
) => CommandResult;

export type ResolveQuotaExecutable = (
  executable: string,
  env: Readonly<Record<string, string>>,
) => string;

export type JournalQuotaFailure = (failure: QuotaProbeFailure) => Promise<void> | void;
export type RetainQuotaFailureBytes = (bytes: string) => Promise<string>;

export interface QuotaProbeInput {
  readonly runCommand: RunQuotaCommand;
  readonly resolveExecutable: ResolveQuotaExecutable;
  /** Only configured, measurable routes reach this list. */
  readonly routes: readonly ConfiguredQuotaRoute[];
  readonly purpose: QuotaProbePurpose;
  readonly timeouts?: QuotaProbeTimeouts;
  /** The command descriptor's environment, including the PATH to resolve against. */
  readonly options: Omit<SystemCommandOptions, "timeoutMs"> & {
    readonly env: Readonly<Record<string, string>>;
  };
  /** The parser's clock is supplied by the caller. */
  readonly now: string;
  /** Mandatory so no unavailable outcome can be skipped silently. */
  readonly journalFailure: JournalQuotaFailure;
  /** Mandatory so unreadable and nonzero responses are retained before journalling. */
  readonly retainFailureBytes: RetainQuotaFailureBytes;
}

interface QuotaProbeBase {
  readonly readout: QuotaReadoutRecord;
  readonly parsed: ParsedQuotaReadout;
  readonly resolvedVersion: string | null;
}

export type QuotaProbeResult =
  | (QuotaProbeBase & { readonly availability: "known"; readonly failure: null })
  | (QuotaProbeBase & { readonly availability: "unavailable"; readonly failure: QuotaProbeFailure });

const KNOWN_MINUTE: unique symbol = Symbol("known-quota-minute");

export interface KnownMinuteFigure {
  readonly availability: "known";
  readonly minutesToReset: number;
  /** Opaque proof supplied only by knownMinuteFigure. */
  readonly [KNOWN_MINUTE]: true;
}

/**
 * The only constructor for threshold-comparable quota data. Unknown, stale,
 * unresolved, and failed readings return null and therefore have no value that
 * the comparison accepts.
 */
export function knownMinuteFigure(minutesToReset: number | null): KnownMinuteFigure | null {
  if (minutesToReset === null || !Number.isFinite(minutesToReset) || minutesToReset < 0) return null;
  return Object.freeze({ availability: "known", minutesToReset, [KNOWN_MINUTE]: true as const });
}

/** A failed read has no type-compatible path into this comparison. */
export function isBelowQuotaStopThreshold(
  figure: KnownMinuteFigure,
  thresholdMinutes: number,
): boolean {
  return figure.minutesToReset < thresholdMinutes;
}

/**
 * Creates the production retention capability for one probe occurrence.
 * The returned path is attempt-relative, so the journal records no machine
 * path. writeFile's mode handles creation and chmod repairs an existing file.
 */
export function retainQuotaFailureInAttempt(
  attemptDir: string,
  captureId: string,
): RetainQuotaFailureBytes {
  const portableId = encodeURIComponent(captureId.length === 0 ? "probe" : captureId);
  const relativePath = join("raw", `quota-${portableId}.txt`);
  const absolutePath = join(attemptDir, relativePath);
  return async (bytes: string): Promise<string> => {
    await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
    await writeFile(absolutePath, bytes, { mode: 0o600 });
    await chmod(absolutePath, 0o600);
    return relativePath;
  };
}

/**
 * Converts only enabled configured routes to the provider selector quota-axi
 * accepts. It never supplies a provider that the project did not configure.
 */
export function buildEnabledProviderCsv(routes: readonly ConfiguredQuotaRoute[]): string {
  const providers: string[] = [];
  for (const route of routes) {
    if (route.enabled === false || route.provider.length === 0 || providers.includes(route.provider)) continue;
    providers.push(route.provider);
  }
  return providers.join(",");
}

/** Pure argv builder shared by the live fixture probe and the runtime probe. */
export function buildQuotaAxiArgv(providerCsv: string): readonly string[] {
  return ["--provider", providerCsv, "--json"];
}

interface NumericVersion {
  readonly text: string;
  readonly parts: readonly [number, number, number];
}

function numericVersion(text: string): NumericVersion | null {
  const match = /(?:^|\D)v?(\d+)\.(\d+)\.(\d+)(?:\D|$)/u.exec(text.trim());
  if (match === null) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (!parts.every(Number.isSafeInteger)) return null;
  return { text: `${String(parts[0])}.${String(parts[1])}.${String(parts[2])}`, parts };
}

/** Numeric major/minor/patch ordering. No version decision compares text. */
export function compareNumericVersions(left: string, right: string): number | null {
  const a = numericVersion(left);
  const b = numericVersion(right);
  if (a === null || b === null) return null;
  for (let index = 0; index < a.parts.length; index += 1) {
    const difference = a.parts[index]! - b.parts[index]!;
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function timeoutFor(purpose: QuotaProbePurpose, configured: QuotaProbeTimeouts): number {
  return purpose === "interactive-preflight"
    ? configured.interactivePreflightMs
    : configured.phaseBoundaryMs;
}

function timedOut(result: CommandResult): boolean {
  return result.error !== null && /(?:ETIMEDOUT|timed?\s*out|timeout)/iu.test(result.error);
}

function rawResultBytes(result: CommandResult): string {
  return `${result.stdout}${result.stderr}`;
}

function emptyParsed(): ParsedQuotaReadout {
  return { readout: { providers: [] }, faults: [] };
}

function structuralFailure(parsed: ParsedQuotaReadout): QuotaProbeFailure | null {
  if (parsed.faults.length > 0) return null;
  const stale = parsed.readout.providers
    .filter((provider) => provider.stateStatus === "stale")
    .map((provider) => provider.provider);
  if (stale.length > 0) return { reasonCode: "stale", providers: stale };

  const unresolved = parsed.readout.providers
    .filter((provider) =>
      provider.stateStatus !== "fresh" ||
      provider.quotaSemanticsStatus !== "known" ||
      provider.scopes.length === 0 ||
      provider.scopes.some((scope) => scope.minutesToReset === null),
    )
    .map((provider) => provider.provider);
  if (parsed.readout.providers.length === 0) unresolved.push(null);
  return unresolved.length === 0
    ? null
    : { reasonCode: "semantics-unresolved", providers: unresolved };
}

/**
 * Runs the installed quota-axi executable through injected process capabilities.
 *
 * The 0.1.29 floor is NECESSARY AND NOT SUFFICIENT. A higher version may emit
 * an unreadable payload; the parser's fault list catches that drift here as
 * `unparseable` rather than pretending the version check proved compatibility.
 * Every unavailable result is journalled before return. No failure throws into
 * the run merely because the quota gauge could not be read.
 */
export async function probeQuota(input: QuotaProbeInput): Promise<QuotaProbeResult> {
  const parsedEmpty = emptyParsed();
  const unavailable = async (
    failure: QuotaProbeFailure,
    parsed: ParsedQuotaReadout = parsedEmpty,
    resolvedVersion: string | null = null,
  ): Promise<QuotaProbeResult> => {
    await input.journalFailure(failure);
    return {
      availability: "unavailable",
      failure,
      parsed,
      readout: parsed.readout,
      resolvedVersion,
    };
  };
  const retainedFailure = async (
    failure: Omit<Extract<QuotaProbeFailure, { reasonCode: "nonzero-exit" }>, "retainedPath"> |
      Omit<Extract<QuotaProbeFailure, { reasonCode: "unparseable" }>, "retainedPath">,
    bytes: string,
    parsed: ParsedQuotaReadout = parsedEmpty,
    resolvedVersion: string | null = null,
  ): Promise<QuotaProbeResult> => {
    const retainedPath = await input.retainFailureBytes(bytes);
    const complete: QuotaProbeFailure = failure.reasonCode === "nonzero-exit"
      ? { ...failure, retainedPath }
      : { ...failure, retainedPath };
    return unavailable(complete, parsed, resolvedVersion);
  };

  let executable: string;
  try {
    executable = input.resolveExecutable(QUOTA_AXI_EXECUTABLE, input.options.env);
  } catch {
    return unavailable({ reasonCode: "executable-not-found", executable: QUOTA_AXI_EXECUTABLE });
  }

  const configuredTimeouts = input.timeouts ?? DEFAULT_QUOTA_PROBE_TIMEOUTS;
  const timeoutMs = timeoutFor(input.purpose, configuredTimeouts);
  const commandOptions: SystemCommandOptions = { ...input.options, timeoutMs };

  let versionResult: CommandResult;
  try {
    versionResult = input.runCommand(executable, ["--version"], commandOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/(?:ETIMEDOUT|timed?\s*out|timeout)/iu.test(message)) {
      return unavailable({ reasonCode: "timeout", command: "version", timeoutMs });
    }
    return retainedFailure(
      { reasonCode: "nonzero-exit", command: "version", exitCode: null },
      "",
    );
  }
  if (timedOut(versionResult)) {
    return unavailable({ reasonCode: "timeout", command: "version", timeoutMs });
  }
  if (versionResult.error !== null || versionResult.status !== 0) {
    return retainedFailure(
      { reasonCode: "nonzero-exit", command: "version", exitCode: versionResult.status },
      rawResultBytes(versionResult),
    );
  }

  const found = numericVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  if (found === null) {
    return retainedFailure(
      { reasonCode: "unparseable", command: "version", faultCount: 1 },
      rawResultBytes(versionResult),
    );
  }
  if (compareNumericVersions(found.text, QUOTA_AXI_VERSION_FLOOR) === -1) {
    return unavailable({
      reasonCode: "version-below-floor",
      foundVersion: found.text,
      floorVersion: QUOTA_AXI_VERSION_FLOOR,
    }, parsedEmpty, found.text);
  }

  let result: CommandResult;
  try {
    result = input.runCommand(
      executable,
      buildQuotaAxiArgv(buildEnabledProviderCsv(input.routes)),
      commandOptions,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/(?:ETIMEDOUT|timed?\s*out|timeout)/iu.test(message)) {
      return unavailable({ reasonCode: "timeout", command: "probe", timeoutMs }, parsedEmpty, found.text);
    }
    return retainedFailure(
      { reasonCode: "nonzero-exit", command: "probe", exitCode: null },
      "",
      parsedEmpty,
      found.text,
    );
  }
  if (timedOut(result)) {
    return unavailable({ reasonCode: "timeout", command: "probe", timeoutMs }, parsedEmpty, found.text);
  }

  const parsed = parseQuotaReadout(result.stdout, input.now);
  if (result.error !== null || result.status !== 0) {
    return retainedFailure(
      { reasonCode: "nonzero-exit", command: "probe", exitCode: result.status },
      rawResultBytes(result),
      parsed,
      found.text,
    );
  }
  if (parsed.faults.length > 0) {
    return retainedFailure(
      { reasonCode: "unparseable", command: "probe", faultCount: parsed.faults.length },
      result.stdout,
      parsed,
      found.text,
    );
  }

  const failure = structuralFailure(parsed);
  if (failure !== null) return unavailable(failure, parsed, found.text);
  return {
    availability: "known",
    failure: null,
    parsed,
    readout: parsed.readout,
    resolvedVersion: found.text,
  };
}
