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
  const modelSegments = segments.slice(2);
  if (segments.length < 3 || segments.slice(0, 2).some((segment) => segment.length === 0) || modelSegments.some((segment) => segment.length === 0)) {
    throw new RouteArmSpecInvalid(spec, "an arm names its adapter, provider and model, each non-empty");
  }
  if (!(ROUTE_EFFORT_LEVELS as readonly string[]).includes(effort)) {
    throw new RouteArmSpecInvalid(spec, `no effort level named ${JSON.stringify(effort)}; expected one of ${ROUTE_EFFORT_LEVELS.join(", ")}`);
  }
  const adapter = segments[0]!;
  const provider = segments[1]!;
  const model = modelSegments.join("/");
  // The effort is the part after the last @, so a model id that itself holds
  // @ would be split here and accepted. The --route flag refuses the same
  // spelling as an unrepresentable selector, so the arm refuses it too (B3-16).
  if (model.includes("@")) {
    throw new RouteArmSpecInvalid(spec, `model ${JSON.stringify(model)} is not a representable selector; @ separates the effort`);
  }
  return Object.freeze({ spec, adapter, provider, model, effort: effort as RouteEffort });
}
