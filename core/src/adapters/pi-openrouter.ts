// This is the OpenRouter route's selector boundary. The full adapter will be a
// second route over pi, not a change to the reviewed pi/Codex route.

import { AdapterError } from "./interface.ts";

export const PI_OPENROUTER_ADAPTER_ID = "pi-openrouter";
export const PI_OPENROUTER_MODEL_PREFIX = "openrouter:";

/**
 * Bare ids, vendor/model ids, and ~vendor/model latest aliases only. The
 * 128-character ceiling applies to the whole id, including ~ and /.
 *
 * Codex refuses slashes because pi can read one as a provider override. On
 * this route a slash spells an OpenRouter model; --provider openrouter remains
 * the only provider on the line. A colon still cannot pass: pi --model treats
 * id:<thinking> as a thinking override, which could supersede the --thinking
 * flag supplied from the agent configuration. Reject instead of rewriting a
 * request that would not mean what its caller asked for.
 */
const OPENROUTER_MODEL_SELECTOR = /^(?=.{1,128}$)(?:[A-Za-z0-9][A-Za-z0-9._-]*|~?[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*)$/;

/** Resolve the route alias without modifying the model id. */
export function selectorFor(model: string): string {
  const name = model.startsWith(PI_OPENROUTER_MODEL_PREFIX)
    ? model.slice(PI_OPENROUTER_MODEL_PREFIX.length)
    : model;
  if (!OPENROUTER_MODEL_SELECTOR.test(name)) {
    throw new AdapterError(
      PI_OPENROUTER_ADAPTER_ID,
      "E_MODEL_UNRESOLVED",
      `${JSON.stringify(model)} is not a model selector this adapter can put on a command line`,
    );
  }
  return name;
}
