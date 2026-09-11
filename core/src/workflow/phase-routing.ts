import { isDeepStrictEqual } from "node:util";
import type { ModelInfo } from "../adapters/interface.ts";
import type { AgentDefinition, AwsfConfig } from "../config/schema.ts";
import type {
  EffectiveRouteProvenance,
  PhaseRouteSelection,
  RequestedRouteProvenance,
  ReviewRouteMode,
  RouteSelectionProvenance,
  RouteValueSource,
} from "../contracts/route-selection.ts";
import type { PhaseRouteOverrides } from "./route-flags.ts";

export class InvalidPhaseRouteSelection extends Error {
  readonly phaseId: string;

  constructor(phaseId: string, detail: string) {
    super(`phase route ${JSON.stringify(phaseId)} is invalid: ${detail}`);
    this.name = "InvalidPhaseRouteSelection";
    this.phaseId = phaseId;
  }
}

export interface RequestedPhaseRoute {
  /** A route-adjusted copy. Non-route role policy remains equal by value. */
  readonly agent: AgentDefinition;
  readonly requested: RequestedRouteProvenance;
  /**
   * The role's non-route policy, deep-copied BEFORE this function built the
   * adjusted agent. `retainedRolePolicy` compares against this copy and never
   * against the role the copy was taken from: a spread shares its nested
   * objects, so comparing the adjusted agent to its own source cannot observe
   * a mutation applied through either reference.
   */
  readonly policy: RolePolicy;
}

/**
 * Every part of a role phase routing must not touch: the whole definition
 * minus the three routable fields. Stated as a complement rather than a list,
 * so a field added to `AgentDefinition` is covered without editing the guard.
 */
export type RolePolicy = Omit<AgentDefinition, "model" | "thinking" | "harness"> & {
  readonly harness: Omit<AgentDefinition["harness"], "adapter">;
};

export function rolePolicyOf(agent: AgentDefinition): RolePolicy {
  const { model: _model, thinking: _thinking, harness, ...retained } = agent;
  const { adapter: _adapter, ...harnessRetained } = harness;
  return { ...retained, harness: harnessRetained };
}

/** The attempt's selection wins field by field; neither layer is discarded whole. */
function layered(
  configured: PhaseRouteSelection | undefined,
  attempted: PhaseRouteSelection | undefined,
): PhaseRouteSelection {
  if (attempted === undefined) return configured ?? {};
  if (configured === undefined) return attempted;
  return {
    ...configured,
    ...(attempted.adapter === undefined ? {} : { adapter: attempted.adapter, provider: attempted.provider }),
    ...(attempted.model === undefined ? {} : { model: attempted.model }),
    ...(attempted.effort === undefined ? {} : { effort: attempted.effort }),
  };
}

function sourceOf<K extends "adapter" | "provider" | "model" | "effort", F extends string>(
  key: K,
  configured: PhaseRouteSelection | undefined,
  attempted: PhaseRouteSelection | undefined,
  fallback: F,
): RouteValueSource | F {
  if (attempted?.[key] !== undefined) return "attempt-override";
  if (configured?.[key] !== undefined) return "phase-override";
  return fallback;
}

/**
 * Applies the optional phase override without changing the role contract.
 * Prompt paths, tools, writes, colour, purpose and continuity are retained from
 * the configured role; only model, effort and the explicit adapter/provider
 * pair are selectable.
 */
export function requestedPhaseRoute(
  config: AwsfConfig,
  phaseId: string,
  role: AgentDefinition,
  attemptOverrides?: PhaseRouteOverrides,
): RequestedPhaseRoute {
  const configured = config.routing.phase_routes?.[phaseId];
  const attempted = attemptOverrides?.[phaseId];
  // Field by field, so `--route builder=@max` sharpens the effort of a route
  // the config already chose rather than discarding the rest of it.
  const override = layered(configured, attempted);
  const adapterId = override.adapter ?? role.harness.adapter;
  const adapterEntry = config.adapters[adapterId];
  if (adapterEntry === undefined || adapterEntry.enabled === false) {
    throw new InvalidPhaseRouteSelection(phaseId, `adapter ${JSON.stringify(adapterId)} is disabled or undeclared`);
  }
  const model = override.model ?? role.model;
  const effort = override.effort ?? role.thinking;
  // `adapters[].provider` predates phase routing and was not a launch assertion.
  // Only the phase-level provider selector opts a route into provider enforcement;
  // otherwise the adapter's preflight answer preserves legacy no-override behaviour.
  const provider = override.provider ?? null;
  const policy = structuredClone(rolePolicyOf(role));
  const adjusted: AgentDefinition = {
    ...role,
    model,
    thinking: effort,
    harness: { ...role.harness, adapter: adapterId },
  };
  return Object.freeze({
    agent: Object.freeze(adjusted),
    policy: Object.freeze(policy),
    requested: Object.freeze({
      phaseId,
      adapterId,
      provider,
      model,
      effort,
      sources: Object.freeze({
        adapter: sourceOf("adapter", configured, attempted, "agent-default"),
        provider: sourceOf("provider", configured, attempted, "unspecified"),
        model: sourceOf("model", configured, attempted, "agent-default"),
        effort: sourceOf("effort", configured, attempted, "agent-default"),
      }),
      // A flag carries no evidence with it; evaluation stays a durable claim.
      evaluation: configured?.evaluation ?? null,
    }),
  });
}

/**
 * Converts an adapter's preflight answer into the effective route and checks
 * every explicit assertion. This runs before the caller reserves a provider
 * call; a mismatch is a refusal, never a fallback opportunity.
 */
export function effectivePhaseRoute(
  requested: RequestedRouteProvenance,
  adapterKind: string,
  model: ModelInfo,
): EffectiveRouteProvenance {
  if (model.adapter !== adapterKind) {
    throw new InvalidPhaseRouteSelection(
      requested.phaseId,
      `selected adapter implementation ${JSON.stringify(adapterKind)} described itself as ${JSON.stringify(model.adapter)}`,
    );
  }
  if (requested.provider !== null && requested.provider !== model.provider) {
    throw new InvalidPhaseRouteSelection(
      requested.phaseId,
      `explicit provider ${JSON.stringify(requested.provider)} does not match adapter provider ${JSON.stringify(model.provider)}`,
    );
  }
  return Object.freeze({
    adapterId: requested.adapterId,
    adapterKind,
    provider: model.provider,
    model: model.requestedModel,
    effort: requested.effort,
  });
}

export function routeSelectionProvenance(input: {
  readonly requested: RequestedRouteProvenance;
  readonly effective: EffectiveRouteProvenance;
  readonly reviewMode?: ReviewRouteMode;
}): RouteSelectionProvenance {
  const reviewMode = input.reviewMode ?? "not-review";
  const degraded = reviewMode === "same-provider-degraded";
  return Object.freeze({
    phaseId: input.requested.phaseId,
    requested: input.requested,
    effective: input.effective,
    observed: null,
    review: Object.freeze({
      mode: reviewMode,
      degraded,
      detail: degraded
        ? "explicit same-provider review has reduced independence; it was requested in durable config and was not selected as fallback"
        : null,
    }),
  });
}

/**
 * Route selection must retain every non-route role policy by value.
 *
 * `before` is the snapshot `requestedPhaseRoute` took of the role ahead of
 * routing, never the role object itself. Passing the role would make this a
 * comparison of an object with a spread of itself, which no mutation reachable
 * from either reference can fail.
 */
export function retainedRolePolicy(
  before: RolePolicy,
  routed: AgentDefinition,
): boolean {
  return isDeepStrictEqual(before, rolePolicyOf(routed));
}
