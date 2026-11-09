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
 * The resolved spine a deep plan belongs to: the leftmost `-wNN-` split whose
 * `<prefix>-plan` is a resolved stem. A greedy match takes the last split, which
 * names a spine that does not exist for a stem holding two `-wNN-` segments.
 */
function parentSpineOf(id: string, stems: ReadonlySet<string>): string | null {
  for (const match of id.matchAll(/-w\d\d-/gu)) {
    if (match.index === undefined || match.index === 0) continue;
    const parent = `${id.slice(0, match.index)}-plan`;
    if (stems.has(parent)) return parent;
  }
  return null;
}

/**
 * Classifies a resolved catalog structurally. A `<prefix>-wNN-*` plan is deep
 * only when its `<prefix>-plan` sibling was resolved; no plan HTML is read.
 */
export function classifyPlans(sources: readonly ResolvedPlanSource[]): readonly PlanIdentity[] {
  const stems = new Set(sources.map(planStem));
  return Object.freeze(sources.map((source) => {
    const id = planStem(source);
    const parentSpine = parentSpineOf(id, stems);
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
