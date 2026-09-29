import type { Static } from "@sinclair/typebox";
import type {
  PhaseRouteSelectionSchema,
  REVIEW_ROUTE_MODES,
  ROUTE_EFFORT_LEVELS,
  RouteEvaluationSchema,
} from "../config/schema.ts";

/** Runtime schemas live in config/schema.ts so deterministic `awsf init` gains no workflow dependency. */
export type RouteEffort = (typeof ROUTE_EFFORT_LEVELS)[number];
export type ReviewRouteMode = (typeof REVIEW_ROUTE_MODES)[number];
/**
 * How one review actually ran. `seeded` is a prove replay's review of a
 * host-committed candidate: no provider built it, so there is nothing to
 * invert against and the replay's arm names the route. It is never a
 * configurable mode, which is why `REVIEW_ROUTE_MODES` does not carry it.
 */
export type ReviewRunMode = ReviewRouteMode | "seeded";
export type RouteEvaluation = Static<typeof RouteEvaluationSchema>;
export type PhaseRouteSelection = Static<typeof PhaseRouteSelectionSchema>;

/**
 * Where one route value came from.
 *
 * `phase-override` is `routing.phase_routes` in the durable config;
 * `attempt-override` is a `--route` the owner attached to this one attempt,
 * which outranks it. The two are kept apart because they answer different
 * questions later: one is what the project routes, the other is what this run
 * was asked to do differently.
 */
export type RouteValueSource = "agent-default" | "phase-override" | "attempt-override";

export interface RequestedRouteProvenance {
  readonly phaseId: string;
  readonly adapterId: string;
  /** Null means no provider was asserted by config; it is never filled by guesswork. */
  readonly provider: string | null;
  readonly model: string;
  readonly effort: RouteEffort;
  readonly sources: {
    readonly adapter: RouteValueSource;
    readonly provider: RouteValueSource | "unspecified";
    readonly model: RouteValueSource;
    readonly effort: RouteValueSource;
  };
  readonly evaluation: RouteEvaluation | null;
}

export interface EffectiveRouteProvenance {
  /** Config id, distinct from the adapter implementation id. */
  readonly adapterId: string;
  readonly adapterKind: string;
  readonly provider: string;
  /** Adapter-canonical selector, not a prediction of the model that answers. */
  readonly model: string;
  readonly effort: RouteEffort;
}

export interface ObservedRouteProvenance {
  readonly adapterKind: string;
  readonly provider: string;
  readonly requestedModel: string;
  readonly resolvedModel: string | null;
  readonly modelProvenance: "stream-authoritative" | "route-attributed" | null;
}

/** The journalled route record, completed from provider evidence after the turn. */
export interface RouteSelectionProvenance {
  readonly phaseId: string;
  readonly requested: RequestedRouteProvenance;
  readonly effective: EffectiveRouteProvenance;
  readonly observed: ObservedRouteProvenance | null;
  readonly review: {
    readonly mode: ReviewRunMode | "not-review";
    readonly degraded: boolean;
    readonly detail: string | null;
  };
}
