import type { CommandResult } from "../execution/process-controller.ts";
import type { SystemCommandOptions } from "../execution/transport-broker.ts";

export const QUOTA_AXI_EXECUTABLE = "quota-axi";

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

export interface QuotaProbeInput {
  readonly runCommand: RunQuotaCommand;
  readonly resolveExecutable: ResolveQuotaExecutable;
  /** Only configured, measurable routes reach this list. */
  readonly routes: readonly ConfiguredQuotaRoute[];
  /** The command descriptor's environment, including the PATH to resolve against. */
  readonly options: SystemCommandOptions & { readonly env: Readonly<Record<string, string>> };
}

/** The raw command result. Parsing is deliberately the caller's separate concern. */
export interface QuotaProbeResult {
  readonly bytes: string;
  readonly status: number | null;
  readonly stderr: string;
  readonly error: string | null;
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

/**
 * Runs the installed quota-axi executable through injected process capabilities.
 * The returned bytes are intentionally not parsed here.
 */
export function probeQuota(input: QuotaProbeInput): QuotaProbeResult {
  const executable = input.resolveExecutable(QUOTA_AXI_EXECUTABLE, input.options.env);
  const result = input.runCommand(
    executable,
    buildQuotaAxiArgv(buildEnabledProviderCsv(input.routes)),
    input.options,
  );
  return {
    bytes: result.stdout,
    status: result.status,
    stderr: result.stderr,
    error: result.error,
  };
}
