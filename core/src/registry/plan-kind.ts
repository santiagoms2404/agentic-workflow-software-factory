import { basename } from "node:path";
import type { ResolvedPlanSource } from "./plan-source.ts";

export type PlanKind = "spine" | "deep";

export interface PlanIdentity {
  /** The plan HTML stem and ticket-directory name. */
  readonly id: string;
  /** A filesystem-independent display name. */
  readonly name: string;
  readonly kind: PlanKind;
  readonly parentSpine: string | null;
  readonly parentSpineName: string | null;
}

function planStem(source: ResolvedPlanSource): string {
  return basename(source.planPath, ".html");
}

/**
 * Classifies a resolved catalog structurally. A `<prefix>-wNN-*` plan is deep
 * only when its `<prefix>-plan` sibling was resolved; no plan HTML is read.
 */
export function classifyPlans(sources: readonly ResolvedPlanSource[]): readonly PlanIdentity[] {
  const stems = new Set(sources.map(planStem));
  return Object.freeze(sources.map((source) => {
    const id = planStem(source);
    const deep = /^(.+)-w\d\d-/u.exec(id);
    const parent = deep?.[1] === undefined ? null : `${deep[1]}-plan`;
    const parentSpine = parent !== null && stems.has(parent) ? parent : null;
    const kind: PlanKind = parentSpine === null ? "spine" : "deep";
    return Object.freeze({
      id,
      name: id,
      kind,
      parentSpine,
      parentSpineName: parentSpine,
    });
  }));
}
