// The environment a provider child is allowed to see.
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

/**
 * Credential SHAPES, widened past the ported list.
 *
 * `fusion-harness` carried three; the two added here — AWS access key ids and
 * GitHub's token family — are the ones this repository's own credential
 * meta-test already sweeps fixtures for, and a value scan that recognized fewer
 * shapes than the fixture sweep would have been the weaker of the two guards
 * standing in the more dangerous place. The fixture sweep protects bytes that
 * are already committed; this protects bytes on their way to a provider.
 */
const ENV_CREDENTIAL_VALUE =
  /(?:\bsk-[A-Za-z0-9_-]{8,}|\bBearer\s+\S+|-----BEGIN [A-Z ]+PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{16,})/i;
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
    if (ENV_CREDENTIAL_KEY.test(key) || ENV_CREDENTIAL_VALUE.test(value)) {
      throw new AdapterError(
        adapter,
        "E_REDACTION",
        `the allowlisted environment entry ${JSON.stringify(key)} holds credential-shaped data`,
      );
    }
    filtered[key] = value;
  }
  return Object.freeze({ ...filtered, ...ENV_INJECTED });
}
