import type { AgentDefinition } from "../config/schema.ts";

export const PERMISSION_PROFILE_NAMES = ["no-tools", "readonly", "managed-worker"] as const;
export type PermissionProfileName = (typeof PERMISSION_PROFILE_NAMES)[number];

/**
 * Config capability names. Provider adapters translate `exec` to their own
 * concrete shell tool name; neither spelling widens a read-only profile.
 */
const PROFILE_CEILINGS: Readonly<Record<PermissionProfileName, ReadonlySet<string>>> = Object.freeze({
  "no-tools": new Set<string>(),
  readonly: new Set(["read", "grep", "find", "ls"]),
  "managed-worker": new Set(["read", "grep", "find", "ls", "edit", "write", "exec", "bash"]),
});

export interface PermissionProfile {
  readonly name: PermissionProfileName;
  /** Exact allowlist handed to the adapter; extension tools are absent unless named here. */
  readonly tools: readonly string[];
  /** Empty means repository-read-only, not session-runtime-read-only. */
  readonly writes: readonly string[];
  readonly repositoryReadOnly: boolean;
  readonly sessionRuntimeWritable: true;
}

export class PermissionProfileInvalid extends Error {
  readonly profile: string;
  readonly tools: readonly string[];

  constructor(profile: string, tools: readonly string[], detail: string) {
    super(`invalid permission profile ${JSON.stringify(profile)}: ${detail}`);
    this.name = "PermissionProfileInvalid";
    this.profile = profile;
    this.tools = tools;
  }
}

export function resolvePermissionProfile(
  name: string,
  tools: readonly string[],
  writes: readonly string[],
): PermissionProfile {
  if (!(PERMISSION_PROFILE_NAMES as readonly string[]).includes(name)) {
    throw new PermissionProfileInvalid(name, tools, `known profiles: ${PERMISSION_PROFILE_NAMES.join(", ")}`);
  }
  const profileName = name as PermissionProfileName;
  const duplicates = tools.filter((tool, index) => tools.indexOf(tool) !== index);
  if (duplicates.length > 0) {
    throw new PermissionProfileInvalid(name, tools, `duplicate tool names: ${[...new Set(duplicates)].join(", ")}`);
  }
  const ceiling = PROFILE_CEILINGS[profileName];
  const outside = tools.filter((tool) => !ceiling.has(tool));
  if (outside.length > 0) {
    throw new PermissionProfileInvalid(
      name,
      tools,
      `tools exceed the profile ceiling: ${outside.join(", ")}`,
    );
  }
  return Object.freeze({
    name: profileName,
    tools: Object.freeze([...tools]),
    writes: Object.freeze([...writes]),
    repositoryReadOnly: writes.length === 0,
    sessionRuntimeWritable: true,
  });
}

export function permissionProfileForAgent(agent: AgentDefinition): PermissionProfile {
  return resolvePermissionProfile(agent.tools.profile, agent.tools.allow, agent.writes);
}

/** An adapter or extension may dispatch only a tool named in the exact list. */
export function toolAllowed(profile: PermissionProfile, tool: string): boolean {
  return profile.tools.includes(tool);
}

export function assertToolAllowed(profile: PermissionProfile, tool: string): void {
  if (!toolAllowed(profile, tool)) {
    throw new PermissionProfileInvalid(profile.name, profile.tools, `tool ${JSON.stringify(tool)} is not allowed`);
  }
}
