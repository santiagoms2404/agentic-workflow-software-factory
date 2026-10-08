// Read-only gatherer. Provider processes and the trap layer are never started.
// quota-axi's failure bytes are discarded, not retained in the state root.
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../config/load.ts";
import type { AwsfConfig } from "../config/schema.ts";
import type { DoctorReadout, DoctorRow } from "../contracts/doctor-readout.ts";
import { resolveExecutable, runSystemCommand } from "../execution/transport-broker.ts";
import { scrubCredentials } from "../policy/redaction.ts";
import type { StorageMode } from "../preflight/fields.ts";
import { DEFAULT_QUOTA_PROBE_TIMEOUTS, probeQuota, type RunQuotaCommand, type ResolveQuotaExecutable } from "../quota/probe.ts";
import { configuredQuotaProbeRoutes, mapConfiguredQuotaRoutes, resolveProjectQuotaRoutes } from "../quota/routes.ts";
import { loadCatalog } from "../registry/catalog.ts";
import { readPlacement } from "../registry/placement.ts";
import { readTrapsReadout } from "../traps/readout.ts";
import { coverageRow } from "./coverage.ts";
import { executablesRow, type ExecutableFact } from "./executables.ts";
import { providersRow } from "./providers.ts";
import { quotaRow, quotaDiagnostics } from "./quota.ts";
import { storageRow } from "./storage.ts";

export type EnvironmentRows = Pick<DoctorReadout["rows"], "storage" | "executables" | "providers" | "quota" | "coverage">;
export interface GatherDoctorInput {
  readonly cwd: string;
  readonly stateRoot: string;
  readonly env: Readonly<Record<string, string>>;
  readonly runCommand?: RunQuotaCommand;
  readonly resolveExecutable?: ResolveQuotaExecutable;
  readonly now?: string;
}

async function modeOf(path: string, nearest = false): Promise<StorageMode> {
  let cursor = path;
  for (;;) {
    try { return { path: cursor, mode: (await stat(cursor)).mode }; }
    catch (error) {
      const parent = dirname(cursor);
      if (!nearest || (error as NodeJS.ErrnoException).code !== "ENOENT" || parent === cursor) return { path: cursor, mode: null };
      cursor = parent;
    }
  }
}

