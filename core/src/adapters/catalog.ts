// The model catalog names ROUTES, not answers. A selector such as
// `claude:opus` says which family AWSF asks; only a provider stream can say
// what model answered. Context windows remain null until catalog evidence is
// deliberately added — a made-up ceiling is worse than no ceiling.

import type { ModelResolutionProvenance, NormalizedEvent } from "../contracts/normalized-events.ts";

export interface ModelFamily {
  alias: string;
  adapterKind: "claude-code" | "pi-codex" | "antigravity";
  provider: string;
  contextWindow: number | null;
}

export const MODEL_FAMILIES: readonly ModelFamily[] = Object.freeze([
  { alias: "claude", adapterKind: "claude-code", provider: "anthropic", contextWindow: null },
  { alias: "codex", adapterKind: "pi-codex", provider: "openai-codex", contextWindow: null },
  { alias: "antigravity", adapterKind: "antigravity", provider: "google", contextWindow: null },
]);

export interface CatalogSelector extends ModelFamily {
  requestedModel: string;
}

/** A selector is a family alias plus an adapter-representable model name. */
export function resolveSelector(selector: string): CatalogSelector | null {
  const separator = selector.indexOf(":");
  if (separator <= 0 || separator !== selector.lastIndexOf(":")) return null;
  const alias = selector.slice(0, separator);
  const requestedModel = selector.slice(separator + 1);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(requestedModel)) return null;
  const family = MODEL_FAMILIES.find((entry) => entry.alias === alias);
  return family === undefined ? null : { ...family, requestedModel };
}

export interface ResolvedIdentity {
  resolvedModel: string | "unknown";
  provenance: ModelResolutionProvenance | "unknown";
}

/**
 * The catalog never promotes the requested selector into an answer. Until a
 * `model.resolved` event arrives, the only honest identity is `unknown`.
 */
export function resolvedIdentity(events: Iterable<NormalizedEvent>): ResolvedIdentity {
  for (const event of events) {
    if (event.kind === "model.resolved") {
      return { resolvedModel: event.resolvedModel, provenance: event.provenance };
    }
  }
  return { resolvedModel: "unknown", provenance: "unknown" };
}
