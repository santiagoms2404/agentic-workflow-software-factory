// The environment a provider child is allowed to see.
//
// This policy is owned here rather than in an adapter module because the
// transport broker applies it again at the process boundary. Adapters also use
// it while building descriptors, but the host boundary must not depend on the
// provider implementations it is protecting.
//
// ---------------------------------------------------------------------------
// PORT — attribution per the plan's Q9 resolution.
//
//   MIT License · Copyright (c) 2026 IndyDevDan
//   fusion-harness `extensions/fusion-harness/core/launch.ts:33-62` —
//   `ENV_ALLOWLIST`, `ENV_INJECTED`, and the credential value/key scan in
//   `filterEnv`.
// ---------------------------------------------------------------------------

import { containsCredential } from "../policy/redaction.ts";
import { AdapterError } from "../contracts/adapter-error.ts";

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
 * The allowlist, plus a value scan on top. An allowlisted key holding
 * credential-shaped bytes is a hard `E_REDACTION` error rather than a
 * pass-through.
 */
export function filterEnv(
  adapter: string,
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const filtered: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = source[key];
    if (value === undefined) continue;
    filtered[key] = admitEnvironmentEntry(adapter, key, value);
  }
  return Object.freeze({ ...filtered, ...ENV_INJECTED });
}

/** Apply the same credential refusal to environment entries outside the base allowlist. */
export function admitEnvironmentEntry(adapter: string, key: string, value: string): string {
  if (ENV_CREDENTIAL_KEY.test(key) || containsCredential(value)) {
    throw new AdapterError(
      adapter,
      "E_REDACTION",
      `the allowlisted environment entry ${JSON.stringify(key)} holds credential-shaped data`,
    );
  }
  return value;
}
