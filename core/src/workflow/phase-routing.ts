import { isDeepStrictEqual } from "node:util";
import type { ModelInfo } from "../adapters/interface.ts";
import type { AgentDefinition, AwsfConfig } from "../config/schema.ts";
import type {
  EffectiveRouteProvenance,
  RequestedRouteProvenance,
  ReviewRouteMode,
  RouteSelectionProvenance,
} from "../contracts/route-selection.ts";

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
): RequestedPhaseRoute {
  const override = config.routing.phase_routes?.[phaseId];
  const adapterId = override?.adapter ?? role.harness.adapter;
  const adapterEntry = config.adapters[adapterId];
  if (adapterEntry === undefined || adapterEntry.enabled === false) {
    throw new InvalidPhaseRouteSelection(phaseId, `adapter ${JSON.stringify(adapterId)} is disabled or undeclared`);
  }
  const model = override?.model ?? role.model;
  const effort = override?.effort ?? role.thinking;
  // `adapters[].provider` predates phase routing and was not a launch assertion.
  // Only the phase-level provider selector opts a route into provider enforcement;
  // otherwise the adapter's preflight answer preserves legacy no-override behaviour.
  const provider = override?.provider ?? null;
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
        adapter: override?.adapter === undefined ? "agent-default" : "phase-override",
        provider: override?.provider === undefined ? "unspecified" : "phase-override",
        model: override?.model === undefined ? "agent-default" : "phase-override",
        effort: override?.effort === undefined ? "agent-default" : "phase-override",
      }),
      evaluation: override?.evaluation ?? null,
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
