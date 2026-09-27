// The route one agent phase ran on, resolved from the evidence the journal
// holds for it. Pure: the projector hands it a phase, the phase's latest
// `route_resolution` payload and the session's parsed config snapshot, and
// writes what comes back into migration 0007's five `phases` columns.
//
// It lives beside the projector rather than under `core/src/metrics/` so the
// projector, the only SQLite writer of these columns (invariant 6), imports
// nothing from the read-side metrics modules.

import { AGENT_PHASE_IDS } from "../config/workflow-ids.ts";
import { ROUTE_EFFORT_LEVELS } from "../config/schema.ts";
import type { RouteEffort, RouteSelectionProvenance, RouteValueSource } from "../contracts/route-selection.ts";

/**
 * Where a phase's effort came from, spelled as migration 0007's CHECK spells it.
 *
 * `journal` — the phase's own `route_resolution` event, which also carries
 * every `--route` override. `config-phase-route` — the snapshot's
 * `routing.phase_routes` entry for the phase. `config-agent` — the snapshot
 * agent that owns the phase. `unknown` — none of them said, and nothing is
 * guessed in their place.
 */
export const EFFORT_SOURCES = ["journal", "config-phase-route", "config-agent", "unknown"] as const;
export type EffortSource = (typeof EFFORT_SOURCES)[number];

export interface PhaseRouteInput {
  readonly phase: { readonly key: string; readonly owner: string };
  /** The phase's latest `route_resolution` payload, or `null` when the journal has none. */
  readonly routeEvent: RouteSelectionProvenance | null;
  /** The session's parsed `config_snapshot_json`. Read defensively: any shape is accepted. */
  readonly configSnapshot: unknown;
}

export interface ResolvedPhaseRoute {
  readonly adapterId: string | null;
  readonly adapterKind: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly effort: RouteEffort | null;
  readonly effortSource: EffortSource;
  /** `requested.sources.effort` of the route event; `null` unless `effortSource` is `journal`. */
  readonly journalSource: RouteValueSource | null;
}

type JsonObject = Readonly<Record<string, unknown>>;

function objectOf(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function effortOf(value: unknown): RouteEffort | null {
  return (ROUTE_EFFORT_LEVELS as readonly unknown[]).includes(value) ? value as RouteEffort : null;
}

/** A route event is usable only when its effective block names a whole route. */
function fromJournal(route: RouteSelectionProvenance): ResolvedPhaseRoute | null {
  const effective = objectOf(route.effective);
  if (effective === null) return null;
  const adapterId = textOf(effective["adapterId"]);
  const adapterKind = textOf(effective["adapterKind"]);
  const provider = textOf(effective["provider"]);
  const model = textOf(effective["model"]);
  const effort = effortOf(effective["effort"]);
  if (adapterId === null || adapterKind === null || provider === null || model === null || effort === null) return null;
  const sources = objectOf(objectOf(route.requested)?.["sources"]);
  const journalSource = sources?.["effort"];
  return Object.freeze({
    adapterId,
    adapterKind,
    provider,
    model,
    effort,
    effortSource: "journal",
    journalSource: journalSource === "agent-default" || journalSource === "phase-override" || journalSource === "attempt-override"
      ? journalSource
      : null,
  });
}

/**
 * The snapshot route, resolved the way `requestedPhaseRoute` resolves a live
 * one: the phase-route entry under the exact phase key wins; a compiled
 * phase (`t01-build`, `shift-review`), which no config key can spell, falls
 * back to the entry under its owning role; each field the entry leaves out
 * comes from the owning agent.
 */
function fromSnapshot(phase: PhaseRouteInput["phase"], snapshot: JsonObject | null): ResolvedPhaseRoute {
  const agents = snapshot?.["agents"];
  const agent = Array.isArray(agents)
    ? agents.map(objectOf).find((candidate) => candidate !== null && candidate["name"] === phase.owner) ?? null
    : null;
  const routes = objectOf(objectOf(snapshot?.["routing"])?.["phase_routes"]);
  const compiled = !(AGENT_PHASE_IDS as readonly string[]).includes(phase.key);
  const entry = objectOf(routes?.[phase.key]) ?? (compiled ? objectOf(routes?.[phase.owner]) : null);

  const adapterId = textOf(entry?.["adapter"]) ?? textOf(objectOf(agent?.["harness"])?.["adapter"]);
  const adapter = adapterId === null ? null : objectOf(objectOf(snapshot?.["adapters"])?.[adapterId]);
  const routeEffort = effortOf(entry?.["effort"]);
  const agentEffort = effortOf(agent?.["thinking"]);
  const effort = routeEffort ?? agentEffort;
  return Object.freeze({
    adapterId,
    adapterKind: textOf(adapter?.["kind"]),
    // Only a declared provider: the phase route's selector, else the adapter
    // entry's label. The committed Claude adapter declares none, and that
    // stays NULL rather than being inferred from the adapter kind.
    provider: textOf(entry?.["provider"]) ?? textOf(adapter?.["provider"]),
    model: textOf(entry?.["model"]) ?? textOf(agent?.["model"]),
    effort,
    effortSource: routeEffort !== null ? "config-phase-route" : agentEffort !== null ? "config-agent" : "unknown",
    journalSource: null,
  });
}

/** Resolves one phase's route. Never throws, and never fills a value its sources did not state. */
export function resolvePhaseRoute(input: PhaseRouteInput): ResolvedPhaseRoute {
  const journal = input.routeEvent === null ? null : fromJournal(input.routeEvent);
  return journal ?? fromSnapshot(input.phase, objectOf(input.configSnapshot));
}
