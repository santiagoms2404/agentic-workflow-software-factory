export const REDACTED_VALUE = "[REDACTED]";

/** One shared credential vocabulary for persistence, projection, API, and rendered folds. */
export const CREDENTIAL_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /AKIA[0-9A-Z]{16}/,
  new RegExp(
    `${"-".repeat(5)}BEGIN ([A-Z ]*PRIVATE KEY)${"-".repeat(5)}[\\s\\S]*?(?:${"-".repeat(5)}END \\1${"-".repeat(5)}|$)`,
  ),
  /gh[opusr]_[A-Za-z0-9]{16,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\bBasic\s+[A-Za-z0-9+/]{12,}={0,2}/i,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /(?:[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/i,
]);

export function containsCredential(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

export function globalCredentialPattern(pattern: RegExp): RegExp {
  const flags = pattern.global ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

export function scrubCredentialString(value: string): string {
  return CREDENTIAL_PATTERNS.reduce(
    (scrubbed, pattern) => scrubbed.replace(globalCredentialPattern(pattern), REDACTED_VALUE),
    value,
  );
}
