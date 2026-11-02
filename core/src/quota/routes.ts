import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "../config/load.ts";
import {
  KNOWN_ADAPTER_KINDS,
  type AdapterEntry,
  type AwsfConfig,
} from "../config/schema.ts";
import type { ProjectCatalog } from "../registry/catalog-schema.ts";
import { loadCatalog } from "../registry/catalog.ts";
import type { Placement } from "../registry/placement-schema.ts";
import { resolvePlanSources } from "../registry/plan-source.ts";
import type { ConfiguredQuotaRoute } from "./probe.ts";

export type KnownAdapterKind = (typeof KNOWN_ADAPTER_KINDS)[number];
export type QuotaAxiProvider = "claude" | "codex";
export type QuotaRouteDisposition = "measurable" | "spends-no-quota" | "unmeasurable";
export type QuotaRouteReason =
  | "fixture-spends-no-quota"
  | "antigravity-not-measurable"
  | "composite-members-unresolved"
  | "composite-member-unmeasurable";

export const QUOTA_ROUTE_REASON_TEXT: Readonly<Record<QuotaRouteReason, string>> = Object.freeze({
  "fixture-spends-no-quota": "fixture adapter spends no quota",
  "antigravity-not-measurable": "antigravity quota is not measurable by quota-axi",
  "composite-members-unresolved": "composite-fusion member adapters could not be resolved",
  "composite-member-unmeasurable": "composite-fusion contains a member whose quota is not measurable",
});

export interface ProjectQuotaRoute {
  /** Owner-chosen route identity. It is never interpreted as a provider name. */
  readonly adapterId: string;
  readonly adapterKind: KnownAdapterKind;
  readonly disposition: QuotaRouteDisposition;
  /** quota-axi provider names derived only from adapter kinds. */
  readonly providers: readonly QuotaAxiProvider[];
  /** Direct member kinds for a composite, null when its members did not resolve. */
  readonly memberKinds: readonly KnownAdapterKind[] | null;
  readonly reason: QuotaRouteReason | null;
}

/**
 * Composite membership is supplied by the composite implementation as adapter
 * ids. awsf/v1 has no durable `members` field, so routes must report an enabled
 * composite as unmeasurable unless that implementation can resolve its members.
 */
export type ResolveCompositeMemberIds = (
  adapterId: string,
  entry: AdapterEntry,
  config: AwsfConfig,
) => readonly string[] | undefined;

export interface MapQuotaRoutesOptions {
  readonly resolveCompositeMemberIds?: ResolveCompositeMemberIds;
}

export interface ResolveProjectQuotaRoutesInput extends MapQuotaRoutesOptions {
  readonly catalogPath: string;
  /** Required for a catalog whose plan repository is outside this checkout. */
  readonly placement?: Placement;
}

export interface ResolvedProjectQuotaRoutes {
  readonly project: string;
  readonly planRepositoryId: string;
  readonly planRepositoryPath: string;
  readonly configPath: string;
  readonly routes: readonly ProjectQuotaRoute[];
  readonly probeRoutes: readonly ConfiguredQuotaRoute[];
}

export class QuotaRouteResolutionError extends Error {
  readonly code: "E_QUOTA_PLAN_REPOSITORY_UNRESOLVED" | "E_QUOTA_PROJECT_MISMATCH";

  constructor(
    code: "E_QUOTA_PLAN_REPOSITORY_UNRESOLVED" | "E_QUOTA_PROJECT_MISMATCH",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "QuotaRouteResolutionError";
  }
}

interface KindMapping {
  readonly disposition: QuotaRouteDisposition;
  readonly providers: readonly QuotaAxiProvider[];
  readonly reason: QuotaRouteReason | null;
}

function mappingForLeafKind(kind: Exclude<KnownAdapterKind, "composite-fusion">): KindMapping {
  switch (kind) {
    case "claude-code":
      return { disposition: "measurable", providers: ["claude"], reason: null };
    case "pi-codex":
      return { disposition: "measurable", providers: ["codex"], reason: null };
    case "fixture":
      return { disposition: "spends-no-quota", providers: [], reason: "fixture-spends-no-quota" };
    case "antigravity":
      return { disposition: "unmeasurable", providers: [], reason: "antigravity-not-measurable" };
  }
}

