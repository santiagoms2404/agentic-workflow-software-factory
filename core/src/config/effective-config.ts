import type { AwsfConfig } from "./schema.ts";
import {
  REDACTED_VALUE,
  containsCredential,
} from "../policy/redaction.ts";

// Same path shape the loader refuses in committed config. Credentials use the
// shared policy scrubber; effective config adds machine-path redaction because
// settings responses must not expose either class of runtime detail.
const ABSOLUTE_PATH_PATTERN = /^(\/|[A-Za-z]:[\\/]|\\\\|~)/;

function shouldRedact(value: string): boolean {
  return ABSOLUTE_PATH_PATTERN.test(value) || containsCredential(value);
}

function redactDeep(node: unknown): unknown {
  if (typeof node === "string") {
    return shouldRedact(node) ? REDACTED_VALUE : node;
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
