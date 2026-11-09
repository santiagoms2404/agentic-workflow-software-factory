import { REDACTED_VALUE, scrubCredentialString } from "../../../dashboard/shared/credential-patterns.ts";

export {
  CREDENTIAL_PATTERNS,
  containsCredential,
  scrubCredentialString,
} from "../../../dashboard/shared/credential-patterns.ts";

const CREDENTIAL_KEY =
  /(?:api[_-]?key|access[_-]?key|auth[_-]?key|secret[_-]?key|private[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|session[_-]?token|bearer[_-]?token|token(?!s)|password|passwd|passphrase|secret|credential|authorization)/i;

export { REDACTED_VALUE };

export function credentialKey(key: string): boolean {
  // An opaque authorization reference is an identifier, not an access token;
  // redacting it would corrupt the digest-bound owner amendment in the journal.
  if (key === "authorizationId") return false;
  return CREDENTIAL_KEY.test(key);
}

/**
 * Returns a detached, recursively scrubbed value and never mutates its input.
 * Credential-named fields are redacted even when their current value is not
 * recognizable; shape-based matching is defense against new token formats.
 */
export function scrubCredentials<T>(value: T, omitKey?: (key: string) => boolean): T {
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
      if (omitKey?.(key)) continue;
      output[key] = credentialKey(key) ? REDACTED_VALUE : visit(child);
    }
    return output;
  };
  return visit(value) as T;
}

/**
 * Keeps JSON columns valid while scrubbing a snapshot supplied as text. Text
 * that is not JSON, such as a truncated body, has no parsed keys, so its
 * credential-named fields are redacted by name before the shape scrubber runs.
 */
export function scrubJsonText(json: string): string {
  try {
    return JSON.stringify(scrubCredentials(JSON.parse(json) as unknown));
  } catch {
    return JSON.stringify(scrubCredentialString(redactCredentialFieldsInText(json)));
  }
}

/** Where the value starting at `start` ends. A nested value runs to the end of the text, which fails closed. */
function valueEnd(text: string, start: number): number {
  const first = text[start];
  if (first === '"') {
    let index = start + 1;
    while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
    return Math.min(index + 1, text.length);
  }
  if (first === "{" || first === "[") return text.length;
  let index = start;
  while (index < text.length && !/[\s,}\]]/u.test(text[index]!)) index += 1;
  return index;
}

/** Replaces the value of every credential-named `"key": value` pair in text that is not JSON. */
function redactCredentialFieldsInText(text: string): string {
  const field = /"([^"\\\n]{1,200})"\s*:\s*/gu;
  let out = "";
  let cursor = 0;
  for (let match = field.exec(text); match !== null; match = field.exec(text)) {
    if (!credentialKey(match[1]!)) continue;
    const start = match.index + match[0].length;
    const end = valueEnd(text, start);
    out += `${text.slice(cursor, start)}"${REDACTED_VALUE}"`;
    cursor = end;
    field.lastIndex = end;
  }
  return out + text.slice(cursor);
}

export function stringifyRedacted(value: unknown): string {
  return JSON.stringify(scrubCredentials(value));
}
