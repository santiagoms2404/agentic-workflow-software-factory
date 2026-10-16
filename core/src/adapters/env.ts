// The environment a provider child is allowed to see, and (through `gateEnv`
// below) the environment a host gate is allowed to see.
//
// An ALLOWLIST, not a filter, and the distinction is the whole point: a filter
// enumerates what must not pass and is wrong the moment a new secret-shaped
// variable is invented, while an allowlist is wrong only in the direction of
// passing too little. The five injected values are applied AFTER filtering so an
// ambient `TERM=xterm-256color` or a hostile `LANG` cannot override the values
// two machines have to agree on for a run to frame and format identically.
//
// ---------------------------------------------------------------------------
// PORT — attribution per the plan's Q9 resolution.
//
//   MIT License · Copyright (c) 2026 IndyDevDan
//   fusion-harness `extensions/fusion-harness/core/launch.ts:33-62` —
//   `ENV_ALLOWLIST`, `ENV_INJECTED`, and the credential value/key scan in
//   `filterEnv`.
//
// Carried rather than re-derived because both real adapters need exactly this
// rule and neither should get to have its own opinion about it. AWSF's own
// change is the error type: a refusal here is an `AdapterError` carrying
// `E_REDACTION` out of the shared eleven-code vocabulary, so the journal and the
// UI read it the same way they read every other adapter refusal.
// ---------------------------------------------------------------------------

import { containsCredential } from "../policy/redaction.ts";
import { AdapterError } from "./interface.ts";

/** Deliberately minimal. Everything else a provider needs, it is told. */
export const ENV_ALLOWLIST: readonly string[] = Object.freeze(["PATH", "HOME", "TMPDIR"]);

/** Injected after filtering, so an ambient value cannot override them. */
export const ENV_INJECTED: Readonly<Record<string, string>> = Object.freeze({
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  TZ: "UTC",
  NO_COLOR: "1",
  TERM: "dumb",
});

/** Key names remain an environment-specific refusal; values use the shared scrubber vocabulary. */
const ENV_CREDENTIAL_KEY = /(?:key|token|secret|password|credential|auth|session)/i;

/**
 * The allowlist, plus a value scan on top.
 *
 * An allowlisted key holding credential-shaped bytes is a hard `E_REDACTION`
 * error rather than a pass-through: `PATH` is on the list because a provider
 * cannot resolve its own tools without it, not because whatever happens to be
 * inside it is safe to hand a child. Passing it anyway would be the harness
 * laundering a secret through a variable it had already decided was harmless.
 */
export function filterEnv(
  adapter: string,
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const filtered: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = source[key];
    if (value === undefined) continue;
    filtered[key] = admitted(adapter, key, value);
  }
  return Object.freeze({ ...filtered, ...ENV_INJECTED });
}

function admitted(adapter: string, key: string, value: string): string {
  if (ENV_CREDENTIAL_KEY.test(key) || containsCredential(value)) {
    throw new AdapterError(
      adapter,
      "E_REDACTION",
      `the allowlisted environment entry ${JSON.stringify(key)} holds credential-shaped data`,
    );
  }
  return value;
}

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
    if (value !== undefined) env[key] = admitted(GATE_ENV_LABEL, key, value);
  }
  for (const [key, value] of Object.entries(declared)) env[key] = admitted(GATE_ENV_LABEL, key, value);
  return Object.freeze(env);
}
