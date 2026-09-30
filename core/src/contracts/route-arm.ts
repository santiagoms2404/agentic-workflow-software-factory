// An explicit owner-selected replay route, independent of metrics and scoring.
import { ROUTE_EFFORT_LEVELS } from "../config/schema.ts";
import type { RouteEffort } from "./route-selection.ts";

/** One route arm: an explicit `<adapter>/<provider>/<model>@<effort>`, every part named. */
export interface RouteArm {
  readonly spec: string;
  readonly adapter: string;
  readonly provider: string;
  readonly model: string;
  readonly effort: RouteEffort;
}

export class RouteArmSpecInvalid extends Error {
  readonly spec: string;

  constructor(spec: string, detail: string) {
    super(`route arm ${JSON.stringify(spec)} is invalid: ${detail}`);
    this.name = "RouteArmSpecInvalid";
    this.spec = spec;
  }
}

/** An arm leaves nothing to defaults: the replay measures the route the owner named. */
export function parseRouteArm(spec: string): RouteArm {
  const at = spec.lastIndexOf("@");
  if (at < 0) throw new RouteArmSpecInvalid(spec, "expected <adapter>/<provider>/<model>@<effort>");
  const segments = spec.slice(0, at).split("/");
  const effort = spec.slice(at + 1);
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    throw new RouteArmSpecInvalid(spec, "an arm names its adapter, provider and model, each non-empty");
  }
  if (!(ROUTE_EFFORT_LEVELS as readonly string[]).includes(effort)) {
    throw new RouteArmSpecInvalid(spec, `no effort level named ${JSON.stringify(effort)}; expected one of ${ROUTE_EFFORT_LEVELS.join(", ")}`);
  }
  const [adapter, provider, model] = segments as [string, string, string];
  return Object.freeze({ spec, adapter, provider, model, effort: effort as RouteEffort });
}
