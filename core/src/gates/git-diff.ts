import { matchesPathGlob, normalizeRepositoryPath } from "../policy/path-policy.ts";
import { protectedExemptionAllows, isProtectedCapability, type ProtectedFilesCapability } from "../contracts/protected-capability.ts";
import { GateReport } from "./interface.ts";

function uniqueSorted(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort();
}

/** Exact set equality: both undeclared host changes and invented claims fail. */
export function diffMatchesClaims(changedPaths: readonly string[], claimedPaths: readonly string[]): GateReport {
  const report = new GateReport("diff_matches_claims");
  const actual = uniqueSorted(changedPaths);
  const claimed = uniqueSorted(claimedPaths);
  const actualSet = new Set(actual);
  const claimedSet = new Set(claimed);
  for (const path of claimed) report.check(`claimed:${path}`, actualSet.has(path), actualSet.has(path) ? "present in host diff" : "claimed but unchanged");
  for (const path of actual) report.check(`changed:${path}`, claimedSet.has(path), claimedSet.has(path) ? "declared by producer" : "undeclared host change");
  if (actual.length === 0 && claimed.length === 0) report.check("exact change set", true, "both sets are empty");
  return report;
}

export interface HeadAdvanceEvidence {
  readonly baseSha: string;
  readonly headSha: string | null;
  readonly hostCommitExists: boolean;
}

export function headAdvanced(evidence: HeadAdvanceEvidence): GateReport {
  return new GateReport("head_advanced")
    .check("host commit exists", evidence.hostCommitExists && evidence.headSha !== null, evidence.headSha ?? "no host commit")
    .check("HEAD differs from base", evidence.headSha !== null && evidence.headSha !== evidence.baseSha, `base=${evidence.baseSha}; head=${evidence.headSha ?? "none"}`);
}

function classifyPath(path: string, globs: readonly string[], caseSensitive: boolean): { valid: boolean; matches: boolean } {
  try {
    normalizeRepositoryPath(path);
    let matches = false;
    // Deliberately inspect every glob: a matching early grant must not hide a
    // malformed later policy entry.
    for (const glob of globs) {
      if (matchesPathGlob(path, glob, caseSensitive)) matches = true;
    }
    return { valid: true, matches };
  } catch {
    return { valid: false, matches: false };
  }
}

export function noProtectedPaths(
  changedPaths: readonly string[],
  protectedPaths: readonly string[],
  caseSensitive = true,
  capabilities: readonly ProtectedFilesCapability[] = [],
): GateReport {
  const report = new GateReport("no_protected_paths");
  if (changedPaths.length === 0) return report.check("change-set", true, "no changed paths");
  for (const path of uniqueSorted(changedPaths)) {
    const classification = classifyPath(path, protectedPaths, capabilities.some(isProtectedCapability) ? false : caseSensitive);
    const ok = classification.valid && (!classification.matches || capabilities.some(capability => protectedExemptionAllows(capability, path)));
    report.check(path, ok, !classification.valid ? "invalid path or protected-path policy" : classification.matches ? "matches a protected path" : "not protected");
  }
  return report;
}

export function writesWithinGlobs(
  changedPaths: readonly string[],
  writes: readonly string[],
  caseSensitive = true,
): GateReport {
  const report = new GateReport("writes_within_globs");
  if (changedPaths.length === 0) return report.check("change-set", true, "no changed paths");
  for (const path of uniqueSorted(changedPaths)) {
    const classification = classifyPath(path, writes, caseSensitive);
    report.check(path, classification.valid && classification.matches, classification.matches ? "matches an allowed write glob" : "outside allowed write globs or invalid policy");
  }
  return report;
}
