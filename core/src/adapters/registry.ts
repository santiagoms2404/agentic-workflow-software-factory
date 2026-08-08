// Config chooses an adapter id; this registry maps its kind to the reviewed
// implementation. It does not infer providers from quota or selectors.

import type { AdapterEntry } from "../config/schema.ts";
import { AntigravityAdapter } from "./antigravity.ts";
import { ClaudeCodeAdapter } from "./claude-code.ts";
import type { HarnessAdapter } from "./interface.ts";
import { PiCodexAdapter } from "./pi-codex.ts";

export type RegisteredAdapterKind = "claude-code" | "pi-codex" | "antigravity";

export function adapterFor(entry: AdapterEntry): HarnessAdapter | null {
  switch (entry.kind) {
    case "claude-code":
      return new ClaudeCodeAdapter({ executable: entry.executable });
    case "pi-codex":
      return new PiCodexAdapter({ executable: entry.executable });
    case "antigravity":
      return new AntigravityAdapter();
    // The fixture adapter requires test-owned absolute paths, and composite
    // fusion is v1.1 scope. Neither can be manufactured from durable config.
    case "fixture":
    case "composite-fusion":
      return null;
  }
}

/** Lookup by config id, preserving the config's explicit enablement choice. */
export function registeredAdapter(
  adapters: Readonly<Record<string, AdapterEntry>>,
  adapterId: string,
): HarnessAdapter | null {
  const entry = adapters[adapterId];
  if (entry === undefined || entry.enabled === false) return null;
  return adapterFor(entry);
}