function knownKind(entry: AdapterEntry): KnownAdapterKind {
  // loadConfig has already rejected every value outside this tuple. Keeping the
  // check here makes the pure mapper safe for typed callers that forged input.
  if (!(KNOWN_ADAPTER_KINDS as readonly string[]).includes(entry.kind)) {
    throw new RangeError(`unknown configured adapter kind: ${JSON.stringify(entry.kind)}`);
  }
  return entry.kind as KnownAdapterKind;
}

function uniqueProviders(providers: readonly QuotaAxiProvider[]): readonly QuotaAxiProvider[] {
  return Object.freeze([...new Set(providers)]);
}

function unresolvedComposite(adapterId: string): ProjectQuotaRoute {
  return Object.freeze({
    adapterId,
    adapterKind: "composite-fusion",
    disposition: "unmeasurable",
    providers: Object.freeze([]),
    memberKinds: null,
    reason: "composite-members-unresolved",
  });
}

function mapComposite(
  adapterId: string,
  entry: AdapterEntry,
  config: AwsfConfig,
  options: MapQuotaRoutesOptions,
  resolving: ReadonlySet<string>,
): ProjectQuotaRoute {
  if (resolving.has(adapterId)) return unresolvedComposite(adapterId);

  let memberIds: readonly string[] | undefined;
  try {
    memberIds = options.resolveCompositeMemberIds?.(adapterId, entry, config);
  } catch {
    return unresolvedComposite(adapterId);
  }
  if (memberIds === undefined || memberIds.length === 0) return unresolvedComposite(adapterId);

  const memberEntries = memberIds.map((memberId) => config.adapters[memberId]);
  if (
    new Set(memberIds).size !== memberIds.length
    || memberEntries.some((member) => member === undefined || member.enabled === false)
  ) {
    return unresolvedComposite(adapterId);
  }

  const nextResolving = new Set(resolving);
  nextResolving.add(adapterId);
  const members = memberIds.map((memberId, index) => mapRoute(
    memberId,
    memberEntries[index]!,
    config,
    options,
    nextResolving,
  ));
  if (members.some((member) => member.memberKinds === null && member.adapterKind === "composite-fusion")) {
    return unresolvedComposite(adapterId);
  }

  const memberKinds = Object.freeze(memberEntries.map((member) => knownKind(member!)));
  const providers = uniqueProviders(members.flatMap((member) => member.providers));
  if (members.some((member) => member.disposition === "unmeasurable")) {
    return Object.freeze({
      adapterId,
      adapterKind: "composite-fusion",
      disposition: "unmeasurable",
      providers,
      memberKinds,
      reason: "composite-member-unmeasurable",
    });
  }
  if (providers.length === 0) {
    return Object.freeze({
      adapterId,
      adapterKind: "composite-fusion",
      disposition: "spends-no-quota",
      providers,
      memberKinds,
      reason: "fixture-spends-no-quota",
    });
  }
  return Object.freeze({
    adapterId,
    adapterKind: "composite-fusion",
    disposition: "measurable",
    providers,
    memberKinds,
    reason: null,
  });
}

function mapRoute(
  adapterId: string,
  entry: AdapterEntry,
  config: AwsfConfig,
  options: MapQuotaRoutesOptions,
  resolving: ReadonlySet<string>,
): ProjectQuotaRoute {
  const adapterKind = knownKind(entry);
  if (adapterKind === "composite-fusion") {
    return mapComposite(adapterId, entry, config, options, resolving);
  }
  const mapping = mappingForLeafKind(adapterKind);
  return Object.freeze({
    adapterId,
    adapterKind,
    disposition: mapping.disposition,
    providers: Object.freeze([...mapping.providers]),
    memberKinds: Object.freeze([]),
    reason: mapping.reason,
  });
}

/** Maps every enabled configured route by kind. Disabled routes are absent. */
export function mapConfiguredQuotaRoutes(
  config: AwsfConfig,
  options: MapQuotaRoutesOptions = {},
): readonly ProjectQuotaRoute[] {
  return Object.freeze(Object.entries(config.adapters)
    .filter(([, entry]) => entry.enabled !== false)
    .map(([adapterId, entry]) => mapRoute(adapterId, entry, config, options, new Set())));
}

