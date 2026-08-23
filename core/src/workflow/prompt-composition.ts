import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { AgentDefinition } from "../config/schema.ts";
import { REDACTED_VALUE, scrubCredentialString } from "../policy/redaction.ts";

export interface PromptBundle {
  readonly userPrompt: string;
  readonly systemPrompt: string;
}

export interface ComposePromptBundleOptions {
  readonly configPath: string;
  readonly agent: AgentDefinition;
}

const SHARED_PROMPT_PATH = "prompts/shared/headless-role.md";
const SYSTEM_PROMPT_SEPARATOR = "\n\n";
const REVIEWER_PRESERVATION_OVERLAY =
  "Dissent, findings, limitations, locations, observations, and consequences outrank brevity.\n";

const ROLE_POLICIES = {
  planner: "common",
  builder: "common",
  reviewer: "reviewer-preserving",
  documenter: "common",
  scout: "common",
  intake: "common",
  designer: "common",
  "architecture-reviewer": "reviewer-preserving",
} as const;

type PromptRole = keyof typeof ROLE_POLICIES;
type RolePolicy = (typeof ROLE_POLICIES)[PromptRole];

export class UnknownPromptRole extends Error {
  constructor(role: string) {
    super(`prompt composition rejected unknown role ${JSON.stringify(role)}; declare its shared policy before launch`);
    this.name = "UnknownPromptRole";
  }
}

export class PromptCredentialRejected extends Error {
  constructor(source: string) {
    super(`prompt bundle rejected ${source}: credential-shaped data is never sent to a provider`);
    this.name = "PromptCredentialRejected";
  }
}

async function readContainedPrompt(configPath: string, path: string): Promise<string> {
  if (isAbsolute(path)) throw new Error(`prompt path must be relative: ${path}`);
  const root = await realpath(dirname(resolve(configPath)));
  const candidate = resolve(root, path);
  const fromRoot = relative(root, candidate);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`prompt path escapes the config context: ${path}`);
  }
  const physical = await realpath(candidate);
  const physicalFromRoot = relative(root, physical);
  if (physicalFromRoot.startsWith("..") || isAbsolute(physicalFromRoot)) {
    throw new Error(`prompt symlink escapes the config context: ${path}`);
  }
  return readFile(physical, "utf8");
}

function credentialSafePrompt(value: string, source: string): string {
  if (scrubCredentialString(value) !== value || value.includes(REDACTED_VALUE)) {
    throw new PromptCredentialRejected(source);
  }
  return value;
}

function policyFor(role: string): RolePolicy {
  if (!Object.hasOwn(ROLE_POLICIES, role)) throw new UnknownPromptRole(role);
  return ROLE_POLICIES[role as PromptRole];
}

function renderSharedBytes(commonSharedBytes: string, policy: RolePolicy): string {
  if (commonSharedBytes.length === 0) return "";
  if (policy === "reviewer-preserving") {
    return [commonSharedBytes, REVIEWER_PRESERVATION_OVERLAY].join(SYSTEM_PROMPT_SEPARATOR);
  }
  return commonSharedBytes;
}

/**
 * Loads and composes the complete headless prompt bundle for one configured role.
 *
 * Role-system bytes are never normalized. This module owns the only separator:
 * an empty shared source reproduces M1 exactly, while non-empty shared bytes are
 * appended after the role contract. The closed policy rejects undeclared roles.
 */
export async function composePromptBundle(options: ComposePromptBundleOptions): Promise<PromptBundle> {
  const policy = policyFor(options.agent.name);
  const userPrompt = credentialSafePrompt(
    await readContainedPrompt(options.configPath, options.agent.prompt.user),
    "configured user prompt",
  );
  const roleSystemPrompt = credentialSafePrompt(
    await readContainedPrompt(options.configPath, options.agent.prompt.system),
    "configured system prompt",
  );
  const commonSharedBytes = credentialSafePrompt(
    await readContainedPrompt(options.configPath, SHARED_PROMPT_PATH),
    "shared headless role prompt",
  );
  const renderedSharedBytes = renderSharedBytes(commonSharedBytes, policy);
  const systemPrompt = renderedSharedBytes.length === 0
    ? roleSystemPrompt
    : [roleSystemPrompt, renderedSharedBytes].join(SYSTEM_PROMPT_SEPARATOR);
  return Object.freeze({ userPrompt, systemPrompt });
}
