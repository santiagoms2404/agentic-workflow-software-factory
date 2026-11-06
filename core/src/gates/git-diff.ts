import { compilePathGlob, normalizeRepositoryPath } from "../policy/path-policy.ts";
import { protectedExemptionAllows, isProtectedCapability, type ProtectedFilesCapability } from "../contracts/protected-capability.ts";
import { isPlanAdmissionCapability, planAdmissionExemptionAllows, type PlanAdmissionCapability } from "../registry/plan-admission.ts";
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

function compilePolicyGlobs(globs: readonly string[], caseSensitive: boolean): readonly RegExp[] | null {
  try {
    return globs.map((glob) => compilePathGlob(glob, caseSensitive));
  } catch {
    return null;
  }
}

function classifyPath(path: string, matchers: readonly RegExp[] | null): { valid: boolean; matches: boolean } {
  let normalizedPath: string;
  try {
    normalizedPath = normalizeRepositoryPath(path);
  } catch {
    return { valid: false, matches: false };
  }
  if (matchers === null) return { valid: false, matches: false };
  let matches = false;
  // Deliberately inspect every matcher: a matching early grant must not hide
  // a malformed later policy entry, which was compiled above.
  for (const matcher of matchers) {
    if (matcher.test(normalizedPath)) matches = true;
  }
  return { valid: true, matches };
}

export function noProtectedPaths(
  changedPaths: readonly string[],
  protectedPaths: readonly string[],
  caseSensitive = true,
  capabilities: readonly (ProtectedFilesCapability | PlanAdmissionCapability)[] = [],
): GateReport {
  const report = new GateReport("no_protected_paths");
  if (changedPaths.length === 0) return report.check("change-set", true, "no changed paths");
  const insensitiveCapability = capabilities.some(capability => isProtectedCapability(capability) || isPlanAdmissionCapability(capability));
  const matchers = compilePolicyGlobs(protectedPaths, insensitiveCapability ? false : caseSensitive);
  for (const path of uniqueSorted(changedPaths)) {
    const classification = classifyPath(path, matchers);
    const ok = classification.valid && (!classification.matches || capabilities.some(capability => protectedExemptionAllows(capability, path) || planAdmissionExemptionAllows(capability, path)));
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
  const matchers = compilePolicyGlobs(writes, caseSensitive);
  for (const path of uniqueSorted(changedPaths)) {
    const classification = classifyPath(path, matchers);
    report.check(path, classification.valid && classification.matches, classification.matches ? "matches an allowed write glob" : "outside allowed write globs or invalid policy");
  }
  return report;
}
