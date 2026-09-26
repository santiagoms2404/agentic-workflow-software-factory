// The model catalog names ROUTES, not answers. A selector such as
// `claude:opus` says which family AWSF asks; only a provider stream can say
// what model answered. Context windows remain null until catalog evidence is
// deliberately added — a made-up ceiling is worse than no ceiling.
// resolveSelector is declarative today: it has no production caller, so it is
// not a gate for live routes.

import type { ModelResolutionProvenance, NormalizedEvent } from "../contracts/normalized-events.ts";

export interface ModelFamily {
  alias: string;
  adapterKind: "claude-code" | "pi-codex" | "pi-openrouter" | "antigravity";
  provider: string;
  contextWindow: number | null;
  modelNamePattern: RegExp;
}

const PLAIN_MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Mirror the OpenRouter route's id shape without sharing its guard with Codex.
const OPENROUTER_MODEL_NAME = /^(?=.{1,128}$)(?:[A-Za-z0-9][A-Za-z0-9._-]*|~?[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*)$/;

export const MODEL_FAMILIES: readonly ModelFamily[] = Object.freeze([
  { alias: "claude", adapterKind: "claude-code", provider: "anthropic", contextWindow: null, modelNamePattern: PLAIN_MODEL_NAME },
  { alias: "codex", adapterKind: "pi-codex", provider: "openai-codex", contextWindow: null, modelNamePattern: PLAIN_MODEL_NAME },
  { alias: "antigravity", adapterKind: "antigravity", provider: "google", contextWindow: null, modelNamePattern: PLAIN_MODEL_NAME },
  { alias: "openrouter", adapterKind: "pi-openrouter", provider: "openrouter", contextWindow: null, modelNamePattern: OPENROUTER_MODEL_NAME },
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
  const family = MODEL_FAMILIES.find((entry) => entry.alias === alias);
  return family !== undefined && family.modelNamePattern.test(requestedModel)
    ? { ...family, requestedModel }
    : null;
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
