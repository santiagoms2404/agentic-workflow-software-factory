import { KNOWN_RISK_TIERS, type RiskTierName } from "../config/schema.ts";
import { compilePathGlob, normalizeRepositoryPath } from "./path-policy.ts";

export const RISK_TIERS = KNOWN_RISK_TIERS;

export interface RiskPolicy {
  readonly default: RiskTierName;
  readonly paths: Readonly<Record<string, RiskTierName>>;
  readonly caseSensitive?: boolean;
}

export interface RiskClassification {
  readonly tier: RiskTierName;
  readonly source: "default" | "path" | "operator-override";
  readonly matched: readonly { path: string; glob: string; tier: RiskTierName }[];
  readonly classifiedTier: RiskTierName;
  readonly invalidPaths?: readonly string[];
}

export interface OperatorRiskOverride {
  readonly tier: RiskTierName;
  /** An override is an auditable operator decision, never an inferred downgrade. */
  readonly reason: string;
}

function tierRank(tier: RiskTierName): number {
  return RISK_TIERS.indexOf(tier);
}

export function classifyRisk(
  paths: readonly string[],
  policy: RiskPolicy,
  override?: OperatorRiskOverride,
): RiskClassification {
  const normalized: string[] = [];
  const invalidPaths: string[] = [];
  for (const raw of paths) {
    try {
      normalized.push(normalizeRepositoryPath(raw));
    } catch {
      invalidPaths.push(raw);
    }
  }
  const uniqueNormalized = [...new Set(normalized)].sort();
  const uniqueInvalid = [...new Set(invalidPaths)].sort();
  const caseSensitive = policy.caseSensitive ?? process.platform !== "win32";
  const rules = uniqueNormalized.length === 0 ? [] : Object.entries(policy.paths).map(([glob, tier]) => ({
    glob,
    tier,
    matcher: compilePathGlob(glob, caseSensitive),
  }));
  const matched: { path: string; glob: string; tier: RiskTierName }[] = [];
  let classifiedTier = policy.default;
  for (const path of uniqueNormalized) {
    for (const { glob, tier, matcher } of rules) {
      if (!matcher.test(path)) continue;
      matched.push({ path, glob, tier });
      if (tierRank(tier) > tierRank(classifiedTier)) classifiedTier = tier;
    }
  }
  const invalidExtra = uniqueInvalid.length > 0 ? { invalidPaths: Object.freeze(uniqueInvalid) } : {};
  if (override !== undefined) {
    if (!override.reason.trim()) throw new Error("an operator risk override requires a reason");
    return Object.freeze({
      tier: override.tier,
      source: "operator-override",
      matched: Object.freeze(matched),
      classifiedTier,
      ...invalidExtra,
    });
  }
  return Object.freeze({
    tier: classifiedTier,
    source: matched.length === 0 ? "default" : "path",
    matched: Object.freeze(matched),
    classifiedTier,
    ...invalidExtra,
  });
}

export function tierForPaths(paths: readonly string[], policy: RiskPolicy): RiskTierName {
  return classifyRisk(paths, policy).tier;
}

/** `RiskTierName` as the numeric tier the lifecycle counts in. */
export function tierNumberOf(tier: RiskTierName): 0 | 1 | 2 {
  const rank = tierRank(tier);
  return rank === 2 ? 2 : rank === 1 ? 1 : 0;
}

export interface RiskAdmission {
  readonly classified: RiskTierName;
  readonly sufficient: boolean;
  /** The path/glob pairs that raised the classification above the attempt's tier. */
  readonly raisedBy: readonly { path: string; glob: string; tier: RiskTierName }[];
}

/**
 * Whether an attempt at `tier` may touch these paths under `policy`.
 *
 * This is the reader `risk.paths` never had. Without it the configuration block
 * that declares which paths deserve tighter controls had no effect on any
 * attempt: an owner could raise a glob to T2 and change nothing, and get no
 * error saying so.
 */
export function admitRisk(
  paths: readonly string[],
  tier: 0 | 1 | 2,
  policy: RiskPolicy,
): RiskAdmission {
  const classification = classifyRisk(paths, policy);
  const classified = classification.classifiedTier;
  const invalid = classification.invalidPaths ?? [];
  return Object.freeze({
    classified,
    sufficient: invalid.length === 0 && tierNumberOf(classified) <= tier,
    raisedBy: Object.freeze(
      classification.matched.filter((match) => tierNumberOf(match.tier) > tier),
    ),
  });
}
