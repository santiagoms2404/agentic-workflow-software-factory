import type { AwsfConfig } from "./schema.ts";

const REDACTED = "[REDACTED]";

// Same shapes the loader already refuses to accept into a committed config.
// Kept here too as a defense-in-depth net: effective-config is what the API
// and dashboard actually render, and it must stay safe even if it is one day
// fed a config merged with runtime data (continuity refs, resolved paths)
// rather than only the loader's own output.
const ABSOLUTE_PATH_PATTERN = /^(\/|[A-Za-z]:[\\/]|\\\\|~)/;
const CREDENTIAL_SHAPED_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{36}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /^Bearer\s+\S+/,
  /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/,
];

function shouldRedact(value: string): boolean {
  return ABSOLUTE_PATH_PATTERN.test(value) || CREDENTIAL_SHAPED_PATTERNS.some((p) => p.test(value));
}

function redactDeep(node: unknown): unknown {
  if (typeof node === "string") {
    return shouldRedact(node) ? REDACTED : node;
  }
  if (Array.isArray(node)) {
    return node.map(redactDeep);
  }
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = redactDeep(value);
    }
    return out;
  }
  return node;
}

// The redacted view of the committed config, safe to serve over
// `/api/v1/settings` and render in the dashboard's `SettingsRoute` ·
// `EffectiveConfig` panel. Structurally identical to `AwsfConfig` — nothing
// is dropped, string leaves that look like a machine path or a credential
// are replaced with `"[REDACTED]"`.
export type EffectiveConfig = AwsfConfig;

export function buildEffectiveConfig(config: AwsfConfig): EffectiveConfig {
  return redactDeep(config) as EffectiveConfig;
}

/**
 * Serializes an effective config to the JSON string persisted in
 * `sessions.config_snapshot_json` (`CHECK (json_valid(config_snapshot_json))`
 * in the observability schema). Always redacts first, so a raw `AwsfConfig`
 * is never accidentally captured verbatim.
 */
export function toConfigSnapshotJson(config: AwsfConfig): string {
  return JSON.stringify(buildEffectiveConfig(config));
}
