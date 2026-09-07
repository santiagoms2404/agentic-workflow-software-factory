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
export type RouteEvaluation = Static<typeof RouteEvaluationSchema>;
export type PhaseRouteSelection = Static<typeof PhaseRouteSelectionSchema>;

export type RouteValueSource = "agent-default" | "phase-override";

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
    readonly mode: ReviewRouteMode | "not-review";
    readonly degraded: boolean;
    readonly detail: string | null;
  };
}