async function configuration(input: GatherDoctorInput): Promise<{ config: AwsfConfig | null; cwd: string; detail: string | null }> {
  try {
    const catalogPath = join(input.cwd, "awsf.project.yaml");
    let catalogText: string | null = null;
    try { catalogText = await readFile(catalogPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    let cwd = input.cwd;
    let configPath = join(cwd, "awsf.config.yaml");
    if (catalogText !== null) {
      const catalog = loadCatalog(catalogText);
      let placement;
      try { placement = await readPlacement(input.stateRoot, catalog.project.slug); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const resolved = await resolveProjectQuotaRoutes({ catalogPath, ...(placement === undefined ? {} : { placement }) });
      cwd = resolved.planRepositoryPath;
      configPath = resolved.configPath;
    }
    return { config: loadConfig(await readFile(configPath, "utf8")), cwd, detail: null };
  } catch (error) {
    return { config: null, cwd: input.cwd, detail: `configuration not measured (${(error as NodeJS.ErrnoException).code ?? "invalid"})` };
  }
}

const DEFAULT_EXECUTABLES: Readonly<Record<string, string>> = { "claude-code": "claude", "pi-codex": "pi", antigravity: "agy" };

export async function gatherDoctorRows(input: GatherDoctorInput): Promise<EnvironmentRows> {
  const run = input.runCommand ?? runSystemCommand;
  const resolver = input.resolveExecutable ?? resolveExecutable;
  const configured = await configuration(input);
  const routes = configured.config === null ? [] : mapConfiguredQuotaRoutes(configured.config);
  const facts: ExecutableFact[] = [];
  const measure = (name: string, executable: string): ExecutableFact => {
    let resolved: string | null = null;
    try { resolved = resolver(executable, input.env); } catch { /* An absence is reported, never repaired. */ }
    const fact = { name, executable, resolved };
    facts.push(fact);
    return fact;
  };
  for (const [id, adapter] of Object.entries(configured.config?.adapters ?? {})) {
    const executable = adapter.executable ?? DEFAULT_EXECUTABLES[adapter.kind];
    if (executable !== undefined) measure(`adapter ${id}${adapter.enabled === false ? " (disabled)" : ""}`, executable);
  }
  const git = measure("git", "git");
  const bwrap = measure("bwrap", "bwrap");
  measure("quota-axi", "quota-axi");
  let common: string | null = null;
  let worktreeRoot = configured.cwd;
  if (git.resolved !== null) {
    const options = { cwd: configured.cwd, env: input.env, timeoutMs: DEFAULT_QUOTA_PROBE_TIMEOUTS.interactivePreflightMs, maxBuffer: 1024 * 1024 };
    try {
      const directory = run(git.resolved, ["rev-parse", "--path-format=absolute", "--git-common-dir"], options);
      const root = run(git.resolved, ["rev-parse", "--show-toplevel"], options);
      if (directory.status === 0 && directory.error === null) common = resolve(configured.cwd, directory.stdout.trim());
      if (root.status === 0 && root.error === null) worktreeRoot = resolve(configured.cwd, root.stdout.trim());
    } catch { /* No readable Git root: storage reports not measured. */ }
  }
  const gitEntries = await Promise.all([
    ...(common === null ? [] : [modeOf(join(common, "HEAD")), modeOf(join(common, "config"))]),
    modeOf(worktreeRoot),
  ]);
  const storage = storageRow({ commonDirectory: common, worktreeRoot, stateRoot: input.stateRoot, gitEntries,
    stateEntry: await modeOf(input.stateRoot, true) });
  const executableRow = executablesRow(facts);
  if (configured.detail !== null) executableRow.detail.push(configured.detail);
  let diagnostics: readonly string[] = [];
  let latencyMs = 0;
  let result = null;
  if (configured.config !== null && configuredQuotaProbeRoutes(routes).length > 0) {
    const stop = configured.config.routing.quota_stop;
    const timeouts = routes.map(route => (stop?.by_adapter?.[route.adapterId] ?? stop?.default)?.probe_timeout_ms ?? DEFAULT_QUOTA_PROBE_TIMEOUTS.interactivePreflightMs);
    const start = performance.now();
    result = await probeQuota({
      routes: configuredQuotaProbeRoutes(routes), purpose: "interactive-preflight", now: input.now ?? new Date().toISOString(),
      timeouts: { interactivePreflightMs: Math.max(...timeouts), phaseBoundaryMs: DEFAULT_QUOTA_PROBE_TIMEOUTS.phaseBoundaryMs },
      options: { cwd: configured.cwd, env: input.env, maxBuffer: 4 * 1024 * 1024 },
      resolveExecutable: resolver,
      runCommand: (executable, argv, options) => {
        // quota-axi writes its cache even for default JSON. Mount the host read-only;
        // no writable temp/home/cache bind and no unsandboxed fallback. Its Codex
        // RPC fallback must not start a provider CLI (verified override in quota-axi).
        if (bwrap.resolved === null) throw new Error("read-only quota sandbox unavailable");
        const response = run(bwrap.resolved, ["--die-with-parent", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev",
          "--setenv", "QUOTA_AXI_CODEX_BINARY", "/dev/null", "--", executable, ...argv], options);
        if (argv.includes("--json") && response.error === null) diagnostics = quotaDiagnostics(response.stdout);
        return response;
      },
      journalFailure: () => { /* The returned reason is rendered in the quota row; no journal exists for doctor. */ },
      retainFailureBytes: async () => "not-retained:doctor-read-only",
    });
    latencyMs = Math.round(performance.now() - start);
  }
  let coverage: DoctorRow;
  try { coverage = coverageRow(await readTrapsReadout(input.stateRoot)); }
  catch { coverage = { status: "finding", detail: ["coverage not measured: unreadable trap evidence; no repair performed"] }; }
  return scrubCredentials({ storage, executables: executableRow, providers: providersRow(routes, result),
    quota: quotaRow(routes, result, configured.config?.routing.quota_stop, latencyMs, diagnostics), coverage });
}
