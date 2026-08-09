// Config chooses an adapter id; this registry maps its kind to the reviewed
// implementation. It does not infer providers from quota or selectors.

import type { AdapterEntry, AwsfConfig } from "../config/schema.ts";
import { AntigravityAdapter } from "./antigravity.ts";
import { ClaudeCodeAdapter } from "./claude-code.ts";
import type { HarnessAdapter } from "./interface.ts";
import { PiCodexAdapter } from "./pi-codex.ts";

export type RegisteredAdapterKind = "claude-code" | "pi-codex" | "antigravity";

export function adapterFor(entry: AdapterEntry, runtime?: AwsfConfig["runtime"]): HarnessAdapter | null {
  const limits = runtime === undefined ? undefined : {
    maxOutputBytes: runtime.max_output_bytes,
    maxEventCount: runtime.max_event_count,
  };
  switch (entry.kind) {
    case "claude-code":
      return new ClaudeCodeAdapter({
        ...(entry.executable === undefined ? {} : { executable: entry.executable }),
        ...(limits === undefined ? {} : { limits }),
      });
    case "pi-codex":
      return new PiCodexAdapter({
        ...(entry.executable === undefined ? {} : { executable: entry.executable }),
        ...(limits === undefined ? {} : { limits }),
      });
    case "antigravity":
      return new AntigravityAdapter();
    // The fixture adapter requires test-owned absolute paths, and composite
    // fusion is v1.1 scope. Neither can be manufactured from durable config.
    case "fixture":
    case "composite-fusion":
      return null;
    default:
      return null;
  }
}

/** Lookup by config id, preserving the config's explicit enablement choice. */
export function registeredAdapter(
  adapters: Readonly<Record<string, AdapterEntry>>,
  adapterId: string,
  runtime?: AwsfConfig["runtime"],
): HarnessAdapter | null {
  const entry = adapters[adapterId];
  if (entry === undefined || entry.enabled === false) return null;
  return adapterFor(entry, runtime);
}
