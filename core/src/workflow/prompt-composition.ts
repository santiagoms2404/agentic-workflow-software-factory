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

/**
 * Loads and composes the complete headless prompt bundle for one configured role.
 *
 * M1 has no shared component. The final system prompt is therefore the exact
 * role-system file content, with no separator or newline normalization.
 */
export async function composePromptBundle(options: ComposePromptBundleOptions): Promise<PromptBundle> {
  const userPrompt = credentialSafePrompt(
    await readContainedPrompt(options.configPath, options.agent.prompt.user),
    "configured user prompt",
  );
  const roleSystemPrompt = credentialSafePrompt(
    await readContainedPrompt(options.configPath, options.agent.prompt.system),
    "configured system prompt",
  );
  return Object.freeze({ userPrompt, systemPrompt: roleSystemPrompt });
}
