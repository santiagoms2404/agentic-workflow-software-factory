// `--route <phase>=<adapter>/<provider>/<model>@<effort>` — the owner's
// per-attempt route selection, parsed here and nowhere else.
//
// Why a flag rather than another config surface: `awsf.config.yaml` is durable
// intent, and an attempt records the effective configuration it was created
// under. `awsf rework` and `awsf review` both refuse when the live config no
// longer matches that snapshot, so expressing one attempt's routing by editing
// the file would lock the owner out of the acts the routing was chosen for.
// The selection lives on the attempt instead and the snapshot is never touched
// — the same argument `raise.ts` makes for the call ceiling.
//
// The grammar's delimiters are chosen so a model name can never contain one:
// both adapters refuse `/` in a selector (it would name a second provider from
// inside a flag), and no selector carries `@`. A model MAY contain `:`, which
// is why the family prefix in `claude:opus` needs no escaping here.

import { AGENT_PHASE_IDS } from "../config/workflow-ids.ts";
import { ROUTE_EFFORT_LEVELS, type AwsfConfig } from "../config/schema.ts";
import { BUILD_OUTPUT_SCHEMA_ID } from "../contracts/build-output.ts";
import { REVIEW_OUTPUT_SCHEMA_ID } from "../contracts/review-output.ts";
import type { PhaseRouteSelection, RouteEffort } from "../contracts/route-selection.ts";
import type { WorkflowRecipe } from "./compiler.ts";

/** Selections the owner attached to one attempt, keyed by agent phase id. */
export type PhaseRouteOverrides = Readonly<Record<string, PhaseRouteSelection>>;

/**
 * Deliberately looser than either adapter's own selector test: this accepts the
 * `family:model` spelling `awsf.config.yaml` writes, and each adapter applies
 * its stricter rule after stripping the prefix it owns. A prefix naming the
 * wrong adapter therefore fails at that adapter rather than being guessed at
 * here.
 */
const ROUTE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class RouteFlagInvalid extends Error {
  readonly value: string;

  constructor(value: string, detail: string) {
    super(`--route ${JSON.stringify(value)} is invalid: ${detail}`);
    this.name = "RouteFlagInvalid";
    this.value = value;
  }
}

export class RouteFlagDuplicated extends Error {
  readonly phaseId: string;

  constructor(phaseId: string) {
    super(`--route names phase ${JSON.stringify(phaseId)} twice; one attempt gives each phase one route`);
    this.name = "RouteFlagDuplicated";
    this.phaseId = phaseId;
  }
}

export interface ParsedRouteFlag {
  readonly phaseId: string;
  readonly selection: PhaseRouteSelection;
}

/** One `<phase>=<route>` pair. Every refusal names the whole value it read. */
export function parseRouteFlag(value: string): ParsedRouteFlag {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    throw new RouteFlagInvalid(value, "expected <phase>=<adapter>/<provider>/<model>@<effort>");
  }
  const phaseId = value.slice(0, separator);
  if (!(AGENT_PHASE_IDS as readonly string[]).includes(phaseId)) {
    throw new RouteFlagInvalid(value, `unknown agent phase ${JSON.stringify(phaseId)}; known phase ids: ${AGENT_PHASE_IDS.join(", ")}`);
  }

  const remainder = value.slice(separator + 1);
  const at = remainder.indexOf("@");
  const routePart = at < 0 ? remainder : remainder.slice(0, at);
  const effortPart = at < 0 ? null : remainder.slice(at + 1);

  // Always both or neither, so the pair can never reach the selection half-set.
  let pair: { readonly adapter: string; readonly provider: string } | undefined;
  let model: string | undefined;

  if (routePart.includes("/")) {
    const segments = routePart.split("/");
    if (segments.length !== 3) {
      throw new RouteFlagInvalid(value, "an explicit route is exactly <adapter>/<provider>/<model>; leave the model empty to keep the phase's configured one");
    }
    const [adapterPart, providerPart, modelPart] = segments as [string, string, string];
    // The loader refuses a half-explicit pair for the same reason: a provider
    // with no adapter behind it is an assertion nothing can execute.
    if (adapterPart.length === 0 || providerPart.length === 0) {
      throw new RouteFlagInvalid(value, "adapter and provider must both be named; a half-explicit provider route is not executable evidence");
    }
    pair = { adapter: adapterPart, provider: providerPart };
    if (modelPart.length > 0) model = modelPart;
  } else if (routePart.length > 0) {
    model = routePart;
  }

  if (model !== undefined && !ROUTE_MODEL.test(model)) {
    throw new RouteFlagInvalid(value, `model ${JSON.stringify(model)} is not a representable selector`);
  }

  let effort: RouteEffort | undefined;
  if (effortPart !== null) {
    if (!(ROUTE_EFFORT_LEVELS as readonly string[]).includes(effortPart)) {
      throw new RouteFlagInvalid(value, `no effort level named ${JSON.stringify(effortPart)}; this CLI accepts ${ROUTE_EFFORT_LEVELS.join(", ")}`);
    }
    effort = effortPart as RouteEffort;
  }

  if (pair === undefined && model === undefined && effort === undefined) {
    throw new RouteFlagInvalid(value, "names a phase but selects nothing; give an adapter/provider, a model, an effort, or some combination");
  }

  return Object.freeze({
    phaseId,
    selection: Object.freeze({
      ...(pair === undefined ? {} : pair),
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    }),
  });
}

