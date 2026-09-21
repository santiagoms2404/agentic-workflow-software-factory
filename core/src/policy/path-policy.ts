import { protectedExemptionAllows, protectedWriteContext, type ProtectedFilesCapability } from "../contracts/protected-capability.ts";
import { posix } from "node:path";

export type PathViolationReason = "invalid-path" | "outside-write-globs" | "protected-path";

export interface PathViolation {
  readonly path: string;
  readonly reasons: readonly PathViolationReason[];
}

export interface PathPolicy {
  readonly protectedCapability?: ProtectedFilesCapability;
  readonly writes: readonly string[];
  readonly protectedPaths: readonly string[];
  /** Defaults to this host's filesystem convention. */
  readonly caseSensitive?: boolean;
}

export class InvalidPolicyPath extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`invalid repository path ${JSON.stringify(path)}: ${detail}`);
    this.name = "InvalidPolicyPath";
    this.path = path;
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0)!;
    return point <= 31 || point === 127;
  });
}

/**
 * Git-facing paths are one normalized, repository-relative POSIX spelling.
 * Refusing rather than repairing is load-bearing: converting a backslash or
 * dropping a `..` would authorize a different path from the one observed.
 */
export function normalizeRepositoryPath(path: string): string {
  if (path.length === 0) throw new InvalidPolicyPath(path, "empty paths do not name an artifact");
  if (hasControlCharacter(path)) {
    throw new InvalidPolicyPath(path, "control characters are refused rather than display-escaped");
  }
  if (path.includes("\\")) throw new InvalidPolicyPath(path, "backslashes are ambiguous across platforms");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new InvalidPolicyPath(path, "the path must be relative to the worktree");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new InvalidPolicyPath(path, "empty, dot, and traversal segments are refused");
  }
  const normalized = posix.normalize(path);
  if (normalized !== path || normalized === ".." || normalized.startsWith("../")) {
    throw new InvalidPolicyPath(path, "the path is not normalized or escapes the worktree");
  }
  return normalized;
}

function normalizeGlob(glob: string): string {
  if (glob.length === 0) throw new InvalidPolicyPath(glob, "empty globs grant nothing; use writes: []");
  if (hasControlCharacter(glob) || glob.includes("\\") || glob.startsWith("/") || /^[A-Za-z]:/.test(glob)) {
    throw new InvalidPolicyPath(glob, "globs must use relative POSIX separators");
  }
  const segments = glob.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new InvalidPolicyPath(glob, "glob segments may not be empty, dot, or traversal");
  }
  return glob;
}

function escapeRegex(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

/** A single star never consumes a separator; a globstar does, including zero directory segments. */
function globSource(glob: string): string {
  let source = "";
  for (let index = 0; index < glob.length;) {
    const character = glob[index]!;
    if (character === "*" && glob[index + 1] === "*") {
      if (glob[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 3;
      } else {
        source += ".*";
        index += 2;
      }
      continue;
    }
    if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += escapeRegex(character);
    index += 1;
  }
  return source;
}

export function matchesPathGlob(path: string, glob: string, caseSensitive = process.platform !== "win32"): boolean {
  const normalizedPath = normalizeRepositoryPath(path);
  const normalizedGlob = normalizeGlob(glob);
  return new RegExp(`^${globSource(normalizedGlob)}$`, caseSensitive ? "" : "i").test(normalizedPath);
}

/** Alias kept intentionally terse for callers classifying many paths. */
export const pathMatches = matchesPathGlob;

export function validatePathPolicy(policy: PathPolicy): void {
  for (const glob of [...policy.writes, ...policy.protectedPaths]) normalizeGlob(glob);
}

export function evaluatePathPolicy(paths: readonly string[], policy: PathPolicy): readonly PathViolation[] {
  validatePathPolicy(policy);
  const caseSensitive = policy.caseSensitive ?? process.platform !== "win32";
  const violations: PathViolation[] = [];
  for (const observed of [...new Set(paths)].sort()) {
    let path: string;
    try {
      path = normalizeRepositoryPath(observed);
    } catch {
      violations.push(Object.freeze({ path: observed, reasons: Object.freeze(["invalid-path"] as const) }));
      continue;
    }
    const reasons: PathViolationReason[] = [];
    if (!policy.writes.some((glob) => matchesPathGlob(path, glob, caseSensitive))) {
      reasons.push("outside-write-globs");
    }
    if (policy.protectedPaths.some((glob) => matchesPathGlob(path, glob, protectedWriteContext(policy.protectedCapability) === null ? caseSensitive : false)) && !protectedExemptionAllows(policy.protectedCapability, path, "write")) {
      reasons.push("protected-path");
    }
    if (reasons.length > 0) violations.push(Object.freeze({ path, reasons: Object.freeze(reasons) }));
  }
  return Object.freeze(violations);
}

/** Session-runtime output is outside Git policy and remains writable for every profile. */
export function writeTargetAllowed(
  target: { readonly scope: "repository"; readonly path: string } | { readonly scope: "session-runtime" },
  policy: PathPolicy,
): boolean {
  if (target.scope === "session-runtime") return true;
  return evaluatePathPolicy([target.path], policy).length === 0;
}

export class PermissionBreach extends Error {
  readonly offendingPaths: readonly string[];
  readonly violations: readonly PathViolation[];
  readonly correctable = false;
  readonly phaseCause = "permission-breach" as const;

  constructor(violations: readonly PathViolation[]) {
    const frozen = Object.freeze([...violations]);
    const paths = Object.freeze(frozen.map((violation) => violation.path).sort());
    super(`permission breach; aborting phase; offending paths: ${paths.map((path) => JSON.stringify(path)).join(", ")}`);
    this.name = "PermissionBreach";
    this.violations = frozen;
    this.offendingPaths = paths;
  }
}

/** Collects every offender before throwing; a breach is terminal, never a correction request. */
export function enforcePathPolicy(paths: readonly string[], policy: PathPolicy): void {
  const violations = evaluatePathPolicy(paths, policy);
  if (violations.length > 0) throw new PermissionBreach(violations);
}