/** Flattens only kind-derived measurable providers for quota-axi's selector. */
export function configuredQuotaProbeRoutes(
  routes: readonly ProjectQuotaRoute[],
): readonly ConfiguredQuotaRoute[] {
  const providers = uniqueProviders(routes.flatMap((route) => route.providers));
  return Object.freeze(providers.map((provider) => Object.freeze({ provider })));
}

function planRepositoryRoot(planPath: string, plansRoot: string): string {
  const depth = plansRoot.split("/").length;
  return resolve(dirname(planPath), ...Array.from({ length: depth }, () => ".."));
}

function findCheckoutRoot(start: string): string | null {
  let candidate = resolve(start);
  while (true) {
    if (existsSync(join(candidate, ".git"))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

function isInside(path: string, root: string): boolean {
  const offset = relative(root, path);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function planRepositoryId(catalog: ProjectCatalog): string | undefined {
  const entry = Object.entries(catalog.repositories).find(([, repository]) => repository.role === "plan");
  return entry?.[0];
}

function resolvePlanRepository(
  catalogPath: string,
  catalog: ProjectCatalog,
  placement?: Placement,
): { repositoryId: string; repositoryPath: string } | null {
  const repositoryId = planRepositoryId(catalog);
  if (repositoryId === undefined) return null;

  const localCheckout = findCheckoutRoot(process.cwd());
  const resolvedCatalogPath = resolve(catalogPath);
  if (localCheckout !== null && isInside(resolvedCatalogPath, localCheckout)) {
    return { repositoryId, repositoryPath: localCheckout };
  }

  if (placement === undefined || placement.project !== catalog.project.slug) {
    return null;
  }

  const located = placement.repositories[repositoryId];
  if (located === undefined) {
    return null;
  }

  return { repositoryId, repositoryPath: located.path };
}

/**
 * Loads awsf.project.yaml, resolves its declared plan repository using W04's
 * placement rules, then reads that repository's awsf.config.yaml. Local auth
 * state never participates in route selection.
 */
export async function resolveProjectQuotaRoutes(
  input: ResolveProjectQuotaRoutesInput,
): Promise<ResolvedProjectQuotaRoutes> {
  const catalog = loadCatalog(await readFile(input.catalogPath, "utf8"));
  const planSources = resolvePlanSources(input.catalogPath, catalog, input.placement);
  let repositoryId: string;
  let repositoryPath: string;

  const source = planSources[0];
  if (source !== undefined) {
    repositoryId = source.repositoryId;
    repositoryPath = planRepositoryRoot(source.planPath, catalog.plans.root);
  } else {
    // A placed repository with awsf.config.yaml might contain 0 .html plan
    // files. Resolve repository path directly rather than misdiagnosing the
    // repository as unplaced and throwing E_QUOTA_PLAN_REPOSITORY_UNRESOLVED.
    const resolved = resolvePlanRepository(input.catalogPath, catalog, input.placement);
    if (resolved === null) {
      throw new QuotaRouteResolutionError(
        "E_QUOTA_PLAN_REPOSITORY_UNRESOLVED",
        `project ${JSON.stringify(catalog.project.slug)} plan repository could not be resolved`,
      );
    }
    repositoryId = resolved.repositoryId;
    repositoryPath = resolved.repositoryPath;
  }

  const configPath = join(repositoryPath, "awsf.config.yaml");
  const config = loadConfig(await readFile(configPath, "utf8"));
  if (config.project.slug !== catalog.project.slug) {
    throw new QuotaRouteResolutionError(
      "E_QUOTA_PROJECT_MISMATCH",
      `plan repository config project ${JSON.stringify(config.project.slug)} does not match catalog project ${JSON.stringify(catalog.project.slug)}`,
    );
  }

  const routes = mapConfiguredQuotaRoutes(config, input);
  return Object.freeze({
    project: catalog.project.slug,
    planRepositoryId: repositoryId,
    planRepositoryPath: repositoryPath,
    configPath,
    routes,
    probeRoutes: configuredQuotaProbeRoutes(routes),
  });
}