/** Every `--route` on one command line, refused whole if any pair is unusable. */
export function parseRouteFlags(values: readonly string[]): PhaseRouteOverrides {
  const overrides: Record<string, PhaseRouteSelection> = {};
  for (const value of values) {
    const parsed = parseRouteFlag(value);
    if (Object.hasOwn(overrides, parsed.phaseId)) throw new RouteFlagDuplicated(parsed.phaseId);
    overrides[parsed.phaseId] = parsed.selection;
  }
  return Object.freeze(overrides);
}

/** How the attempt's own routes read back on a status line or in a refusal. */
export function formatRouteOverride(phaseId: string, selection: PhaseRouteSelection): string {
  const route = selection.adapter === undefined
    ? selection.model ?? "configured model"
    : `${selection.adapter}/${selection.provider ?? "?"}/${selection.model ?? "configured model"}`;
  return `${phaseId}=${route}@${selection.effort ?? "configured effort"}`;
}

export interface SameProviderPrediction {
  readonly reviewPhaseId: string;
  readonly workerPhaseId: string;
  readonly provider: string;
}

/**
 * Whether the routes as written already put the review on the builder's
 * provider — answered from EXPLICIT providers only.
 *
 * This is a courtesy, not the rule. The rule is enforced at REVIEWING against
 * the provider the builder actually ran on, read from the journal, and nothing
 * here can relax it. So this deliberately declines to guess: a route that names
 * no provider is left alone rather than resolved through the config's optional
 * adapter label, which is not a launch assertion. Saying nothing when unsure is
 * correct; a wrong warning would teach the owner to ignore the right one.
 */
export function predictSameProviderReview(
  config: AwsfConfig,
  overrides: PhaseRouteOverrides,
  recipe: WorkflowRecipe,
): SameProviderPrediction | null {
  const review = recipe.phases.find((phase) => phase.kind === "agent" && phase.schemaId === REVIEW_OUTPUT_SCHEMA_ID);
  const worker = recipe.phases.find((phase) => phase.kind === "agent" && phase.schemaId === BUILD_OUTPUT_SCHEMA_ID);
  if (review === undefined || worker === undefined) return null;

  const explicitProvider = (phaseId: string): string | null =>
    overrides[phaseId]?.provider ?? config.routing.phase_routes?.[phaseId]?.provider ?? null;

  const reviewProvider = explicitProvider(review.id);
  const workerProvider = explicitProvider(worker.id);
  if (reviewProvider === null || workerProvider === null) return null;
  if (reviewProvider !== workerProvider) return null;
  return Object.freeze({ reviewPhaseId: review.id, workerPhaseId: worker.id, provider: reviewProvider });
}
