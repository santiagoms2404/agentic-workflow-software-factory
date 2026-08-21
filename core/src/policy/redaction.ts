import { REDACTED_VALUE, scrubCredentialString } from "../../../dashboard/shared/credential-patterns.ts";

export {
  CREDENTIAL_PATTERNS,
  containsCredential,
  scrubCredentialString,
} from "../../../dashboard/shared/credential-patterns.ts";

const CREDENTIAL_KEY = /^(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|private[_-]?key|credential)$/i;

export { REDACTED_VALUE };

export function credentialKey(key: string): boolean {
  return CREDENTIAL_KEY.test(key);
}

/**
 * Returns a detached, recursively scrubbed value and never mutates its input.
 * Credential-named fields are redacted even when their current value is not
 * recognizable; shape-based matching is defense against new token formats.
 */
export function scrubCredentials<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") return scrubCredentialString(node);
    if (node === null || typeof node !== "object") return node;
    const prior = seen.get(node);
    if (prior !== undefined) return prior;
    if (Array.isArray(node)) {
      const output: unknown[] = [];
      seen.set(node, output);
      for (const item of node) output.push(visit(item));
      return output;
    }
    const output: Record<string, unknown> = {};
    seen.set(node, output);
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      output[key] = credentialKey(key) ? REDACTED_VALUE : visit(child);
    }
    return output;
  };
  return visit(value) as T;
}

/** Keeps JSON columns valid while scrubbing a snapshot supplied as text. */
export function scrubJsonText(json: string): string {
  try {
    return JSON.stringify(scrubCredentials(JSON.parse(json) as unknown));
  } catch {
    return JSON.stringify(scrubCredentialString(json));
  }
}

export function stringifyRedacted(value: unknown): string {
  return JSON.stringify(scrubCredentials(value));
}
