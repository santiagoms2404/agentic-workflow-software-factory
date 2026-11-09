// Host gates use the same process environment policy as provider descriptors,
// then add only the explicitly admitted host values below. The policy itself
// lives in execution/process-environment.ts so the broker can enforce it without
// importing an adapter module.

import { admitEnvironmentEntry, filterEnv } from "../execution/process-environment.ts";
export { ENV_ALLOWLIST, ENV_INJECTED, filterEnv } from "../execution/process-environment.ts";

// ---------------------------------------------------------------------------
// Host gates (owner call O6, finding B7-03).
//
// A configured gate (`npm run test:unit`, typecheck, lint, journeys, traps)
// executes agent-authored candidate code on the host with no sandbox, so it is
// held to the same allowlist as a provider child: inheriting the host
// environment handed the builder's own tests the Jev credential (inv 13) and
// every other secret in the owner's shell. ONE allowlist — this module's —
// extended by only what a gate needs to run, never a second copy.
// ---------------------------------------------------------------------------

/**
 * Passed from the parent when set, on top of `ENV_ALLOWLIST`. `CI` switches
 * test runners out of watch and interactive modes. The locale passes through
 * and replaces the injected default: the injected value exists so two machines
 * frame a PROVIDER stream identically, while a gate runs the owner's own
 * toolchain on the owner's host and is compared only against the same host's
 * baseline, which this same builder also produced.
 */
export const GATE_ENV_PASSTHROUGH: readonly string[] = Object.freeze(["CI", "LANG", "LC_ALL"]);

const GATE_ENV_LABEL = "gate";

/**
 * The environment every configured gate runs under: the provider allowlist and
 * injected set, the gate passthrough, then what config declared for the gate.
 * `NODE_OPTIONS` is deliberately NOT a passthrough — an ambient value can
 * preload arbitrary code into every node gate — so it reaches a gate only as a
 * declared entry. Every admitted entry gets `filterEnv`'s refusal: a
 * credential-named key or credential-shaped value is `E_REDACTION`, not a
 * pass-through.
 */
export function gateEnv(
  source: Readonly<Record<string, string | undefined>>,
  declared: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  const env: Record<string, string> = { ...filterEnv(GATE_ENV_LABEL, source) };
  for (const key of GATE_ENV_PASSTHROUGH) {
    const value = source[key];
    if (value !== undefined) env[key] = admitEnvironmentEntry(GATE_ENV_LABEL, key, value);
  }
  for (const [key, value] of Object.entries(declared)) env[key] = admitEnvironmentEntry(GATE_ENV_LABEL, key, value);
  return Object.freeze(env);
}
